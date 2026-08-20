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
    ACTION_NONE,
    ACTION_REPORT,
    ACTION_RERUN,
    INFRA,
    MAX_FIX_RUNS,
    MAX_RERUNS,
    PRE_EXISTING,
    UNKNOWN,
    classify_check,
    decide,
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

FRESH_STATE = {"reruns": 0, "fixes": 0, "escalated": False}


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


class TestStateSurvivesBetweenInvocations:
    def test_counters_round_trip_through_the_marker_comment(self):
        # The durability contract: what render_state writes into the PR comment
        # is what parse_state reads back on the next CI completion. If these drift
        # the caps silently stop applying.
        state = {"reruns": 2, "fixes": 1, "escalated": False}

        assert parse_state(f"some text\n{render_state(state)}\nmore text") == state

    def test_a_missing_comment_means_nothing_has_been_spent(self):
        assert parse_state(None) == {"reruns": 0, "fixes": 0, "escalated": False}
        assert parse_state("") == {"reruns": 0, "fixes": 0, "escalated": False}

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
        known = {ACTION_RERUN, ACTION_FIX, ACTION_REPORT, ACTION_ESCALATE, ACTION_NONE}
        states = [
            FRESH_STATE,
            {"reruns": 1, "fixes": 0, "escalated": False},
            {"reruns": MAX_RERUNS, "fixes": 0, "escalated": False},
            {"reruns": MAX_RERUNS, "fixes": MAX_FIX_RUNS, "escalated": False},
            {"reruns": 0, "fixes": 0, "escalated": True},
        ]
        boards = [[], [a_check()], [PR_1306_E2E_SHARD_1], [a_check(failing_on_main=True)]]

        for state in states:
            for board in boards:
                assert decide(board, state)["action"] in known


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
