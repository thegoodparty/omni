from case_scout import selfcheck
from case_scout.bucket import CaseScoutBucket


class _FakeGithub:
    def __init__(self, prs=None, bodies=None):
        self._prs = prs or []
        self._bodies = bodies or {}

    def list_open_labeled_prs(self, label):
        return self._prs

    def get_pr_body(self, number):
        return self._bodies.get(number, "")


class TestFindPiiHits:
    def test_clean_text_has_no_hits(self):
        assert selfcheck.find_pii_hits("a perfectly ordinary case description") == []

    def test_catches_an_email(self):
        hits = selfcheck.find_pii_hits("reach me at voter@example.com please")
        assert any(h.startswith("email:") for h in hits)

    def test_catches_a_uuid(self):
        hits = selfcheck.find_pii_hits("conversation 123e4567-e89b-12d3-a456-426614174000 flagged")
        assert any(h.startswith("uuid:") for h in hits)


class TestRunSelfCheck:
    def test_clean_run_and_clean_prs_report_nothing(self, s3_bucket, monkeypatch):
        bucket = CaseScoutBucket("case-scout-test", s3_client=s3_bucket)
        bucket.write_run_bundle("2026-11-05", {"runId": "2026-11-05", "drafts": [], "needsSetup": [], "listFull": []})
        github = _FakeGithub(prs=[{"number": 42}], bodies={42: "## Proposed cases\n(no new cases tonight)"})
        posted = []
        monkeypatch.setattr(selfcheck.alerts, "post_alert", lambda *a, **k: posted.append(a))

        hits = selfcheck.run_self_check(bucket, github, "dev", recent_run_ids=["2026-11-05"])

        assert hits == []
        assert posted == []

    def test_flags_and_alerts_on_an_email_in_a_pr_body(self, s3_bucket, monkeypatch):
        bucket = CaseScoutBucket("case-scout-test", s3_client=s3_bucket)
        github = _FakeGithub(prs=[{"number": 42}], bodies={42: "contact voter@example.com for details"})
        posted = []
        monkeypatch.setattr(selfcheck.alerts, "post_alert", lambda *a, **k: posted.append(a))

        hits = selfcheck.run_self_check(bucket, github, "prod", recent_run_ids=[])

        assert any("PR #42" in h and "email:" in h for h in hits)
        assert posted  # alerted once

    def test_flags_a_leaked_conversation_id_in_the_bundle(self, s3_bucket, monkeypatch):
        bucket = CaseScoutBucket("case-scout-test", s3_client=s3_bucket)
        bucket.write_run_bundle(
            "2026-11-05",
            {
                "runId": "2026-11-05",
                "drafts": [{"case": {"caseId": "leaky-case"}}],
                "needsSetup": [],
                "listFull": [],
                "note": "oops conv-abc123 leaked in here",
            },
        )
        bucket.write_run_sources("2026-11-05", {"leaky-case": {"conversationId": "conv-abc123"}})
        github = _FakeGithub()
        posted = []
        monkeypatch.setattr(selfcheck.alerts, "post_alert", lambda *a, **k: posted.append(a))

        hits = selfcheck.run_self_check(bucket, github, "dev", recent_run_ids=["2026-11-05"])

        assert any("conversationId:conv-abc123" in h for h in hits)
        assert posted

    def test_never_raises_when_github_listing_fails(self, s3_bucket):
        bucket = CaseScoutBucket("case-scout-test", s3_client=s3_bucket)

        class _BrokenGithub:
            def list_open_labeled_prs(self, label):
                raise RuntimeError("boom")

        hits = selfcheck.run_self_check(bucket, _BrokenGithub(), "dev", recent_run_ids=[])

        assert hits == []
