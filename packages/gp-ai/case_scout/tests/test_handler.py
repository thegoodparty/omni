import json

from .conftest import HANDLER


class TestStartAction:
    def test_claims_the_night_and_returns_claimed(self, s3_bucket):
        response = HANDLER.handler({"action": "start", "runDate": "2026-11-05"}, None)

        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body == {"status": "claimed", "runDate": "2026-11-05"}

    def test_no_ops_when_the_night_is_already_claimed(self, s3_bucket):
        HANDLER.handler({"action": "start", "runDate": "2026-11-05"}, None)

        response = HANDLER.handler({"action": "start", "runDate": "2026-11-05"}, None)

        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body == {"status": "already_claimed", "runDate": "2026-11-05"}

    def test_defaults_to_todays_date_when_none_is_given(self, s3_bucket):
        # case-scout-nightly.yml invokes `start` with no data (TDD: "GitHub
        # sends and receives no data"), so a real trigger never carries
        # runDate — the handler must still produce a usable claim key.
        response = HANDLER.handler({"action": "start"}, None)

        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["status"] == "claimed"
        assert len(body["runDate"]) == len("2026-11-05")


class TestPublishAction:
    def test_accepts_a_run_id_with_no_bundle_yet(self, s3_bucket):
        response = HANDLER.handler({"action": "publish", "runId": "run-1"}, None)

        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["status"] == "no_bundle"
        assert body["runId"] == "run-1"
        assert body["prNumber"] is None

    def test_a_zero_draft_bundle_is_a_dry_run_that_still_posts_and_advances(self, s3_bucket, monkeypatch):
        # No ENVIRONMENT var is set in this suite (conftest.py only sets
        # CASE_SCOUT_BUCKET/AWS_DEFAULT_REGION), so this exercises the
        # fail-toward-dry-run default (publisher.case_scout_open_prs_enabled:
        # only environment == "prod" ever opens a real PR) alongside the
        # ticket's own "zero-draft run still posts a note... and advances
        # the marker" acceptance criterion. The Slack post is faked (no
        # SLACK_BOT_TOKEN is configured for this suite, and this test
        # shouldn't reach the network either way).
        from case_scout.bucket import CaseScoutBucket

        monkeypatch.setattr(HANDLER.publisher, "_default_post_slack", lambda channel, text: True)
        CaseScoutBucket("case-scout-test", s3_client=s3_bucket).write_run_bundle(
            "run-2", {"runId": "run-2", "drafts": [], "needsSetup": []}
        )

        response = HANDLER.handler({"action": "publish", "runId": "run-2"}, None)

        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["status"] == "dry_run"
        assert body["runId"] == "run-2"
        assert body["prNumber"] is None
        assert body["notePosted"] is True
        assert body["markerAdvanced"] is True

    def test_rejects_a_missing_run_id(self, s3_bucket):
        response = HANDLER.handler({"action": "publish"}, None)

        assert response["statusCode"] == 400


class TestUnknownAction:
    def test_rejects_an_unrecognized_action(self, s3_bucket):
        response = HANDLER.handler({"action": "do-something-else"}, None)

        assert response["statusCode"] == 400

    def test_rejects_a_missing_action(self, s3_bucket):
        response = HANDLER.handler({}, None)

        assert response["statusCode"] == 400
