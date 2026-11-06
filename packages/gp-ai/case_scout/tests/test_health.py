from datetime import UTC, datetime

from case_scout.bucket import CaseScoutBucket
from case_scout.health import is_run_stale, latest_run_id


class TestLatestRunId:
    def test_none_when_nothing_has_ever_run(self, s3_bucket):
        bucket = CaseScoutBucket("case-scout-test", s3_client=s3_bucket)

        assert latest_run_id(bucket, datetime(2026, 11, 6, tzinfo=UTC)) is None

    def test_picks_the_most_recent_run_across_a_month_boundary(self, s3_bucket):
        bucket = CaseScoutBucket("case-scout-test", s3_client=s3_bucket)
        bucket.write_run_record("2026-10-31", {"runId": "2026-10-31"})
        bucket.write_run_record("2026-11-02", {"runId": "2026-11-02"})

        assert latest_run_id(bucket, datetime(2026, 11, 6, tzinfo=UTC)) == "2026-11-02"


class TestIsRunStale:
    def test_stale_when_no_run_has_ever_happened(self, s3_bucket):
        bucket = CaseScoutBucket("case-scout-test", s3_client=s3_bucket)

        assert is_run_stale(bucket, datetime(2026, 11, 6, tzinfo=UTC)) is True

    def test_not_stale_within_the_window(self, s3_bucket):
        bucket = CaseScoutBucket("case-scout-test", s3_client=s3_bucket)
        bucket.write_run_record("2026-11-05", {"runId": "2026-11-05"})

        assert is_run_stale(bucket, datetime(2026, 11, 6, 0, 0, tzinfo=UTC)) is False

    def test_stale_past_the_window(self, s3_bucket):
        bucket = CaseScoutBucket("case-scout-test", s3_client=s3_bucket)
        bucket.write_run_record("2026-11-01", {"runId": "2026-11-01"})

        assert is_run_stale(bucket, datetime(2026, 11, 6, 0, 0, tzinfo=UTC)) is True

    def test_custom_threshold(self, s3_bucket):
        bucket = CaseScoutBucket("case-scout-test", s3_client=s3_bucket)
        bucket.write_run_record("2026-11-05", {"runId": "2026-11-05"})

        assert is_run_stale(bucket, datetime(2026, 11, 5, 10, 0, tzinfo=UTC), max_stale_hours=1.0) is True
