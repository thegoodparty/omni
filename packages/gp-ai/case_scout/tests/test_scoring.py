import json
from datetime import UTC, datetime

import pytest

from case_scout import ai_secrets
from case_scout.reader import scoring as scoring_module
from case_scout.reader.messages import Message
from case_scout.reader.scoring import (
    _OLD_TOOL_VISIBILITY_PARAGRAPH,
    MODEL,
    PROMPT,
    Candidate,
    ScoringError,
    SessionScore,
    _call_anthropic,
    parse_scored_session,
    score_session,
    score_session_if_covered,
    select_candidates,
    should_score,
)
from case_scout.reader.sessions import Session


def _msg(conversation_id, role, minute, scope="chief_of_staff", message_id=None):
    return Message(
        conversation_id=conversation_id,
        scope=scope,
        message_id=message_id or f"{conversation_id}-{minute}",
        role=role,
        content="hello",
        created_at=datetime(2026, 11, 5, 0, 0, tzinfo=UTC),
    )


def _session(session_id="conv-1:m1", scope="chief_of_staff", started_minute=0):
    message = _msg("conv-1", "user", started_minute, scope=scope, message_id="m1")
    return Session(session_id=session_id, conversation_id="conv-1", scope=scope, messages=(message,))


def _response(**overrides):
    request = {
        "request_ordinal": 1,
        "primary_use_case": "voter_data",
        "answered_request": "yes",
        "overall_rating": "good",
        "major_failure_type": "none",
        "known_pattern": "none",
        "severity": 0,
        "confidence": "high",
        "human_review_needed": "no",
        "worth_quoting_anonymized": "no",
        "summary_nonidentifying": "asked a question",
        "reason_nonidentifying": "answered correctly",
        **overrides,
    }
    return json.dumps({"session_id": "conv-1:m1", "requests": [request]})


class TestPromptText:
    def test_contains_the_replacement_tool_visibility_paragraph(self):
        assert "Tool calls and their inputs are shown in this transcript" in PROMPT
        assert "tool results are not" in PROMPT

    def test_does_not_contain_the_old_tool_visibility_paragraph(self):
        assert _OLD_TOOL_VISIBILITY_PARAGRAPH not in PROMPT
        assert "NOT stored in this transcript" not in PROMPT

    def test_contains_the_known_pattern_field_and_json_shape(self):
        assert "known_pattern: one of" in PROMPT
        assert '"known_pattern": ""' in PROMPT


class TestParseScoredSession:
    def test_well_formed_response_parses_into_a_request_score(self):
        score = parse_scored_session(_response(severity=2, known_pattern="date_arithmetic"), "conv-1:m1")

        assert score.session_id == "conv-1:m1"
        assert len(score.requests) == 1
        request = score.requests[0]
        assert request.severity == 2
        assert request.known_pattern == "date_arithmetic"
        assert request.major_failure_type == "none"

    def test_session_severity_is_the_highest_among_its_requests(self):
        raw = json.dumps(
            {
                "session_id": "conv-1:m1",
                "requests": [
                    {**json.loads(_response())["requests"][0], "request_ordinal": 1, "severity": 1},
                    {**json.loads(_response())["requests"][0], "request_ordinal": 2, "severity": 3},
                ],
            }
        )

        score = parse_scored_session(raw, "conv-1:m1")

        assert score.severity == 3

    def test_an_unknown_known_pattern_is_treated_as_none(self):
        score = parse_scored_session(_response(known_pattern="not_a_real_pattern"), "conv-1:m1")

        assert score.requests[0].known_pattern == "none"

    def test_severity_outside_0_to_3_is_clamped(self):
        score = parse_scored_session(_response(severity=99), "conv-1:m1")
        assert score.requests[0].severity == 3

        score = parse_scored_session(_response(severity=-5), "conv-1:m1")
        assert score.requests[0].severity == 0

    def test_malformed_json_raises_value_error(self):
        with pytest.raises(ValueError):
            parse_scored_session("not json at all, no braces here", "conv-1:m1")

    def test_missing_requests_raises_value_error(self):
        with pytest.raises(ValueError):
            parse_scored_session(json.dumps({"session_id": "conv-1:m1"}), "conv-1:m1")


class TestScoreSessionRetry:
    def test_a_malformed_response_is_retried_once_then_succeeds(self):
        calls = []

        def fake_call(system, transcript):
            calls.append(1)
            if len(calls) == 1:
                return "not json"
            return _response()

        score = score_session(_session(), call=fake_call)

        assert len(calls) == 2
        assert isinstance(score, SessionScore)

    def test_two_malformed_responses_surface_as_a_scoring_error_not_a_crash(self):
        calls = []

        def fake_call(system, transcript):
            calls.append(1)
            return "still not json"

        with pytest.raises(ScoringError):
            score_session(_session(), call=fake_call)

        assert len(calls) == 2

    def test_a_well_formed_first_response_makes_exactly_one_call(self):
        calls = []

        def fake_call(system, transcript):
            calls.append(1)
            return _response()

        score_session(_session(), call=fake_call)

        assert len(calls) == 1

    def test_no_tools_are_ever_passed_to_the_model(self):
        # The call signature itself is (system, transcript) -- there is no
        # tools parameter for score_session to pass, which is the point: a
        # tool can never be registered because there is nowhere to put one.
        received = {}

        def fake_call(system, transcript):
            received["system"] = system
            received["transcript"] = transcript
            return _response()

        score_session(_session(), call=fake_call)

        assert received["system"] == PROMPT


class TestScopeAllowlist:
    def test_an_unrecognized_scope_is_skipped_before_scoring(self):
        def fail_if_called(system, transcript):
            raise AssertionError("the model must never be called for an uncovered scope")

        result = score_session_if_covered(_session(scope="ordinance_flow"), call=fail_if_called)

        assert result is None

    def test_a_covered_scope_is_scored(self):
        result = score_session_if_covered(_session(scope="chief_of_staff"), call=lambda s, t: _response())

        assert result is not None

    def test_should_score(self):
        assert should_score(_session(scope="chief_of_staff")) is True
        assert should_score(_session(scope="campaign_assistant")) is True
        assert should_score(_session(scope="ordinance_flow")) is False
        assert should_score(_session(scope="ai-chat")) is False


class TestSelectCandidates:
    def _score(self, severity):
        request = json.loads(_response(severity=severity))["requests"][0]
        from case_scout.reader.scoring import RequestScore

        return SessionScore(
            session_id="s",
            requests=(
                RequestScore(
                    request_ordinal=1,
                    primary_use_case=request["primary_use_case"],
                    answered_request=request["answered_request"],
                    overall_rating=request["overall_rating"],
                    major_failure_type=request["major_failure_type"],
                    known_pattern=request["known_pattern"],
                    severity=severity,
                    confidence=request["confidence"],
                    human_review_needed=request["human_review_needed"],
                    worth_quoting_anonymized=request["worth_quoting_anonymized"],
                    summary_nonidentifying=request["summary_nonidentifying"],
                    reason_nonidentifying=request["reason_nonidentifying"],
                ),
            ),
        )

    def test_filters_to_severity_2_or_3_in_covered_scopes(self):
        low = _session(session_id="low", scope="chief_of_staff", started_minute=0)
        mid = _session(session_id="mid", scope="chief_of_staff", started_minute=1)
        high = _session(session_id="high", scope="campaign_assistant", started_minute=2)
        out_of_scope = _session(session_id="oos", scope="ordinance_flow", started_minute=3)

        scored = [
            (low, self._score(1)),
            (mid, self._score(2)),
            (high, self._score(3)),
            (out_of_scope, self._score(3)),
        ]

        candidates = select_candidates(scored)

        assert [c.session.session_id for c in candidates] == ["high", "mid"]

    def test_orders_by_severity_descending_then_session_start(self):
        earlier = Session(
            session_id="a",
            conversation_id="conv-a",
            scope="chief_of_staff",
            messages=(_msg("conv-a", "user", 0, scope="chief_of_staff", message_id="a1"),),
        )
        later = Session(
            session_id="b",
            conversation_id="conv-b",
            scope="chief_of_staff",
            messages=(
                Message(
                    conversation_id="conv-b",
                    scope="chief_of_staff",
                    message_id="b1",
                    role="user",
                    content="hi",
                    created_at=datetime(2026, 11, 5, 1, 0, tzinfo=UTC),
                ),
            ),
        )

        scored = [(earlier, self._score(2)), (later, self._score(3))]

        candidates = select_candidates(scored)

        assert [c.session.session_id for c in candidates] == ["b", "a"]
        assert isinstance(candidates[0], Candidate)

    def test_an_ordinance_flow_session_is_excluded_even_at_severity_3(self):
        session = _session(session_id="oos", scope="ordinance_flow")

        candidates = select_candidates([(session, self._score(3))])

        assert candidates == []


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class TestCallAnthropic:
    """The real `_call_anthropic`, not an injected fake — the one place the
    "no tools registered" AC and the Opus model id are actually exercised,
    rather than taken on faith from the test double every other test here
    uses."""

    def test_raises_scoring_error_when_no_api_key_is_configured(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        ai_secrets.reset_for_tests()

        with pytest.raises(ScoringError):
            _call_anthropic(PROMPT, "a transcript")

    def test_sends_no_tools_and_uses_the_opus_model_id(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
        ai_secrets.reset_for_tests()
        captured = {}

        def fake_post(url, json, headers, timeout):
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return _FakeResponse({"content": [{"type": "text", "text": "hello"}]})

        monkeypatch.setattr(scoring_module.httpx, "post", fake_post)

        result = _call_anthropic(PROMPT, "a transcript")

        assert result == "hello"
        assert "tools" not in captured["json"]
        assert "tool_choice" not in captured["json"]
        assert captured["json"]["model"] == MODEL
        assert captured["json"]["system"] == PROMPT
        assert captured["headers"]["x-api-key"] == "test-key"
