"""Tests for the failing-check triage that decides whether to spend an agent run.

The thing being protected here is twofold: the repository, because a fix run can
push code, and the bill, because every fix run costs $1.50-$5. Both failure modes
run in the same direction — classifying an infrastructure flake as a regression
buys a model edits to code that was never broken — so the guards that keep this
module from reaching for an agent matter more than the one path that does.

The fixtures are captured from real omni runs, not invented. See
`ci_triage.INFRA_LOG_SIGNATURES` for where each signature was observed.
"""

import json

import ci_triage
from ci_triage import (
    ACTION_ESCALATE,
    ACTION_FIX,
    ACTION_FIX_FINDINGS,
    ACTION_HOLD,
    ACTION_NONE,
    ACTION_REPORT,
    ACTION_RERUN,
    FIX_RUN_GRACE_SECONDS,
    INFRA,
    MAX_FIX_RUNS,
    MAX_RERUNS,
    PRE_EXISTING,
    UNKNOWN,
    classify_check,
    decide,
    open_findings,
    parse_state,
    render_state,
)

# PR #1306, run 32086655082 attempt 1, job 95562468914 — the failure this whole
# feature was built for. `Install Playwright browsers` ran `apt-get` against the
# Azure Ubuntu mirror at 01:12:33 and produced its last line at 01:13:13; the job
# hit `timeout-minutes: 30` and was cancelled at 01:41:55 with `Run Playwright
# tests` never started. Shards 2, 3 and 4 passed on the same commit.
PR_1306_E2E_SHARD_1 = {
    "name": "E2E Shard (1)",
    "workflow_name": "gp-webapp",
    "conclusion": "cancelled",
    "failing_on_main": False,
    "log_excerpt": (
        "2026-08-18T01:13:12.7627622Z Ign:14 http://azure.archive.ubuntu.com/ubuntu noble-updates/main amd64 Packages\n"
        "2026-08-18T01:13:13.2012205Z Get:5 https://archive.ubuntu.com/ubuntu noble-security InRelease [126 kB]\n"
        "2026-08-18T01:41:55.9117559Z ##[error]The operation was canceled.\n"
        "2026-08-18T01:41:56.2036268Z Terminate orphan process: pid (2157) "
        "(npm exec playwright install --with-deps chromium)\n"
    ),
}

FRESH_STATE = {"reruns": 0, "fixes": 0, "escalated": False, "fix_started_at": 0, "findings_attempted": []}

# PR #1306 again, this time the half nobody acted on. Cursor Bugbot posted this
# three minutes after the PR opened; delegate-reviewer approved two minutes
# later, a human approved two days after that, and the thread was still open
# when the PR merged. The regression it describes reached main.
PR_1306_BUGBOT_FINDING = {
    "id": "PRRT_kwDOJ1306",
    "author": "cursor",
    "resolved": False,
    "outdated": False,
    "human_replied": False,
    "excerpt": (
        "### Failed collection hides retry UI\n\n"
        "**High Severity**\n\n"
        "<!-- DESCRIPTION START -->\n"
        "`groupByOpponent` always seeds roster-only opponents into the response, "
        "including when `collectionStatus` is `failed`.\n"
        "<!-- DESCRIPTION END -->\n"
    ),
}

# A fixed instant, so the in-flight window is asserted against arithmetic rather
# than against how long the test suite happened to take.
NOW = 1_755_000_000


def a_check(**overrides):
    """A plain failing check with no infrastructure signature and green main."""
    check = {"name": "Validate", "conclusion": "failure", "failing_on_main": False, "log_excerpt": "Test failed"}
    check.update(overrides)
    return check


class TestClassifyRealFailures:
    def test_pr_1306_playwright_install_hang_is_infrastructure_not_a_regression(self):
        # The regression this feature must never cause. #1306's shard never ran a
        # test, so there is nothing about the diff to fix; asking a model to make
        # it pass means editing application code to satisfy a broken apt mirror.
        result = classify_check(PR_1306_E2E_SHARD_1)

        assert result["classification"] == INFRA
        assert result["name"] == "E2E Shard (1)"

    def test_pr_1306_gets_a_rerun_and_never_a_fix_run(self):
        # End to end on the real payload: the correct response to #1306 is the
        # free one. This is the assertion that would have caught a "just ask the
        # LLM to fix CI" implementation.
        decision = decide([PR_1306_E2E_SHARD_1], FRESH_STATE)

        assert decision["action"] == ACTION_RERUN
        assert decision["next_state"]["fixes"] == 0

    def test_a_cancelled_job_is_infrastructure_even_with_no_log(self):
        # The job structure alone settles #1306: a `cancelled` conclusion means
        # the runner killed the job, so it never reported a verdict on the diff.
        # Log fetching can fail, and the classification must not depend on it.
        result = classify_check({"name": "E2E Shard (1)", "conclusion": "cancelled", "failing_on_main": False})

        assert result["classification"] == INFRA

    def test_gp_api_people_db_statement_timeout_is_infrastructure(self):
        # gp-api `Test (shard 1)` has failed repeatedly this way against
        # people-db. It is a sick database, not a broken diff.
        result = classify_check(
            a_check(
                name="Test (shard 1)",
                log_excerpt="Error: canceling statement due to statement timeout",
            )
        )

        assert result["classification"] == INFRA

    def test_prisma_beforeeach_hook_timeout_is_infrastructure(self):
        # Observed on gp-api: `beforeEach` timing out inside prisma.user.create.
        result = classify_check(
            a_check(log_excerpt="Exceeded timeout of 5000 ms for a hook.\n  hook timed out in prisma.user.create")
        )

        assert result["classification"] == INFRA

    def test_github_api_tls_error_is_infrastructure(self):
        # Transient TLS failures fetching the GitHub API have cascaded into E2E
        # failures that look nothing like their actual cause.
        result = classify_check(a_check(log_excerpt="x509: certificate is not valid for any names"))

        assert result["classification"] == INFRA

    def test_signatures_match_regardless_of_log_casing(self):
        result = classify_check(a_check(log_excerpt="ETIMEDOUT connecting to upstream"))

        assert result["classification"] == INFRA

    def test_every_conclusion_that_produced_no_verdict_is_infrastructure(self):
        # Each of these means the job never judged the diff: the runner failed to
        # boot, GitHub abandoned the run, or a manual approval gate is holding
        # it. Any one of them missing from the set falls through to UNKNOWN and
        # can eventually buy an agent run to "fix" code that never executed.
        for conclusion in ("cancelled", "timed_out", "stale", "startup_failure", "action_required"):
            result = classify_check(a_check(conclusion=conclusion, log_excerpt=""))

            assert result["classification"] == INFRA, f"{conclusion} was not recognised as a non-verdict"


class TestPreExistingFailuresAreNeverFought:
    def test_a_check_failing_on_main_is_pre_existing(self):
        result = classify_check(a_check(failing_on_main=True))

        assert result["classification"] == PRE_EXISTING

    def test_failing_on_main_outranks_every_other_signal(self):
        # Precedence is load-bearing, not incidental. A breakage already red on
        # main is not this PR's bug no matter what its log or conclusion says,
        # and no later branch may reclassify it into something actionable.
        result = classify_check(a_check(failing_on_main=True, conclusion="cancelled", log_excerpt="statement timeout"))

        assert result["classification"] == PRE_EXISTING

    def test_an_all_pre_existing_board_reports_instead_of_acting(self):
        decision = decide([a_check(failing_on_main=True)], FRESH_STATE)

        assert decision["action"] == ACTION_REPORT
        assert decision["next_state"]["reruns"] == 0
        assert decision["next_state"]["fixes"] == 0

    def test_a_pre_existing_failure_does_not_suppress_a_real_one_beside_it(self):
        # Reporting the pre-existing one must not become a reason to ignore the
        # check that IS this PR's problem.
        decision = decide([a_check(name="Broken on main", failing_on_main=True), a_check(name="Validate")], FRESH_STATE)

        assert decision["action"] == ACTION_RERUN


class TestUnknownFailuresBuyOneRerunBeforeAnAgent:
    def test_an_unattributable_failure_is_not_called_a_regression(self):
        # "Could not establish the cause" must not be spelled "the diff broke
        # it". The distinction is what keeps a first-pass agent run off an
        # unrecognized flake.
        result = classify_check(a_check())

        assert result["classification"] == UNKNOWN

    def test_the_first_response_to_an_unknown_failure_is_a_free_rerun(self):
        decision = decide([a_check()], FRESH_STATE)

        assert decision["action"] == ACTION_RERUN
        assert decision["next_state"]["fixes"] == 0

    def test_the_fix_reason_does_not_overstate_the_evidence(self):
        # The counters are per-PR, not per-check, so when the re-run budget was
        # spent on an infrastructure failure that has since cleared, a
        # newly-appearing check reaches a fix run having been seen exactly once.
        # The reason line is what a human reads to decide whether to trust that
        # run, so it must not claim the failure reproduced when it may not have.
        decision = decide([a_check()], {"reruns": MAX_RERUNS, "fixes": 0, "escalated": False})

        assert decision["action"] == ACTION_FIX
        assert "reproduced" not in decision["reason"]
        assert "deterministic" not in decision["reason"]

    def test_a_failure_that_survives_a_rerun_has_earned_a_fix_run(self):
        # Reproducing across a re-run is the evidence that promotes a failure
        # from "unattributable" to "deterministic". Without this the feature
        # could never fix anything.
        decision = decide([a_check()], {"reruns": 1, "fixes": 0, "escalated": False})

        assert decision["action"] == ACTION_FIX
        assert decision["next_state"]["fixes"] == 1


class TestInfrastructureNeverBecomesAnAgentRun:
    def test_infrastructure_keeps_rerunning_up_to_the_cap(self):
        # PR #1319 hit the identical apt-get hang twice consecutively, so the
        # second re-run is a case we have actually observed, not a hypothetical.
        decision = decide([PR_1306_E2E_SHARD_1], {"reruns": 2, "fixes": 0, "escalated": False})

        assert decision["action"] == ACTION_RERUN
        assert decision["next_state"]["reruns"] == 3

    def test_exhausted_infrastructure_escalates_rather_than_paying_for_a_fix(self):
        # THE most important assertion in this file. A broken apt mirror that
        # survived every re-run is still not a code defect, and the worst thing
        # this feature could do is hand it to a model with permission to edit
        # application code. Out of re-runs means out of moves, not "try harder".
        decision = decide([PR_1306_E2E_SHARD_1], {"reruns": MAX_RERUNS, "fixes": 0, "escalated": False})

        assert decision["action"] == ACTION_ESCALATE
        assert decision["next_state"]["fixes"] == 0

    def test_infrastructure_alongside_an_unknown_failure_still_reruns_first(self):
        decision = decide([PR_1306_E2E_SHARD_1, a_check()], {"reruns": 1, "fixes": 0, "escalated": False})

        assert decision["action"] == ACTION_RERUN

    def test_an_unknown_failure_cannot_smuggle_a_fix_run_past_a_persisting_infra_one(self):
        # The hole this closes: with re-runs spent, a second failing check that
        # matched no signature used to exempt the whole board from escalation and
        # buy an agent run — while the environment was still visibly broken. The
        # infra failure is the most likely cause of the unknown one (an apt
        # mirror that hangs one job starves another into a signature-less
        # timeout), so the unknown check is being judged on bad evidence.
        decision = decide([PR_1306_E2E_SHARD_1, a_check()], {"reruns": MAX_RERUNS, "fixes": 0, "escalated": False})

        assert decision["action"] == ACTION_ESCALATE
        assert decision["next_state"]["fixes"] == 0


class TestCapsBoundTheSpend:
    def test_fix_runs_stop_at_the_cap(self):
        decision = decide([a_check()], {"reruns": MAX_RERUNS, "fixes": MAX_FIX_RUNS, "escalated": False})

        assert decision["action"] == ACTION_ESCALATE

    def test_an_escalated_pr_does_nothing_further(self):
        # Terminal by design. The counters are per-PR rather than per-commit
        # precisely so a fix run's own push cannot reopen the budget, so nothing
        # the bot does can clear this — only a human can.
        decision = decide([a_check()], {"reruns": 1, "fixes": 1, "escalated": True})

        assert decision["action"] == ACTION_NONE

    def test_no_failing_checks_means_no_action(self):
        decision = decide([], FRESH_STATE)

        assert decision["action"] == ACTION_NONE

    def test_a_rerun_never_consumes_the_fix_budget(self):
        decision = decide([PR_1306_E2E_SHARD_1], FRESH_STATE)

        assert decision["next_state"]["fixes"] == 0


class TestAnInFlightFixRunIsNotDuplicated:
    def test_a_fix_run_that_has_not_pushed_yet_does_not_buy_a_second_one(self):
        # The window this closes: launching a fix run changes nothing on the PR
        # until the agent pushes, so the 30-minute schedule comes back to an
        # identical red board. Without this guard it reads that as "nothing has
        # happened" and launches a second agent onto the same branch — two runs
        # pushing the same branch, both fix slots gone before either finished.
        state = {"reruns": 1, "fixes": 1, "escalated": False, "fix_started_at": NOW - 600}

        decision = decide([a_check()], state, now=NOW)

        assert decision["action"] == ACTION_NONE
        assert decision["next_state"]["fixes"] == 1

    def test_the_wait_ends_once_the_run_has_outlived_the_agent_deadline(self):
        # A run that is past its own deadline is not coming back, so the PR must
        # start moving again rather than sit for the life of the marker comment.
        state = {"reruns": 1, "fixes": 1, "escalated": False, "fix_started_at": NOW - FIX_RUN_GRACE_SECONDS - 1}

        decision = decide([a_check()], state, now=NOW)

        assert decision["action"] == ACTION_FIX

    def test_launching_a_fix_run_stamps_the_window_in_the_same_write(self):
        # The stamp has to land in the state that spends the slot. Written
        # separately, a crash between the two writes leaves a launched run with
        # no guard against being launched again.
        decision = decide([a_check()], {"reruns": 1, "fixes": 0, "escalated": False}, now=NOW)

        assert decision["action"] == ACTION_FIX
        assert decision["next_state"]["fix_started_at"] == NOW

    def test_a_rerun_does_not_open_an_in_flight_window(self):
        # Re-runs put checks back into pending within seconds, which the
        # workflow's own "checks still running" guard already covers. Stamping
        # here would idle the PR for an hour for no reason.
        decision = decide([PR_1306_E2E_SHARD_1], FRESH_STATE, now=NOW)

        assert decision["next_state"]["fix_started_at"] == 0

    def test_an_unreadable_stamp_does_not_park_the_pr(self):
        # Unlike the counters, this field fails toward acting: a garbled stamp
        # that read as "in flight" would freeze the PR an hour at a time, and the
        # counters still bound the spend either way.
        for bad in ("soon", -5, True, None):
            state = {"reruns": 1, "fixes": 0, "escalated": False, "fix_started_at": bad}

            assert decide([a_check()], state, now=NOW)["action"] == ACTION_FIX, f"fix_started_at={bad!r} parked the PR"


class TestStateSurvivesBetweenInvocations:
    def test_counters_round_trip_through_the_marker_comment(self):
        # The durability contract: what render_state writes into the PR comment
        # is what parse_state reads back on the next CI completion. If these drift
        # the caps silently stop applying.
        state = {
            "reruns": 2,
            "fixes": 1,
            "escalated": False,
            "fix_started_at": NOW,
            # Carried across too. A round trip that dropped these would let an
            # already-answered finding buy a second fix run on every pass.
            "findings_attempted": ["PRRT_one", "PRRT_two"],
        }

        assert parse_state(f"some text\n{render_state(state)}\nmore text") == state

    def test_a_missing_comment_means_nothing_has_been_spent(self):
        assert parse_state(None) == FRESH_STATE
        assert parse_state("") == FRESH_STATE

    def test_an_unparseable_state_comment_is_treated_as_exhausted(self):
        # Fails toward spending nothing. Reading a corrupted marker as "fresh"
        # would uncap the feature exactly when we have lost track of what it has
        # already done — the one situation where churn is unbounded.
        assert parse_state("<!-- gpbot-ci-drive -->\nno state here")["escalated"] is True
        assert parse_state("<!-- gpbot-ci-state: {not json} -->")["escalated"] is True
        assert parse_state("<!-- gpbot-ci-state: [1,2] -->")["escalated"] is True

    def test_a_tampered_counter_is_treated_as_exhausted(self):
        # Negative, non-integer and boolean counts all read as spent. Anything
        # else lets a hand-edited comment hand the bot an unlimited budget.
        for bad in (-1, "3", None, True):
            decision = decide([a_check()], {"reruns": bad, "fixes": 0, "escalated": False})
            assert decision["action"] != ACTION_RERUN, f"reruns={bad!r} reopened the re-run budget"


class TestMalformedInputCannotCrashTheDrive:
    def test_an_unreadable_check_is_unknown_rather_than_an_exception(self):
        # A GitHub API shape drift must degrade to the cautious class, not take
        # the drive down and leave the PR sitting again.
        assert classify_check("not a dict")["classification"] == UNKNOWN
        assert classify_check(None)["classification"] == UNKNOWN

    def test_non_list_checks_and_non_dict_state_are_survivable(self):
        assert decide(None, None)["action"] == ACTION_NONE
        assert decide("nope", "nope")["action"] == ACTION_NONE

    def test_the_cli_emits_a_decision_a_shell_can_read(self):
        # The workflow shells out to this and reads `action` with jq, so the
        # stdout contract is as load-bearing as the logic.
        payload = {"checks": [PR_1306_E2E_SHARD_1], "state": FRESH_STATE}
        decision = json.loads(json.dumps(decide(payload["checks"], payload["state"])))

        assert decision["action"] == ACTION_RERUN
        assert isinstance(decision["reason"], str) and decision["reason"]


class TestEvidenceIsReportedToHumans:
    def test_every_classification_carries_why(self):
        # Escalation hands these strings to a human in Slack. A verdict with no
        # observation behind it is exactly the "the bot says so" report that
        # makes people stop reading the channel.
        decision = decide([PR_1306_E2E_SHARD_1, a_check(failing_on_main=True)], FRESH_STATE)

        for classification in decision["classifications"]:
            assert classification["evidence"], f"{classification['name']} was classified with no evidence"

    def test_the_module_only_ever_returns_known_actions(self):
        # The workflow branches on this string. A typo'd action would silently
        # do nothing and put the PR back to sitting untouched.
        known = {
            ACTION_RERUN,
            ACTION_FIX,
            ACTION_FIX_FINDINGS,
            ACTION_REPORT,
            ACTION_ESCALATE,
            ACTION_HOLD,
            ACTION_NONE,
        }
        states = [
            FRESH_STATE,
            {"reruns": 1, "fixes": 0, "escalated": False},
            {"reruns": MAX_RERUNS, "fixes": 0, "escalated": False},
            {"reruns": MAX_RERUNS, "fixes": MAX_FIX_RUNS, "escalated": False},
            {"reruns": 0, "fixes": 0, "escalated": True},
            {"reruns": 0, "fixes": 0, "escalated": False, "findings_attempted": [PR_1306_BUGBOT_FINDING["id"]]},
        ]
        boards = [[], [a_check()], [PR_1306_E2E_SHARD_1], [a_check(failing_on_main=True)]]
        finding_sets = [None, [], [PR_1306_BUGBOT_FINDING]]

        for state in states:
            for board in boards:
                for findings in finding_sets:
                    assert decide(board, state, findings)["action"] in known


class TestTheRenderedCommentIsTheDurableState:
    def test_the_comment_the_drive_posts_is_readable_back_as_state(self):
        # The closed loop that makes the caps work at all: gpbot-ci-drive.yml
        # posts render_comment's output and reads it back with parse_state on the
        # next CI completion. If these two ever disagree the counters reset every
        # pass and a failing fix run can re-trigger itself forever.
        decision = decide([PR_1306_E2E_SHARD_1], FRESH_STATE)

        assert parse_state(ci_triage.render_comment(decision)) == decision["next_state"]

    def test_the_comment_carries_the_marker_the_workflow_searches_for(self):
        # The workflow finds its own comment with a literal `contains` on this
        # string. Renaming one side silently orphans every existing counter.
        assert ci_triage.STATE_MARKER in ci_triage.render_comment(decide([a_check()], FRESH_STATE))

    def test_the_comment_states_what_has_been_spent(self):
        # A human landing on the PR has to be able to see why the bot stopped
        # without going and reading this module.
        body = ci_triage.render_comment(decide([a_check()], {"reruns": 1, "fixes": 0, "escalated": False}))

        assert f"of {MAX_RERUNS}" in body and f"of {MAX_FIX_RUNS}" in body

    def test_a_stopped_pr_tells_a_human_how_to_hand_it_back(self):
        # The counters are per-PR and nothing the bot does resets them, so
        # without this the PR just goes quiet with no way to restart it.
        body = ci_triage.render_comment(decide([a_check()], {"reruns": 3, "fixes": 2, "escalated": False}))

        assert "will not be driven further" in body
        assert "Delete this comment" in body

    def test_a_rerun_comment_does_not_read_like_a_dead_end(self):
        body = ci_triage.render_comment(decide([PR_1306_E2E_SHARD_1], FRESH_STATE))

        assert "will not be driven further" not in body

    def test_the_cli_parses_its_state_out_of_the_comment_body(self):
        # The workflow hands over the raw comment body and never parses the
        # counters itself, so this path — not decide(state=...) — is the one
        # production actually takes.
        prior = ci_triage.render_comment(decide([PR_1306_E2E_SHARD_1], FRESH_STATE))
        state = parse_state(prior)

        assert state["reruns"] == 1
        assert decide([PR_1306_E2E_SHARD_1], state)["next_state"]["reruns"] == 2


class TestUnansweredReviewFindingsAreWork:
    """The #1306 gap: Bugbot found the defect and nothing treated it as work.

    Bugbot posts a COMMENTED review rather than CHANGES_REQUESTED, so it never
    blocks a merge, and delegate's approval satisfies the one-approval ruleset
    on its own. Until this path existed, an unresolved finding on a bot PR was
    read by every part of the system as "nothing to do".
    """

    def test_the_finding_that_reached_main_would_now_buy_a_fix_run(self):
        decision = decide([], FRESH_STATE, [PR_1306_BUGBOT_FINDING], now=NOW)

        assert decision["action"] == ACTION_FIX_FINDINGS

    def test_a_green_board_with_nothing_outstanding_does_nothing(self):
        assert decide([], FRESH_STATE, [], now=NOW)["action"] == ACTION_NONE
        assert decide([], FRESH_STATE, None, now=NOW)["action"] == ACTION_NONE

    def test_a_red_board_is_settled_before_any_finding_is_paid_for(self):
        # A run that answers a finding pushes code that still has to pass CI, so
        # buying one against a red board spends money to arrive back at a red PR.
        decision = decide([PR_1306_E2E_SHARD_1], FRESH_STATE, [PR_1306_BUGBOT_FINDING], now=NOW)

        assert decision["action"] == ACTION_RERUN

    def test_a_finding_gets_one_fix_run_and_never_a_second(self):
        # The unbounded-spend case this guard exists for: the agent disagrees
        # with a false positive, leaves the thread open, and without the banked
        # id every later pass reads the same thread as fresh work.
        first = decide([], FRESH_STATE, [PR_1306_BUGBOT_FINDING], now=NOW)
        assert first["action"] == ACTION_FIX_FINDINGS

        after = parse_state(ci_triage.render_comment(first))
        second = decide([], after, [PR_1306_BUGBOT_FINDING], now=NOW + FIX_RUN_GRACE_SECONDS + 1)

        assert second["action"] == ACTION_HOLD
        assert second["next_state"]["escalated"] is True

    def test_a_finding_posted_after_the_first_run_still_gets_answered(self):
        # Bugbot re-reviews the fix push. A genuinely new thread is new work and
        # must not be silenced by the previous thread having been attempted.
        state = dict(FRESH_STATE, fixes=1, findings_attempted=[PR_1306_BUGBOT_FINDING["id"]])
        new_finding = dict(PR_1306_BUGBOT_FINDING, id="PRRT_second", excerpt="### Something else")

        decision = decide([], state, [PR_1306_BUGBOT_FINDING, new_finding], now=NOW)

        assert decision["action"] == ACTION_FIX_FINDINGS
        # Both ids are banked, not just the fresh one, because a single run is
        # pointed at every open thread at once.
        assert set(decision["next_state"]["findings_attempted"]) == {PR_1306_BUGBOT_FINDING["id"], "PRRT_second"}

    def test_findings_and_checks_draw_on_the_same_fix_budget(self):
        # One budget, because what it bounds is money rather than either
        # activity on its own.
        state = dict(FRESH_STATE, reruns=MAX_RERUNS, fixes=MAX_FIX_RUNS)

        decision = decide([], state, [PR_1306_BUGBOT_FINDING], now=NOW)

        assert decision["action"] == ACTION_HOLD
        assert "no fix runs left" in decision["reason"]

    def test_an_in_flight_fix_run_is_not_duplicated_by_a_finding(self):
        # Same window the CI path uses. A launched run changes nothing on the PR
        # for many minutes, so the 30-minute schedule would otherwise point a
        # second agent at the same branch.
        state = dict(FRESH_STATE, fixes=1, fix_started_at=NOW)

        decision = decide([], state, [PR_1306_BUGBOT_FINDING], now=NOW + 60)

        assert decision["action"] == ACTION_NONE
        assert "in flight" in decision["reason"]


class TestWhichThreadsCount:
    def test_a_resolved_thread_is_finished(self):
        assert open_findings([dict(PR_1306_BUGBOT_FINDING, resolved=True)]) == []

    def test_an_outdated_thread_is_finished(self):
        # A fix push moves the lines and GitHub marks the thread outdated by
        # itself, which is the natural stop for a thread already acted on.
        assert open_findings([dict(PR_1306_BUGBOT_FINDING, outdated=True)]) == []

    def test_a_thread_a_human_replied_in_belongs_to_the_human(self):
        # Nobody replied on #1306, which is exactly why it qualified. Once a
        # person is in the thread the bot must not talk over them.
        assert open_findings([dict(PR_1306_BUGBOT_FINDING, human_replied=True)]) == []

    def test_delegate_findings_are_left_alone(self):
        # delegate withholds approval until its blockers are fixed, so it
        # already gates the merge, and it runs a reply-and-re-review protocol a
        # second automated actor would fight.
        assert open_findings([dict(PR_1306_BUGBOT_FINDING, author="delegate-reviewer")]) == []

    def test_the_same_account_counts_over_either_api(self):
        # GraphQL says `cursor`, REST says `cursor[bot]`.
        assert len(open_findings([dict(PR_1306_BUGBOT_FINDING, author="cursor[bot]")])) == 1
        assert len(open_findings([dict(PR_1306_BUGBOT_FINDING, author="Cursor")])) == 1

    def test_a_garbled_thread_still_counts_as_needing_an_answer(self):
        # Missing flags must not read as "already handled" — silently dropping a
        # real finding is the bug this whole path exists to fix.
        bare = {"id": "PRRT_bare", "author": "cursor"}

        assert len(open_findings([bare])) == 1

    def test_a_thread_with_no_id_is_dropped(self):
        # The one drop that is not the cautious direction, and it has to be:
        # findings_attempted is keyed on the id, so an untrackable thread would
        # buy a fix run on every pass forever.
        assert open_findings([dict(PR_1306_BUGBOT_FINDING, id="")]) == []
        assert open_findings([dict(PR_1306_BUGBOT_FINDING, id=None)]) == []

    def test_junk_cannot_crash_the_drive(self):
        assert open_findings("nope") == []
        assert open_findings([None, 7, "x"]) == []

    def test_the_title_a_human_reads_is_the_headline_not_the_markup(self):
        # This string goes to Slack. Bugbot's body opens with a markdown heading
        # and then a wall of HTML comment markers.
        assert open_findings([PR_1306_BUGBOT_FINDING])[0]["title"] == "Failed collection hides retry UI"

    def test_a_finding_is_named_in_the_escalation_a_human_reads(self):
        decision = decide([], dict(FRESH_STATE, fixes=MAX_FIX_RUNS), [PR_1306_BUGBOT_FINDING], now=NOW)

        assert "Failed collection hides retry UI" in ci_triage.render_summary(decision)

    def test_a_stopped_findings_pr_tells_a_human_how_to_hand_it_back(self):
        body = ci_triage.render_comment(
            decide([], dict(FRESH_STATE, fixes=MAX_FIX_RUNS), [PR_1306_BUGBOT_FINDING], now=NOW)
        )

        assert "will not be driven further" in body
        assert "Delete this comment" in body


class TestCapsAreDeliberate:
    def test_the_rerun_cap_absorbs_the_observed_double_flake(self):
        # PR #1319 hit the same apt-get hang on two consecutive runs. A cap below
        # 3 would have escalated a pure flake to a human, which is the noise that
        # makes an alert channel worth ignoring.
        assert ci_triage.MAX_RERUNS >= 3

    def test_the_fix_cap_matches_the_ship_pr_round_cap(self):
        # ship-pr's Phase 3 stops after 2 check-fix rounds. This automates that
        # judgement; it must not quietly grant itself a larger budget than the
        # human-driven process it is modelled on.
        assert ci_triage.MAX_FIX_RUNS == 2
