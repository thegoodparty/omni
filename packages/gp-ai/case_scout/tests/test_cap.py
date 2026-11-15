from datetime import UTC, datetime, timedelta

from case_scout.reader.cap import (
    DEFAULT_NIGHTLY_CAP,
    MIN_SAMPLE_SIZE,
    nightly_cap_for_merge_share,
    trailing_merge_share,
)
from case_scout.reader.ledger import LedgerEntry

NOW = datetime(2026, 11, 5, 6, 0, tzinfo=UTC)


def _entry(outcome, case_id, days_ago=1, conversation_id="conv-1", agent_id="chief_of_staff"):
    return LedgerEntry(
        conversation_id=conversation_id,
        agent_id=agent_id,
        outcome=outcome,
        case_id=case_id,
        failure_summary="some failure",
        created_at=NOW - timedelta(days=days_ago),
        closed_at=None,
    )


class TestNightlyCapForMergeShare:
    def test_none_keeps_the_default(self):
        assert nightly_cap_for_merge_share(None) == DEFAULT_NIGHTLY_CAP

    def test_at_or_above_70_percent_raises_the_cap_to_5(self):
        assert nightly_cap_for_merge_share(0.70) == 5
        assert nightly_cap_for_merge_share(0.9) == 5

    def test_between_40_and_70_percent_keeps_the_default(self):
        assert nightly_cap_for_merge_share(0.40) == DEFAULT_NIGHTLY_CAP
        assert nightly_cap_for_merge_share(0.55) == DEFAULT_NIGHTLY_CAP

    def test_below_40_percent_lowers_the_cap(self):
        assert nightly_cap_for_merge_share(0.39) < DEFAULT_NIGHTLY_CAP
        assert nightly_cap_for_merge_share(0.0) >= 1


class TestTrailingMergeShare:
    def test_insufficient_sample_returns_none(self):
        entries = [_entry("proposed", f"case-{i}") for i in range(MIN_SAMPLE_SIZE - 1)]
        assert trailing_merge_share(entries, NOW) is None

    def test_high_merge_share_reads_above_70_percent(self):
        entries = [_entry("proposed", f"case-{i}") for i in range(10)]
        entries += [_entry("merged", f"case-{i}", days_ago=0) for i in range(8)]
        share = trailing_merge_share(entries, NOW)
        assert share is not None
        assert share >= 0.70
        assert nightly_cap_for_merge_share(share) == 5

    def test_low_merge_share_reads_below_40_percent(self):
        entries = [_entry("proposed", f"case-{i}") for i in range(10)]
        entries += [_entry("merged", f"case-{i}", days_ago=0) for i in range(3)]
        share = trailing_merge_share(entries, NOW)
        assert share is not None
        assert share < 0.40
        assert nightly_cap_for_merge_share(share) < DEFAULT_NIGHTLY_CAP

    def test_proposals_outside_the_window_do_not_count(self):
        entries = [_entry("proposed", "old-case", days_ago=30)] * MIN_SAMPLE_SIZE
        assert trailing_merge_share(entries, NOW) is None

    def test_a_merge_recorded_after_the_proposal_window_still_counts(self):
        # A case proposed near the window's edge can take days to review and
        # merge after its own "proposed" line has aged out of the window —
        # the merge lookup is deliberately unwindowed (cap.py docstring).
        entries = [_entry("proposed", f"case-{i}", days_ago=13) for i in range(MIN_SAMPLE_SIZE)]
        entries.append(_entry("merged", "case-0", days_ago=0))
        share = trailing_merge_share(entries, NOW)
        assert share == 1 / MIN_SAMPLE_SIZE
