from datetime import UTC, datetime, timedelta

import pytest

from case_scout.reader.drafting import DraftedCase
from case_scout.reader.gate import (
    GateResult,
    check_contact_patterns,
    check_copied_text,
    check_denylist,
    gate_draft,
    run_second_read,
    session_denylist,
    session_user_messages,
)
from case_scout.reader.messages import Message
from case_scout.reader.sessions import Session

NOW = datetime(2026, 11, 5, 6, 0, tzinfo=UTC)


def _case(**overrides):
    fields = {
        "case_id": "polling-place-photo-rules",
        "question": "Can I take a photo of my ballot?",
        "turns": None,
        "condition": "Ballot photo rules are set per state.",
        "handled_when": "the reply says it depends on the state and to confirm locally.",
        "source": "production",
        "split": "tune",
        **overrides,
    }
    return DraftedCase(**fields)


def _msg(conversation_id, minute, role="user", content="I need help", denylist=None):
    return Message(
        conversation_id=conversation_id,
        scope="chief_of_staff",
        message_id=f"{conversation_id}-{minute}",
        role=role,
        content=content,
        created_at=NOW - timedelta(hours=1) + timedelta(minutes=minute),
        denylist=denylist or [],
    )


def _session(messages):
    return Session(
        session_id=f"{messages[0].conversation_id}:{messages[0].message_id}",
        conversation_id=messages[0].conversation_id,
        scope=messages[0].scope,
        messages=tuple(messages),
    )


def _passing_second_read(_draft_text):
    return "[]"


class TestSessionDenylist:
    def test_collects_terms_across_every_message_in_the_session(self):
        session = _session(
            [
                _msg("conv-1", 0, denylist=["Jane Doe", "Acme Campaign"]),
                _msg("conv-1", 1, role="assistant", content="ok", denylist=["Jane Doe", "Acme Campaign"]),
            ]
        )
        assert session_denylist(session) == ("Jane Doe", "Acme Campaign") or set(session_denylist(session)) == {
            "Jane Doe",
            "Acme Campaign",
        }

    def test_empty_when_no_message_carries_a_denylist(self):
        session = _session([_msg("conv-1", 0)])
        assert session_denylist(session) == ()


class TestSessionUserMessages:
    def test_only_user_turns_with_content_are_kept(self):
        session = _session(
            [
                _msg("conv-1", 0, role="user", content="hello there"),
                _msg("conv-1", 1, role="assistant", content="hi"),
                _msg("conv-1", 2, role="user", content="   "),
            ]
        )
        assert session_user_messages(session) == ("hello there",)


class TestCheckDenylist:
    def test_a_present_term_blocks_case_insensitively(self):
        fields = ["The reply should mention Springfield's rule."]
        assert check_denylist(fields, ("springfield",)) is not None

    def test_an_absent_term_passes(self):
        fields = ["Nothing identifying here."]
        assert check_denylist(fields, ("Springfield",)) is None

    def test_a_term_under_three_characters_is_skipped(self):
        fields = ["Mo went to the office."]
        assert check_denylist(fields, ("Mo",)) is None

    def test_word_boundaries_dont_match_a_substring_of_a_longer_word(self):
        # "Ada" must not match inside "Canada" (Implementation Notes: a
        # denylist term like "Ada" shouldn't match "Canada").
        fields = ["The candidate moved to Canada last year."]
        assert check_denylist(fields, ("Ada",)) is None

    def test_a_regex_special_character_in_a_term_is_treated_literally(self):
        fields = ["Reach out to City Council (District 4) directly."]
        assert check_denylist(fields, ("City Council (District 4)",)) is not None

    def test_case_variation_still_matches(self):
        fields = ["the candidate ran in SPRINGFIELD."]
        assert check_denylist(fields, ("Springfield",)) is not None


class TestCheckCopiedText:
    SOURCE = ("I think the polling place near my house closed early on election day last year",)

    def test_exactly_eight_matching_words_blocks(self):
        draft = ["He said the polling place near my house closed early"]
        assert check_copied_text(draft, self.SOURCE) is not None

    def test_seven_matching_words_does_not_block(self):
        draft = ["He said the polling place near my house"]
        assert check_copied_text(draft, self.SOURCE) is None

    def test_punctuation_and_case_normalization_still_catches_a_near_identical_run(self):
        draft = ["He said: THE POLLING-PLACE near my house, closed early!"]
        assert check_copied_text(draft, self.SOURCE) is not None

    def test_no_user_messages_never_blocks(self):
        assert check_copied_text(["anything at all, eight or more words long here"], ()) is None


class TestCheckContactPatterns:
    @pytest.mark.parametrize(
        "text",
        [
            "reach me at jane.doe+test@example.com",
            "call (555) 123-4567 for details",
            "call 555-123-4567 for details",
            "call +1 555 123 4567 for details",
            "see https://example.com/profile for more",
            "see www.example.com for more",
        ],
    )
    def test_each_pattern_is_caught(self, text):
        assert check_contact_patterns([text]) is not None

    def test_non_matching_text_passes(self):
        assert check_contact_patterns(["a perfectly ordinary sentence with no contact info"]) is None


class TestRunSecondRead:
    def test_an_empty_list_passes(self):
        assert run_second_read(["some draft text"], call=lambda text: "[]") is None

    def test_a_flagged_string_blocks(self):
        reason = run_second_read(["some draft text"], call=lambda text: '["Jane Doe"]')
        assert reason is not None

    def test_a_call_error_blocks_with_no_retry(self):
        from case_scout.reader.gate import SecondReadError

        calls = []

        def call(text):
            calls.append(text)
            raise SecondReadError("boom")

        reason = run_second_read(["some draft text"], call=call)
        assert reason is not None
        assert len(calls) == 1

    def test_a_malformed_answer_is_retried_once_then_blocks(self):
        responses = iter(["not json", "still not json"])
        reason = run_second_read(["some draft text"], call=lambda text: next(responses))
        assert reason is not None

    def test_a_malformed_first_answer_recovers_on_retry(self):
        responses = iter(["not json", "[]"])
        reason = run_second_read(["some draft text"], call=lambda text: next(responses))
        assert reason is None

    def test_the_call_payload_is_only_the_draft(self):
        seen = {}

        def call(draft_text):
            seen["payload"] = draft_text
            return "[]"

        run_second_read(["condition text", "handledWhen text"], call=call)
        assert seen["payload"] == "condition text\nhandledWhen text"
        assert "transcript" not in seen["payload"].lower()


class TestGateDraft:
    def _gate(self, case, denylist=(), user_messages=(), second_read_call=None):
        return gate_draft(
            case.to_json(),
            denylist=denylist,
            user_messages=user_messages,
            second_read_call=second_read_call or _passing_second_read,
        )

    def test_a_clean_draft_passes(self):
        result = self._gate(_case())
        assert result == GateResult(passed=True)

    def test_a_denylist_match_blocks_before_the_second_read_runs(self):
        calls = []

        def second_read(text):
            calls.append(text)
            return "[]"

        case = _case(condition="This happened in Springfield specifically.")
        result = self._gate(case, denylist=("Springfield",), second_read_call=second_read)
        assert result.passed is False
        assert result.rule == "denylist"
        assert calls == []  # the paid model call never runs once a code check already gated the draft

    def test_copied_text_blocks(self):
        case = _case(condition="the user asked about the polling place near my house closed early")
        result = self._gate(case, user_messages=("I think the polling place near my house closed early last year",))
        assert result.passed is False
        assert result.rule == "copiedText"

    def test_contact_pattern_blocks(self):
        case = _case(condition="Follow up at jane.doe@example.com for details.")
        result = self._gate(case)
        assert result.passed is False
        assert result.rule == "contactPattern"

    def test_second_read_flag_blocks(self):
        result = self._gate(_case(), second_read_call=lambda text: '["a real org"]')
        assert result.passed is False
        assert result.rule == "secondRead"

    def test_second_read_error_blocks(self):
        from case_scout.reader.gate import SecondReadError

        def call(text):
            raise SecondReadError("down")

        result = self._gate(_case(), second_read_call=call)
        assert result.passed is False
        assert result.rule == "secondRead"

    def test_schema_violation_blocks(self):
        # DraftedCase.to_json() always serializes exactly one of
        # question/turns (its if/else can't represent both at once — that
        # exclusivity is already enforced earlier, by drafting._parse_case),
        # so a "both set" violation is built directly on the dict gate_draft
        # actually receives, simulating a bug upstream of the gate.
        case_dict = _case().to_json()
        case_dict["turns"] = ["another turn"]
        result = gate_draft(case_dict, denylist=(), user_messages=(), second_read_call=_passing_second_read)
        assert result.passed is False
        assert result.rule == "schema"

    def test_no_raw_matched_text_or_reason_leaks_the_denylist_term(self):
        case = _case(condition="This happened in Springfield specifically.")
        result = self._gate(case, denylist=("Springfield",))
        assert "Springfield" not in (result.reason or "")


class TestSchemaValidation:
    from case_scout.reader.case_schema import MAX_CASE_ID_LENGTH, MAX_CONDITION_CHARS, MAX_HANDLED_WHEN_CHARS

    def test_a_bad_case_id_is_gated(self):
        case = _case(case_id="has a space")
        result = gate_draft(case.to_json(), denylist=(), user_messages=(), second_read_call=_passing_second_read)
        assert result.passed is False
        assert result.rule == "schema"

    def test_an_overlong_condition_is_gated(self):
        case = _case(condition="x" * (self.MAX_CONDITION_CHARS + 1))
        result = gate_draft(case.to_json(), denylist=(), user_messages=(), second_read_call=_passing_second_read)
        assert result.passed is False
        assert result.rule == "schema"

    def test_an_overlong_handled_when_is_gated(self):
        case = _case(handled_when="x" * (self.MAX_HANDLED_WHEN_CHARS + 1))
        result = gate_draft(case.to_json(), denylist=(), user_messages=(), second_read_call=_passing_second_read)
        assert result.passed is False
        assert result.rule == "schema"

    def test_both_question_and_turns_is_gated(self):
        case_dict = _case().to_json()  # question is already set by _case's default
        case_dict["turns"] = ["a turn"]  # see TestGateDraft.test_schema_violation_blocks for why this is built by hand
        result = gate_draft(case_dict, denylist=(), user_messages=(), second_read_call=_passing_second_read)
        assert result.passed is False
        assert result.rule == "schema"

    def test_a_valid_case_passes_schema(self):
        case = _case()
        result = gate_draft(case.to_json(), denylist=(), user_messages=(), second_read_call=_passing_second_read)
        assert result.passed is True
