from case_scout.reader.spend import DEFAULT_SPEND_CAP_USD, SpendTracker, spend_cap_usd_from_env


class TestSpendCapFromEnv:
    def test_falls_back_to_default_when_unset(self):
        assert spend_cap_usd_from_env({}) == DEFAULT_SPEND_CAP_USD

    def test_falls_back_to_default_on_garbage(self):
        assert spend_cap_usd_from_env({"CASE_SCOUT_SPEND_CAP_USD": "not-a-number"}) == DEFAULT_SPEND_CAP_USD

    def test_falls_back_to_default_on_non_positive(self):
        assert spend_cap_usd_from_env({"CASE_SCOUT_SPEND_CAP_USD": "0"}) == DEFAULT_SPEND_CAP_USD
        assert spend_cap_usd_from_env({"CASE_SCOUT_SPEND_CAP_USD": "-5"}) == DEFAULT_SPEND_CAP_USD

    def test_the_configured_value_wins(self):
        assert spend_cap_usd_from_env({"CASE_SCOUT_SPEND_CAP_USD": "12.5"}) == 12.5


class TestSpendTracker:
    def test_accumulates_total_and_by_stage(self):
        tracker = SpendTracker(cap_usd=10.0)

        tracker.record("score", 1.0)
        tracker.record("score", 2.0)
        tracker.record("draft", 3.0)

        assert tracker.total_usd == 6.0
        assert tracker.by_stage == {"score": 3.0, "draft": 3.0}
        assert tracker.cap_hit is False

    def test_flags_cap_hit_once_total_crosses_the_cap(self):
        tracker = SpendTracker(cap_usd=5.0)

        hit_before = tracker.record("draft", 4.0)
        hit_after = tracker.record("draft", 2.0)

        assert hit_before is False
        assert hit_after is True
        assert tracker.cap_hit is True

    def test_never_raises_once_over_cap(self):
        tracker = SpendTracker(cap_usd=1.0)
        tracker.record("draft", 5.0)

        # A caller that keeps recording after cap_hit (shouldn't happen, but
        # must not crash the pipeline if it does) just keeps accumulating.
        tracker.record("draft", 5.0)

        assert tracker.cap_hit is True
        assert tracker.total_usd == 10.0
