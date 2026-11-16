"""Choice check for the analytics guard (DATA-2754): a PR that adds a user choice which
changes what the product produces (an outreach purpose, a tone, a template, an audience)
should record the chosen value on an event. Robocall asked "What do you want to do?" from
August to November before anyone noticed no event said what was picked.

Whether a control is such a choice, and whether its value reaches an event, is judgment,
not import tracing: a sort dropdown or a tab is not one, and the value often reaches the
event two files away through a hook. So a loose regex picks the changed webapp files
that add something choice-shaped, and one model call judges them. Warn-only, and every
failure (no key, no SDK, a bad response) degrades to a status line, never to an error.

"Recorded" means fired anywhere we record events: a webapp trackEvent property or a
gp-api analytics track property. Amplitude is a destination, not the test.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from collections.abc import Callable, Iterable, Mapping, Sequence
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel, Field

import governance_gotchas
import llm_judge

REPO_ROOT = Path(__file__).resolve().parents[4]
RUBRIC_PATH = REPO_ROOT / ".claude/skills/instrument-analytics-event/SKILL.md"
# Same model and forced-tool plumbing as the gap judge; an override is an env change.
DEFAULT_MODEL = os.environ.get("CHOICE_JUDGE_MODEL", "claude-sonnet-5")

WEB_ROOT = "packages/gp-webapp/"
_SKIP_PARTS = frozenset({"e2e-tests", "__tests__", "__mocks__", "node_modules", "dev"})
_SKIP_SUFFIXES = (".test.tsx", ".stories.tsx", ".spec.tsx")

# Loose on purpose: a miss here is a choice nobody judges, a false hit costs a few hundred
# tokens. Custom pickers are common (robocall's purpose step is clickable Cards calling
# onSelect), so handlers and option maps count, not only the styleguide controls.
CHOICE_HINT = re.compile(
    r"<(?:RadioGroup|Select|ToggleGroup|Switch|Checkbox|Tabs|OptionCard|Combobox|"
    r"SegmentedControl|[A-Z]\w*(?:Picker|Selector|Chooser|Step))\b"
    r"|\bon(?:Select|ValueChange|CheckedChange|Choose|Pick)\b\s*[=(:]"
    r"|\b[A-Z][A-Z0-9_]*(?:OPTIONS|CHOICES|PURPOSES|GOALS|TONES|TEMPLATES|LAYOUTS|THEMES)\b"
)
# gp-api fires through wrappers (trackForOffice, private this.track, trackSendCompleted), so
# any track-prefixed call counts; a plain `.track(` search misses most backend events.
_TRACKING = re.compile(r"\btrack\w*\(|\bEVENTS\.|EventProps\b")

MAX_FILES = 8
_FILE_CHARS = 16_000
_DIFF_CHARS = 8_000
_FLOW_LINES = 40
_PR_LINES = 60


class Tree(Protocol):
    def paths(self) -> set[str]: ...
    def read_many(self, paths: Iterable[str]) -> dict[str, str]: ...


class ChoiceVerdict(BaseModel):
    id: str = Field(description="The candidate id, copied verbatim.")
    is_output_choice: bool = Field(
        description="True only if the change adds a control where the user picks something "
        "that changes what the product produces or sends, including when it is sent (a send "
        "date or time). False for sort, filter, tab, "
        "view toggles, pagination, form fields that are content (a name, an address), "
        "settings that do not change an output, and filters that only change which rows a "
        "screen shows, even when they re-query.")
    choice: str = Field(description="What the user chooses, in a few words, e.g. 'robocall "
                        "purpose'. Empty when is_output_choice is false.")
    recorded: bool = Field(
        description="True if the material shows the chosen value reaching a property on a "
        "fired event, frontend (trackEvent) or backend (gp-api analytics track).")
    evidence: str = Field(description="file:line of the event call carrying the value, or "
                          "empty when not recorded.")
    reason: str = Field(description="One sentence a PR author can act on.")


class ChoiceBatch(BaseModel):
    results: list[ChoiceVerdict]


JUDGE_TOOL = {
    "name": "report_choice_verdicts",
    "description": "Return one verdict per candidate file.",
    "input_schema": ChoiceBatch.model_json_schema(),
}

_INSTRUCTIONS = (
    "You review a pull request to the GoodParty webapp. Each candidate is a changed file "
    "whose added lines look like they might add a user choice. Decide, per candidate, "
    "whether the change adds a choice that changes what the product produces (the rubric "
    "rule above), and if so whether the chosen value is recorded on an event. Judge only "
    "what this change adds: a choice that existed before the change is not this PR's to "
    "record, even if it is unrecorded. "
    "Recorded means the value, or something it maps one-to-one to, is set as a property on "
    "an event that fires: a webapp trackEvent call, or a gp-api analytics track call. "
    "Look in the file, in flow_events (event calls in this file's folder and its parent), "
    "and in pr_tracking_changes (tracking lines this PR adds anywhere, including gp-api). "
    "An event that fires on the step but does not carry the value is not recorded. "
    "If nothing in the material carries it, recorded is false: do not assume a backend "
    "event you cannot see. When one choice spans several candidates (a step component and "
    "the flow that holds its state), report it once, on the file where the user picks it, "
    "and set is_output_choice false on the others. Copy each id verbatim. Return one verdict per candidate via the "
    "tool."
)


def _choice_rule(rubric: str) -> str:
    """The skill's choice bullet, single-sourced. The whole rubric when the line moved, so
    a reworded skill costs tokens rather than blinding the judge."""
    for line in rubric.splitlines():
        if line.strip().startswith("- A step where the user chooses"):
            return "## Rubric rule\n\n" + line.strip()
    return rubric


def system_prompt(rubric: str, gotchas: str) -> str:
    parts = [_choice_rule(rubric)]
    section = governance_gotchas.gotchas_prompt_section(gotchas)
    if section:
        parts.append(section)
    parts.append(_INSTRUCTIONS)
    return "\n\n---\n\n".join(parts)


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, check=True,
                          text=True, errors="replace").stdout


def _in_scope(path: str) -> bool:
    parts = set(path.split("/"))
    return (path.startswith(WEB_ROOT) and path.endswith(".tsx")
            and not parts & _SKIP_PARTS and not path.endswith(_SKIP_SUFFIXES))


def added_lines(diff: str) -> dict[str, list[tuple[int, str]]]:
    """Added lines per file from a unified diff, with their head line numbers."""
    out: dict[str, list[tuple[int, str]]] = {}
    path, line_no = None, 0
    for raw in diff.splitlines():
        if raw.startswith("+++ "):
            target = raw[4:]
            path = target[2:] if target.startswith("b/") else None
            if path is not None:
                out.setdefault(path, [])
        elif raw.startswith("@@"):
            m = re.search(r"\+(\d+)", raw)
            line_no = int(m.group(1)) if m else 0
        elif path is None:
            continue
        elif raw.startswith("+"):
            out[path].append((line_no, raw[1:]))
            line_no += 1
        elif not raw.startswith("-") and not raw.startswith("\\"):
            line_no += 1
    return out


def _diff_args(base: str, head: str | None) -> list[str]:
    return [base] + ([head] if head else [])


def _flow_events(path: str, head: Tree, cache: dict[str, str]) -> list[str]:
    folder = path.rsplit("/", 1)[0]
    parent = folder.rsplit("/", 1)[0]
    near = sorted(p for p in head.paths()
                  if p.endswith((".ts", ".tsx")) and not p.endswith(_SKIP_SUFFIXES)
                  and p.rsplit("/", 1)[0] in (folder, parent))
    missing = [p for p in near if p not in cache]
    cache.update(head.read_many(missing))
    out = []
    for p in near:
        for i, line in enumerate(cache.get(p, "").splitlines(), 1):
            if _TRACKING.search(line):
                out.append(f"{p.removeprefix(WEB_ROOT)}:{i}: {line.strip()[:200]}")
                if len(out) >= _FLOW_LINES:
                    return out
    return out


def candidates(repo: Path, base: str, head_ref: str | None, head: Tree) -> list[dict]:
    """One candidate per changed webapp file whose added lines look choice-shaped, with the
    material the judge needs: the file's diff, the file, nearby event calls, and every
    tracking line this PR adds (gp-api included)."""
    added = added_lines(_git(repo, "diff", "-U0", "--no-color", *_diff_args(base, head_ref)))
    pr_tracking = [f"{p}:{n}: {t.strip()[:200]}" for p, rows in sorted(added.items())
                   for n, t in rows if _TRACKING.search(t)][:_PR_LINES]
    hits = [(p, [(n, t) for n, t in rows if CHOICE_HINT.search(t)])
            for p, rows in sorted(added.items()) if _in_scope(p)]
    hits = [(p, rows) for p, rows in hits if rows]
    hits.sort(key=lambda h: -len(h[1]))
    cache: dict[str, str] = {}
    texts = head.read_many(p for p, _ in hits[:MAX_FILES])
    out = []
    for path, rows in hits[:MAX_FILES]:
        diff = _git(repo, "diff", "-U6", "--no-color", *_diff_args(base, head_ref), "--", path)
        out.append({
            "id": path,
            "hint_lines": [f"{n}: {t.strip()[:200]}" for n, t in rows[:15]],
            "diff": diff[:_DIFF_CHARS],
            "file": texts.get(path, "")[:_FILE_CHARS],
            "flow_events": _flow_events(path, head, cache),
            "pr_tracking_changes": pr_tracking,
        })
    return out


def build_messages(items: Sequence[dict]) -> list[dict]:
    return [{"role": "user", "content": "Candidate files:\n\n" + json.dumps(list(items), indent=1)}]


def _validated(payload: dict) -> dict:
    return ChoiceBatch.model_validate(payload).model_dump()


def judge(items: Sequence[dict], *, api_key: str | None, model: str = DEFAULT_MODEL,
          client_factory: Callable = llm_judge.make_anthropic_client,
          rubric_path: Path = RUBRIC_PATH) -> tuple[dict[str, dict], str]:
    return llm_judge.run_graceful(
        items, api_key=api_key, model=model, tool=JUDGE_TOOL, message_builder=build_messages,
        system_factory=lambda: system_prompt(rubric_path.read_text(),
                                             governance_gotchas.load_gotchas()),
        unavailable_status="skipped: rubric unavailable", client_factory=client_factory,
        results_field="results", noun="candidates", validate=_validated,
    )


def unrecorded(verdicts: Mapping[str, dict]) -> list[dict]:
    """The verdicts that warrant a warning, in path order."""
    return [v | {"id": k} for k, v in sorted(verdicts.items())
            if v.get("is_output_choice") and not v.get("recorded")]


def run(repo: Path, base: str, head_ref: str | None, head: Tree, *,
        api_key: str | None, client_factory: Callable = llm_judge.make_anthropic_client
        ) -> tuple[list[dict], str, int]:
    """(unrecorded choices, judge status, candidate count). Never raises."""
    try:
        items = candidates(repo, base, head_ref, head)
    except Exception as exc:  # noqa: BLE001 — a warn-only check must never break the guard
        return [], f"failed: {type(exc).__name__}: {exc}", 0
    verdicts, status = judge(items, api_key=api_key, client_factory=client_factory)
    return unrecorded(verdicts), status, len(items)
