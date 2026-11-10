from case_scout.bucket import CaseScoutBucket, Marker

from .conftest import TEST_BUCKET


class TestMarker:
    def test_read_marker_with_nothing_written_is_empty_and_has_no_etag(self, s3_bucket):
        store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)

        marker = store.read_marker()

        assert marker.last_session_start is None
        assert marker.processed_session_ids == []
        assert marker.etag is None

    def test_write_then_read_round_trips(self, s3_bucket):
        store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)
        first = store.read_marker()
        store.write_marker(
            Marker(
                last_session_start="2026-11-03T22:41:00Z",
                processed_session_ids=["conv-1:0"],
                updated_by_run="run-1",
                etag=first.etag,
            )
        )

        marker = store.read_marker()

        assert marker.last_session_start == "2026-11-03T22:41:00Z"
        assert marker.processed_session_ids == ["conv-1:0"]
        assert marker.updated_by_run == "run-1"
        assert marker.etag is not None

    def test_write_marker_refuses_a_stale_etag(self, s3_bucket):
        store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)
        first = store.read_marker()
        store.write_marker(
            Marker(last_session_start="t1", processed_session_ids=[], updated_by_run="run-1", etag=first.etag)
        )

        # `first` is now stale: a second writer racing off the same read must
        # not be allowed to clobber the write above (TDD section 2.2: "two
        # publishes can't both advance it").
        import botocore.exceptions
        import pytest

        with pytest.raises(botocore.exceptions.ClientError):
            store.write_marker(
                Marker(last_session_start="t2", processed_session_ids=[], updated_by_run="run-2", etag=first.etag)
            )


class TestClaimRun:
    def test_first_claim_succeeds(self, s3_bucket):
        store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)

        assert store.claim_run("2026-11-05") is True
        assert store.is_claimed("2026-11-05") is True

    def test_second_claim_for_the_same_night_fails(self, s3_bucket):
        store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)
        store.claim_run("2026-11-05")

        assert store.claim_run("2026-11-05") is False

    def test_different_nights_claim_independently(self, s3_bucket):
        store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)
        store.claim_run("2026-11-05")

        assert store.claim_run("2026-11-06") is True


class TestClaimReader:
    def test_the_reader_claim_is_separate_from_the_night_claim(self, s3_bucket):
        store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)
        store.claim_run("2026-11-05")

        assert store.claim_reader("2026-11-05") is True

    def test_a_second_reader_for_the_same_night_fails(self, s3_bucket):
        store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)
        store.claim_reader("2026-11-05")

        assert store.claim_reader("2026-11-05") is False


class TestLedger:
    def test_append_creates_the_file(self, s3_bucket):
        store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)

        store.append_ledger_line("2026-11", {"conversationId": "c1", "outcome": "proposed"})

        body = s3_bucket.get_object(Bucket=TEST_BUCKET, Key="ledger/2026-11.jsonl")["Body"].read()
        assert body.decode().strip() == '{"conversationId": "c1", "outcome": "proposed"}'

    def test_append_adds_a_second_line_without_clobbering_the_first(self, s3_bucket):
        store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)
        store.append_ledger_line("2026-11", {"conversationId": "c1"})
        store.append_ledger_line("2026-11", {"conversationId": "c2"})

        lines = (
            s3_bucket.get_object(Bucket=TEST_BUCKET, Key="ledger/2026-11.jsonl")["Body"]
            .read()
            .decode()
            .strip()
            .splitlines()
        )
        assert len(lines) == 2
        assert '"c1"' in lines[0]
        assert '"c2"' in lines[1]

    def test_read_ledger_lines_with_no_file_yet_returns_empty(self, s3_bucket):
        store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)
        assert store.read_ledger_lines("2026-11") == []

    def test_read_ledger_lines_round_trips_appended_lines(self, s3_bucket):
        store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)
        store.append_ledger_line("2026-11", {"conversationId": "c1", "outcome": "proposed"})
        store.append_ledger_line("2026-11", {"conversationId": "c2", "outcome": "covered"})

        lines = store.read_ledger_lines("2026-11")

        assert lines == [
            {"conversationId": "c1", "outcome": "proposed"},
            {"conversationId": "c2", "outcome": "covered"},
        ]

    def test_read_ledger_lines_skips_an_unparseable_line(self, s3_bucket):
        store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)
        s3_bucket.put_object(
            Bucket=TEST_BUCKET,
            Key="ledger/2026-11.jsonl",
            Body=b'{"conversationId": "c1"}\nnot json\n{"conversationId": "c2"}\n',
        )

        lines = store.read_ledger_lines("2026-11")

        assert lines == [{"conversationId": "c1"}, {"conversationId": "c2"}]


class TestRunObjects:
    def test_bundle_round_trips(self, s3_bucket):
        store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)
        bundle = {"runId": "run-1", "drafts": [], "needsSetup": []}

        store.write_run_bundle("run-1", bundle)

        assert store.read_run_bundle("run-1") == bundle

    def test_bundle_missing_reads_as_none(self, s3_bucket):
        store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)

        assert store.read_run_bundle("never-written") is None

    def test_sources_round_trips(self, s3_bucket):
        store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)
        sources = {"polling-place-photo-rules": {"conversationId": "c1", "sessionId": "c1:0"}}

        store.write_run_sources("run-1", sources)

        assert store.read_run_sources("run-1") == sources

    def test_record_round_trips(self, s3_bucket):
        store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)
        record = {"runId": "run-1", "counts": {"sessions": 41}, "spendUsd": {"total": 0.0}, "errors": []}

        store.write_run_record("run-1", record)

        assert store.read_run_record("run-1") == record
