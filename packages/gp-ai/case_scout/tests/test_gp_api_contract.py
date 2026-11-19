"""The bucket contract between gp-api's case scout reader
(packages/gp-api/src/caseScout) and this publisher.

gp-api's tests assert its reader writes exactly the files in
packages/gp-api/src/caseScout/fixtures/publisherContract; this test feeds
those same files to run_publish. Change both sides together.
"""

import json
from datetime import UTC, datetime
from pathlib import Path

from case_scout import publisher
from case_scout.bucket import CaseScoutBucket
from case_scout.publisher import CASES_PATH, FakeGitHubClient, run_publish

from .conftest import TEST_BUCKET

FIXTURES = Path(__file__).resolve().parents[3] / "gp-api" / "src" / "caseScout" / "fixtures" / "publisherContract"
RUN_ID = "2026-11-16"
NOW = datetime(2026, 11, 16, 9, 30, tzinfo=UTC)


def _fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


def _seed(s3_bucket) -> None:
    for name in ("bundle.json", "sources.json", "record.json"):
        s3_bucket.put_object(Bucket=TEST_BUCKET, Key=f"runs/{RUN_ID}/{name}", Body=_fixture(name).encode())
    s3_bucket.put_object(Bucket=TEST_BUCKET, Key=f"ledger/{RUN_ID[:7]}.jsonl", Body=_fixture("ledger.jsonl").encode())


def test_the_publisher_publishes_what_gp_api_writes(s3_bucket, monkeypatch):
    monkeypatch.setenv("CASE_SCOUT_OPEN_PRS", "true")
    alerts = []
    monkeypatch.setattr(publisher.alerts, "post_alert", lambda *args: alerts.append(args))
    _seed(s3_bucket)
    store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)
    path = f"{CASES_PATH}/chief_of_staff.json"
    github = FakeGitHubClient(
        files={path: {"agentId": "chief_of_staff", "cases": [{"caseId": "existing-case", "question": "q"}]}},
        now=NOW.isoformat(),
    )
    notes = []

    result = run_publish(RUN_ID, store, "prod", NOW, github=github, post_slack=lambda c, t: notes.append(t) or True)

    bundle = json.loads(_fixture("bundle.json"))
    record = json.loads(_fixture("record.json"))
    assert result.pr_opened is True
    assert result.marker_advanced is True
    assert alerts == []

    # The drafted case lands on main's list as written, key order included.
    appended = github.files[path]["cases"][-1]
    assert appended == bundle["drafts"][0]["case"]
    assert list(appended) == list(bundle["drafts"][0]["case"])
    pr = github.open_prs[f"case-scout/{RUN_ID}"]
    assert "conv-golden-a" not in pr["body"]
    assert "turnout-figure-without-source" in pr["body"]

    # The private note carries the source conversation, the ledger's counts and
    # the record's spend.
    assert len(notes) == 1
    assert "conversation `conv-golden-a`" in notes[0]
    assert "covered=1" in notes[0]
    assert f"tonight ${record['spendUsd']['total']:.2f}" in notes[0]

    marker = store.read_marker()
    assert marker.last_session_start == record["newMarker"]["lastSessionStart"]
    assert marker.processed_session_ids == record["newMarker"]["processedSessionIds"]
    assert marker.updated_by_run == RUN_ID


def test_a_second_publish_of_the_same_run_opens_no_second_pr(s3_bucket, monkeypatch):
    monkeypatch.setenv("CASE_SCOUT_OPEN_PRS", "true")
    monkeypatch.setattr(publisher.alerts, "post_alert", lambda *args: None)
    _seed(s3_bucket)
    store = CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)
    github = FakeGitHubClient(files={}, now=NOW.isoformat())

    first = run_publish(RUN_ID, store, "prod", NOW, github=github, post_slack=lambda c, t: True)
    second = run_publish(RUN_ID, store, "prod", NOW, github=github, post_slack=lambda c, t: True)

    assert first.pr_number is not None
    assert len(github.open_prs) == 1
    assert len(github.commits) == 1
    assert second.marker_advanced is True
