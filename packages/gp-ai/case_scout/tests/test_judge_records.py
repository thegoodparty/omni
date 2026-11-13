import json

import boto3
import pytest
from moto import mock_aws

from case_scout.reader.judge_records import S3JudgeRecordsReader

JUDGE_BUCKET = "gp-agent-artifacts-test"


@pytest.fixture
def judge_bucket():
    """A moto-mocked version of the judge's own records bucket — this
    module's grant on the real one is read-only, so every test here only
    ever calls get/list, never put, against a bucket this fixture seeds
    directly (mirroring gp-api's RunRecordSchema shape, not this reader's
    own writes, since the scout never writes here)."""
    with mock_aws():
        client = boto3.client("s3", region_name="us-west-2")
        client.create_bucket(Bucket=JUDGE_BUCKET, CreateBucketConfiguration={"LocationConstraint": "us-west-2"})
        yield client


def _seed_record(
    client,
    sweep_id: str,
    arm: str,
    agent_id: str,
    case_id: str,
    attempt: int,
    status: str,
    started_at: str = "2026-11-01T00:00:00.000Z",
):
    key = f"_judge/{sweep_id}/records/{arm}/{agent_id}/{case_id}-{attempt}.json"
    body = json.dumps({"status": status, "startedAt": started_at, "caseId": case_id, "agentId": agent_id})
    client.put_object(Bucket=JUDGE_BUCKET, Key=key, Body=body.encode(), ContentType="application/json")


class TestS3JudgeRecordsReader:
    def test_reads_back_base_arm_attempts_for_the_requested_case(self, judge_bucket):
        _seed_record(judge_bucket, "sweep-1", "base", "chief_of_staff", "case-a", 1, "produced")
        _seed_record(judge_bucket, "sweep-1", "base", "chief_of_staff", "case-a", 2, "blocked")
        _seed_record(judge_bucket, "sweep-1", "base", "chief_of_staff", "case-a", 3, "produced")

        reader = S3JudgeRecordsReader(JUDGE_BUCKET, s3_client=judge_bucket)
        attempts = reader.base_arm_attempts("chief_of_staff", "case-a")

        assert len(attempts) == 3
        assert sorted(a.status for a in attempts) == ["blocked", "produced", "produced"]
        assert all(a.sweep_id == "sweep-1" for a in attempts)
        assert sum(1 for a in attempts if a.handled) == 2

    def test_ignores_the_candidate_arm(self, judge_bucket):
        _seed_record(judge_bucket, "sweep-1", "base", "chief_of_staff", "case-a", 1, "produced")
        _seed_record(judge_bucket, "sweep-1", "candidate", "chief_of_staff", "case-a", 1, "produced")

        reader = S3JudgeRecordsReader(JUDGE_BUCKET, s3_client=judge_bucket)
        attempts = reader.base_arm_attempts("chief_of_staff", "case-a")

        assert len(attempts) == 1

    def test_ignores_other_agents_and_cases(self, judge_bucket):
        _seed_record(judge_bucket, "sweep-1", "base", "chief_of_staff", "case-a", 1, "produced")
        _seed_record(judge_bucket, "sweep-1", "base", "campaign_assistant", "case-a", 1, "produced")
        _seed_record(judge_bucket, "sweep-1", "base", "chief_of_staff", "case-b", 1, "produced")

        reader = S3JudgeRecordsReader(JUDGE_BUCKET, s3_client=judge_bucket)
        attempts = reader.base_arm_attempts("chief_of_staff", "case-a")

        assert len(attempts) == 1

    def test_spans_multiple_sweeps(self, judge_bucket):
        _seed_record(judge_bucket, "sweep-1", "base", "chief_of_staff", "case-a", 1, "produced")
        _seed_record(judge_bucket, "sweep-2", "base", "chief_of_staff", "case-a", 1, "blocked")

        reader = S3JudgeRecordsReader(JUDGE_BUCKET, s3_client=judge_bucket)
        attempts = reader.base_arm_attempts("chief_of_staff", "case-a")

        assert {a.sweep_id for a in attempts} == {"sweep-1", "sweep-2"}

    def test_ignores_non_record_keys_under_the_judge_prefix(self, judge_bucket):
        # manifests/ and rulings/ live under the same _judge/ prefix this
        # reader lists, and must never be mistaken for a records/ key.
        judge_bucket.put_object(
            Bucket=JUDGE_BUCKET,
            Key="_judge/sweep-1/manifests/base.json",
            Body=b"{}",
            ContentType="application/json",
        )
        judge_bucket.put_object(
            Bucket=JUDGE_BUCKET,
            Key="_judge/sweep-1/rulings/chief_of_staff.json",
            Body=b"{}",
            ContentType="application/json",
        )
        _seed_record(judge_bucket, "sweep-1", "base", "chief_of_staff", "case-a", 1, "produced")

        reader = S3JudgeRecordsReader(JUDGE_BUCKET, s3_client=judge_bucket)
        attempts = reader.base_arm_attempts("chief_of_staff", "case-a")

        assert len(attempts) == 1

    def test_a_malformed_record_is_skipped_rather_than_raising(self, judge_bucket):
        judge_bucket.put_object(
            Bucket=JUDGE_BUCKET,
            Key="_judge/sweep-1/records/base/chief_of_staff/case-a-1.json",
            Body=json.dumps({"caseId": "case-a"}).encode(),  # no status, no startedAt
            ContentType="application/json",
        )

        reader = S3JudgeRecordsReader(JUDGE_BUCKET, s3_client=judge_bucket)
        attempts = reader.base_arm_attempts("chief_of_staff", "case-a")

        assert attempts == []

    def test_no_env_var_set_raises_rather_than_guessing_a_bucket(self, monkeypatch):
        monkeypatch.delenv("JUDGE_RECORDS_BUCKET", raising=False)

        with pytest.raises(RuntimeError):
            S3JudgeRecordsReader()
