"""Runs `run_night` over the bench fixtures and scores the outcome per
fixture.

The three model calls go through `CallRecorder`, which forwards each call to
the inner callable it was given (the real Anthropic calls for a live run)
and keeps the raw reply, so the report can show each fixture's severity,
pattern and drafted case. `run_night` itself never surfaces scores or a
gated draft's text; recording at the call seam is what makes them visible
without changing how the scout decides anything.
"""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from case_scout.bench.judge_loader import JUDGE_CASES_DIR, draft_loader_issue
from case_scout.bench.loader import BenchFixture, fixture_messages
from case_scout.bucket import CaseScoutBucket
from case_scout.reader import drafting, gate, scoring
from case_scout.reader.case_lists import CaseListFetchError, CaseListInfo, _parse_case_list
from case_scout.reader.case_schema import validate_against_schema
from case_scout.reader.judge_records import FakeJudgeRecordsReader
from case_scout.reader.messages import FakeCaseScoutMessageReader
from case_scout.reader.night import NightResult, run_night
from case_scout.reader.scoring import CANDIDATE_MIN_SEVERITY, SessionScore, parse_scored_session

_SESSION_HEADER = re.compile(r"^# session (\S+)", re.M)

DRAFTED_OUTCOMES = frozenset({"proposed", "listFull"})

PASS = "pass"
FAIL = "fail"
NOT_APPLICABLE = "n/a"


class LocalChatCaseListReader:
    """Reads the judge's case lists from this checkout instead of GitHub
    `main`, so a bench run sees the conditions on the branch under test
    and makes no network call for them."""

    def __init__(self, cases_dir: Path = JUDGE_CASES_DIR):
        self._cases_dir = cases_dir

    def read(self, agent_id: str) -> CaseListInfo:
        path = self._cases_dir / f"{agent_id}.json"
        try:
            payload = json.loads(path.read_text())
        except (OSError, ValueError) as e:
            raise CaseListFetchError(f"could not read {path}: {e}") from e
        if not isinstance(payload, dict):
            raise CaseListFetchError(f"{path} was not a JSON object")
        return _parse_case_list(agent_id, payload)


@dataclass
class RecordedCall:
    stage: str
    session_id: str | None
    input_chars: int
    output: str


@dataclass
class CallRecorder:
    score_inner: Callable[[str, str], str]
    draft_inner: Callable[[str, str], str]
    second_read_inner: Callable[[str], str]
    calls: list[RecordedCall] = field(default_factory=list)
    _last_drafted_session: str | None = None

    def score(self, system: str, transcript: str) -> str:
        return self._forward(
            "score", self._session_of(transcript), len(system) + len(transcript), self.score_inner, system, transcript
        )

    def draft(self, system: str, transcript: str) -> str:
        session_id = self._session_of(transcript)
        self._last_drafted_session = session_id
        return self._forward("draft", session_id, len(system) + len(transcript), self.draft_inner, system, transcript)

    def second_read(self, draft_text: str) -> str:
        # run_drafting gates each candidate right after drafting it, one at a
        # time, so the draft the gate is reading belongs to the last session
        # drafted. The second read sees only the draft, never a session id.
        return self._forward(
            "gate",
            self._last_drafted_session,
            len(gate.SECOND_READ_PROMPT) + len(draft_text),
            self.second_read_inner,
            draft_text,
        )

    def _forward(
        self, stage: str, session_id: str | None, input_chars: int, inner: Callable[..., str], *args: str
    ) -> str:
        output = ""
        try:
            output = inner(*args)
            return output
        finally:
            self.calls.append(RecordedCall(stage=stage, session_id=session_id, input_chars=input_chars, output=output))

    @staticmethod
    def _session_of(transcript: str) -> str | None:
        match = _SESSION_HEADER.search(transcript)
        return match.group(1) if match else None

    def outputs(self, stage: str, session_id: str) -> list[str]:
        return [c.output for c in self.calls if c.stage == stage and c.session_id == session_id]


def real_calls() -> tuple[Any, Any, Any]:
    """The same callables score_session, draft_candidate and run_second_read
    fall back to when no call is injected."""
    return scoring._call_anthropic, drafting._call_anthropic, gate._call_second_read_anthropic


@dataclass(frozen=True)
class BenchRun:
    run_id: str
    fixtures: tuple[BenchFixture, ...]
    night: NightResult
    recorder: CallRecorder
    results: list[dict[str, Any]]


def run_bench(
    fixtures: list[BenchFixture],
    bucket: CaseScoutBucket,
    now: datetime,
    run_id: str,
    score_inner: Any,
    draft_inner: Any,
    second_read_inner: Any,
    cases_dir: Path = JUDGE_CASES_DIR,
) -> BenchRun:
    recorder = CallRecorder(score_inner=score_inner, draft_inner=draft_inner, second_read_inner=second_read_inner)
    messages = fixture_messages(fixtures)
    night = run_night(
        run_id,
        bucket,
        FakeCaseScoutMessageReader(messages),
        environment="dev",
        now=now,
        case_list_reader=LocalChatCaseListReader(cases_dir),
        judge_records_reader=FakeJudgeRecordsReader(),
        # A session has at least one message, so this can never cap one.
        session_cap=len(messages),
        score_call=recorder.score,
        draft_call=recorder.draft,
        second_read_call=recorder.second_read,
        nightly_cap=len(fixtures),
    )
    if not night.reader_run.claimed or night.draft_run is None:
        raise RuntimeError(f"bench run {run_id} was already claimed in this bucket")

    all_planted = sorted({p for f in fixtures for p in f.planted_pii}, key=len, reverse=True)
    results = [_fixture_result(fixture, night, recorder, all_planted, cases_dir) for fixture in fixtures]
    return BenchRun(run_id=run_id, fixtures=tuple(fixtures), night=night, recorder=recorder, results=results)


def _last_parsed_score(recorder: CallRecorder, session_id: str) -> SessionScore | None:
    for raw in reversed(recorder.outputs("score", session_id)):
        try:
            return parse_scored_session(raw, session_id)
        except ValueError:
            continue
    return None


def _last_parsed_draft(recorder: CallRecorder, session_id: str) -> dict[str, Any] | None:
    for raw in reversed(recorder.outputs("draft", session_id)):
        try:
            result = drafting.parse_draft_response(raw)
        except ValueError:
            continue
        return {
            "outcome": result.outcome,
            "failureSummary": result.failure_summary,
            "case": result.case.to_json() if result.case else None,
            "coveredBy": result.covered_by,
            "needsSetup": result.needs_setup_what,
        }
    return None


def _strings_in(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in _strings_in(v)]
    if isinstance(value, list):
        return [s for v in value for s in _strings_in(v)]
    return []


def planted_pii_found(value: Any, planted: list[str]) -> list[str]:
    text = "\n".join(_strings_in(value)).lower()
    return [p for p in planted if p.lower() in text]


def _check(status: str, detail: str = "") -> dict[str, str]:
    return {"status": status, "detail": detail}


def _fixture_result(
    fixture: BenchFixture,
    night: NightResult,
    recorder: CallRecorder,
    all_planted: list[str],
    cases_dir: Path,
) -> dict[str, Any]:
    assert night.draft_run is not None
    sessions = [s for s in night.reader_run.sessions if s.conversation_id == fixture.conversation_id]
    session_ids = [s.session_id for s in sessions]
    ledger = [line for line in night.draft_run.ledger_lines if line["conversationId"] == fixture.conversation_id]
    line = ledger[-1] if ledger else None
    outcome = line["outcome"] if line else None

    score_calls = [c for c in recorder.calls if c.stage == "score" and c.session_id in session_ids]
    score = _last_parsed_score(recorder, session_ids[0]) if session_ids else None
    scoring_error = next((e for e in night.scoring_errors if any(sid in e for sid in session_ids)), None)
    draft_response = _last_parsed_draft(recorder, session_ids[0]) if session_ids else None

    bundle_entry = None
    if line is not None and outcome in DRAFTED_OUTCOMES:
        bundle_entry = next(
            (
                entry
                for entry in [*night.draft_run.bundle["drafts"], *night.draft_run.bundle["listFull"]]
                if entry["case"]["caseId"] == line.get("caseId")
            ),
            None,
        )
    final_case = bundle_entry["case"] if bundle_entry else None
    drafted = outcome in DRAFTED_OUTCOMES and final_case is not None

    if outcome in DRAFTED_OUTCOMES:
        gate_result: dict[str, Any] | None = {"passed": True, "rule": None, "reason": None}
    elif outcome == "gated" and line is not None:
        gate_result = {
            "passed": False,
            "rule": (line.get("gateFailures") or [None])[0],
            "reason": line.get("failureSummary") or None,
        }
    else:
        gate_result = None

    checks: dict[str, dict[str, str]] = {}
    expect = fixture.expect

    if expect.scored:
        if len(sessions) != 1:
            checks["scored"] = _check(FAIL, f"fixture split into {len(sessions)} sessions, expected 1")
        elif score is None:
            checks["scored"] = _check(FAIL, scoring_error or "no parseable score")
        else:
            checks["scored"] = _check(PASS, f"severity {score.severity}")
    else:
        touched = bool(score_calls) or bool(ledger)
        checks["ignored"] = _check(
            FAIL if touched else PASS,
            "the scout scored or drafted a scope it does not cover" if touched else "never scored, no ledger line",
        )

    if expect.should_draft:
        if drafted:
            checks["drafted"] = _check(PASS, f"outcome {outcome}")
        elif expect.drop_ok:
            checks["drafted"] = _check(PASS, f"no draft (outcome {outcome}), allowed for planted PII")
        elif outcome == "covered" and line is not None and line.get("coveredBy") in expect.also_pass_if_covered_by:
            checks["drafted"] = _check(PASS, f"covered by {line.get('coveredBy')}, an accepted alternative")
        else:
            checks["drafted"] = _check(FAIL, f"expected a draft, got outcome {outcome}")
    else:
        checks["drafted"] = _check(
            FAIL if drafted else PASS, f"outcome {outcome}" if outcome else "never a drafting candidate"
        )

    if expect.covered_by is not None:
        named = line.get("coveredBy") if line else None
        checks["skipped_as_covered"] = _check(
            PASS if outcome == "covered" else FAIL,
            f"named {named!r}, expected {expect.covered_by!r}" if outcome == "covered" else f"outcome {outcome}",
        )

    if expect.pattern is not None:
        if score is None:
            checks["pattern"] = _check(FAIL, "not scored")
        else:
            flagged = sorted({r.known_pattern for r in score.requests if r.severity >= CANDIDATE_MIN_SEVERITY})
            checks["pattern"] = _check(
                PASS if expect.pattern in flagged else FAIL,
                f"expected {expect.pattern}, scout flagged {flagged or ['nothing at severity 2+']}",
            )

    if final_case is not None:
        leaked = planted_pii_found(
            [final_case, bundle_entry.get("failureSummary") if bundle_entry else ""], all_planted
        )
        checks["no_planted_pii"] = _check(FAIL if leaked else PASS, f"found {leaked}" if leaked else "")
        schema_issue = validate_against_schema(final_case)
        checks["gate_schema"] = _check(FAIL if schema_issue else PASS, schema_issue or "")
        loader_issue = draft_loader_issue(fixture.agent, final_case, cases_dir)
        checks["judge_loader"] = _check(FAIL if loader_issue else PASS, loader_issue or "")
    else:
        detail = "no draft"
        if draft_response and draft_response.get("case") and planted_pii_found(draft_response["case"], all_planted):
            detail = "the drafting call put planted PII in its case and the gate dropped it"
        for name in ("no_planted_pii", "gate_schema", "judge_loader"):
            checks[name] = _check(NOT_APPLICABLE, detail)

    return {
        "id": fixture.id,
        "agent": fixture.agent,
        "category": fixture.category,
        "summary": fixture.summary,
        "notes": fixture.notes,
        "expect": fixture.expect.model_dump(),
        "sessionIds": session_ids,
        "score": _score_json(score),
        "scoringError": scoring_error,
        "outcome": outcome,
        "coveredBy": line.get("coveredBy") if line else None,
        "needsSetup": line.get("needsSetup") if line else None,
        "draftResponse": draft_response,
        "gate": gate_result,
        "case": final_case,
        "checks": checks,
        "passed": all(c["status"] != FAIL for c in checks.values()),
        "grades": {"faithful": None, "gradeable": None, "fictional": None, "note": ""},
    }


def _score_json(score: SessionScore | None) -> dict[str, Any] | None:
    if score is None:
        return None
    return {
        "severity": score.severity,
        "requests": [
            {
                "severity": r.severity,
                "knownPattern": r.known_pattern,
                "majorFailureType": r.major_failure_type,
                "overallRating": r.overall_rating,
                "summary": r.summary_nonidentifying,
                "reason": r.reason_nonidentifying,
            }
            for r in score.requests
        ],
    }
