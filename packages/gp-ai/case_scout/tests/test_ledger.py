from datetime import UTC, datetime, timedelta

from case_scout.reader.ledger import (
    dedup_key,
    find_duplicate,
    find_rejection,
    parse_ledger_lines,
    recent_proposals_for_agent,
    yyyymm_keys_covering,
)

NOW = datetime(2026, 11, 5, 6, 0, tzinfo=UTC)


def _raw_line(
    outcome,
    conversation_id="conv-1",
    agent_id="chief_of_staff",
    case_id="case-1",
    summary="the same failure",
    days_ago=1,
    closed_days_ago=None,
):
    line = {
        "conversationId": conversation_id,
        "agentId": agent_id,
        "outcome": outcome,
        "caseId": case_id,
        "failureSummary": summary,
        "createdAt": (NOW - timedelta(days=days_ago)).isoformat(),
    }
    if closed_days_ago is not None:
        line["closedAt"] = (NOW - timedelta(days=closed_days_ago)).isoformat()
    return line


class TestDedupKey:
    def test_normalizes_case_and_whitespace(self):
        a = dedup_key("conv-1", "chief_of_staff", "  The Same   Failure ")
        b = dedup_key("conv-1", "chief_of_staff", "the same failure")
        assert a == b

    def test_differs_by_conversation_agent_or_summary(self):
        base = dedup_key("conv-1", "chief_of_staff", "a failure")
        assert base != dedup_key("conv-2", "chief_of_staff", "a failure")
        assert base != dedup_key("conv-1", "campaign_assistant", "a failure")
        assert base != dedup_key("conv-1", "chief_of_staff", "a different failure")


class TestParseLedgerLines:
    def test_skips_lines_missing_required_fields(self):
        entries = parse_ledger_lines([{"outcome": "proposed"}, _raw_line("proposed")])
        assert len(entries) == 1

    def test_tolerates_an_unparseable_timestamp(self):
        raw = _raw_line("proposed")
        raw["createdAt"] = "not-a-timestamp"
        entries = parse_ledger_lines([raw])
        assert entries[0].created_at is None


class TestFindDuplicate:
    def test_a_recent_proposed_line_for_the_same_key_is_a_duplicate(self):
        entries = parse_ledger_lines([_raw_line("proposed", case_id="polling-place-photo-rules")])
        match = find_duplicate(entries, "conv-1", "chief_of_staff", "the same failure", NOW)
        assert match is not None
        assert match.case_id == "polling-place-photo-rules"

    def test_outside_the_30_day_window_is_not_a_duplicate(self):
        entries = parse_ledger_lines([_raw_line("proposed", days_ago=31)])
        assert find_duplicate(entries, "conv-1", "chief_of_staff", "the same failure", NOW) is None

    def test_a_non_proposed_outcome_is_never_a_duplicate_source(self):
        entries = parse_ledger_lines([_raw_line("covered")])
        assert find_duplicate(entries, "conv-1", "chief_of_staff", "the same failure", NOW) is None

    def test_a_different_failure_summary_is_not_a_duplicate(self):
        entries = parse_ledger_lines([_raw_line("proposed", summary="a totally different failure")])
        assert find_duplicate(entries, "conv-1", "chief_of_staff", "the same failure", NOW) is None


class TestFindRejection:
    def test_a_rejection_closed_within_30_days_suppresses(self):
        entries = parse_ledger_lines([_raw_line("rejected", case_id="noisy-case", closed_days_ago=5)])
        match = find_rejection(entries, "conv-1", "chief_of_staff", "the same failure", NOW)
        assert match is not None
        assert match.case_id == "noisy-case"

    def test_a_rejection_closed_more_than_30_days_ago_is_open_again(self):
        entries = parse_ledger_lines([_raw_line("rejected", closed_days_ago=31)])
        assert find_rejection(entries, "conv-1", "chief_of_staff", "the same failure", NOW) is None

    def test_never_proposed_or_rejected_is_open(self):
        assert find_rejection([], "conv-1", "chief_of_staff", "the same failure", NOW) is None


class TestRecentProposalsForAgent:
    def test_only_proposed_lines_for_the_given_agent_within_the_window(self):
        entries = parse_ledger_lines(
            [
                _raw_line("proposed", agent_id="chief_of_staff", case_id="a"),
                _raw_line("proposed", agent_id="campaign_assistant", case_id="b"),
                _raw_line("covered", agent_id="chief_of_staff", case_id="c"),
                _raw_line("proposed", agent_id="chief_of_staff", case_id="d", days_ago=31),
            ]
        )
        result = recent_proposals_for_agent(entries, "chief_of_staff", NOW)
        assert [e.case_id for e in result] == ["a"]

    def test_most_recent_first(self):
        entries = parse_ledger_lines(
            [
                _raw_line("proposed", case_id="older", days_ago=10),
                _raw_line("proposed", case_id="newer", days_ago=1),
            ]
        )
        result = recent_proposals_for_agent(entries, "chief_of_staff", NOW)
        assert [e.case_id for e in result] == ["newer", "older"]


class TestYyyymmKeysCovering:
    def test_a_window_within_one_month_returns_one_key(self):
        assert yyyymm_keys_covering(datetime(2026, 11, 20, tzinfo=UTC), 5) == ["2026-11"]

    def test_a_window_spanning_a_month_boundary_returns_both(self):
        assert yyyymm_keys_covering(datetime(2026, 11, 5, tzinfo=UTC), 30) == ["2026-10", "2026-11"]
