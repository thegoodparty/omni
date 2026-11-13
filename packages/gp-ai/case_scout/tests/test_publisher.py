"""Test Plan (ticket Implementation Details / Test Plan section) for the
Publisher: PR, Slack note, marker advance, dry-run mode, and the 7-day
stale-PR sweep. Every test here runs against FakeGitHubClient and a fake
Slack poster — no real network call, same convention as every other
case_scout test (reader/messages.py's FakeCaseScoutMessageReader,
reader/case_lists.py's FakeChatCaseListReader).
"""

from datetime import UTC, datetime

from case_scout.bucket import CaseScoutBucket, Marker
from case_scout.publisher import (
    OUTCOME_PR_CLOSED_STALE,
    FakeGitHubClient,
    _advance_marker,
    _gate_dropped_every_draft_two_nights,
    case_scout_open_prs_enabled,
    databricks_table_for_environment,
    render_pr_body,
    render_slack_note,
    run_publish,
    slack_channel_for_environment,
)
from case_scout.reader.ledger import find_rejection, parse_ledger_lines

from .conftest import TEST_BUCKET

CASES_PATH = "packages/gp-api/src/chats/evals/judge/cases"
NOW = datetime(2026, 11, 5, 9, 0, tzinfo=UTC)


def _store(s3_bucket) -> CaseScoutBucket:
    return CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)


class _FakeSlack:
    def __init__(self):
        self.posted = []

    def __call__(self, channel, text):
        self.posted.append((channel, text))
        return True


def _fake_slack():
    return _FakeSlack()


def _draft(agent_id, case_id, severity=3, condition="a condition", handled_when="a handled-when"):
    return {
        "agentId": agent_id,
        "severity": severity,
        "case": {
            "caseId": case_id,
            "question": "a question",
            "condition": condition,
            "handledWhen": handled_when,
            "source": "production",
            "split": "tune",
        },
        "failureSummary": "a failure summary",
    }


def _seed_bundle(store, run_id, drafts=None, needs_setup=None, list_full=None, sources=None, new_marker=None):
    store.write_run_bundle(
        run_id,
        {"runId": run_id, "drafts": drafts or [], "needsSetup": needs_setup or [], "listFull": list_full or []},
    )
    store.write_run_sources(
        run_id,
        sources
        or {
            c["case"]["caseId"]: {
                "conversationId": f"conv-{c['case']['caseId']}",
                "sessionId": f"conv-{c['case']['caseId']}:m1",
            }
            for c in (drafts or [])
        },
    )
    store.write_run_record(
        run_id,
        {
            "runId": run_id,
            "counts": {},
            "spendUsd": {"total": 1.23},
            "newMarker": new_marker
            or {"lastSessionStart": "2026-11-05T08:00:00+00:00", "processedSessionIds": ["conv-1:m1"]},
        },
    )


class TestDevNeverOpensAPR:
    def test_dev_with_open_prs_true_still_opens_no_pr(self, s3_bucket, monkeypatch):
        monkeypatch.setenv("CASE_SCOUT_OPEN_PRS", "true")
        store = _store(s3_bucket)
        _seed_bundle(store, "2026-11-05", drafts=[_draft("chief_of_staff", "case-a")])
        github = FakeGitHubClient()
        slack = _fake_slack()

        result = run_publish("2026-11-05", store, "dev", NOW, github=github, post_slack=slack)

        assert result.pr_opened is False
        assert result.dry_run is True
        assert github.commits == []
        assert result.marker_advanced is True


class TestDryRunVsLiveMode:
    def test_dry_run_opens_no_pr_and_the_note_says_dry_run(self, s3_bucket, monkeypatch):
        monkeypatch.setenv("CASE_SCOUT_OPEN_PRS", "false")
        store = _store(s3_bucket)
        _seed_bundle(store, "2026-11-05", drafts=[_draft("chief_of_staff", "case-a")])
        github = FakeGitHubClient()
        slack = _fake_slack()

        result = run_publish("2026-11-05", store, "prod", NOW, github=github, post_slack=slack)

        assert result.pr_opened is False
        assert result.dry_run is True
        assert github.commits == []
        assert "dry run" in slack.posted[0][1]
        assert result.marker_advanced is True

    def test_live_mode_opens_a_pr_and_the_note_links_it(self, s3_bucket, monkeypatch):
        monkeypatch.setenv("CASE_SCOUT_OPEN_PRS", "true")
        store = _store(s3_bucket)
        _seed_bundle(store, "2026-11-05", drafts=[_draft("chief_of_staff", "case-a")])
        github = FakeGitHubClient()
        slack = _fake_slack()

        result = run_publish("2026-11-05", store, "prod", NOW, github=github, post_slack=slack)

        assert result.pr_opened is True
        assert result.pr_number is not None
        assert result.pr_url in slack.posted[0][1]
        assert "dry run" not in slack.posted[0][1]


class TestSlackChannelConfig:
    def test_dev_resolves_to_bot_dev(self):
        assert slack_channel_for_environment("dev") == "CL23R5BJ4"

    def test_unknown_resolves_to_bot_dev(self):
        assert slack_channel_for_environment("unknown") == "CL23R5BJ4"

    def test_prod_resolves_to_product_chats_digest(self):
        assert slack_channel_for_environment("prod") == "C0C626B0ZJN"

    def test_the_env_var_overrides_the_dev_default(self, monkeypatch):
        monkeypatch.setenv("CASE_SCOUT_SLACK_CHANNEL", "C0VERRIDE")

        assert slack_channel_for_environment("dev") == "C0VERRIDE"

    def test_the_env_var_overrides_the_prod_default(self, monkeypatch):
        monkeypatch.setenv("CASE_SCOUT_SLACK_CHANNEL", "C0VERRIDE")

        assert slack_channel_for_environment("prod") == "C0VERRIDE"

    def test_the_databricks_table_is_the_dev_view_outside_prod(self):
        assert databricks_table_for_environment("dev") == "mart_case_scout.case_scout_messages_dev"
        assert databricks_table_for_environment("prod") == "mart_case_scout.case_scout_messages"


class TestPRTemplate:
    def test_title_branch_label_commit_and_body_match_the_template(self, s3_bucket, monkeypatch):
        monkeypatch.setenv("CASE_SCOUT_OPEN_PRS", "true")
        store = _store(s3_bucket)
        _seed_bundle(
            store,
            "2026-11-05",
            drafts=[_draft("chief_of_staff", "case-a"), _draft("campaign_assistant", "case-b")],
            needs_setup=[{"agentId": "chief_of_staff", "severity": 2, "what": "needs a staged payment fixture"}],
            list_full=[
                {
                    "agentId": "chief_of_staff",
                    "severity": 2,
                    "case": {"caseId": "case-c", "condition": "cc", "handledWhen": "hh"},
                    "failureSummary": "fs",
                }
            ],
        )
        github = FakeGitHubClient()
        slack = _fake_slack()

        result = run_publish("2026-11-05", store, "prod", NOW, github=github, post_slack=slack)

        assert len(github.commits) == 1
        commit = github.commits[0]
        assert commit["branch"] == "case-scout/2026-11-05"
        assert commit["message"] == "chore(judge): propose 2 cases from production"

        pr = github.open_prs["case-scout/2026-11-05"]
        assert pr["number"] == result.pr_number
        assert pr["title"] == "Proposed judge cases, 2026-11-05"
        assert pr["label"] == "case-scout"
        body = pr["body"]
        assert "chief_of_staff" in body
        assert "campaign_assistant" in body
        assert "case-a" in body
        assert "case-b" in body
        assert "needs a staged payment fixture" in body
        assert "case-c" in body
        # AC: no conversation ids anywhere in the PR.
        assert "conv-case-a" not in body
        assert "conv-case-b" not in body


class TestAlreadyOnMainExclusion:
    def test_a_case_id_already_on_main_is_excluded_from_the_new_commit(self, s3_bucket, monkeypatch):
        monkeypatch.setenv("CASE_SCOUT_OPEN_PRS", "true")
        store = _store(s3_bucket)
        _seed_bundle(
            store,
            "2026-11-05",
            drafts=[_draft("chief_of_staff", "existing-case"), _draft("chief_of_staff", "new-case")],
        )
        github = FakeGitHubClient(
            files={
                f"{CASES_PATH}/chief_of_staff.json": {
                    "agentId": "chief_of_staff",
                    "cases": [{"caseId": "existing-case", "condition": "c", "handledWhen": "h"}],
                }
            }
        )
        slack = _fake_slack()

        result = run_publish("2026-11-05", store, "prod", NOW, github=github, post_slack=slack)

        committed = github.commits[0]["files"][f"{CASES_PATH}/chief_of_staff.json"]
        case_ids = [c["caseId"] for c in committed["cases"]]
        assert case_ids.count("existing-case") == 1
        assert "new-case" in case_ids
        assert result.skipped_already_on_main == ("existing-case",)


class TestIdempotentRepublish:
    def test_publishing_twice_for_the_same_run_id_does_not_duplicate_or_reopen(self, s3_bucket, monkeypatch):
        monkeypatch.setenv("CASE_SCOUT_OPEN_PRS", "true")
        store = _store(s3_bucket)
        _seed_bundle(store, "2026-11-05", drafts=[_draft("chief_of_staff", "case-a")])
        github = FakeGitHubClient()
        slack = _fake_slack()

        first = run_publish("2026-11-05", store, "prod", NOW, github=github, post_slack=slack)
        second = run_publish("2026-11-05", store, "prod", NOW, github=github, post_slack=slack)

        assert first.pr_opened is True
        # The caseId-already-on-main check (AC #5) catches the retry before
        # it ever reaches open_pr's own branch-exists idempotency: the first
        # call's commit already appended "case-a" to `main`, so the second
        # call's only draft is now a no-op skip with nothing left to commit.
        assert second.pr_opened is False
        assert second.pr_number is None
        assert second.skipped_already_on_main == ("case-a",)
        assert len(github.commits) == 1
        cases = github.files[f"{CASES_PATH}/chief_of_staff.json"]["cases"]
        assert len(cases) == 1


class TestMarkerAdvance:
    def test_marker_advances_after_a_successful_publish(self, s3_bucket, monkeypatch):
        monkeypatch.setenv("CASE_SCOUT_OPEN_PRS", "true")
        store = _store(s3_bucket)
        _seed_bundle(store, "2026-11-05", drafts=[_draft("chief_of_staff", "case-a")])
        github = FakeGitHubClient()
        slack = _fake_slack()

        result = run_publish("2026-11-05", store, "prod", NOW, github=github, post_slack=slack)

        assert result.marker_advanced is True
        marker = store.read_marker()
        assert marker.updated_by_run == "2026-11-05"
        assert marker.last_session_start == "2026-11-05T08:00:00+00:00"
        assert marker.processed_session_ids == ["conv-1:m1"]

    def test_a_stale_etag_write_is_rejected_not_silently_overwritten(self, s3_bucket, monkeypatch):
        store = _store(s3_bucket)
        store.write_run_record("2026-11-05", {"newMarker": {"lastSessionStart": "t1", "processedSessionIds": []}})
        read_before_concurrent_write = store.read_marker()
        # A concurrent publish advances the marker using the same etag this
        # call already read.
        store.write_marker(
            Marker(
                last_session_start="t0",
                processed_session_ids=[],
                updated_by_run="other-run",
                etag=read_before_concurrent_write.etag,
            )
        )
        monkeypatch.setattr(store, "read_marker", lambda: read_before_concurrent_write)

        advanced = _advance_marker(store, "2026-11-05")

        assert advanced is False
        assert _store(s3_bucket).read_marker().updated_by_run == "other-run"

    def test_refuses_to_move_the_marker_backwards(self, s3_bucket, monkeypatch):
        store = _store(s3_bucket)
        current = store.read_marker()
        store.write_marker(
            Marker(
                last_session_start="2026-11-05T12:00:00+00:00",
                processed_session_ids=["a"],
                updated_by_run="a-later-run",
                etag=current.etag,
            )
        )
        # An old runId's candidate, computed before the marker above was
        # ever written, would drag lastSessionStart backwards if applied.
        store.write_run_record(
            "2026-11-01",
            {"newMarker": {"lastSessionStart": "2026-11-01T09:00:00+00:00", "processedSessionIds": ["b"]}},
        )

        advanced = _advance_marker(store, "2026-11-01")

        assert advanced is False
        unchanged = _store(s3_bucket).read_marker()
        assert unchanged.updated_by_run == "a-later-run"
        assert unchanged.last_session_start == "2026-11-05T12:00:00+00:00"


class TestZeroDraftRun:
    def test_zero_draft_run_still_posts_and_advances_with_no_pr_call(self, s3_bucket, monkeypatch):
        monkeypatch.setenv("CASE_SCOUT_OPEN_PRS", "true")
        store = _store(s3_bucket)
        _seed_bundle(store, "2026-11-05", drafts=[])
        github = FakeGitHubClient()
        slack = _fake_slack()

        result = run_publish("2026-11-05", store, "prod", NOW, github=github, post_slack=slack)

        assert result.pr_opened is False
        assert result.note_posted is True
        assert result.marker_advanced is True
        assert github.commits == []
        assert "(none)" in slack.posted[0][1]

    def test_no_bundle_at_all_publishes_nothing(self, s3_bucket):
        store = _store(s3_bucket)
        github = FakeGitHubClient()
        slack = _fake_slack()

        result = run_publish("2026-11-06", store, "prod", NOW, github=github, post_slack=slack)

        assert result.had_bundle is False
        assert result.pr_opened is False
        assert result.note_posted is False
        assert result.marker_advanced is False
        assert slack.posted == []


class TestStaleCloseSweep:
    def test_an_eligible_pr_closes_and_is_recorded_distinctly_from_a_rejection(self, s3_bucket, monkeypatch):
        monkeypatch.setenv("CASE_SCOUT_OPEN_PRS", "true")
        store = _store(s3_bucket)
        store.write_run_sources("2026-10-20", {"old-case": {"conversationId": "conv-x", "sessionId": "conv-x:m1"}})
        github = FakeGitHubClient()
        github.seed_open_pr("case-scout/2026-10-20", number=42, created_at="2026-10-20T09:00:00+00:00")
        github.seed_open_pr("case-scout/2026-11-05", number=43, created_at=NOW.isoformat())
        _seed_bundle(store, "2026-11-05", drafts=[])
        slack = _fake_slack()

        result = run_publish("2026-11-05", store, "prod", NOW, github=github, post_slack=slack)

        assert 42 in result.stale_closed
        assert 43 not in result.stale_closed
        assert 42 in github.closed_prs
        assert "case-scout/2026-11-05" in github.open_prs

        lines = store.read_ledger_lines("2026-10")
        stale_lines = [line for line in lines if line["outcome"] == OUTCOME_PR_CLOSED_STALE]
        assert len(stale_lines) == 1
        assert stale_lines[0]["caseId"] == "old-case"
        assert stale_lines[0]["prNumber"] == 42

        entries = parse_ledger_lines(lines)
        assert find_rejection(entries, "conv-x", "chief_of_staff", "", NOW) is None

    def test_dev_never_runs_the_stale_close_sweep(self, s3_bucket):
        store = _store(s3_bucket)
        github = FakeGitHubClient()
        github.seed_open_pr("case-scout/2026-10-20", number=42, created_at="2026-10-20T09:00:00+00:00")
        slack = _fake_slack()

        result = run_publish("2026-11-05", store, "dev", NOW, github=github, post_slack=slack)

        assert result.stale_closed == ()
        assert "case-scout/2026-10-20" in github.open_prs

    def test_a_pr_under_seven_days_old_is_left_open(self, s3_bucket, monkeypatch):
        monkeypatch.setenv("CASE_SCOUT_OPEN_PRS", "true")
        store = _store(s3_bucket)
        github = FakeGitHubClient()
        github.seed_open_pr("case-scout/2026-11-01", number=50, created_at="2026-11-01T09:00:00+00:00")
        _seed_bundle(store, "2026-11-05", drafts=[])
        slack = _fake_slack()

        result = run_publish("2026-11-05", store, "prod", NOW, github=github, post_slack=slack)

        assert result.stale_closed == ()
        assert "case-scout/2026-11-01" in github.open_prs


class TestGitHubClientBranchIdempotency:
    def test_open_pr_on_an_already_existing_branch_returns_the_existing_pr(self):
        # RealGitHubClient's own idempotent path (a retried publish for the
        # same runId hits "ref already exists" and returns the PR already
        # opened rather than committing twice) — FakeGitHubClient mirrors it
        # exactly so this never needs a real HTTP call to cover. The
        # run_publish-level idempotency test never reaches this path (the
        # caseId-already-on-main check intercepts first), so it's covered
        # directly here instead.
        github = FakeGitHubClient()
        files = {
            f"{CASES_PATH}/chief_of_staff.json": {
                "agentId": "chief_of_staff",
                "cases": [{"caseId": "x", "condition": "c", "handledWhen": "h"}],
            }
        }

        first = github.open_pr("case-scout/2026-11-05", "main", files, "msg", "title", "body", "case-scout")
        second = github.open_pr("case-scout/2026-11-05", "main", files, "msg", "title", "body", "case-scout")

        assert first == second
        assert len(github.commits) == 1

    def test_a_retry_after_an_orphaned_branch_recovers_by_opening_the_pr(self):
        # Delegate review caught this: an earlier attempt can create the
        # branch/commit and then die before POST /pulls (a 5xx, a timeout).
        # The original code re-raised on the retry's "ref already exists"
        # 422 forever, since no PR existed yet to find. The fix checks for
        # an existing PR up front and, failing that, tolerates the ref
        # already being there and opens the PR against it.
        github = FakeGitHubClient()
        github.seed_orphan_branch("case-scout/2026-11-05")
        files = {
            f"{CASES_PATH}/chief_of_staff.json": {
                "agentId": "chief_of_staff",
                "cases": [{"caseId": "x", "condition": "c", "handledWhen": "h"}],
            }
        }

        pr = github.open_pr("case-scout/2026-11-05", "main", files, "msg", "title", "body", "case-scout")

        assert pr["number"] is not None
        assert "case-scout/2026-11-05" in github.open_prs
        # Nothing was recommitted — the orphaned branch already carried the
        # content the earlier, PR-less attempt computed.
        assert github.commits == []


class TestOpenPrsFlagIsProdOnly:
    def test_prod_with_the_flag_true_opens(self, monkeypatch):
        monkeypatch.setenv("CASE_SCOUT_OPEN_PRS", "true")
        assert case_scout_open_prs_enabled("prod") is True

    def test_prod_with_the_flag_false_is_a_dry_run(self, monkeypatch):
        monkeypatch.setenv("CASE_SCOUT_OPEN_PRS", "false")
        assert case_scout_open_prs_enabled("prod") is False

    def test_prod_with_the_flag_unset_is_a_dry_run(self, monkeypatch):
        monkeypatch.delenv("CASE_SCOUT_OPEN_PRS", raising=False)
        assert case_scout_open_prs_enabled("prod") is False

    def test_dev_ignores_the_flag_entirely(self, monkeypatch):
        monkeypatch.setenv("CASE_SCOUT_OPEN_PRS", "true")
        assert case_scout_open_prs_enabled("dev") is False


class TestRenderPrBody:
    def test_empty_sections_render_as_none(self):
        body = render_pr_body({}, [], [], [])

        assert "(no new cases tonight)" in body
        assert body.count("(none)") == 3  # needs setup, list full, removals

    def test_contains_no_conversation_ids(self):
        drafts = {
            "chief_of_staff": [{"severity": 3, "case": {"caseId": "a-case", "condition": "c", "handledWhen": "h"}}]
        }
        body = render_pr_body(drafts, [], [], [])

        assert "conv-" not in body


class TestRenderSlackNote:
    def test_dry_run_note_says_dry_run_and_carries_conversation_ids(self):
        drafts = [_draft("chief_of_staff", "case-a")]
        sources = {"case-a": {"conversationId": "conv-123", "sessionId": "conv-123:m1"}}

        note = render_slack_note(
            run_id="2026-11-05",
            environment="prod",
            pr_url=None,
            dry_run=True,
            drafts=drafts,
            sources=sources,
            counts={"covered": 1, "gated": 2},
            spend_tonight=1.5,
            spend_month_to_date=12.0,
        )

        assert "dry run" in note
        assert "conv-123" in note
        assert "case_scout_messages" in note  # prod table, no _dev suffix
        assert "$1.50" in note
        assert "$12.00" in note


class TestGateHealthAlert:
    def _store(self, s3_bucket) -> CaseScoutBucket:
        return CaseScoutBucket(TEST_BUCKET, s3_client=s3_bucket)

    def test_true_when_both_nights_gated_every_draft(self, s3_bucket):
        store = self._store(s3_bucket)
        store.append_ledger_line("2026-11", {"runId": "2026-11-05", "outcome": "gated"})
        store.append_ledger_line("2026-11", {"runId": "2026-11-04", "outcome": "gated"})

        assert _gate_dropped_every_draft_two_nights(store, "2026-11-05") is True

    def test_false_when_a_quiet_night_had_nothing_drafted(self, s3_bucket):
        store = self._store(s3_bucket)
        store.append_ledger_line("2026-11", {"runId": "2026-11-05", "outcome": "gated"})
        # 2026-11-04 has no lines at all -- an uneventful night, not a gate problem.

        assert _gate_dropped_every_draft_two_nights(store, "2026-11-05") is False

    def test_false_when_either_night_proposed_something(self, s3_bucket):
        store = self._store(s3_bucket)
        store.append_ledger_line("2026-11", {"runId": "2026-11-05", "outcome": "gated"})
        store.append_ledger_line("2026-11", {"runId": "2026-11-04", "outcome": "proposed"})

        assert _gate_dropped_every_draft_two_nights(store, "2026-11-05") is False
