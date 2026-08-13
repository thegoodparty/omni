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


def load_gap_config(path: Path = CONFIG_PATH) -> dict:
    """Read the exclusion config. Missing file -> empty excludes (scan everything)."""
    if not path.exists():
        return {"exclude_globs": []}
    doc = yaml.safe_load(path.read_text()) or {}
    return {"exclude_globs": list(doc.get("exclude_globs", []) or [])}


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


def detect_surfaces_in_file(rel_path: str, text: str) -> list[dict]:
    """Run the path-appropriate detectors over one file's text. One surface per matched
    detector type (not per match) — the coarse unit here is 'this file has a wizard', which
    the judgment pass later refines. In-file surfaces have no URL, so they key on
    path#surface_type (the spec's path-plus-symbol fallback)."""
    if rel_path.startswith("packages/gp-webapp/"):
        detectors = _WEBAPP_DETECTORS
    elif rel_path.startswith("packages/gp-api/"):
        detectors = _API_DETECTORS
    else:
        return []
    out: list[dict] = []
    for surface_type, pattern in detectors:
        if pattern.search(text):
            out.append(
                {
                    "id": f"{rel_path}#{surface_type}",
                    "surface_type": surface_type,
                    "location": rel_path,
                }
            )
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


# --- call-site diff -----------------------------------------------------------

_TRACKING_RE = re.compile(r"\btrackEvent\s*\(|\bAnalyticsService\b|\.track\(")


def has_tracking_call(text: str) -> bool:
    """Whether a file fires any analytics event (frontend trackEvent or backend track)."""
    return _TRACKING_RE.search(text) is not None


def find_gaps(surfaces: Sequence[dict], files_with_tracking: set[str]) -> list[dict]:
    """A candidate surface whose file fires no event is a candidate gap (file-level, Phase 1)."""
    return [s for s in surfaces if s["location"] not in files_with_tracking]


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
        }
        for c in candidates
    ]
    content = "Candidate surfaces to classify:\n\n" + json.dumps(payload, indent=2)
    return [{"role": "user", "content": content}]


def parse_judge_response(resp, candidate_ids: Sequence[str]) -> dict[str, dict]:
    """Validate the tool_use block as a JudgeBatch and key verdicts by id, keeping only ids
    that were in the input (a hallucinated id is dropped, never trusted into state)."""
    block = next((b for b in resp.content if getattr(b, "type", None) == "tool_use"), None)
    if block is None:
        raise RuntimeError("no tool_use block in judge response")
    batch = JudgeBatch.model_validate(block.input)
    allowed = set(candidate_ids)
    return {v.id: v.model_dump() for v in batch.results if v.id in allowed}


# --- judge call + graceful wrapper (network IO layer) ------------------------


def make_anthropic_client(api_key: str):
    """Construct the Anthropic SDK client. Import is local so the module still imports when
    the dependency is absent and judgment is skipped."""
    import anthropic

    return anthropic.Anthropic(api_key=api_key)


def judge_candidates(
    candidates: Sequence[dict], rubric: str, *, client, model: str, max_tokens: int = 4096
) -> dict[str, dict]:
    """One batched judgment call over the capped candidate set. Client is injected so this
    is unit-testable without network. Forces the report_gap_verdicts tool for a validated
    result. Mirrors qa_validate.py's AnthropicJudge."""
    resp = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=judge_system_prompt(rubric),
        tools=[JUDGE_TOOL],
        tool_choice={"type": "tool", "name": JUDGE_TOOL["name"]},
        messages=build_judge_messages(candidates),
    )
    return parse_judge_response(resp, [c["id"] for c in candidates])


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
    if not candidates:
        return {}, "no-candidates"
    if not api_key:
        return {}, "skipped: ANTHROPIC_API_KEY unset"
    try:
        rubric = load_rubric(rubric_path)
    except OSError:  # missing, unreadable, or a directory — all degrade to a skip, never raise
        return {}, "skipped: rubric unavailable"
    try:
        client = client_factory(api_key)
        verdicts = judge_candidates(candidates, rubric, client=client, model=model)
    except Exception as exc:  # noqa: BLE001 — judgment must never break the governance run
        return {}, f"failed: {exc}"
    return verdicts, "ok"


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


def is_visible(entry: Mapping) -> bool:
    """The digest shows only untriaged (`new`) gaps. open collapses to a count line;
    accepted/dismissed are suppressed."""
    return entry.get("disposition") == "new"


def coverage_stats(state: Mapping[str, dict]) -> dict:
    counts = {"new": 0, "open": 0, "accepted": 0, "dismissed": 0}
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

_WEBAPP_ROOT = "packages/gp-webapp"
_API_ROOT = "packages/gp-api/src"
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


def scan_repo(repo_root: Path, exclude_globs: Sequence[str]) -> tuple[list[dict], set[str]]:
    """Walk gp-webapp + gp-api, returning all candidate surfaces (each with a bounded code
    snippet for the judge) and the set of files that fire at least one event."""
    surfaces: list[dict] = []
    files_with_tracking: set[str] = set()
    page_texts: dict[str, str] = {}
    for sub in (_WEBAPP_ROOT, _API_ROOT):
        for rel, path in _iter_files(repo_root, sub, exclude_globs):
            text = path.read_text(errors="replace")
            if has_tracking_call(text):
                files_with_tracking.add(rel)
            if rel.endswith("/page.tsx"):
                page_texts[rel] = text
            for surface in detect_surfaces_in_file(rel, text):
                pat = _DETECTOR_PATTERN.get(surface["surface_type"])
                surface["snippet"] = extract_context(text, pat)
                surfaces.append(surface)
    routes = enumerate_route_surfaces(list(page_texts), exclude_globs)
    for r in routes:
        r["snippet"] = extract_context(page_texts.get(r["location"], ""), None)
    surfaces.extend(routes)
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
) -> tuple[dict, list[dict], str, int]:
    """Scan → deterministic gaps → judge the untriaged capped set → merge confirmed gaps.
    Returns (new_state, gaps, judgment_status, pending_count). Judgment is graceful: when it
    does not return 'ok', no new entries are added and pending_count reports the candidates
    that went un-judged. client_factory defaults to None (resolved here, not at def time) so
    that callers like main() which never pass it still pick up a test's monkeypatched
    make_anthropic_client instead of a frozen reference to the original."""
    client_factory = client_factory or make_anthropic_client
    cfg = load_gap_config(config_path)
    prior = load_state(state_path)
    surfaces, tracked = scan_repo(repo_root, cfg["exclude_globs"])
    gaps = find_gaps(surfaces, tracked)
    candidates = select_candidates(gaps, prior, limit)
    candidates_by_id = {c["id"]: c for c in candidates}
    if enable_judge:
        verdicts, status = run_judgment(
            candidates, api_key=api_key, model=model,
            rubric_path=rubric_path, client_factory=client_factory,
        )
    else:
        verdicts, status = {}, "skipped: --no-judge"
    new_state = merge_judged_state(prior, verdicts, candidates_by_id, today)
    pending = 0 if status in ("ok", "no-candidates") else len(candidates)
    return new_state, gaps, status, pending


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
    surfaces, tracked = scan_repo(repo_root, cfg["exclude_globs"])
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

    if not (repo_root / _WEBAPP_ROOT).exists() and not (repo_root / _API_ROOT).exists():
        print(
            f"gap-sweep: neither scan root found under {repo_root}; nothing to scan.",
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
        new_state, _gaps, judgment_status, pending = run_sweep(
            repo_root, args.config, args.state, today,
            api_key=api_key, model=args.model, limit=args.limit,
            rubric_path=args.rubric, enable_judge=not args.no_judge,
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

    section = render_gap_section(
        new_state, today.isoformat(),
        judgment_status=judgment_status, pending_count=pending,
    )
    if judgment_status not in ("ok", "no-candidates"):
        print(f"gap-sweep: {judgment_status} ({pending} candidates pending).", file=sys.stderr)
    sys.stdout.write(section)
    if not args.no_log:
        prepend_log(args.log, section)
    _atomic_write(args.state, json.dumps(new_state, indent=2, sort_keys=True) + "\n")
    if args.json:
        args.json.write_text(json.dumps(new_state, indent=2, sort_keys=True) + "\n")
    if args.slack_out:
        payload = build_slack_payload(
            new_state, today.isoformat(), judgment_status, pending,
            browse_url=gaps_browse_url(), feedback_url=gaps_feedback_url(),
        )
        args.slack_out.parent.mkdir(parents=True, exist_ok=True)
        args.slack_out.write_text(json.dumps(payload, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
