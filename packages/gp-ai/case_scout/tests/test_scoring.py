import json
from datetime import UTC, datetime

import pytest

from case_scout import ai_secrets
from case_scout.reader import scoring as scoring_module
from case_scout.reader.messages import Message, ToolCall
from case_scout.reader.scoring import (
    _OLD_TOOL_VISIBILITY_PARAGRAPH,
    ANSWERED_VALUES,
    CONFIDENCE_VALUES,
    FAILURES,
    KNOWN_PATTERNS,
    MODEL,
    NO_KNOWN_PATTERN,
    PROMPT,
    RATING_VALUES,
    SCORE_SCHEMA,
    SEVERITY_VALUES,
    USE_CASES,
    YES_NO_VALUES,
    Candidate,
    ScoringError,
    SessionScore,
    _call_anthropic,
    parse_scored_session,
    render_session_transcript,
    score_session,
    score_session_if_covered,
    select_candidates,
    should_score,
)
from case_scout.reader.sessions import Session


def _msg(conversation_id, role, minute, scope="chief_of_staff", message_id=None, content="hello"):
    return Message(
        conversation_id=conversation_id,
        scope=scope,
        message_id=message_id or f"{conversation_id}-{minute}",
        role=role,
        content=content,
        created_at=datetime(2026, 11, 5, 0, minute, tzinfo=UTC),
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

    def test_ties_on_severity_break_by_earlier_session_start(self):
        # Both at severity 3 — only the started_at tiebreak decides the
        # order. test_orders_by_severity_descending_then_session_start gives
        # its two sessions DIFFERENT severities, so that test alone would
        # still pass with the started_at key removed from the sort.
        earlier = _session(session_id="earlier", scope="chief_of_staff", started_minute=0)
        later = _session(session_id="later", scope="chief_of_staff", started_minute=5)

        scored = [(later, self._score(3)), (earlier, self._score(3))]

        candidates = select_candidates(scored)

        assert [c.session.session_id for c in candidates] == ["earlier", "later"]

    def test_an_ordinance_flow_session_is_excluded_even_at_severity_3(self):
        session = _session(session_id="oos", scope="ordinance_flow")

        candidates = select_candidates([(session, self._score(3))])

        assert candidates == []


class TestRenderSessionTranscript:
    def test_a_tool_call_is_inlined_under_the_message_that_made_it(self):
        message = Message(
            conversation_id="conv-1",
            scope="chief_of_staff",
            message_id="m1",
            role="assistant",
            content="let me check that",
            created_at=datetime(2026, 11, 5, 0, 0, tzinfo=UTC),
            tool_calls=[ToolCall(tool="lookup_voter", input='{"zip": "90210"}')],
        )
        session = Session(session_id="conv-1:m1", conversation_id="conv-1", scope="chief_of_staff", messages=(message,))

        transcript = render_session_transcript(session)

        assert 'tool: lookup_voter input: {"zip": "90210"}' in transcript
        # The tool call line must come after the message's own text, i.e.
        # under the block that made the call, not before it or detached.
        assert transcript.index("let me check that") < transcript.index("tool: lookup_voter")

    def test_a_blank_message_is_tagged_empty(self):
        message = _msg("conv-1", "assistant", 0, message_id="m1", content="   ")
        session = Session(session_id="conv-1:m1", conversation_id="conv-1", scope="chief_of_staff", messages=(message,))

        transcript = render_session_transcript(session)

        assert "[empty]" in transcript

    def test_a_non_blank_message_is_not_tagged_empty(self):
        session = _session()

        transcript = render_session_transcript(session)

        assert "[empty]" not in transcript

    def test_header_carries_the_session_id_scope_and_start(self):
        session = _session(session_id="conv-1:m1", scope="campaign_assistant")

        transcript = render_session_transcript(session)

        assert "# session conv-1:m1" in transcript
        assert "scope: campaign_assistant" in transcript


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

    def test_enforces_the_reply_shape_with_the_score_schema(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
        ai_secrets.reset_for_tests()
        captured = {}

        def fake_post(url, json, headers, timeout):
            captured["json"] = json
            return _FakeResponse({"content": [{"type": "text", "text": "{}"}]})

        monkeypatch.setattr(scoring_module.httpx, "post", fake_post)

        _call_anthropic(PROMPT, "a transcript")

        assert captured["json"]["output_config"] == {"format": {"type": "json_schema", "schema": SCORE_SCHEMA}}


# The API rejects a schema with these keywords, and requires every object to
# close its properties, so a schema edit that breaks either fails here instead
# of failing every scoring call in production.
_UNSUPPORTED_SCHEMA_KEYWORDS = {
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "multipleOf",
    "pattern",
    "minItems",
    "maxItems",
}


def _schema_nodes(node):
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _schema_nodes(value)
    elif isinstance(node, list):
        for value in node:
            yield from _schema_nodes(value)


class TestScoreSchema:
    def test_uses_only_constraints_the_api_accepts(self):
        for node in _schema_nodes(SCORE_SCHEMA):
            assert not _UNSUPPORTED_SCHEMA_KEYWORDS & node.keys()
            if node.get("type") == "object":
                assert node.get("additionalProperties") is False

    def test_offers_exactly_the_values_the_prompt_lists(self):
        def listed(values):
            return " | ".join(str(v) for v in values)

        assert f"primary_use_case: one of {listed(USE_CASES)}" in PROMPT
        assert f"answered_request: {listed(ANSWERED_VALUES)}" in PROMPT
        assert f"overall_rating: {listed(RATING_VALUES)}" in PROMPT
        assert f"major_failure_type: one of {listed(FAILURES)}" in PROMPT
        assert f"known_pattern: one of {listed([*KNOWN_PATTERNS, NO_KNOWN_PATTERN])}" in PROMPT
        assert f"severity: {listed(SEVERITY_VALUES)}" in PROMPT
        assert f"confidence: {listed(CONFIDENCE_VALUES)}" in PROMPT
        assert f"human_review_needed: {listed(YES_NO_VALUES)}" in PROMPT
        assert f"worth_quoting_anonymized: {listed(YES_NO_VALUES)}" in PROMPT

    def test_requires_every_field_the_prompt_asks_for(self):
        item = SCORE_SCHEMA["properties"]["requests"]["items"]
        assert set(item["required"]) == set(item["properties"])
        for name in item["properties"]:
            assert f'"{name}"' in PROMPT

    def test_a_reply_it_allows_parses(self):
        reply = {
            "session_id": "s-1",
            "requests": [
                {
                    "request_ordinal": 1,
                    "primary_use_case": "voter_data",
                    "answered_request": "no",
                    "overall_rating": "bad",
                    "major_failure_type": "wrong_or_invented",
                    "known_pattern": "unsourced_numbers",
                    "severity": 3,
                    "confidence": "high",
                    "human_review_needed": "yes",
                    "worth_quoting_anonymized": "no",
                    "summary_nonidentifying": "turnout target",
                    "reason_nonidentifying": "figures with no source",
                }
            ],
        }

        scored = parse_scored_session(json.dumps(reply), "s-1")

        assert scored.severity == 3
