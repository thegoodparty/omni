import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from case_scout.reader.case_lists import CaseListInfo, FakeChatCaseListReader
from case_scout.reader.drafting import (
    CASE_ID_PATTERN,
    MAX_CASE_ID_LENGTH,
    MAX_CASE_TURNS,
    MAX_CONDITION_CHARS,
    MAX_HANDLED_WHEN_CHARS,
    SOURCE_PRODUCTION,
    DraftContext,
    DraftingError,
    assign_split,
    draft_candidate,
    parse_draft_response,
    run_drafting,
)
from case_scout.reader.ledger import parse_ledger_lines
from case_scout.reader.messages import Message
from case_scout.reader.scoring import Candidate, RequestScore, SessionScore
from case_scout.reader.sessions import Session

NOW = datetime(2026, 11, 5, 6, 0, tzinfo=UTC)

# case_scout's Docker image ships no gp-api source (case_lists.py's module
# docstring), so this story's field-bound constants are a hand-mirrored copy
# of cases.ts rather than an import. This test is the pin that keeps the
# mirror honest: it reads cases.ts straight off the checkout CI already has
# (not the deployed container) and fails the moment a bound drifts, rather
# than leave the drafting prompt silently wrong about what the schema allows.
_CASES_TS = (
    Path(__file__).resolve().parents[4] / "packages" / "gp-api" / "src" / "chats" / "evals" / "judge" / "cases.ts"
)


class TestFieldBoundsPinnedAgainstCasesTs:
    def test_cases_ts_is_where_this_suite_expects_it(self):
        assert _CASES_TS.is_file(), f"cases.ts moved — update the path this pin test reads: {_CASES_TS}"

    def test_max_case_turns_matches(self):
        text = _CASES_TS.read_text()
        match = re.search(r"export const MAX_CASE_TURNS = (\d+)", text)
        assert match is not None
        assert MAX_CASE_TURNS == int(match.group(1))

    def test_max_condition_chars_matches(self):
        text = _CASES_TS.read_text()
        match = re.search(r"export const MAX_CONDITION_CHARS = ([\d_]+)", text)
        assert match is not None
        assert MAX_CONDITION_CHARS == int(match.group(1).replace("_", ""))

    def test_max_handled_when_chars_matches(self):
        text = _CASES_TS.read_text()
        match = re.search(r"export const MAX_HANDLED_WHEN_CHARS = (\d+)", text)
        assert match is not None
        assert MAX_HANDLED_WHEN_CHARS == int(match.group(1))

    def test_case_id_max_length_matches(self):
        text = _CASES_TS.read_text()
        # CaseIdSchema's `.max(80)` — the schema builder has no named export
        # for this bound, unlike the three above, so the pin matches the
        # literal chained onto the schema immediately after `.min(1)`.
        match = re.search(r"CaseIdSchema = z\s*\.string\(\)\s*\.min\(1\)\s*\.max\((\d+)\)", text)
        assert match is not None
        assert MAX_CASE_ID_LENGTH == int(match.group(1))

    def test_case_id_pattern_matches(self):
        text = _CASES_TS.read_text()
        match = re.search(r"const CASE_ID = /(\^.*\$)/", text)
        assert match is not None
        assert CASE_ID_PATTERN.pattern == match.group(1)


def _msg(conversation_id, minute, scope="chief_of_staff", content="I need help"):
    return Message(
        conversation_id=conversation_id,
        scope=scope,
        message_id=f"{conversation_id}-{minute}",
        role="user",
        content=content,
        created_at=NOW - timedelta(hours=1) + timedelta(minutes=minute),
    )


def _session(conversation_id="conv-1", scope="chief_of_staff", session_id=None):
    message = _msg(conversation_id, 0, scope=scope)
    return Session(
        session_id=session_id or f"{conversation_id}:{message.message_id}",
        conversation_id=conversation_id,
        scope=scope,
        messages=(message,),
    )


def _score(severity=3):
    request = RequestScore(
        request_ordinal=1,
        primary_use_case="voter_data",
        answered_request="no",
        overall_rating="bad",
        major_failure_type="wrong_or_invented",
        known_pattern="none",
        severity=severity,
        confidence="high",
        human_review_needed="yes",
        worth_quoting_anonymized="no",
        summary_nonidentifying="asked a question",
        reason_nonidentifying="got it wrong",
    )
    return SessionScore(session_id="s", requests=(request,))


def _candidate(conversation_id="conv-1", scope="chief_of_staff", severity=3, session_id=None):
    session = _session(conversation_id=conversation_id, scope=scope, session_id=session_id)
    return Candidate(session=session, score=_score(severity))


def _new_case_response(case_id="polling-place-photo-rules", failure_summary="gave a wrong polling rule", **overrides):
    case = {
        "caseId": case_id,
        "question": "Can I take a photo of my ballot?",
        "condition": "Ballot photo rules are set per state.",
        "handledWhen": "the reply says it depends on the state and to confirm locally.",
        **overrides,
    }
    return json.dumps({"outcome": "newCase", "failureSummary": failure_summary, "case": case})


def _covered_response(case_id="existing-case", failure_summary="already covered"):
    return json.dumps({"outcome": "coveredBy", "failureSummary": failure_summary, "caseId": case_id})


def _needs_setup_response(what="needs a staged payment fixture", failure_summary="can't reproduce without setup"):
    return json.dumps({"outcome": "needsSetup", "failureSummary": failure_summary, "what": what})


def _context(agent_id="chief_of_staff"):
    return DraftContext(
        agent_id=agent_id, fixture_description="a test fixture", current_conditions=(), recent_proposals=()
    )


def _passing_second_read(_draft_text):
    """A gate.run_second_read stand-in that always passes (an empty flag
    list) — every run_drafting test below whose draft reaches "proposed" or
    "listFull" goes through the gate (drafting.py's module docstring), so it
    needs a second-read double or the real call fails closed on the missing
    ANTHROPIC_API_KEY. The gate's own layers (denylist, copied text, contact
    patterns, schema) are exercised in test_gate.py, not re-tested here."""
    return "[]"


class TestParseDraftResponse:
    def test_a_new_case_with_a_question_parses(self):
        result = parse_draft_response(_new_case_response())
        assert result.outcome == "newCase"
        assert result.case.case_id == "polling-place-photo-rules"
        assert result.case.question == "Can I take a photo of my ballot?"
        assert result.case.turns is None
        assert len(result.case.condition) <= MAX_CONDITION_CHARS
        assert len(result.case.handled_when) <= MAX_HANDLED_WHEN_CHARS
        assert result.case.source == SOURCE_PRODUCTION

    def test_a_new_case_with_turns_parses(self):
        raw = _new_case_response()
        payload = json.loads(raw)
        payload["case"].pop("question")
        payload["case"]["turns"] = ["first turn", "second turn"]
        result = parse_draft_response(json.dumps(payload))
        assert result.case.turns == ("first turn", "second turn")
        assert result.case.question is None

    def test_covered_by_parses(self):
        result = parse_draft_response(_covered_response())
        assert result.outcome == "coveredBy"
        assert result.covered_by == "existing-case"

    def test_needs_setup_parses(self):
        result = parse_draft_response(_needs_setup_response())
        assert result.outcome == "needsSetup"
        assert result.needs_setup_what == "needs a staged payment fixture"

    def test_an_invalid_case_id_is_rejected(self):
        with pytest.raises(ValueError):
            parse_draft_response(_new_case_response(case_id="has a space"))

    def test_a_too_long_case_id_is_rejected(self):
        with pytest.raises(ValueError):
            parse_draft_response(_new_case_response(case_id="x" * (MAX_CASE_ID_LENGTH + 1)))

    def test_a_too_long_condition_is_rejected(self):
        with pytest.raises(ValueError):
            parse_draft_response(_new_case_response(condition="x" * (MAX_CONDITION_CHARS + 1)))

    def test_a_too_long_handled_when_is_rejected(self):
        with pytest.raises(ValueError):
            parse_draft_response(_new_case_response(handledWhen="x" * (MAX_HANDLED_WHEN_CHARS + 1)))

    def test_both_question_and_turns_is_rejected(self):
        raw = _new_case_response()
        payload = json.loads(raw)
        payload["case"]["turns"] = ["another turn"]
        with pytest.raises(ValueError):
            parse_draft_response(json.dumps(payload))

    def test_neither_question_nor_turns_is_rejected(self):
        raw = _new_case_response()
        payload = json.loads(raw)
        payload["case"].pop("question")
        with pytest.raises(ValueError):
            parse_draft_response(json.dumps(payload))

    def test_an_unrecognized_outcome_is_rejected(self):
        with pytest.raises(ValueError):
            parse_draft_response(json.dumps({"outcome": "maybe", "failureSummary": "x"}))

    def test_a_missing_failure_summary_is_rejected(self):
        with pytest.raises(ValueError):
            parse_draft_response(json.dumps({"outcome": "coveredBy", "caseId": "x"}))


class TestAssignSplit:
    def test_is_deterministic(self):
        assert assign_split("some-case-id") == assign_split("some-case-id")

    def test_splits_roughly_two_to_one(self):
        splits = [assign_split(f"case-{i}") for i in range(300)]
        tune = splits.count("tune")
        holdout = splits.count("holdout")
        assert tune + holdout == 300
        ratio = tune / holdout
        assert 1.3 < ratio < 3.3  # "about 2 to 1" (TDD), not exact


class TestDraftCandidateRetry:
    def test_succeeds_on_the_second_attempt_after_a_malformed_first(self):
        responses = iter(["not json", _new_case_response()])
        result = draft_candidate(_candidate(), _context(), call=lambda s, t: next(responses))
        assert result.outcome == "newCase"

    def test_raises_drafting_error_after_two_malformed_attempts(self):
        with pytest.raises(DraftingError):
            draft_candidate(_candidate(), _context(), call=lambda s, t: "not json")

    def test_no_api_key_raises_drafting_error(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        with pytest.raises(DraftingError):
            draft_candidate(_candidate(), _context())


class TestRunDraftingBasicOutcomes:
    def test_a_new_case_is_proposed_with_source_and_split(self):
        candidate = _candidate()
        run = run_drafting(
            run_id="2026-11-05",
            candidates=[candidate],
            case_list_reader=FakeChatCaseListReader(),
            ledger_entries=[],
            nightly_cap=3,
            now=NOW,
            draft_call=lambda s, t: _new_case_response(),
            second_read_call=_passing_second_read,
        )
        assert len(run.bundle["drafts"]) == 1
        drafted_case = run.bundle["drafts"][0]["case"]
        assert drafted_case["source"] == "production"
        assert drafted_case["split"] in ("tune", "holdout")
        assert run.sources == {
            "polling-place-photo-rules": {"conversationId": "conv-1", "sessionId": candidate.session.session_id}
        }
        assert len(run.ledger_lines) == 1
        assert run.ledger_lines[0]["outcome"] == "proposed"
        assert run.ledger_lines[0]["caseId"] == "polling-place-photo-rules"

    def test_a_covered_verdict_produces_no_case(self):
        run = run_drafting(
            run_id="2026-11-05",
            candidates=[_candidate()],
            case_list_reader=FakeChatCaseListReader(),
            ledger_entries=[],
            nightly_cap=3,
            now=NOW,
            draft_call=lambda s, t: _covered_response(),
        )
        assert run.bundle["drafts"] == []
        assert run.sources == {}
        assert run.ledger_lines[0]["outcome"] == "covered"
        assert run.ledger_lines[0]["coveredBy"] == "existing-case"

    def test_a_needs_setup_verdict_lands_on_the_needs_setup_list(self):
        run = run_drafting(
            run_id="2026-11-05",
            candidates=[_candidate()],
            case_list_reader=FakeChatCaseListReader(),
            ledger_entries=[],
            nightly_cap=3,
            now=NOW,
            draft_call=lambda s, t: _needs_setup_response(),
        )
        assert run.bundle["drafts"] == []
        assert len(run.bundle["needsSetup"]) == 1
        assert run.bundle["needsSetup"][0]["what"] == "needs a staged payment fixture"
        assert run.ledger_lines[0]["outcome"] == "needsSetup"

    def test_a_drafting_error_is_recorded_not_raised(self):
        run = run_drafting(
            run_id="2026-11-05",
            candidates=[_candidate()],
            case_list_reader=FakeChatCaseListReader(),
            ledger_entries=[],
            nightly_cap=3,
            now=NOW,
            draft_call=lambda s, t: "not json",
        )
        assert run.bundle["drafts"] == []
        assert run.ledger_lines[0]["outcome"] == "error"


class TestCaseIdCollision:
    def test_a_caseid_already_on_the_agents_list_is_recorded_as_an_error(self):
        existing_list = CaseListInfo(
            agent_id="chief_of_staff",
            case_count=1,
            case_ids=frozenset({"polling-place-photo-rules"}),
            conditions=(),
            fixture_description="",
        )
        run = run_drafting(
            run_id="2026-11-05",
            candidates=[_candidate()],
            case_list_reader=FakeChatCaseListReader({"chief_of_staff": existing_list}),
            ledger_entries=[],
            nightly_cap=3,
            now=NOW,
            draft_call=lambda s, t: _new_case_response(),
        )
        assert run.bundle["drafts"] == []
        assert run.sources == {}
        assert run.ledger_lines[0]["outcome"] == "error"

    def test_two_candidates_drafting_the_same_caseid_in_one_night_only_keep_the_first(self):
        candidates = [
            _candidate(conversation_id="conv-1", session_id="conv-1:a"),
            _candidate(conversation_id="conv-2", session_id="conv-2:a"),
        ]
        run = run_drafting(
            run_id="2026-11-05",
            candidates=candidates,
            case_list_reader=FakeChatCaseListReader(),
            ledger_entries=[],
            nightly_cap=3,
            now=NOW,
            # Different failure summaries so duplicate suppression (keyed on
            # summary, not caseId) doesn't short-circuit this before the
            # collision check ever runs.
            draft_call=lambda s, t: _new_case_response(failure_summary=f"failure for {t[:20]}"),
            second_read_call=_passing_second_read,
        )
        assert len(run.bundle["drafts"]) == 1
        assert len(run.sources) == 1
        outcomes = [line["outcome"] for line in run.ledger_lines]
        assert outcomes == ["proposed", "error"]


class TestNightlyCap:
    def test_candidates_beyond_the_cap_are_recorded_as_capped_worst_severity_first(self):
        calls = []

        def call(system, transcript):
            calls.append(transcript)
            return _new_case_response(case_id=f"case-{len(calls)}")

        candidates = [
            _candidate(conversation_id="conv-severe", severity=3),
            _candidate(conversation_id="conv-issue", severity=2),
        ]
        run = run_drafting(
            run_id="2026-11-05",
            candidates=candidates,
            case_list_reader=FakeChatCaseListReader(),
            ledger_entries=[],
            nightly_cap=1,
            now=NOW,
            draft_call=call,
            second_read_call=_passing_second_read,
        )
        assert len(calls) == 1  # the capped candidate never reaches the drafting call at all
        outcomes = [(line["outcome"], line["severity"]) for line in run.ledger_lines]
        assert outcomes == [("proposed", 3), ("capped", 2)]

    def test_every_candidate_gets_a_ledger_line_including_capped_ones(self):
        candidates = [_candidate(conversation_id=f"conv-{i}", severity=3) for i in range(5)]
        run = run_drafting(
            run_id="2026-11-05",
            candidates=candidates,
            case_list_reader=FakeChatCaseListReader(),
            ledger_entries=[],
            nightly_cap=2,
            now=NOW,
            draft_call=lambda s, t: _covered_response(),
        )
        assert len(run.ledger_lines) == 5
        assert sum(1 for line in run.ledger_lines if line["outcome"] == "capped") == 3


class TestListSizeCap:
    def test_a_full_list_records_list_full_instead_of_proposed(self):
        full_list = CaseListInfo(
            agent_id="chief_of_staff", case_count=25, case_ids=frozenset(), conditions=(), fixture_description=""
        )
        run = run_drafting(
            run_id="2026-11-05",
            candidates=[_candidate()],
            case_list_reader=FakeChatCaseListReader({"chief_of_staff": full_list}),
            ledger_entries=[],
            nightly_cap=3,
            now=NOW,
            draft_call=lambda s, t: _new_case_response(),
            second_read_call=_passing_second_read,
        )
        assert run.bundle["drafts"] == []
        assert len(run.bundle["listFull"]) == 1
        assert run.sources == {}
        assert run.ledger_lines[0]["outcome"] == "listFull"


class TestDuplicateSuppression:
    def test_a_recent_proposal_for_the_same_failure_is_covered_not_proposed_again(self):
        prior = parse_ledger_lines(
            [
                {
                    "conversationId": "conv-1",
                    "agentId": "chief_of_staff",
                    "outcome": "proposed",
                    "caseId": "polling-place-photo-rules",
                    "failureSummary": "gave a wrong polling rule",
                    "createdAt": (NOW - timedelta(days=3)).isoformat(),
                }
            ]
        )
        run = run_drafting(
            run_id="2026-11-06",
            candidates=[_candidate()],
            case_list_reader=FakeChatCaseListReader(),
            ledger_entries=prior,
            nightly_cap=3,
            now=NOW,
            draft_call=lambda s, t: _new_case_response(),  # the model proposes the same case again
        )
        assert run.bundle["drafts"] == []
        assert run.sources == {}
        assert run.ledger_lines[0]["outcome"] == "covered"
        assert run.ledger_lines[0]["coveredBy"] == "polling-place-photo-rules"

    def test_two_candidates_in_the_same_night_for_the_same_failure_produce_one_proposal(self):
        candidates = [
            _candidate(conversation_id="conv-1", session_id="conv-1:a"),
            _candidate(conversation_id="conv-1", session_id="conv-1:b"),
        ]
        run = run_drafting(
            run_id="2026-11-05",
            candidates=candidates,
            case_list_reader=FakeChatCaseListReader(),
            ledger_entries=[],
            nightly_cap=3,
            now=NOW,
            draft_call=lambda s, t: _new_case_response(),
            second_read_call=_passing_second_read,
        )
        outcomes = [line["outcome"] for line in run.ledger_lines]
        assert outcomes == ["proposed", "covered"]
        assert len(run.bundle["drafts"]) == 1


class TestRejectionSuppression:
    def test_a_rejection_closed_within_30_days_suppresses_the_recurrence(self):
        prior = parse_ledger_lines(
            [
                {
                    "conversationId": "conv-1",
                    "agentId": "chief_of_staff",
                    "outcome": "rejected",
                    "caseId": "noisy-case",
                    "failureSummary": "gave a wrong polling rule",
                    "createdAt": (NOW - timedelta(days=20)).isoformat(),
                    "closedAt": (NOW - timedelta(days=10)).isoformat(),
                }
            ]
        )
        run = run_drafting(
            run_id="2026-11-05",
            candidates=[_candidate()],
            case_list_reader=FakeChatCaseListReader(),
            ledger_entries=prior,
            nightly_cap=3,
            now=NOW,
            draft_call=lambda s, t: _new_case_response(),
        )
        assert run.bundle["drafts"] == []
        assert run.ledger_lines[0]["outcome"] == "suppressed"
        assert run.ledger_lines[0]["caseId"] == "noisy-case"

    def test_a_rejection_closed_more_than_30_days_ago_is_open_again(self):
        prior = parse_ledger_lines(
            [
                {
                    "conversationId": "conv-1",
                    "agentId": "chief_of_staff",
                    "outcome": "rejected",
                    "caseId": "noisy-case",
                    "failureSummary": "gave a wrong polling rule",
                    "createdAt": (NOW - timedelta(days=40)).isoformat(),
                    "closedAt": (NOW - timedelta(days=31)).isoformat(),
                }
            ]
        )
        run = run_drafting(
            run_id="2026-11-05",
            candidates=[_candidate()],
            case_list_reader=FakeChatCaseListReader(),
            ledger_entries=prior,
            nightly_cap=3,
            now=NOW,
            draft_call=lambda s, t: _new_case_response(),
            second_read_call=_passing_second_read,
        )
        assert len(run.bundle["drafts"]) == 1
        assert run.ledger_lines[0]["outcome"] == "proposed"


class TestGateIntegration:
    """Wiring tests for drafting.py's own gate.gate_draft call (gate.py's
    checks are unit-tested on their own in test_gate.py). Covers the ticket's
    "Gate-failure logging" Test Plan bullet: a gated draft's ledger line
    carries the rule and a non-identifying reason, never the matched text,
    and the draft reaches neither `drafts` nor `listFull`."""

    def _denylisted_session(self, conversation_id="conv-1"):
        message = Message(
            conversation_id=conversation_id,
            scope="chief_of_staff",
            message_id=f"{conversation_id}-0",
            role="user",
            content="I need help",
            created_at=NOW - timedelta(hours=1),
            denylist=["Springfield"],
        )
        return Session(
            session_id=f"{conversation_id}:{message.message_id}",
            conversation_id=conversation_id,
            scope="chief_of_staff",
            messages=(message,),
        )

    def _denylisted_candidate(self):
        return Candidate(session=self._denylisted_session(), score=_score())

    def test_a_gated_draft_is_dropped_entirely_and_logged_as_gated(self):
        run = run_drafting(
            run_id="2026-11-05",
            candidates=[self._denylisted_candidate()],
            case_list_reader=FakeChatCaseListReader(),
            ledger_entries=[],
            nightly_cap=3,
            now=NOW,
            draft_call=lambda s, t: _new_case_response(condition="This happened in Springfield specifically."),
            second_read_call=_passing_second_read,
        )
        assert run.bundle["drafts"] == []
        assert run.bundle["listFull"] == []
        assert run.sources == {}
        assert len(run.ledger_lines) == 1
        line = run.ledger_lines[0]
        assert line["outcome"] == "gated"
        assert line["gateFailures"] == ["denylist"]
        assert "Springfield" not in line["failureSummary"]
        assert "springfield" not in line["failureSummary"].lower()

    def test_a_draft_a_full_list_would_hold_back_is_still_gated(self):
        full_list = CaseListInfo(
            agent_id="chief_of_staff", case_count=25, case_ids=frozenset(), conditions=(), fixture_description=""
        )
        run = run_drafting(
            run_id="2026-11-05",
            candidates=[self._denylisted_candidate()],
            case_list_reader=FakeChatCaseListReader({"chief_of_staff": full_list}),
            ledger_entries=[],
            nightly_cap=3,
            now=NOW,
            draft_call=lambda s, t: _new_case_response(condition="This happened in Springfield specifically."),
            second_read_call=_passing_second_read,
        )
        # Gating runs before the list-full placement decision, so a draft
        # that would otherwise land on "listFull" (and so still reach the
        # PR body) is gated first instead.
        assert run.bundle["listFull"] == []
        assert run.ledger_lines[0]["outcome"] == "gated"

    def test_duplicate_rejection_and_collision_never_reach_the_paid_second_read_call(self):
        calls = []

        def second_read(text):
            calls.append(text)
            return "[]"

        prior = parse_ledger_lines(
            [
                {
                    "conversationId": "conv-1",
                    "agentId": "chief_of_staff",
                    "outcome": "proposed",
                    "caseId": "polling-place-photo-rules",
                    "failureSummary": "gave a wrong polling rule",
                    "createdAt": (NOW - timedelta(days=3)).isoformat(),
                }
            ]
        )
        run_drafting(
            run_id="2026-11-06",
            candidates=[_candidate()],
            case_list_reader=FakeChatCaseListReader(),
            ledger_entries=prior,
            nightly_cap=3,
            now=NOW,
            draft_call=lambda s, t: _new_case_response(),  # duplicates the prior proposal above
            second_read_call=second_read,
        )
        assert calls == []
