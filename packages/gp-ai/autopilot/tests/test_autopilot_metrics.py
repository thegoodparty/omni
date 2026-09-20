"""Tests for the one line per stage run that observability greps for.

Modeled on engineer_agent/tests/test_metrics.py's discipline: a broken metric
does not throw, it reports a smaller/wrong number, so both directions matter —
the line must be emitted with the right outcome, and it must never invent a
value it does not have.
"""

import json

from autopilot.agent.metrics import (
    METRIC_PREFIX,
    RUN_SUMMARY_MARKER_PATTERN,
    format_metric_line,
    format_run_summary_comment,
    format_run_summary_marker,
    run_summary,
)

SUCCESS_RESULT = {
    "status": "success",
    "task_id": "86acb46d4",
    "result": "Opened https://github.com/thegoodparty/omni/pull/1900",
    "cost_usd": 3.7100000000000004,
    "num_turns": 24,
    "session_id": "a1b2c3d4",
}

BUDGET_EXHAUSTED_RESULT = {
    "status": "error",
    "task_id": "86acb46d4",
    "error": "budget ceiling hit",
    "error_subtype": "error_max_budget_usd",
    "cost_usd": 15.0,
}

DEADLINE_RESULT = {
    "status": "error",
    "task_id": "86acb46d4",
    "error": "Deadline exceeded (2700s)",
    "error_subtype": "error_deadline_exceeded",
}

GENERIC_ERROR_RESULT = {
    "status": "error",
    "task_id": "86acb46d4",
    "error": "boom",
}


def parsed(line: str) -> dict:
    prefix, _, body = line.partition(" ")
    assert prefix == METRIC_PREFIX
    return json.loads(body)


class TestOutcomes:
    def test_a_successful_run_reports_success(self):
        fields = parsed(format_metric_line(SUCCESS_RESULT, "story", 361.24, "EPIC-1"))

        assert fields["task_id"] == "86acb46d4"
        assert fields["stage"] == "story"
        assert fields["outcome"] == "success"
        assert fields["cost_usd"] == 3.71
        assert fields["duration_s"] == 361.2
        assert fields["epic_task_id"] == "EPIC-1"

    def test_a_budget_exhausted_run_reports_that_outcome(self):
        fields = parsed(format_metric_line(BUDGET_EXHAUSTED_RESULT, "story", 900.0))

        assert fields["outcome"] == "budget_exhausted"
        assert fields["cost_usd"] == 15.0

    def test_a_deadline_killed_run_reports_that_outcome(self):
        fields = parsed(format_metric_line(DEADLINE_RESULT, "qa", 1800.0))

        assert fields["outcome"] == "deadline_exceeded"

    def test_a_generic_error_is_still_counted(self):
        fields = parsed(format_metric_line(GENERIC_ERROR_RESULT, "epic-create", 12.0))

        assert fields["outcome"] == "error"

    def test_a_run_that_parked_for_feedback_reports_that_outcome_not_success(self):
        parked_result = dict(SUCCESS_RESULT, parked_stage="epic-create")

        fields = parsed(format_metric_line(parked_result, "epic-create", 90.0))

        assert fields["outcome"] == "feedback_parked"
        # Parking is still a clean, billable run — its cost is not discarded
        # just because the outcome label changed.
        assert fields["cost_usd"] == 3.71

    def test_parked_stage_on_a_failed_run_does_not_claim_a_clean_park(self):
        # apply_park_outcome only ever tags a successful run (see
        # autopilot.agent.feedback), but this pins the metric's own half of
        # that contract: a non-success status always wins over a stray
        # parked_stage field.
        fields = parsed(format_metric_line(dict(GENERIC_ERROR_RESULT, parked_stage="epic-create"), "epic-create", 12.0))

        assert fields["outcome"] == "error"


class TestUnknownIsNotZero:
    def test_a_missing_cost_is_null_rather_than_free(self):
        fields = parsed(format_metric_line({"status": "success", "task_id": "x"}, "story", None))

        assert fields["cost_usd"] is None
        assert fields["duration_s"] is None

    def test_a_cost_of_actually_zero_is_reported_as_zero(self):
        fields = parsed(format_metric_line(dict(SUCCESS_RESULT, cost_usd=0.0), "story", 0.4))

        assert fields["cost_usd"] == 0.0
        assert fields["duration_s"] == 0.4

    def test_a_nonsense_cost_cannot_produce_a_line_nobody_can_parse(self):
        for bad in (float("nan"), float("inf"), "3.71", None, True):
            fields = parsed(format_metric_line(dict(SUCCESS_RESULT, cost_usd=bad), "story", 1.0))

            assert fields["cost_usd"] is None
            assert fields["outcome"] == "success"

    def test_a_run_never_asked_for_an_epic_records_none(self):
        assert parsed(format_metric_line(SUCCESS_RESULT, "story", 1.0, "")).get("epic_task_id") is None
        assert parsed(format_metric_line(SUCCESS_RESULT, "story", 1.0)).get("epic_task_id") is None


class TestSetupDuration:
    # ENG-11149: setup (the omni checkout, plus a warm image's conditional
    # npm ci) runs before run_agent and is never paid, so it needs its own
    # field rather than folding into duration_s — a reader must be able to
    # tell "the run was slow" from "setup was slow" apart.
    def test_setup_duration_is_reported_alongside_run_duration(self):
        fields = parsed(format_metric_line(SUCCESS_RESULT, "story", 361.24, "EPIC-1", setup_s=4.567))

        assert fields["setup_s"] == 4.6
        assert fields["duration_s"] == 361.2

    def test_a_missing_setup_duration_is_null_rather_than_zero(self):
        fields = parsed(format_metric_line(SUCCESS_RESULT, "story", 361.24))

        assert fields["setup_s"] is None


class TestTheContract:
    def test_every_field_is_present_even_when_it_does_not_apply(self):
        expected = {"task_id", "stage", "outcome", "cost_usd", "duration_s", "setup_s", "epic_task_id", "pr_url"}

        assert set(parsed(format_metric_line(None, None)).keys()) == expected

    def test_the_line_is_a_single_greppable_line(self):
        line = format_metric_line(SUCCESS_RESULT, "story", 361.2)

        assert "\n" not in line
        assert line.startswith(METRIC_PREFIX + " {")

    def test_junk_in_never_raises(self):
        for result in (None, "", [], 7, {"status": object()}):
            assert format_metric_line(result, object(), object()).startswith(METRIC_PREFIX)


class TestPrUrl:
    def test_pr_url_extracted_from_the_result_text(self):
        fields = parsed(format_metric_line(SUCCESS_RESULT, "story", 1.0))

        assert fields["pr_url"] == "https://github.com/thegoodparty/omni/pull/1900"

    def test_no_pr_link_in_the_result_text_is_null_not_missing(self):
        no_pr = dict(SUCCESS_RESULT, result="Parked, waiting on an answer.")

        fields = parsed(format_metric_line(no_pr, "story", 1.0))

        assert fields["pr_url"] is None

    def test_an_unrelated_repos_pull_link_is_not_mistaken_for_this_runs_own(self):
        other_repo = dict(SUCCESS_RESULT, result="See https://github.com/thegoodparty/some-other-repo/pull/12")

        fields = parsed(format_metric_line(other_repo, "story", 1.0))

        assert fields["pr_url"] is None


class TestRunSummary:
    """run_summary is the ONE dict fed to both sinks — the metric line and
    the ClickUp comment (metrics.format_run_summary_comment, consumed by
    main.post_run_summary_comment). This pins that they can never disagree.
    """

    def test_run_summary_matches_the_metric_lines_own_fields(self):
        summary = run_summary(SUCCESS_RESULT, "story", 361.24, "EPIC-1")
        fields = parsed(format_metric_line(SUCCESS_RESULT, "story", 361.24, "EPIC-1"))

        assert summary == fields

    def test_format_run_summary_comment_includes_the_pr_link_when_present(self):
        summary = run_summary(SUCCESS_RESULT, "story", 361.24, "EPIC-1")

        comment = format_run_summary_comment(summary)

        assert comment.startswith("[autopilot:run-summary stage=story outcome=success cost_usd=3.71]")
        assert "https://github.com/thegoodparty/omni/pull/1900" in comment
        assert "Cost:** $3.71" in comment
        assert "Duration:** 361.2s" in comment

    def test_format_run_summary_comment_omits_the_pr_line_when_absent(self):
        no_pr = dict(SUCCESS_RESULT, result="No PR this run.")
        summary = run_summary(no_pr, "epic-create", 12.0)

        comment = format_run_summary_comment(summary)

        assert "PR:" not in comment

    def test_format_run_summary_comment_reports_unknown_cost_honestly(self):
        summary = run_summary({"status": "success", "task_id": "x"}, "story", None)

        comment = format_run_summary_comment(summary)

        assert "Cost:** unknown" in comment
        assert "Duration:** unknown" in comment

    def test_format_run_summary_comment_never_carries_a_park_or_slack_answer_marker(self):
        # The critical interaction (ENG-11151): the run-summary comment must
        # never look like a park or a relayed Slack answer to router.route()'s
        # self-resume guard or sweep's reply-after-park check.
        summary = run_summary(SUCCESS_RESULT, "story", 1.0)

        comment = format_run_summary_comment(summary)

        assert "[autopilot:parked" not in comment
        assert "[autopilot:slack-answer" not in comment

    def test_junk_in_never_raises(self):
        for result in (None, "", [], 7, {"status": object()}):
            assert format_run_summary_comment(run_summary(result, object(), object()))


class TestRunSummaryMarker:
    def test_marker_carries_stage_outcome_and_cost(self):
        marker = format_run_summary_marker("story", "success", 3.71)

        assert marker == "[autopilot:run-summary stage=story outcome=success cost_usd=3.71]"
        match = RUN_SUMMARY_MARKER_PATTERN.search(marker)
        assert match is not None
        assert match.group(1) == "story"
        assert match.group(2) == "success"
        assert match.group(3) == "3.71"

    def test_marker_omits_cost_usd_when_none(self):
        marker = format_run_summary_marker("qa", "error", None)

        assert marker == "[autopilot:run-summary stage=qa outcome=error]"
        match = RUN_SUMMARY_MARKER_PATTERN.search(marker)
        assert match is not None
        assert match.group(3) is None
