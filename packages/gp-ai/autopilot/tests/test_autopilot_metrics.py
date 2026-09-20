"""Tests for the one line per stage run that observability greps for.

Modeled on engineer_agent/tests/test_metrics.py's discipline: a broken metric
does not throw, it reports a smaller/wrong number, so both directions matter —
the line must be emitted with the right outcome, and it must never invent a
value it does not have.
"""

import json

from autopilot.agent.metrics import METRIC_PREFIX, format_metric_line

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
        expected = {"task_id", "stage", "outcome", "cost_usd", "duration_s", "setup_s", "epic_task_id"}

        assert set(parsed(format_metric_line(None, None)).keys()) == expected

    def test_the_line_is_a_single_greppable_line(self):
        line = format_metric_line(SUCCESS_RESULT, "story", 361.2)

        assert "\n" not in line
        assert line.startswith(METRIC_PREFIX + " {")

    def test_junk_in_never_raises(self):
        for result in (None, "", [], 7, {"status": object()}):
            assert format_metric_line(result, object(), object()).startswith(METRIC_PREFIX)
