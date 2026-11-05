"""The drafting call (TDD "Drafting"; Implementation Notes section 3 step 6,
section 5 "Draft", section 10.4 duplicates, section 7's rejection
suppression) and the nightly orchestration around it: the nightly cap
(cap.py), the 25-case list soft cap (case_lists.py), and duplicate/rejection
suppression (ledger.py).

One Opus call per candidate, no tools — same prompt-injection containment
property as scoring.py (see that module's docstring): a model reading an
untrusted transcript can only ever produce schema-checked JSON, never act on
anything. The model's output is NOT what reaches GitHub on its own — every
draft in bundle.json here is PRE-GATE (Implementation Notes section 3 step 7
is the next story's PII gate; this story's bundle.json entries are what that
story gates, per this ticket's own Outputs note).
"""

import re
import zlib
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any

import httpx

from case_scout import ai_secrets
from case_scout.reader.case_lists import CaseListFetchError, CaseListInfo, ChatCaseListReader
from case_scout.reader.ledger import LedgerEntry, find_duplicate, find_rejection, recent_proposals_for_agent
from case_scout.reader.scoring import MODEL, Candidate, extract_json, render_session_transcript

# Field bounds this prompt must hold the model to (Implementation Notes
# section 1.1, `packages/gp-api/src/chats/evals/judge/cases.ts`). Mirrored as
# constants, not imported, because case_scout's Docker image ships no gp-api
# source (see case_lists.py's module docstring) — these numbers are a
# contract this story's test suite pins against `cases.ts`'s own values, same
# spirit as records.py's dataVersion check but for a Python-side mirror.
CASE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
MAX_CASE_ID_LENGTH = 80
MAX_CONDITION_CHARS = 2_000
MAX_HANDLED_WHEN_CHARS = 600
MAX_CASE_TURNS = 10
MAX_FAILURE_SUMMARY_LENGTH = 300

# TDD "Data model and contracts": "source: z.enum(['authored', 'production'])".
# Every case this module drafts is production-sourced by definition.
SOURCE_PRODUCTION = "production"

# TDD "Drafting": "a split of tune or holdout, about 2 to 1." A stable hash
# of caseId rather than a run-local counter: caseId is already unique and
# never reused (CaseIdSchema), so hashing it needs no persisted state across
# runs to keep the ~2:1 split steady over time.
_SPLIT_TUNE = "tune"
_SPLIT_HOLDOUT = "holdout"


def assign_split(case_id: str) -> str:
    return _SPLIT_HOLDOUT if zlib.crc32(case_id.encode()) % 3 == 2 else _SPLIT_TUNE


_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
_ANTHROPIC_VERSION = "2023-06-01"
_API_KEY_ENV = "ANTHROPIC_API_KEY"
_MAX_TOKENS = 2048
_TIMEOUT_SECONDS = 60
_MAX_ATTEMPTS = 2  # same retry-once-on-parse-failure shape as scoring.score_session

# Implementation Notes section 4: "invented names, a real state, a real
# office title, and the fixture's own place for anything the fixture hosts."
HOUSE_STYLE = (
    "House style for every fictional person or place you invent: invented "
    "first and last names, a real US state, and a real office title (e.g. "
    "'City Council', 'Mayor', 'School Board'). Use the fixture's own "
    "organization, city and race details (below) for anything the fixture "
    "hosts, rather than inventing a second one."
)

SYSTEM_PROMPT_TEMPLATE = """You are drafting a test case for GoodParty.org's judge, which checks chat \
assistant quality. You will see one real production session that failed. Your job is NOT to \
redact it — it is to write a brand NEW, entirely fictional conversation that reproduces the SAME \
underlying failure, so the judge can check whether the assistant still makes this mistake. Never \
copy a sentence, a name, a place or a specific fact from the session below into anything you write.

{house_style}

The fixture this case will run against ({agent_id}):
{fixture_description}

This agent's current conditions (what the judge already checks) — do not draft a case for a \
failure one of these already covers; if the session's failure is already covered, answer \
"coveredBy" naming the closest one instead:
{current_conditions}

Recent proposals from this agent's last 30 days (do not repeat one of these; if the session's \
failure matches one, answer "coveredBy" naming it):
{recent_proposals}

If you draft a new case, it must satisfy ALL of:
- caseId: kebab-case, letters/digits/underscore/hyphen only, at most {max_case_id} characters, \
descriptive and unique against the conditions and proposals above.
- Exactly one of "question" (a single user turn) or "turns" (a list of 1 to {max_turns} user \
turns, in order) — never both.
- condition: at most {max_condition} characters. What the assistant must get right or avoid, \
written generally enough to check the behavior, not just this one scenario.
- handledWhen: at most {max_handled_when} characters. Describes VISIBLE BEHAVIOR IN THE REPLY \
ONLY — never a tool result, never something only visible in logs. Say what a passing reply does \
and, briefly, what a failing one does instead.

Decide one of exactly three outcomes:
1. A new case reproducing this failure (the fixture can support it, and no existing condition or \
recent proposal already covers it).
2. "coveredBy": an existing condition or recent proposal already covers this failure.
3. "needsSetup": the fixture lacks data this failure needs (specific account state, specific \
race data, etc.) to reproduce faithfully.

Every answer also includes failureSummary: one short, non-identifying clause naming the \
underlying failure (used only to recognize repeats across nights — never shown to anyone, so it \
may be blunt, but still must name no real person, place or organization).

Return ONLY a JSON object, no prose and no code fences, in exactly one of these three shapes:

{{"outcome": "newCase", "failureSummary": "...", \
"case": {{"caseId": "...", "question": "...", "condition": "...", "handledWhen": "..."}}}}

{{"outcome": "newCase", "failureSummary": "...", \
"case": {{"caseId": "...", "turns": ["...", "..."], "condition": "...", "handledWhen": "..."}}}}

{{"outcome": "coveredBy", "failureSummary": "...", "caseId": "<the existing caseId>"}}

{{"outcome": "needsSetup", "failureSummary": "...", "what": "one line naming what's missing"}}
"""


class DraftingError(Exception):
    """A candidate could not be drafted — raised after the one allowed retry
    on a parse failure, or when the call itself cannot be made (no API key).
    Always per-candidate (same contract as scoring.ScoringError): the
    orchestration below catches this for one candidate and records it,
    never lets it abort the rest of the night."""


@dataclass(frozen=True)
class DraftedCase:
    case_id: str
    question: str | None
    turns: tuple[str, ...] | None
    condition: str
    handled_when: str
    source: str = SOURCE_PRODUCTION
    split: str | None = None

    def to_json(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "caseId": self.case_id,
            "condition": self.condition,
            "handledWhen": self.handled_when,
            "source": self.source,
            "split": self.split,
        }
        if self.question is not None:
            payload["question"] = self.question
        else:
            payload["turns"] = list(self.turns or ())
        return payload


@dataclass(frozen=True)
class DraftResult:
    outcome: str  # "newCase" | "coveredBy" | "needsSetup"
    failure_summary: str
    case: DraftedCase | None = None
    covered_by: str | None = None
    needs_setup_what: str | None = None


@dataclass(frozen=True)
class DraftContext:
    agent_id: str
    fixture_description: str
    current_conditions: tuple[str, ...]
    recent_proposals: tuple[LedgerEntry, ...]


def _render_conditions(conditions: tuple[str, ...]) -> str:
    if not conditions:
        return "(none yet)"
    return "\n".join(f"- {c}" for c in conditions)


def _render_recent_proposals(proposals: tuple[LedgerEntry, ...]) -> str:
    if not proposals:
        return "(none in the last 30 days)"
    return "\n".join(f"- {p.case_id}: {p.failure_summary}" for p in proposals if p.case_id)


def build_system_prompt(context: DraftContext) -> str:
    return SYSTEM_PROMPT_TEMPLATE.format(
        house_style=HOUSE_STYLE,
        agent_id=context.agent_id,
        fixture_description=context.fixture_description or "(no fixture description available tonight)",
        current_conditions=_render_conditions(context.current_conditions),
        recent_proposals=_render_recent_proposals(context.recent_proposals),
        max_case_id=MAX_CASE_ID_LENGTH,
        max_turns=MAX_CASE_TURNS,
        max_condition=MAX_CONDITION_CHARS,
        max_handled_when=MAX_HANDLED_WHEN_CHARS,
    )


def _require_bounded_str(value: Any, field: str, max_length: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"drafting response's {field} was missing or blank")
    if len(value) > max_length:
        raise ValueError(f"drafting response's {field} exceeded {max_length} characters")
    return value


def _parse_case(raw: Any) -> DraftedCase:
    if not isinstance(raw, dict):
        raise ValueError("drafting response's case was not an object")

    case_id = _require_bounded_str(raw.get("caseId"), "case.caseId", MAX_CASE_ID_LENGTH)
    if not CASE_ID_PATTERN.match(case_id):
        raise ValueError(f"drafting response's caseId {case_id!r} contains characters outside [A-Za-z0-9_-]")

    has_question = bool(isinstance(raw.get("question"), str) and raw["question"].strip())
    has_turns = bool(isinstance(raw.get("turns"), list) and len(raw["turns"]) > 0)
    if has_question == has_turns:
        raise ValueError("drafting response's case needs exactly one of question or turns")

    question: str | None = None
    turns: tuple[str, ...] | None = None
    if has_question:
        question = raw["question"]
    else:
        raw_turns = raw["turns"]
        if len(raw_turns) > MAX_CASE_TURNS:
            raise ValueError(f"drafting response's case had more than {MAX_CASE_TURNS} turns")
        if not all(isinstance(t, str) and t.strip() for t in raw_turns):
            raise ValueError("drafting response's case had a blank or non-string turn")
        turns = tuple(raw_turns)

    condition = _require_bounded_str(raw.get("condition"), "case.condition", MAX_CONDITION_CHARS)
    handled_when = _require_bounded_str(raw.get("handledWhen"), "case.handledWhen", MAX_HANDLED_WHEN_CHARS)

    return DraftedCase(case_id=case_id, question=question, turns=turns, condition=condition, handled_when=handled_when)


def parse_draft_response(raw_text: str) -> DraftResult:
    """Reads one model reply into a DraftResult. Raises ValueError (via
    extract_json, or directly here) on anything malformed — draft_candidate's
    retry loop watches for this one error type, same contract as
    scoring.parse_scored_session."""
    payload = extract_json(raw_text)
    outcome = payload.get("outcome")
    if outcome not in ("newCase", "coveredBy", "needsSetup"):
        raise ValueError(f"drafting response had an unrecognized outcome: {outcome!r}")

    failure_summary = _require_bounded_str(payload.get("failureSummary"), "failureSummary", MAX_FAILURE_SUMMARY_LENGTH)

    if outcome == "newCase":
        return DraftResult(outcome=outcome, failure_summary=failure_summary, case=_parse_case(payload.get("case")))
    if outcome == "coveredBy":
        case_id = _require_bounded_str(payload.get("caseId"), "caseId", MAX_CASE_ID_LENGTH)
        return DraftResult(outcome=outcome, failure_summary=failure_summary, covered_by=case_id)
    what = _require_bounded_str(payload.get("what"), "what", MAX_FAILURE_SUMMARY_LENGTH)
    return DraftResult(outcome=outcome, failure_summary=failure_summary, needs_setup_what=what)


def _response_text(payload: Any) -> str:
    content = payload.get("content") if isinstance(payload, dict) else None
    if not isinstance(content, list):
        return ""
    parts = [block.get("text", "") for block in content if isinstance(block, dict) and block.get("type") == "text"]
    return "".join(parts)


def _call_anthropic(system: str, transcript: str) -> str:
    """One Messages API call, no tools — mirrors scoring._call_anthropic's
    error handling exactly (see that function's docstring for why every
    failure mode becomes one exception type here, DraftingError)."""
    key = ai_secrets.secret(_API_KEY_ENV)
    if not key:
        raise DraftingError(f"{_API_KEY_ENV} is not configured")

    try:
        response = httpx.post(
            _ANTHROPIC_URL,
            json={
                "model": MODEL,
                "max_tokens": _MAX_TOKENS,
                "system": system,
                "messages": [{"role": "user", "content": transcript}],
            },
            headers={
                "content-type": "application/json",
                "x-api-key": key,
                "anthropic-version": _ANTHROPIC_VERSION,
            },
            timeout=_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return _response_text(response.json())
    except (httpx.HTTPError, ValueError) as e:
        raise DraftingError(f"Anthropic call failed: {e}") from e


def draft_candidate(candidate: Candidate, context: DraftContext, call: Any = None) -> DraftResult:
    """Drafts one candidate: one Opus call, retried once on a parse failure,
    then a DraftingError for that candidate (mirrors scoring.score_session)."""
    call = call or _call_anthropic
    system = build_system_prompt(context)
    transcript = render_session_transcript(candidate.session)

    last_error: Exception | None = None
    for _ in range(_MAX_ATTEMPTS):
        raw_text = call(system, transcript)
        try:
            return parse_draft_response(raw_text)
        except ValueError as e:
            last_error = e

    raise DraftingError(
        f"session {candidate.session.session_id}: drafting response could not be parsed after retry ({last_error})"
    )


@dataclass(frozen=True)
class DraftRun:
    """What one night's drafting produced — main.py writes `bundle` and
    `sources` to the bucket via CaseScoutBucket.write_run_bundle /
    write_run_sources, and appends every line in `ledger_lines` via
    append_ledger_line (TDD Outputs: "append... for every decided
    candidate, whatever its outcome")."""

    run_id: str
    bundle: dict[str, Any]
    sources: dict[str, Any]
    ledger_lines: tuple[dict[str, Any], ...]


def _ledger_line(
    run_id: str,
    candidate: Candidate,
    outcome: str,
    now: datetime,
    case_id: str | None = None,
    covered_by: str | None = None,
    needs_setup: str | None = None,
    failure_summary: str = "",
) -> dict[str, Any]:
    return {
        "runId": run_id,
        "conversationId": candidate.session.conversation_id,
        "sessionId": candidate.session.session_id,
        "agentId": candidate.session.scope,
        "severity": candidate.score.severity,
        "outcome": outcome,
        "caseId": case_id,
        "coveredBy": covered_by,
        "needsSetup": needs_setup,
        "gateFailures": [],
        "prNumber": None,
        "failureSummary": failure_summary,
        "createdAt": now.isoformat(),
    }


def _as_ledger_entry(line: dict[str, Any]) -> LedgerEntry:
    return LedgerEntry(
        conversation_id=line["conversationId"],
        agent_id=line["agentId"],
        outcome=line["outcome"],
        case_id=line["caseId"],
        failure_summary=line["failureSummary"],
        created_at=datetime.fromisoformat(line["createdAt"]),
        closed_at=None,
    )


def run_drafting(
    run_id: str,
    candidates: list[Candidate],
    case_list_reader: ChatCaseListReader,
    ledger_entries: list[LedgerEntry],
    nightly_cap: int,
    now: datetime,
    draft_call: Any = None,
) -> DraftRun:
    """Implementation Notes section 3 step 6: drafts each candidate up to
    the nightly cap, worst severity first (candidates must already be
    ordered that way — scoring.select_candidates does this). Candidates
    beyond the cap never reach the drafting call at all and are recorded as
    "capped" (TDD Acceptance Criteria: "not dropped silently").

    `ledger_entries` should already hold the trailing ~30 days (the caller
    loads this once per run via CaseScoutBucket.read_ledger_lines across
    ledger.yyyymm_keys_covering) — this function only reads and extends an
    in-memory copy, so a duplicate within the SAME night (two different
    sessions reducing to the same failure) is caught too, not just across
    nights.
    """
    working_entries = list(ledger_entries)
    case_list_cache: dict[str, CaseListInfo] = {}

    drafted_count = 0
    drafts: list[dict[str, Any]] = []
    needs_setup: list[dict[str, Any]] = []
    list_full: list[dict[str, Any]] = []
    sources: dict[str, Any] = {}
    ledger_lines: list[dict[str, Any]] = []

    for candidate in candidates:
        agent_id = candidate.session.scope

        if drafted_count >= nightly_cap:
            ledger_lines.append(_ledger_line(run_id, candidate, outcome="capped", now=now))
            continue

        if agent_id not in case_list_cache:
            try:
                case_list_cache[agent_id] = case_list_reader.read(agent_id)
            except CaseListFetchError:
                case_list_cache[agent_id] = CaseListInfo.empty(agent_id)
        case_list = case_list_cache[agent_id]

        context = DraftContext(
            agent_id=agent_id,
            fixture_description=case_list.fixture_description,
            current_conditions=case_list.conditions,
            recent_proposals=tuple(recent_proposals_for_agent(working_entries, agent_id, now)),
        )

        try:
            result = draft_candidate(candidate, context, call=draft_call)
        except DraftingError as e:
            drafted_count += 1
            ledger_lines.append(
                _ledger_line(
                    run_id, candidate, outcome="error", now=now, failure_summary=str(e)[:MAX_FAILURE_SUMMARY_LENGTH]
                )
            )
            continue

        drafted_count += 1
        failure_summary = result.failure_summary

        if result.outcome == "coveredBy":
            ledger_lines.append(
                _ledger_line(
                    run_id,
                    candidate,
                    outcome="covered",
                    now=now,
                    covered_by=result.covered_by,
                    failure_summary=failure_summary,
                )
            )
            continue

        if result.outcome == "needsSetup":
            needs_setup.append(
                {"agentId": agent_id, "severity": candidate.score.severity, "what": result.needs_setup_what}
            )
            ledger_lines.append(
                _ledger_line(
                    run_id,
                    candidate,
                    outcome="needsSetup",
                    now=now,
                    needs_setup=result.needs_setup_what,
                    failure_summary=failure_summary,
                )
            )
            continue

        assert result.case is not None
        duplicate = find_duplicate(working_entries, candidate.session.conversation_id, agent_id, failure_summary, now)
        if duplicate is not None:
            ledger_lines.append(
                _ledger_line(
                    run_id,
                    candidate,
                    outcome="covered",
                    now=now,
                    covered_by=duplicate.case_id,
                    failure_summary=failure_summary,
                )
            )
            continue

        rejection = find_rejection(working_entries, candidate.session.conversation_id, agent_id, failure_summary, now)
        if rejection is not None:
            ledger_lines.append(
                _ledger_line(
                    run_id,
                    candidate,
                    outcome="suppressed",
                    now=now,
                    case_id=rejection.case_id,
                    failure_summary=failure_summary,
                )
            )
            continue

        case = replace(result.case, split=assign_split(result.case.case_id))

        if case_list.is_full:
            list_full.append(
                {
                    "agentId": agent_id,
                    "severity": candidate.score.severity,
                    "case": case.to_json(),
                    "failureSummary": failure_summary,
                }
            )
            ledger_lines.append(
                _ledger_line(
                    run_id,
                    candidate,
                    outcome="listFull",
                    now=now,
                    case_id=case.case_id,
                    failure_summary=failure_summary,
                )
            )
            continue

        drafts.append(
            {
                "agentId": agent_id,
                "severity": candidate.score.severity,
                "case": case.to_json(),
                "failureSummary": failure_summary,
            }
        )
        sources[case.case_id] = {
            "conversationId": candidate.session.conversation_id,
            "sessionId": candidate.session.session_id,
        }
        line = _ledger_line(
            run_id, candidate, outcome="proposed", now=now, case_id=case.case_id, failure_summary=failure_summary
        )
        ledger_lines.append(line)
        working_entries.append(_as_ledger_entry(line))
        # case_list is a frozen dataclass read once per agent per run; bump
        # the cached count so a second candidate drafted for the same agent
        # tonight sees the cap this draft just moved it toward.
        case_list_cache[agent_id] = replace(case_list, case_count=case_list.case_count + 1)

    bundle = {"runId": run_id, "drafts": drafts, "needsSetup": needs_setup, "listFull": list_full}
    return DraftRun(run_id=run_id, bundle=bundle, sources=sources, ledger_lines=tuple(ledger_lines))
