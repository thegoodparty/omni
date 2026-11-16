"""Would a draft parse in the Universal Judge's own case-list loader
(`packages/gp-api/src/chats/evals/judge/cases.ts`, `parseCaseList` with
`ChatCaseSchema`)?

A Python mirror rather than running `cli.ts --dry-run`: the TS route needs a
provisioned gp-api checkout (npm ci, built workspace packages) for a check
that is a schema parse. This mirror is stricter than the gate's own
(`reader/case_schema.py`) on purpose, because it is the loader's rules that
decide whether a merged case breaks the judge: unknown keys are refused
(`.strict()`), a present key may not be null (zod `.optional()` is not
`.nullable()`), `condition`/`handledWhen` are trimmed before their length
check, and a caseId may not repeat within the list. tests/test_bench.py pins
the key set and the bounds against cases.ts.

The draft is appended to an in-memory copy of the agent's real case list and
the whole list is re-parsed, the same thing a merge of the scout's PR would
make the loader do.
"""

import json
from pathlib import Path
from typing import Any

from case_scout.reader.case_schema import (
    CASE_ID_PATTERN,
    MAX_CASE_ID_LENGTH,
    MAX_CASE_TURNS,
    MAX_CONDITION_CHARS,
    MAX_HANDLED_WHEN_CHARS,
)

JUDGE_CASES_DIR = Path(__file__).resolve().parents[3] / "gp-api" / "src" / "chats" / "evals" / "judge" / "cases"

# ChatCaseSchema's own keys. The scout only ever writes caseId, question or
# turns, condition, handledWhen, source and split; the rest are here so the
# authored cases already on the list parse too.
CHAT_CASE_KEYS = frozenset(
    {
        "caseId",
        "question",
        "turns",
        "priorTranscript",
        "toolFailure",
        "accountState",
        "condition",
        "handledWhen",
        "scored",
        "dimensions",
        "source",
        "split",
    }
)

_SOURCES = frozenset({"authored", "production"})
_SPLITS = frozenset({"tune", "holdout"})


def chat_case_issue(case: Any) -> str | None:
    if not isinstance(case, dict):
        return "a case is not an object"
    unknown = sorted(set(case) - CHAT_CASE_KEYS)
    if unknown:
        return f"unknown keys {unknown} (ChatCaseSchema is strict)"
    nulls = sorted(k for k, v in case.items() if v is None)
    if nulls:
        return f"keys {nulls} are null, and an optional zod field accepts a missing key, not null"

    case_id = case.get("caseId")
    if not isinstance(case_id, str) or not 1 <= len(case_id) <= MAX_CASE_ID_LENGTH:
        return f"caseId must be a string of 1 to {MAX_CASE_ID_LENGTH} characters"
    if not CASE_ID_PATTERN.match(case_id):
        return "caseId may contain only letters, digits, underscore and hyphen"

    has_question = "question" in case
    has_turns = "turns" in case
    if has_question == has_turns:
        return "exactly one of question or turns is required"
    if has_question and not (isinstance(case["question"], str) and len(case["question"]) >= 1):
        return "question must be a non-empty string"
    if has_turns:
        turns = case["turns"]
        if not isinstance(turns, list) or not 1 <= len(turns) <= MAX_CASE_TURNS:
            return f"turns must be a list of 1 to {MAX_CASE_TURNS} strings"
        if not all(isinstance(t, str) and len(t) >= 1 for t in turns):
            return "every turn must be a non-empty string"

    for key, limit in (("condition", MAX_CONDITION_CHARS), ("handledWhen", MAX_HANDLED_WHEN_CHARS)):
        if key in case:
            value = case[key]
            if not isinstance(value, str) or not 1 <= len(value.strip()) <= limit:
                return f"{key} must be 1 to {limit} characters after trimming"

    if "scored" in case and not isinstance(case["scored"], bool):
        return "scored must be a boolean"
    if "handledWhen" in case and "condition" not in case:
        return "handledWhen describes handling a condition; add the condition"
    if "handledWhen" in case and case.get("scored") is False:
        return "a control (scored: false) carries no handledWhen"
    if "source" in case and case["source"] not in _SOURCES:
        return f"source must be one of {sorted(_SOURCES)}"
    if "split" in case and case["split"] not in _SPLITS:
        return f"split must be one of {sorted(_SPLITS)}"
    return None


def case_list_issue(agent_id: str, payload: Any) -> str | None:
    """parseCaseList for a chat agent: the envelope, then every case, then
    caseId uniqueness."""
    if not isinstance(payload, dict):
        return "not a case list object"
    if payload.get("agentId") != agent_id:
        return f"declares agentId {payload.get('agentId')!r}, expected {agent_id!r}"
    if payload.get("shape") != "chat":
        return f"declares shape {payload.get('shape')!r}, expected 'chat'"
    cases = payload.get("cases")
    if not isinstance(cases, list) or not cases:
        return "cases must be a non-empty list"
    seen: set[str] = set()
    for index, case in enumerate(cases):
        issue = chat_case_issue(case)
        if issue:
            return f"case {index} is not a valid chat case: {issue}"
        if case["caseId"] in seen:
            return f"case {index} repeats caseId {case['caseId']!r}"
        seen.add(case["caseId"])
    return None


def draft_loader_issue(agent_id: str, draft_case: dict[str, Any], cases_dir: Path = JUDGE_CASES_DIR) -> str | None:
    path = cases_dir / f"{agent_id}.json"
    try:
        payload = json.loads(path.read_text())
    except (OSError, ValueError) as e:
        return f"could not read {path.name}: {e}"
    if not isinstance(payload, dict) or not isinstance(payload.get("cases"), list):
        return f"{path.name} is not a case list"
    return case_list_issue(agent_id, {**payload, "cases": [*payload["cases"], draft_case]})
