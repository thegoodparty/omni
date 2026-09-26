"""Instrumentation gap sweep (DATA-2151) — deterministic enumeration + graceful LLM judgment.

Enumerates candidate product surfaces in gp-webapp and gp-api, diffs them against
tracking call sites, and surfaces the ones with no nearby event as ranked recommendations
with disposition tracking. Recommendations only: never edits product packages.

Pure functions (config, enumeration, diff, id, rank, state merge, render) take plain data
and have no IO, so they are unit-tested with fixtures. Only the walk/IO/CLI layer touches
disk. Phase 1 is fully deterministic; Phase 2 adds a graceful Anthropic rubric-judgment pass
(`run_judgment`) over the untriaged candidate gaps — only judge-confirmed gaps enter state,
and a missing key or failed call degrades to a compact status line, never a crash.

Running the one-off seed (needs a funded ANTHROPIC_API_KEY):
  ANTHROPIC_API_KEY=... uv run instrumentation_gaps.py --seed
    -> writes every confirmed gap to instrumentation_data/instrumentation_gaps.json as `new`
       and a review artifact to instrumentation_data/instrumentation-gaps-seed.md
  # fill in `- disposition:` / `- reason:` in the artifact, then:
  uv run instrumentation_gaps.py --load-seed instrumentation_data/instrumentation-gaps-seed.md
    -> applies your dispositions back into the state file
Commit the resulting instrumentation_gaps.json to establish the baseline; the weekly
cadence then shows deltas. The seed is deferred until the funded key is available (the CI
secret ANTHROPIC_PRODUCT_ANALYTICS_API_KEY, or a local console key).
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import sys
from collections.abc import Iterable, Mapping, Sequence
from datetime import date, datetime
from pathlib import Path

import yaml
from pydantic import BaseModel, Field

import llm_judge
import ts_imports
import ts_scopes

class CorruptStateError(Exception):
    """The on-disk state file exists but is not a readable JSON object. Distinct from a
    missing file (legitimate first run) — a caller must treat this as 'stop, don't touch
    the file', never as 'treat everything as new'."""


HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[3]  # python -> scripts -> runbooks -> packages -> omni
DATA_DIR = HERE / "instrumentation_data"
CONFIG_PATH = HERE / "instrumentation_gaps_config.yaml"
DEFAULT_STATE = DATA_DIR / "instrumentation_gaps.json"
DEFAULT_LOG = DATA_DIR / "instrumentation-gaps-log.md"
# Run-level counters, deliberately a sibling of DEFAULT_STATE rather than a key inside it:
# that file is a flat map keyed by gap id and load_state rejects anything else. Same shape of
# small companion file as amplitude_event_provenance_state.json.
DEFAULT_RUN_STATE = DATA_DIR / "instrumentation_gaps_run_state.json"

JUDGE_OK_STATUSES = llm_judge.OK_STATUSES
NO_JUDGE_STATUS = "skipped: --no-judge"
# Statuses that move the judge-failure streak neither up nor down. "no-candidates" never
# exercised the judge, and --no-judge is a deliberate opt-out — counting a local run of it
# would commit a spurious streak into the state file and make the next digest cry wolf.
JUDGE_STREAK_HOLD = JUDGE_OK_STATUSES + (NO_JUDGE_STATUS,)

DEFAULT_RUBRIC_PATH = REPO_ROOT / ".claude/skills/instrument-analytics-event/SKILL.md"
DEFAULT_MODEL = os.environ.get("GAP_JUDGE_MODEL", "claude-sonnet-5")


def gaps_feedback_url() -> str | None:
    """GitHub link where a reviewer edits disposition + reason inline. Env override, else the
    committed state file on main."""
    explicit = os.environ.get("GP_GAPS_FEEDBACK_URL")
    if explicit:
        return explicit
    return (
        "https://github.com/thegoodparty/omni/blob/main/"
        "packages/runbooks/scripts/python/instrumentation_data/instrumentation_gaps.json"
    )


def gaps_browse_url() -> str | None:
    """Read-only gaps tab in the event-state sheet. Env override, else derived from the sheet
    id (+ optional gaps tab gid). None when no sheet id is set — the post then omits the link."""
    explicit = os.environ.get("GP_GAPS_BROWSE_URL")
    if explicit:
        return explicit
    sheet_id = os.environ.get("GP_EVENT_STATE_SHEET_ID")
    if not sheet_id:
        return None
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit"
    gid = os.environ.get("GP_GAPS_TAB_GID")
    return f"{url}#gid={gid}" if gid else url


# --- LLM judgment: schema + rubric -------------------------------------------
# The judge applies the instrument/skip rubric (single-sourced in SKILL.md) to each
# deterministic candidate gap. Deterministic enumeration is over-inclusive on purpose;
# this pass is the precision filter. Phase 1 keeps working if this whole section is
# skipped (see run_judgment's graceful contract).


class JudgeVerdict(BaseModel):
    id: str = Field(description="The candidate surface id, copied verbatim from the input.")
    is_gap: bool = Field(description="True if this surface should fire an event per the rubric.")
    rubric_rule: str = Field(description="Short name of the rubric rule that applies.")
    dashboard_question: str = Field(
        description="The product question the missing event would answer."
    )
    rank: int = Field(description="Priority 0-5, lower is higher priority.")
    reason: str = Field(description="One-line justification for the verdict.")


class JudgeBatch(BaseModel):
    results: list[JudgeVerdict]


def load_rubric(path: Path = DEFAULT_RUBRIC_PATH) -> str:
    """Read the instrument/skip rubric from the skill. Single-sourced — never copied here.
    Missing file raises FileNotFoundError; run_judgment treats that as a graceful skip."""
    return path.read_text()


# The roots walked when the config predates scan_roots. Keeps an old checkout scanning what
# it always scanned instead of silently scanning nothing.
_DEFAULT_SCAN_ROOTS = (
    {"path": "packages/gp-webapp", "detectors": "webapp"},
    {"path": "packages/gp-api/src", "detectors": "api"},
)


def load_gap_config(path: Path = CONFIG_PATH) -> dict:
    """Read the exclusion config and the scan roots. Missing file -> empty excludes and the
    default roots (scan everything we have always scanned)."""
    doc = {}
    if path.exists():
        doc = yaml.safe_load(path.read_text()) or {}
    roots = list(doc.get("scan_roots") or []) or [dict(r) for r in _DEFAULT_SCAN_ROOTS]
    return {
        "exclude_globs": list(doc.get("exclude_globs", []) or []),
        "scan_roots": roots,
    }


def is_excluded(rel_path: str, exclude_globs: Sequence[str]) -> bool:
    """True if the repo-relative path matches any exclusion glob."""
    return any(fnmatch.fnmatch(rel_path, g) for g in exclude_globs)


# --- enumeration: routes ------------------------------------------------------

_APP_PREFIX = "packages/gp-webapp/app"


def route_pattern_from_page_path(rel_path: str) -> str:
    """`.../app/dashboard/[slug]/page.tsx` -> `/dashboard/[slug]`. Route groups like
    `(marketing)` are organizational, not URL segments, so they drop out."""
    inner = rel_path[len(_APP_PREFIX):].removeprefix("/")
    parts = inner.split("/")
    parts = parts[:-1]  # drop the trailing page.tsx
    segs = [p for p in parts if not (p.startswith("(") and p.endswith(")"))]
    return "/" + "/".join(segs) if segs else "/"


def enumerate_route_surfaces(
    page_rel_paths: Iterable[str], exclude_globs: Sequence[str]
) -> list[dict]:
    """Every non-excluded `app/**/page.tsx` becomes a route surface keyed by URL pattern."""
    out: list[dict] = []
    for rel in sorted(page_rel_paths):
        if not rel.endswith("/page.tsx") or is_excluded(rel, exclude_globs):
            continue
        out.append(
            {"id": route_pattern_from_page_path(rel), "surface_type": "route", "location": rel}
        )
    return out


# --- enumeration: in-file heuristic detectors --------------------------------
# Intentionally over-inclusive. False positives are expected and are the Phase-2 judgment
# pass's job to drop; here they only need to be caught, not adjudicated.

_WEBAPP_DETECTORS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("wizard_stage", re.compile(r"\bcurrentStep\b|\bsetCurrentStep\b|<Stepper\b|useWizard\b")),
    ("form_submit", re.compile(r"onSubmit=\{|\bhandleSubmit\b")),
    ("cta", re.compile(r"<Button\b[^>]*onClick=")),
)
_API_DETECTORS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("api_job", re.compile(r"@Processor\(|@Process\(|\.process\(")),
    ("api_webhook", re.compile(r"@Post\(\s*['\"][^'\"]*webhook", re.IGNORECASE)),
    ("api_status", re.compile(r"status\s*[:=]\s*['\"](COMPLETED|FAILED|REJECTED|APPROVED)['\"]")),
)

# Keyed by surface_type so scan_repo can window a candidate's snippet around the same
# pattern that flagged it, rather than re-deriving the mapping there.
_DETECTOR_PATTERN: dict[str, re.Pattern[str]] = {
    name: pat for name, pat in (*_WEBAPP_DETECTORS, *_API_DETECTORS)
}

# Keyed by the scan root's `detectors` name (config-driven, DATA-2539) rather than a path
# prefix — with configurable roots a path prefix can no longer decide which set applies.
_DETECTOR_SETS = {"webapp": _WEBAPP_DETECTORS, "api": _API_DETECTORS}


# Detectors that get one candidate per match. cta is excluded deliberately: it is 74 of the
# 110 surfaces the old file-level filter discarded and it ranks lowest in the rubric, so
# per-match cta would add ~200 low-value candidates to every judge batch for decisions nobody
# acts on. route has no in-file match to key on at all. wizard_stage is excluded too: a
# wizard's N `currentStep` references are one wizard, not N surfaces — per-match detection
# measured 95 of 138 line-keyed ids and 9 of 17 duplicate ids, all for the same underlying
# surface. It still gets a scope-level (not file-level) tracking check — see the non-per-match
# branch below.
_PER_MATCH_TYPES = frozenset(
    {"form_submit", "api_job", "api_webhook", "api_status"}
)
# `onSubmit={handleThing}` and `onSubmit={(e) => ...}`
_PROP_IDENT = re.compile(r"=\{\s*([A-Za-z_$][\w$]*)\s*\}")
_PROP_INLINE = re.compile(r"=\{\s*(?:async\s*)?\(")
_DECL_MAX_LINES_TO_BRACE = 2


def _local_decl_block(code: str, ident: str, pairs) -> tuple[int, int] | None:
    """Span of `const ident = ...` / `function ident(...)` declared in this same file, or None
    when the name comes from props, an import or a hook."""
    m = re.search(
        rf"^[ \t]*(?:export\s+)?(?:const|let|function)\s+{re.escape(ident)}\b", code, re.M
    )
    if not m:
        return None
    after = [p for p in pairs if p[0] >= m.start()]
    if not after:
        return None
    open_idx, close_idx = min(after, key=lambda p: p[0])
    if code.count("\n", m.start(), open_idx) > _DECL_MAX_LINES_TO_BRACE:
        return None
    return (m.start(), close_idx + 1)


def surface_scope(code: str, text: str, match_start: int, pairs):
    """(span, name, kind) for one surface. Most specific scope first.

    1. `handler` — the named handler the prop references, wherever it is declared in this file.
    2. `inline` — the arrow written inline in the prop.
    3. `component` — the enclosing component.

    Step 1 is not an optimization, it is the whole fix. ChiefOfStaffChatBody.tsx is one
    component spanning all 1,327 lines; it fires 8 events between lines 293 and 804 and its
    chat submit at 1272 fires nothing. Scoped to the component the submit reads as tracked and
    the sweep stays silent — the exact cosmetic outcome DATA-2539 warns about. Scoped to
    `onSend` (declared at 895) it reads correctly as a gap."""
    tail = text[match_start : match_start + 120]
    ident = _PROP_IDENT.search(tail)
    if ident:
        span = _local_decl_block(code, ident.group(1), pairs)
        if span:
            return span, ident.group(1), "handler"
    if _PROP_INLINE.search(tail):
        after = [p for p in pairs if p[0] >= match_start]
        if after:
            open_idx, close_idx = min(after, key=lambda p: p[0])
            outer = ts_scopes.enclosing_scope(code, match_start, pairs)
            name = ts_scopes.scope_name(code, outer[0]) if outer else None
            return (open_idx, close_idx + 1), name, "inline"
    span = ts_scopes.enclosing_scope(code, match_start, pairs)
    if span:
        return span, ts_scopes.scope_name(code, span[0]), "component"
    return None, None, "none"


def _in_type_declaration(code: str, pos: int, pairs) -> bool:
    """True when the match sits inside an interface/type/enum body rather than code. Drops
    `currentStep?: string` without dropping the components that reference currentStep."""
    span = ts_scopes.enclosing_scope(code, pos, pairs, decisive=False)
    return span is not None and ts_scopes.scope_kind(code, span[0]) == "type"


def surface_id(
    rel_path: str, surface_type: str, text: str, match_start: int, match_count: int,
    scope_name: str | None,
) -> str:
    """A single match keeps the historic `path#type` id, named scope or not — nothing needs
    disambiguating, and this is what lets existing state entries in single-match files survive
    with their human rulings. Appending the scope name unconditionally would rename every
    entry and discard all 38 rulings instead of 21."""
    if match_count == 1:
        return f"{rel_path}#{surface_type}"
    if scope_name:
        return f"{rel_path}#{surface_type}#{scope_name}"
    return f"{rel_path}#{surface_type}#L{text.count(chr(10), 0, match_start) + 1}"


def detect_surfaces_in_file(rel_path: str, text: str, detector_set: str) -> list[dict]:
    """Run one detector set over a file's text. The caller resolves which set from the scan
    root the file came from — a path prefix cannot, now that roots are configurable.

    Per-match types (_PER_MATCH_TYPES) get one candidate per match, each scoped to its own
    handler/inline/component span so a file that tracks some things doesn't hide an untracked
    one (DATA-2539). Other types (cta, and anything outside _PER_MATCH_TYPES) keep the old
    coarse per-file unit — 'this file has buttons' — which the judgment pass refines."""
    detectors = _DETECTOR_SETS.get(detector_set)
    if not detectors:
        return []
    code = ts_scopes.blank_noncode(text)
    pairs = ts_scopes.brace_pairs(code)
    out: list[dict] = []
    for surface_type, pattern in detectors:
        matches = list(pattern.finditer(text))
        if surface_type == "wizard_stage":
            matches = [m for m in matches if not _in_type_declaration(code, m.start(), pairs)]
        if not matches:
            continue
        if surface_type == "wizard_stage":
            # One surface per file: a wizard's N `currentStep` references are one wizard, not
            # N surfaces. Measured: per-match wizard produced 95 of 138 line-keyed ids and 9
            # of 17 duplicate ids, all for the same underlying surface.
            # has_tracking is still scope-scoped, not file-scoped — the union of this
            # surface's own match scopes, which is strictly tighter than the whole file.
            spans = [
                span for span in (
                    ts_scopes.enclosing_scope(code, m.start(), pairs) for m in matches
                ) if span is not None
            ]
            out.append({
                "id": f"{rel_path}#{surface_type}",
                "surface_type": surface_type,
                "location": rel_path,
                "match_start": matches[0].start(),
                "has_tracking": any(
                    _TRACKING_RE.search(text[a:b]) is not None for a, b in spans
                ),
                "scope": spans[0] if spans else None,
            })
            continue
        if surface_type not in _PER_MATCH_TYPES:
            # Coarse unit: "this file has buttons" (cta). Unlike wizard_stage above, this
            # stays a genuinely file-level question — no has_tracking key here, so find_gaps
            # falls back to the whole-file files_with_tracking set, exactly the old behavior.
            out.append({
                "id": f"{rel_path}#{surface_type}",
                "surface_type": surface_type,
                "location": rel_path,
                "match_start": matches[0].start(),
                "scope": None,
            })
            continue
        seen: set[str] = set()
        for m in matches:
            span, name, scope_kind = surface_scope(code, text, m.start(), pairs)
            # Fail toward noise: an unresolved scope yields a candidate the judge can rule on.
            # A line-window fallback would read a neighbour's trackEvent and silently drop a
            # real gap, which is the failure this ticket exists to remove.
            has_tracking = span is not None and (
                _TRACKING_RE.search(text[span[0] : span[1]]) is not None
            )
            # The id names the surface's enclosing COMPONENT, never the handler identifier —
            # two untracked submits in the same component (e.g. `onSend` and `onSave`, each
            # its own named handler) must still collide down to a line key rather than mint
            # two same-looking-but-different ids from handler names a reviewer never sees in
            # the digest. Only the handler branch needs recomputing: inline/component already
            # name the enclosing scope.
            if scope_kind == "handler":
                outer = ts_scopes.enclosing_scope(code, m.start(), pairs)
                id_name = ts_scopes.scope_name(code, outer[0]) if outer else None
            else:
                id_name = name
            gid = surface_id(rel_path, surface_type, text, m.start(), len(matches), id_name)
            if gid in seen:
                # Two matches resolving to one scope. Fall to the line key rather than
                # silently dropping the second surface.
                line_key = f"{rel_path}#{surface_type}#L{text.count(chr(10), 0, m.start()) + 1}"
                gid = line_key
                # Two matches on ONE line collide again; an ordinal is the last tiebreak.
                # Without it the second surface silently overwrites the first in state.
                n = 2
                while gid in seen:
                    gid = f"{line_key}.{n}"
                    n += 1
            seen.add(gid)
            out.append({
                "id": gid,
                "surface_type": surface_type,
                "location": rel_path,
                "match_start": m.start(),
                "has_tracking": has_tracking,
                "scope": span,
                "scope_kind": scope_kind,
            })
    return out


def extract_context(
    text: str, pattern: re.Pattern[str] | None = None, max_lines: int = 40
) -> str:
    """A bounded code snippet for the judge to read. Windowed around the first pattern
    match when given, else the file head. Bounded so the judge input stays small."""
    lines = text.splitlines()
    if pattern is not None:
        match = pattern.search(text)
        if match is not None:
            hit_line = text.count("\n", 0, match.start())
            half = max_lines // 2
            start = max(0, hit_line - half)
            window = lines[start : start + max_lines]
            return "\n".join(window).strip("\n")
    return "\n".join(lines[:max_lines]).strip("\n")


def extract_context_at(
    text: str, match_start: int, scope: tuple[int, int] | None = None, max_lines: int = 40
) -> str:
    """A bounded snippet centered on one surface, preferring its resolved scope when that
    fits. The old windowing centered on the file's *first* match of the detector pattern,
    which for a per-match candidate is a different surface entirely — the judge was ruling on
    code it could not see."""
    if scope is not None:
        block = text[scope[0] : scope[1]]
        if block.count("\n") < max_lines:
            return block.strip("\n")
    lines = text.splitlines()
    hit = text.count("\n", 0, match_start)
    start = max(0, hit - max_lines // 2)
    return "\n".join(lines[start : start + max_lines]).strip("\n")


# --- call-site diff -----------------------------------------------------------

_TRACKING_RE = re.compile(r"\btrackEvent\s*\(|\bAnalyticsService\b|\.track\(")


def has_tracking_call(text: str) -> bool:
    """Whether a file fires any analytics event (frontend trackEvent or backend track)."""
    return _TRACKING_RE.search(text) is not None


def hook_fires_events(
    rel_path: str, text: str, files_with_tracking: set[str], exists
) -> bool:
    """Whether any `use*` hook this file imports fires events one hop away.

    Only the hook edge is followed. Measured on 2026-09-25: hook imports flag 8 of 259 gap
    files and caught both of that day's false alarms, while following every relative import
    flags 62 and is mostly a parent importing an unrelated tracked child, which says nothing
    about the parent's own surface."""
    for name, spec in ts_imports.parse_relative_imports(text):
        if not ts_imports.is_hook_name(name):
            continue
        target = ts_imports.resolve_import(rel_path, spec, exists)
        if target is not None and target in files_with_tracking:
            return True
    return False


def find_gaps(surfaces: Sequence[dict], files_with_tracking: set[str]) -> list[dict]:
    """A candidate surface with no tracking call in its own scope is a candidate gap.

    Per-match surfaces carry a scope-level `has_tracking` decided at detection time. cta and
    route have no handler to scope to and fall back to the file-level set, which is the old
    behavior for exactly the two types where it is still the right question."""
    out: list[dict] = []
    for s in surfaces:
        if "has_tracking" in s:
            if not s["has_tracking"]:
                out.append(s)
        elif s["location"] not in files_with_tracking:
            out.append(s)
    return out


# --- ranking (heuristic; replaced/augmented by the LLM judge in Phase 2) ------

_RANK_BY_TYPE = {
    "wizard_stage": 0,  # URL-stable stages RouteTracker cannot see — highest value
    "api_status": 1,
    "api_job": 1,
    "form_submit": 2,
    "api_webhook": 2,
    "route": 3,
    "cta": 4,
}


def rank_gap(gap: Mapping) -> int:
    """Lower = higher priority, ordered by the rubric's value hierarchy."""
    return _RANK_BY_TYPE.get(gap["surface_type"], 5)


_TRIAGED = {"open", "accepted", "dismissed"}


def select_candidates(
    gaps: Sequence[dict], prior_state: Mapping[str, dict], limit: int | None = 25
) -> list[dict]:
    """The bounded set the judge sees: gaps not already triaged by a human, top-N by the
    heuristic rank. Skipping triaged ids keeps cost down and never re-judges a decided
    surface (which also means the judge can never overturn a human dismissal). limit=None
    returns every eligible gap uncapped, for the whole-repo seed."""
    eligible = [
        g
        for g in gaps
        if prior_state.get(g["id"], {}).get("disposition") not in _TRIAGED
    ]
    eligible.sort(key=lambda g: (rank_gap(g), g["id"]))
    return eligible if limit is None else eligible[:limit]


# --- judge prompt + response parsing (pure, no network) ----------------------

JUDGE_TOOL = {
    "name": "report_gap_verdicts",
    "description": "Return one verdict per candidate surface, applying the instrument/skip rubric.",
    "input_schema": JudgeBatch.model_json_schema(),
}

_JUDGE_INSTRUCTIONS = (
    "You are auditing product surfaces for missing analytics instrumentation. "
    "The rubric above is authoritative: decide is_gap=true only when the rubric says the "
    "surface should fire an event that it currently does not. Apply the skip list strictly "
    "(chrome, in-page nav, main-nav destinations already covered by page views, single "
    "toggle open/close). For each candidate name the rubric_rule that applies, the "
    "dashboard_question the missing event would answer, a rank 0-5 (0 = highest priority, "
    "e.g. a URL-stable multi-step flow stage; higher = lower value), and a one-line reason. "
    "When tracked_in_hook is true, a React hook this file imports does fire events, so the "
    "surface may already be instrumented one hop away and the snippet cannot show it; weigh "
    "that as evidence, not as a verdict. "
    "Copy each id verbatim. Return exactly one verdict per candidate via the tool."
)


def judge_system_prompt(rubric: str) -> str:
    """Rubric text (single-sourced from SKILL.md) plus the fixed judging instructions."""
    return f"{rubric}\n\n---\n\n{_JUDGE_INSTRUCTIONS}"


def build_judge_messages(candidates: Sequence[dict]) -> list[dict]:
    """One user turn carrying the capped candidate set as JSON for the judge to classify."""
    payload = [
        {
            "id": c["id"],
            "surface_type": c["surface_type"],
            "location": c["location"],
            "snippet": c.get("snippet", ""),
            "tracked_in_hook": c.get("tracked_in_hook", False),
        }
        for c in candidates
    ]
    content = "Candidate surfaces to classify:\n\n" + json.dumps(payload, indent=2)
    return [{"role": "user", "content": content}]


def judge_max_tokens(candidate_count: int) -> int:
    """The output cap for a batch of this size."""
    return llm_judge.max_tokens_for(candidate_count)


def _validated_judge_batch(payload: dict) -> dict:
    """Validate the *whole* tool payload as a JudgeBatch, before llm_judge filters by id.
    llm_judge is subject-agnostic — it only knows ids — so a hallucinated id carrying a
    malformed verdict would otherwise be silently dropped by the id filter instead of
    failing the batch. Matches the pre-extraction original's exact ordering:
    JudgeBatch.model_validate(block.input) ran before the allowed-id filter. Returns the
    validated, re-dumped payload so the verdicts llm_judge reads back are the same shape
    the original returned (JudgeVerdict.model_dump()), not the raw tool-call dicts."""
    return JudgeBatch.model_validate(payload).model_dump()


def parse_judge_response(resp, candidate_ids: Sequence[str]) -> dict[str, dict]:
    return llm_judge.parse_tool_response(
        resp, candidate_ids, results_field="results", noun="candidates",
        validate=_validated_judge_batch,
    )


# --- judge call + graceful wrapper (network IO layer) ------------------------


make_anthropic_client = llm_judge.make_anthropic_client


def judge_candidates(
    candidates: Sequence[dict], rubric: str, *, client, model: str,
    max_tokens: int | None = None,
) -> dict[str, dict]:
    """One batched judgment call over the capped candidate set. Client is injected so this
    is unit-testable without network. Forces the report_gap_verdicts tool for a validated
    result. Mirrors qa_validate.py's AnthropicJudge."""
    return llm_judge.judge_batch(
        candidates, system=judge_system_prompt(rubric), tool=JUDGE_TOOL, client=client,
        model=model, message_builder=build_judge_messages, max_tokens=max_tokens,
        results_field="results", noun="candidates", validate=_validated_judge_batch,
    )


def judge_all(
    candidates: Sequence[dict], rubric: str, *, client, model: str, chunk_size: int = 25
) -> dict[str, dict]:
    """Judge candidates in bounded chunks, merging verdicts. One call per chunk keeps each
    request within the token/response budget on a whole-repo seed; the weekly run (<=25
    candidates) is exactly one chunk."""
    out: dict[str, dict] = {}
    for i in range(0, len(candidates), chunk_size):
        chunk = candidates[i : i + chunk_size]
        out.update(judge_candidates(chunk, rubric, client=client, model=model))
    return out


def run_judgment(
    candidates: Sequence[dict],
    *,
    api_key: str | None,
    model: str,
    rubric_path: Path = DEFAULT_RUBRIC_PATH,
    client_factory=make_anthropic_client,
) -> tuple[dict[str, dict], str]:
    """Graceful boundary around the judge. Never raises: returns (verdicts_by_id, status).
    A missing key, missing rubric, SDK/network error, or bad response all degrade to an
    empty result and a status string the digest reports — the run continues unaffected."""
    return llm_judge.run_graceful(
        candidates, api_key=api_key, model=model, tool=JUDGE_TOOL,
        message_builder=build_judge_messages,
        system_factory=lambda: judge_system_prompt(load_rubric(rubric_path)),
        unavailable_status="skipped: rubric unavailable",
        client_factory=client_factory,
        results_field="results", noun="candidates", validate=_validated_judge_batch,
    )


# --- state + dispositions -----------------------------------------------------


def merge_judged_state(
    prior: Mapping[str, dict],
    verdicts: Mapping[str, dict],
    candidates_by_id: Mapping[str, dict],
    today: date,
) -> dict[str, dict]:
    """Fold judge-confirmed gaps into the disposition state. Only is_gap=true verdicts
    create or refresh entries; is_gap=false is dropped and never added. Human decisions
    (disposition, reason) and first_seen are preserved; the judge's reason is stored as
    judge_reason so it never clobbers the human field. Prior ids absent this run are kept."""
    iso = today.isoformat()
    out: dict[str, dict] = {k: dict(v) for k, v in prior.items()}
    for gid, verdict in verdicts.items():
        if not verdict.get("is_gap"):
            continue
        cand = candidates_by_id.get(gid, {})
        judged = {
            "rubric_rule": verdict.get("rubric_rule", ""),
            "dashboard_question": verdict.get("dashboard_question", ""),
            "judge_reason": verdict.get("reason", ""),
            "rank": verdict.get("rank", 5),
        }
        if gid not in out:
            out[gid] = {
                "id": gid,
                "surface_type": cand.get("surface_type", ""),
                "location": cand.get("location", ""),
                "disposition": "new",
                "reason": "",
                "first_seen": iso,
                "last_seen": iso,
                **judged,
            }
            continue
        entry = out[gid]
        entry["last_seen"] = iso
        if cand:
            entry["surface_type"] = cand.get("surface_type", entry.get("surface_type", ""))
            entry["location"] = cand.get("location", entry.get("location", ""))
        entry.update(judged)  # refresh judged fields; disposition/reason/first_seen untouched
    return out


_CLOSED = {"resolved", "retired"}
# Below this fraction of the previous run's surface count, the scan is not believed and
# nothing is closed. A broken glob or a fat-fingered detector regex would otherwise retire
# the entire backlog in one unattended run, and closing is the one operation here that
# removes work from a human's queue.
_COLLAPSE_FLOOR = 0.5


def close_resolved_entries(
    state: Mapping[str, dict],
    surface_ids: set[str],
    gap_ids: set[str],
    today: date,
) -> tuple[dict[str, dict], int]:
    """Close entries that stopped being gaps. Returns (new_state, closed_count).

    `resolved` when the surface is still detected but no longer reads as untracked — someone
    instrumented it, which is the one outcome this whole loop exists to produce and which had
    no way to be recorded. `retired` when the surface is not detected at all.

    Applies to accepted and dismissed entries too. Nothing is deleted and no human field is
    touched: reason, first_seen and ticket_url survive, so a closed row is still the audit
    trail of what someone decided and why."""
    out = {k: dict(v) for k, v in state.items()}
    closed = 0
    iso = today.isoformat()
    for gid, entry in out.items():
        if entry.get("disposition") in _CLOSED or gid in gap_ids:
            continue
        entry["disposition"] = "resolved" if gid in surface_ids else "retired"
        entry["resolved_cause"] = "instrumented" if gid in surface_ids else "surface_gone"
        entry["resolved_at"] = iso
        closed += 1
    return out, closed


def is_visible(entry: Mapping) -> bool:
    """The digest shows only untriaged (`new`) gaps. open collapses to a count line;
    accepted/dismissed are suppressed."""
    return entry.get("disposition") == "new"


def coverage_stats(state: Mapping[str, dict]) -> dict:
    counts = {
        "new": 0, "open": 0, "accepted": 0, "dismissed": 0, "resolved": 0, "retired": 0,
    }
    for entry in state.values():
        d = entry.get("disposition", "new")
        if d in counts:
            counts[d] += 1
    return {"tracked_gaps": len(state), **counts}


def is_actioned(entry: Mapping) -> bool:
    """An accepted gap that already produced a ticket or was instrumented in-session. The
    triage skill uses this so a re-run never double-files or re-offers it."""
    return bool(entry.get("ticket_url") or entry.get("actioned_at"))


def stamp_gap(
    state: dict[str, dict], gap_id: str, *, ticket_url: str | None = None,
    actioned_at: str | None = None,
) -> dict[str, dict]:
    """Record that an accepted gap was acted on. Idempotent: only sets provided fields."""
    entry = state.get(gap_id)
    if entry is None:
        return state
    if ticket_url is not None:
        entry["ticket_url"] = ticket_url
    if actioned_at is not None:
        entry["actioned_at"] = actioned_at
    return state


# --- digest rendering ---------------------------------------------------------


def _md_cell(value: str | None) -> str:
    """Sanitize a judge-authored string for a markdown table cell: empty -> '-', and pipes
    or newlines (which would break the committed-log table) are neutralized. The digest is
    written to a committed markdown file, so uncontrolled model text must not corrupt it."""
    text = (value or "").strip()
    if not text:
        return "-"
    return text.replace("|", r"\|").replace("\n", " ").replace("\r", " ")


def build_slack_payload(
    state: Mapping[str, dict],
    run_date: str,
    judgment_status: str,
    pending_count: int,
    *,
    browse_url: str | None,
    feedback_url: str | None,
    top_n: int = 10,
    judge_consecutive_failures: int = 0,
) -> dict:
    """Run-data the health step reads to fold the gaps into its Slack post. The digest is
    delta-led (like the health monitor's new/escalated/resolved), so the Slack signal is
    scoped to gaps first-seen THIS run, not the whole untriaged backlog — a genuinely new
    gap breaks the quiet gate, but an un-triaged backlog never re-nags the channel weekly.
    The full untriaged set stays browsable in the gaps sheet tab / committed log. new_gaps
    is that this-run set, sorted by (rank, id), capped at top_n."""
    new_gaps_this_run = new_this_run(state, run_date)
    new_gaps = [
        {
            "rank": e.get("rank", 5),
            "id": e["id"],
            "surface_type": e["surface_type"],
            "rubric_rule": e.get("rubric_rule", ""),
            "dashboard_question": e.get("dashboard_question", ""),
            "location": e["location"],
        }
        for e in new_gaps_this_run[:top_n]
    ]
    return {
        "status": judgment_status,
        "run_date": run_date,
        "new_count": len(new_gaps_this_run),
        "pending_count": pending_count,
        "judge_consecutive_failures": judge_consecutive_failures,
        "new_gaps": new_gaps,
        "browse_url": browse_url,
        "feedback_url": feedback_url,
    }


def render_gap_section(
    state: Mapping[str, dict],
    run_date: str,
    top_n: int = 10,
    *,
    judgment_status: str = "ok",
    pending_count: int = 0,
) -> str:
    """One dated markdown section: coverage line, ranked new-gaps table (with the rubric
    rule and dashboard question from the judge), and a graceful judgment-status line when
    the judge did not run."""
    cov = coverage_stats(state)
    visible = sorted(
        (e for e in state.values() if is_visible(e)),
        key=lambda e: (e.get("rank", 5), e["id"]),
    )
    lines = [
        f"## {run_date}",
        "",
        "### Potential instrumentation gaps",
        "",
        f"Coverage: {cov['tracked_gaps']} tracked — {cov['new']} new, {cov['open']} open, "
        f"{cov['accepted']} accepted, {cov['dismissed']} dismissed.",
        "",
    ]
    if not visible:
        lines += ["No new gaps.", ""]
    else:
        shown = visible[:top_n]
        lines += [
            "| rank | surface | type | rubric rule | dashboard question | location |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
        for e in shown:
            lines.append(
                f"| {e.get('rank', 5)} | {e['id']} | {e['surface_type']} | "
                f"{_md_cell(e.get('rubric_rule'))} | {_md_cell(e.get('dashboard_question'))} | "
                f"{e['location']} |"
            )
        if len(visible) > top_n:
            lines.append(f"\n({len(visible) - top_n} more new gaps — see the state file.)")
        lines.append("")
    if judgment_status not in ("ok", "no-candidates"):
        lines += [
            f"Judgment unavailable this run ({judgment_status}); "
            f"{pending_count} candidate(s) pending, not yet judged.",
            "",
        ]
    return "\n".join(lines)


# --- IO + CLI -----------------------------------------------------------------

_SCAN_SUFFIXES = (".ts", ".tsx")


def load_state(path: Path | None) -> dict[str, dict]:
    """Read the disposition state, keyed by id. Missing/None -> {} (legitimate first run).
    Existing but unparseable or non-dict -> raise CorruptStateError. A bad hand-edit must
    never be treated as 'everything is new' — that would silently wipe every human
    dismissed/accepted disposition on the next auto-merged write. Callers must catch
    CorruptStateError and skip the run instead of writing."""
    if not path or not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        raise CorruptStateError(f"{path}: {exc}") from exc
    if not isinstance(data, dict):
        raise CorruptStateError(f"{path}: state file does not contain a JSON object")
    return data


def load_run_state(path: Path | None) -> dict:
    """Read the run-level counters. Missing, unreadable, or non-dict all degrade to {}.

    Deliberately the opposite contract to load_state, which raises on a bad file. Nothing here
    is a human decision that a silent reset would destroy — the worst a lost counter costs is
    one digest that under-reports a streak. Being able to fail the unattended cron would cost
    far more, so this file is never allowed to raise."""
    if not path or not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def next_run_state(
    prior: Mapping, judgment_status: str, today: date, surface_count: int | None = None,
) -> dict:
    """Advance the judge-failure streak for this run's status.

    A failure increments and an ok resets and stamps last_ok. Everything in JUDGE_STREAK_HOLD
    holds the current value: those runs are evidence of neither health nor failure, so they
    must neither clear a real streak nor invent one.

    surface_count carries this run's scanned-surface total forward, so the next run's collapse
    guard has something to compare against. Callers must omit it (leaving the prior count
    untouched) whenever this run's scan wasn't believed — otherwise a collapsed count becomes
    the new baseline and the guard can never fire again."""
    out = dict(prior)
    raw = out.get("judge_consecutive_failures", 0)
    streak = raw if isinstance(raw, int) and not isinstance(raw, bool) and raw >= 0 else 0
    if judgment_status == "ok":
        out["judge_consecutive_failures"] = 0
        out["last_ok"] = today.isoformat()
    elif judgment_status in JUDGE_STREAK_HOLD:
        out["judge_consecutive_failures"] = streak
    else:
        out["judge_consecutive_failures"] = streak + 1
    if surface_count is not None:
        out["surface_count"] = surface_count
    return out


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, path)


def _iter_files(repo_root: Path, sub: str, exclude_globs: Sequence[str]):
    base = repo_root / sub
    if not base.exists():
        return
    for p in base.rglob("*"):
        if not p.is_file() or p.suffix not in _SCAN_SUFFIXES:
            continue
        rel = p.relative_to(repo_root).as_posix()
        if is_excluded(rel, exclude_globs):
            continue
        yield rel, p


def scan_repo(
    repo_root: Path, exclude_globs: Sequence[str], scan_roots: Sequence[Mapping] | None = None
) -> tuple[list[dict], set[str]]:
    """Walk each configured scan root, returning all candidate surfaces (each with a bounded
    code snippet for the judge) and the set of files that fire at least one event."""
    roots = list(scan_roots or _DEFAULT_SCAN_ROOTS)
    surfaces: list[dict] = []
    files_with_tracking: set[str] = set()
    page_texts: dict[str, str] = {}
    # Only kept for files that produced a has_tracking-bearing surface, since that's the
    # only case the second pass below needs a file's text for.
    texts: dict[str, str] = {}
    for root in roots:
        for rel, path in _iter_files(repo_root, root["path"], exclude_globs):
            text = path.read_text(errors="replace")
            if has_tracking_call(text):
                files_with_tracking.add(rel)
            if rel.endswith("/page.tsx"):
                page_texts[rel] = text
            for surface in detect_surfaces_in_file(rel, text, root["detectors"]):
                surface["snippet"] = extract_context_at(
                    text, surface["match_start"], surface.get("scope")
                )
                surface.pop("scope", None)  # offsets are per-file; never persisted to state
                surfaces.append(surface)
                if "has_tracking" in surface:
                    texts[rel] = text
    routes = enumerate_route_surfaces(list(page_texts), exclude_globs)
    for r in routes:
        r["snippet"] = extract_context(page_texts.get(r["location"], ""), None)
    surfaces.extend(routes)

    # Second pass: the hint needs the full tracking set, which only exists after the walk.
    exists = lambda rel: (repo_root / rel).exists()
    for surface in surfaces:
        if "has_tracking" not in surface:
            continue  # cta/route carry no hint — they have no handler to lift
        surface["tracked_in_hook"] = hook_fires_events(
            surface["location"], texts[surface["location"]], files_with_tracking, exists
        )
    return surfaces, files_with_tracking


def run_sweep(
    repo_root: Path,
    config_path: Path,
    state_path: Path | None,
    today: date,
    *,
    api_key: str | None = None,
    model: str = DEFAULT_MODEL,
    limit: int = 25,
    rubric_path: Path = DEFAULT_RUBRIC_PATH,
    client_factory=None,
    enable_judge: bool = True,
    run_state_path: Path | None = None,
) -> tuple[dict, list[dict], str, int, int, int, int]:
    """Scan → deterministic gaps → judge the untriaged capped set → merge confirmed gaps →
    close entries that stopped being gaps. Returns (new_state, gaps, judgment_status,
    pending_count, closed_count, surfaces_enumerated, suppressed_by_tracking). Judgment is
    graceful: when it does not return 'ok', no new entries are added and pending_count reports
    the candidates that went un-judged. client_factory defaults to None (resolved here, not at
    def time) so that callers like main() which never pass it still pick up a test's
    monkeypatched make_anthropic_client instead of a frozen reference to the original."""
    client_factory = client_factory or make_anthropic_client
    cfg = load_gap_config(config_path)
    prior = load_state(state_path)
    surfaces, tracked = scan_repo(repo_root, cfg["exclude_globs"], cfg["scan_roots"])
    gaps = find_gaps(surfaces, tracked)
    candidates = select_candidates(gaps, prior, limit)
    candidates_by_id = {c["id"]: c for c in candidates}
    if enable_judge:
        verdicts, status = run_judgment(
            candidates, api_key=api_key, model=model,
            rubric_path=rubric_path, client_factory=client_factory,
        )
    else:
        verdicts, status = {}, NO_JUDGE_STATUS
    new_state = merge_judged_state(prior, verdicts, candidates_by_id, today)
    pending = 0 if status in JUDGE_OK_STATUSES else len(candidates)

    prior_count = load_run_state(run_state_path).get("surface_count")
    believable = (
        not isinstance(prior_count, int)
        or prior_count <= 0
        or len(surfaces) >= prior_count * _COLLAPSE_FLOOR
    )
    if believable:
        new_state, closed = close_resolved_entries(
            new_state, {s["id"] for s in surfaces}, {g["id"] for g in gaps}, today
        )
    else:
        closed = 0
        print(
            f"gap-sweep: scan returned {len(surfaces)} surfaces against a previous "
            f"{prior_count}; closing skipped and state left as-is.",
            file=sys.stderr,
        )

    return (
        new_state, gaps, status, pending, closed,
        len(surfaces),                                      # surfaces_enumerated
        sum(1 for s in surfaces if s.get("has_tracking")),  # suppressed_by_tracking
    )


def render_seed_artifact(state: Mapping[str, dict]) -> str:
    """A one-off, machine-parseable review artifact (PR #171 shape). One block per gap;
    the reviewer fills `- disposition:` (accepted|dismissed|open, blank keeps `new`) and
    `- reason:`. load_seed parses it back."""
    gaps = sorted(state.values(), key=lambda e: (e.get("rank", 5), e["id"]))
    lines = [
        f"# Instrumentation gap seed — {len(gaps)} candidate gaps",
        "",
        # Deliberately avoid the literal "- disposition:" / "- reason:" field-marker
        # substrings here — a caller filling in a block via a naive first-match string
        # replace (as review consumers do) would otherwise hit this instructional text
        # instead of the real field line below.
        "For each, set disposition to accepted, dismissed, or open (blank keeps it new)",
        "and add a reason when dismissing. Then load it back with --load-seed.",
        "",
    ]
    for e in gaps:
        lines += [
            f"## {e['id']}",
            f"- surface_type: {e.get('surface_type', '')}",
            f"- rank: {e.get('rank', 5)}",
            f"- location: {e.get('location', '')}",
            f"- rubric_rule: {e.get('rubric_rule', '')}",
            f"- dashboard_question: {e.get('dashboard_question', '')}",
            f"- judge_reason: {e.get('judge_reason', '')}",
            "- disposition:",
            "- reason:",
            "",
        ]
    return "\n".join(lines)


def new_this_run(state: Mapping[str, dict], run_date: str) -> list[dict]:
    """Untriaged gaps first seen on ``run_date`` — the weekly review batch. Sorted by
    (rank, id), matching the digest's ordering."""
    batch = [
        e for e in state.values()
        if e.get("disposition") == "new" and e.get("first_seen") == run_date
    ]
    return sorted(batch, key=lambda e: (e.get("rank", 5), e["id"]))


def render_review_artifact(state: Mapping[str, dict], run_date: str) -> str:
    """The seed-artifact review format (fill `- disposition:` / `- reason:`), restricted to
    this run's new gaps. Loads back through the same parse/apply path as the seed."""
    batch = {e["id"]: e for e in new_this_run(state, run_date)}
    return render_seed_artifact(batch)


def run_seed(
    repo_root: Path,
    config_path: Path,
    state_path: Path | None,
    today: date,
    *,
    api_key: str | None,
    model: str = DEFAULT_MODEL,
    rubric_path: Path = DEFAULT_RUBRIC_PATH,
    client_factory=make_anthropic_client,
    chunk_size: int = 25,
) -> tuple[dict, str, int]:
    """Whole-repo one-off audit: scan, judge every untriaged candidate (chunked), merge
    confirmed gaps as `new`. Graceful like run_sweep — never raises on judgment issues."""
    cfg = load_gap_config(config_path)
    prior = load_state(state_path)
    surfaces, tracked = scan_repo(repo_root, cfg["exclude_globs"], cfg["scan_roots"])
    gaps = find_gaps(surfaces, tracked)
    candidates = select_candidates(gaps, prior, limit=None)
    candidates_by_id = {c["id"]: c for c in candidates}
    if not candidates:
        return merge_judged_state(prior, {}, {}, today), "no-candidates", 0
    if not api_key:
        return dict(prior), "skipped: ANTHROPIC_API_KEY unset", 0
    try:
        rubric = load_rubric(rubric_path)
    except OSError:
        return dict(prior), "skipped: rubric unavailable", 0
    try:
        client = client_factory(api_key)
        verdicts = judge_all(candidates, rubric, client=client, model=model, chunk_size=chunk_size)
    except Exception as exc:  # noqa: BLE001 — judgment must never break the seed run
        return dict(prior), f"failed: {exc}", 0
    new_state = merge_judged_state(prior, verdicts, candidates_by_id, today)
    return new_state, "ok", len(candidates)


def parse_seed_artifact(text: str) -> dict[str, dict]:
    """Parse a filled seed artifact into {id: {disposition, reason}}, keeping only blocks
    whose disposition was filled in (blank disposition means the reviewer left it `new`).
    Format is exactly render_seed_artifact's output; unknown lines are ignored."""
    out: dict[str, dict] = {}
    current: str | None = None
    fields: dict[str, str] = {}

    def flush():
        if current is not None and fields.get("disposition"):
            out[current] = {
                "disposition": fields["disposition"],
                "reason": fields.get("reason", ""),
            }

    for line in text.splitlines():
        if line.startswith("## "):
            flush()
            current, fields = line[3:].strip(), {}
        elif line.startswith("- disposition:"):
            fields["disposition"] = line[len("- disposition:"):].strip()
        elif line.startswith("- reason:"):
            fields["reason"] = line[len("- reason:"):].strip()
    flush()
    return out


_VALID_DISPOSITIONS = {"new", "open", "accepted", "dismissed"}


def apply_seed_dispositions(
    state: Mapping[str, dict], parsed: Mapping[str, dict], today: date
) -> tuple[dict, int]:
    """Apply reviewer dispositions from a parsed seed artifact back onto the state, for ids
    that exist in state. Ids not in state are skipped (not counted, not added). A disposition
    outside the valid whitelist (e.g. a typo like "dismiss") is skipped and warned on rather
    than stored verbatim — an unrecognized value would silently drop the entry from the
    digest (is_visible only matches "new") without being tallied by coverage_stats either.
    first_seen is preserved; only disposition/reason/last_seen change on an applied id.
    Returns (new_state, applied_count)."""
    out = {k: dict(v) for k, v in state.items()}
    applied = 0
    iso = today.isoformat()
    for gid, d in parsed.items():
        if gid not in out:
            continue
        disposition = d["disposition"]
        if disposition not in _VALID_DISPOSITIONS:
            print(
                f"gap-sweep: skipping {gid!r} — invalid disposition {disposition!r} "
                f"(valid: {sorted(_VALID_DISPOSITIONS)})",
                file=sys.stderr,
            )
            continue
        out[gid]["disposition"] = disposition
        out[gid]["reason"] = d.get("reason", "")
        out[gid]["last_seen"] = iso
        applied += 1
    return out, applied


def prepend_log(log_path: Path, section: str) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    existing = log_path.read_text() if log_path.exists() else ""
    match = re.search(r"^## \d{4}-\d{2}-\d{2}$", existing, re.MULTILINE)
    if match:
        log_path.write_text(existing[: match.start()] + section + "\n" + existing[match.start():])
    else:
        log_path.write_text(existing + ("\n" if existing else "") + section)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Instrumentation gap sweep (DATA-2151).")
    parser.add_argument("--repo", type=Path, default=None, help="repo root (default: $OMNI_REPO or inferred)")
    parser.add_argument("--config", type=Path, default=CONFIG_PATH)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--run-state", type=Path, default=DEFAULT_RUN_STATE,
                        help="run-level counters (judge-failure streak) carried between runs")
    parser.add_argument("--log", type=Path, default=DEFAULT_LOG)
    parser.add_argument("--no-log", action="store_true")
    parser.add_argument("--json", type=Path, help="also write the full state JSON here")
    parser.add_argument("--today", help="override run date YYYY-MM-DD")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="judge model id")
    parser.add_argument("--limit", type=int, default=25, help="max candidates judged per run")
    parser.add_argument("--rubric", type=Path, default=DEFAULT_RUBRIC_PATH)
    parser.add_argument("--no-judge", action="store_true", help="skip the LLM judgment pass")
    parser.add_argument("--slack-out", type=Path, default=None,
                        help="write the gap run-data JSON here for the health step's Slack post")
    parser.add_argument("--seed", action="store_true",
                        help="one-off whole-repo audit: judge every untriaged candidate "
                             "uncapped and write a human-reviewable seed artifact")
    parser.add_argument("--seed-artifact", type=Path, default=DATA_DIR / "instrumentation-gaps-seed.md",
                        help="where to write the --seed review artifact")
    parser.add_argument("--load-seed", type=Path, default=None,
                        help="parse a filled seed artifact and apply its dispositions to "
                             "--state; does no scan and no judgment")
    parser.add_argument("--list-new", action="store_true",
                        help="print this run's untriaged (new) gaps as JSON and exit")
    parser.add_argument("--review-artifact", type=Path, default=None,
                        help="write the weekly review artifact (this run's new gaps) and exit")
    parser.add_argument("--load-review", type=Path, default=None,
                        help="apply a filled weekly review artifact's dispositions (same "
                             "format/behavior as --load-seed)")
    args = parser.parse_args(argv)

    repo_root = args.repo or Path(os.environ.get("OMNI_REPO", REPO_ROOT))
    today = datetime.strptime(args.today, "%Y-%m-%d").date() if args.today else date.today()

    # Each of these flags selects a distinct one-shot action; supplying more than one is a
    # usage error. Guard before the individual branches (which each return early) so every
    # conflicting pair is caught — not just --load-seed/--load-review.
    set_actions = [
        name
        for name, val in (
            ("--list-new", args.list_new),
            ("--review-artifact", args.review_artifact),
            ("--load-seed", args.load_seed),
            ("--load-review", args.load_review),
            ("--seed", args.seed),
        )
        if val
    ]
    if len(set_actions) > 1:
        print(
            f"gap-sweep: {', '.join(set_actions)} are mutually exclusive; pass only one.",
            file=sys.stderr,
        )
        return 1

    if args.list_new:
        # Read-only: never scans or judges.
        try:
            state = load_state(args.state)
        except CorruptStateError as exc:
            print(
                f"gap-sweep: state file unreadable ({exc}); skipping this run, "
                "state left untouched.",
                file=sys.stderr,
            )
            return 0
        json.dump(new_this_run(state, today.isoformat()), sys.stdout, indent=2, default=str)
        sys.stdout.write("\n")
        return 0

    if args.review_artifact:
        # Read-only: never scans or judges.
        try:
            state = load_state(args.state)
        except CorruptStateError as exc:
            print(
                f"gap-sweep: state file unreadable ({exc}); skipping this run, "
                "state left untouched.",
                file=sys.stderr,
            )
            return 0
        _atomic_write(args.review_artifact, render_review_artifact(state, today.isoformat()))
        print(f"wrote review artifact for {today.isoformat()} to {args.review_artifact}", file=sys.stderr)
        return 0

    load_path = args.load_seed or args.load_review
    if load_path:
        # Dedicated round-trip branch: no scan, no judgment — just apply a reviewer's
        # dispositions from a filled seed/review artifact back onto the state.
        try:
            prior = load_state(args.state)
        except CorruptStateError as exc:
            print(
                f"gap-sweep: state file unreadable ({exc}); skipping this run, "
                "state left untouched.",
                file=sys.stderr,
            )
            return 0
        flag = "--load-seed" if args.load_seed else "--load-review"
        try:
            seed_text = load_path.read_text()
        except OSError as exc:
            print(
                f"gap-sweep: {flag} file unreadable ({exc}); skipping this run, "
                "state left untouched.",
                file=sys.stderr,
            )
            return 0
        parsed = parse_seed_artifact(seed_text)
        new_state, applied = apply_seed_dispositions(prior, parsed, today)
        skipped = len(parsed) - applied
        _atomic_write(args.state, json.dumps(new_state, indent=2, sort_keys=True) + "\n")
        print(f"applied {applied} / skipped {skipped} (unknown ids or invalid dispositions)")
        return 0

    try:
        cfg_roots = load_gap_config(args.config)["scan_roots"]
    except Exception:  # noqa: BLE001 — a bad config must degrade, not crash the cron
        # The sweep below calls load_gap_config inside its own try/except and will report
        # the real error there. This pre-check only warns about missing roots.
        cfg_roots = []
    if cfg_roots and not any((repo_root / r["path"]).exists() for r in cfg_roots):
        print(
            f"gap-sweep: no configured scan root found under {repo_root}; nothing to scan.",
            file=sys.stderr,
        )

    api_key = os.environ.get("ANTHROPIC_API_KEY")

    if args.seed:
        # Graceful-skip contract: a scan/walk failure must never fail the run.
        try:
            new_state, status, judged = run_seed(
                repo_root, args.config, args.state, today,
                api_key=api_key, model=args.model, rubric_path=args.rubric,
                client_factory=make_anthropic_client,
            )
        except CorruptStateError as exc:
            print(
                f"gap-sweep: state file unreadable ({exc}); skipping this run, "
                "state left untouched.",
                file=sys.stderr,
            )
            return 0
        except Exception as exc:  # noqa: BLE001 — unattended run must not crash on a scan error
            print(f"gap-sweep: scan failed ({exc}); skipping this run, state untouched.", file=sys.stderr)
            return 0
        print(f"gap-seed: {status} ({judged} candidate(s) judged).", file=sys.stderr)
        _atomic_write(args.state, json.dumps(new_state, indent=2, sort_keys=True) + "\n")
        _atomic_write(args.seed_artifact, render_seed_artifact(new_state))
        return 0

    # Graceful-skip contract: a scan/walk failure must never fail the governance run.
    try:
        new_state, _gaps, judgment_status, pending, _closed, surfaces_enumerated, _suppressed = (
            run_sweep(
                repo_root, args.config, args.state, today,
                api_key=api_key, model=args.model, limit=args.limit,
                rubric_path=args.rubric, enable_judge=not args.no_judge,
                run_state_path=args.run_state,
            )
        )
    except CorruptStateError as exc:
        print(
            f"gap-sweep: state file unreadable ({exc}); skipping this run, "
            "state left untouched.",
            file=sys.stderr,
        )
        return 0
    except Exception as exc:  # noqa: BLE001 — unattended cron must not crash on a scan error
        print(f"gap-sweep: scan failed ({exc}); skipping this run, state untouched.", file=sys.stderr)
        return 0

    prior_run_state = load_run_state(args.run_state)
    prior_surface_count = prior_run_state.get("surface_count")
    # Mirrors run_sweep's own collapse guard: if this run's scan wasn't believed (and so
    # closing was skipped), the collapsed count must not overwrite the recorded baseline —
    # otherwise the guard could never fire again on the next run.
    scan_believable = (
        not isinstance(prior_surface_count, int)
        or prior_surface_count <= 0
        or surfaces_enumerated >= prior_surface_count * _COLLAPSE_FLOOR
    )
    run_state = next_run_state(
        prior_run_state, judgment_status, today,
        surface_count=surfaces_enumerated if scan_believable else None,
    )
    streak = run_state["judge_consecutive_failures"]

    section = render_gap_section(
        new_state, today.isoformat(),
        judgment_status=judgment_status, pending_count=pending,
    )
    if judgment_status not in JUDGE_OK_STATUSES:
        streak_note = f", {streak} consecutive runs" if streak > 1 else ""
        print(f"gap-sweep: {judgment_status} ({pending} candidates pending{streak_note}).",
              file=sys.stderr)
    sys.stdout.write(section)
    if not args.no_log:
        prepend_log(args.log, section)
    _atomic_write(args.state, json.dumps(new_state, indent=2, sort_keys=True) + "\n")
    _atomic_write(args.run_state, json.dumps(run_state, indent=2, sort_keys=True) + "\n")
    if args.json:
        args.json.write_text(json.dumps(new_state, indent=2, sort_keys=True) + "\n")
    if args.slack_out:
        payload = build_slack_payload(
            new_state, today.isoformat(), judgment_status, pending,
            browse_url=gaps_browse_url(), feedback_url=gaps_feedback_url(),
            judge_consecutive_failures=streak,
        )
        args.slack_out.parent.mkdir(parents=True, exist_ok=True)
        args.slack_out.write_text(json.dumps(payload, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
