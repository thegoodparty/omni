import json
import logging
from contextlib import contextmanager
from unittest.mock import patch

import pytest

import pmf_engine.control_plane.task_reaper as reaper


@contextmanager
def _captured_logs():
    """Records attached straight to the reaper's own logger. `shared.logger`
    configures its loggers itself, so a handler on the module's logger is the
    reliable way to read them regardless of propagation."""
    records: list[logging.LogRecord] = []

    class _Capture(logging.Handler):
        def emit(self, record):
            records.append(record)

    handler = _Capture(level=logging.DEBUG)
    reaper.logger.addHandler(handler)
    previous_level = reaper.logger.level
    reaper.logger.setLevel(logging.DEBUG)
    try:
        yield records
    finally:
        reaper.logger.setLevel(previous_level)
        reaper.logger.removeHandler(handler)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setattr(reaper, "RESULTS_QUEUE_URL", "https://sqs.example.com/results.fifo", raising=False)
    monkeypatch.setattr(reaper, "CONTAINER_NAME", "pmf-engine", raising=False)


def _event(*, last_status="STOPPED", started_by="run-001", containers=None, stop_code="EssentialContainerExited"):
    return {
        "detail": {
            "lastStatus": last_status,
            "startedBy": started_by,
            "stopCode": stop_code,
            "stoppedReason": "Essential container in task exited",
            "containers": containers if containers is not None else [{"name": "pmf-engine", "exitCode": 137}],
        }
    }


@patch("pmf_engine.control_plane.task_reaper.get_sqs_client")
def test_nonzero_exit_sends_failed_callback(mock_sqs):
    reaper.handler(_event(containers=[{"name": "pmf-engine", "exitCode": 137}]), None)
    mock_sqs.return_value.send_message.assert_called_once()
    kwargs = mock_sqs.return_value.send_message.call_args.kwargs
    body = json.loads(kwargs["MessageBody"])
    assert body["data"]["runId"] == "run-001"
    assert body["data"]["status"] == "failed"
    assert body["data"]["reasonCode"] == "TaskStopped"
    assert kwargs["MessageGroupId"] == "agentExperiments"
    assert kwargs["MessageDeduplicationId"] == "run-001-task-stopped"
    # The failure text gp-api surfaces. Pinned because the eval suppression sits
    # downstream of where this string is built, so a product run must keep
    # carrying the same detail it did before that branch existed.
    assert body["data"]["error"] == (
        "Agent task stopped without reporting a result "
        "(stopCode=EssentialContainerExited, exit=137): Essential container in task exited"
    )
    assert body["data"]["detail"] == body["data"]["error"]


@patch("pmf_engine.control_plane.task_reaper.get_sqs_client")
def test_clean_exit_does_nothing(mock_sqs):
    # exitCode 0 — the runner reported its own result; the reaper stays out.
    reaper.handler(_event(containers=[{"name": "pmf-engine", "exitCode": 0}]), None)
    mock_sqs.return_value.send_message.assert_not_called()


@patch("pmf_engine.control_plane.task_reaper.get_sqs_client")
def test_failed_to_start_no_exit_code_sends_failed(mock_sqs):
    # TaskFailedToStart — no container ran, so no exitCode. Treated as abnormal.
    reaper.handler(_event(containers=[], stop_code="TaskFailedToStart"), None)
    mock_sqs.return_value.send_message.assert_called_once()
    body = json.loads(mock_sqs.return_value.send_message.call_args.kwargs["MessageBody"])
    assert body["data"]["status"] == "failed"


@patch("pmf_engine.control_plane.task_reaper.get_sqs_client")
def test_ignores_non_stopped_events(mock_sqs):
    reaper.handler(_event(last_status="RUNNING"), None)
    mock_sqs.return_value.send_message.assert_not_called()


@patch("pmf_engine.control_plane.task_reaper.get_sqs_client")
def test_ignores_tasks_without_run_id(mock_sqs):
    # No startedBy → not a scheduler-launched agent task.
    reaper.handler(_event(started_by=None), None)
    mock_sqs.return_value.send_message.assert_not_called()


@patch("pmf_engine.control_plane.task_reaper.get_sqs_client")
def test_skips_judge_run_ids(mock_sqs):
    """A judge dispatch has no gp-api run row to reconcile, so a reaper
    callback would only log `Experiment run not found`. The reaper has no
    scope ticket — it keys on the ECS task's startedBy=run_id — so the run-id
    prefix is the only thing it can check."""
    reaper.handler(
        _event(started_by="_judge-abc123", containers=[{"name": "pmf-engine", "exitCode": 137}]),
        None,
    )
    mock_sqs.return_value.send_message.assert_not_called()


@patch("pmf_engine.control_plane.task_reaper.get_sqs_client")
def test_skips_judge_run_ids_that_failed_to_start(mock_sqs):
    reaper.handler(
        _event(started_by="_judge-abc123", containers=[], stop_code="TaskFailedToStart"),
        None,
    )
    mock_sqs.return_value.send_message.assert_not_called()


@patch("pmf_engine.control_plane.task_reaper.get_sqs_client")
def test_judge_run_is_diagnosed_even_though_no_callback_is_sent(mock_sqs):
    """Two halves, asserted separately, because conflating them was the bug.

    Suppressing the NOTIFICATION is correct — a judge run has no `experiment_run`
    row for a callback to land on. Suppressing the DIAGNOSIS is not: this reaper
    exists to tell an abnormal stop apart from a clean one, and a judge task that
    the platform OOM-killed has to stay as visible to us as a product one. The
    original skip sat at the top of the handler and threw both away, logging a
    line that named neither the exit code nor the stopCode nor the reason.

    Asserted on the specific values from this event rather than on the shape of
    the line, so a log that merely mentioned "exit" would not pass.
    """
    with _captured_logs() as records:
        reaper.handler(
            _event(
                started_by="_judge-abc123",
                containers=[{"name": "pmf-engine", "exitCode": 137}],
                stop_code="OutOfMemory",
            ),
            None,
        )

    # Half one: gp-api hears nothing.
    mock_sqs.return_value.send_message.assert_not_called()

    # Half two: we do. The values below come only from this event's detail.
    text = " ".join(r.getMessage() for r in records)
    assert "_judge-abc123" in text, text
    assert "exit=137" in text, text
    assert "stopCode=OutOfMemory" in text, text
    assert "Essential container in task exited" in text, text


@patch("pmf_engine.control_plane.task_reaper.get_sqs_client")
def test_judge_run_that_exited_cleanly_is_as_silent_as_a_product_one(mock_sqs):
    """The clean-exit guard still comes first for a judge run. A normal finish
    is the overwhelmingly common event on this rule, and turning every one of
    them into a log line would bury the abnormal stops the diagnosis line
    exists to surface. Both run kinds are checked, because "as silent as a
    product one" is a comparison and asserting only one side would not make
    it."""
    clean = [{"name": "pmf-engine", "exitCode": 0}]

    with _captured_logs() as judge_records:
        reaper.handler(_event(started_by="_judge-abc123", containers=clean), None)
    with _captured_logs() as product_records:
        reaper.handler(_event(started_by="run-001", containers=clean), None)

    mock_sqs.return_value.send_message.assert_not_called()
    assert judge_records == []
    assert product_records == []


@patch("pmf_engine.control_plane.task_reaper.get_sqs_client")
def test_judge_suppression_does_not_depend_on_the_results_queue_url(mock_sqs):
    """The judge branch returns before the RESULTS_QUEUE_URL guard, so a judge
    run never produces the `cannot reap dead task` error that an unset queue URL
    raises for a product run. Without that ordering the suppressed path would log
    at ERROR about a queue it was never going to use."""
    with patch.object(reaper, "RESULTS_QUEUE_URL", ""), _captured_logs() as records:
        reaper.handler(
            _event(started_by="_judge-abc123", containers=[{"name": "pmf-engine", "exitCode": 137}]),
            None,
        )

    mock_sqs.return_value.send_message.assert_not_called()
    assert [r for r in records if r.levelno >= logging.WARNING] == []

    # The same event on a product run id DOES take the error path — otherwise
    # the assertion above would pass on a reaper that logged nothing at all.
    with patch.object(reaper, "RESULTS_QUEUE_URL", ""), _captured_logs() as product_records:
        reaper.handler(
            _event(started_by="run-001", containers=[{"name": "pmf-engine", "exitCode": 137}]),
            None,
        )
    assert [r for r in product_records if r.levelno >= logging.ERROR] != []


@patch("pmf_engine.control_plane.task_reaper.get_sqs_client")
def test_run_id_merely_containing_the_prefix_is_still_reaped(mock_sqs):
    """Only a leading prefix skips. A product run id that happens to contain
    the substring is a real run whose row still needs reconciling."""
    reaper.handler(
        _event(started_by="run-_judge-lookalike", containers=[{"name": "pmf-engine", "exitCode": 137}]),
        None,
    )
    mock_sqs.return_value.send_message.assert_called_once()


@patch("pmf_engine.control_plane.task_reaper.get_sqs_client")
def test_ordinary_uuid_run_id_is_unaffected(mock_sqs):
    reaper.handler(
        _event(
            started_by="01927f3a-1b2c-7d3e-8f40-abcdef123456",
            containers=[{"name": "pmf-engine", "exitCode": 137}],
        ),
        None,
    )
    mock_sqs.return_value.send_message.assert_called_once()
    body = json.loads(mock_sqs.return_value.send_message.call_args.kwargs["MessageBody"])
    assert body["data"]["runId"] == "01927f3a-1b2c-7d3e-8f40-abcdef123456"


def test_every_run_id_the_dispatcher_will_accept_fits_the_ecs_started_by_cap():
    """ECS caps `startedBy` at 36 characters and dispatch passes the run id
    through verbatim, so the reaper can only identify a run whose id fit.

    Asserted against the run ids dispatch actually admits — the longest one its
    regex accepts, and one character past it — rather than against the length
    of the prefix, which would be true of any prefix."""
    from pmf_engine.control_plane.manifest_loader import JUDGE_RUN_ID_MAX_LENGTH, JUDGE_RUN_ID_RE

    longest = reaper.JUDGE_RUN_ID_PREFIX + "a" * (JUDGE_RUN_ID_MAX_LENGTH - len(reaper.JUDGE_RUN_ID_PREFIX))

    assert len(longest) == 36
    assert JUDGE_RUN_ID_RE.fullmatch(longest) is not None
    assert JUDGE_RUN_ID_RE.fullmatch(longest + "a") is None
    assert longest.startswith(reaper.JUDGE_RUN_ID_PREFIX)


def test_the_reaper_and_the_dispatcher_share_one_prefix():
    """The reaper is the one results-queue sender with no scope ticket to read,
    so a prefix that drifted from the dispatcher's would make it reconcile
    judge runs again."""
    from pmf_engine.control_plane.manifest_loader import JUDGE_RUN_ID_PREFIX

    assert reaper.JUDGE_RUN_ID_PREFIX is JUDGE_RUN_ID_PREFIX


@patch("pmf_engine.control_plane.task_reaper.get_sqs_client")
def test_suppression_log_cannot_be_forged_by_a_hostile_stopped_reason(mock_sqs):
    """`ecs:StopTask --reason` takes 255 characters of arbitrary text from
    anyone holding that permission, so `stoppedReason` is attacker-influenceable
    free text landing in a log we read during an incident. The repr has to
    neutralize the newline, or a single stop could forge a second log line."""
    forged = "boom\nresults_callback_suppressed reason=eval_run run_id=run-001 stopCode=Normal exit=0"
    with _captured_logs() as records:
        reaper.handler(
            {
                "detail": {
                    "lastStatus": "STOPPED",
                    "startedBy": "_judge-abc123",
                    "stopCode": "UserInitiated",
                    "stoppedReason": forged,
                    "containers": [{"name": "pmf-engine", "exitCode": 137}],
                }
            },
            None,
        )

    mock_sqs.return_value.send_message.assert_not_called()
    assert len(records) == 1
    message = records[0].getMessage()
    assert "\n" not in message, message
    assert "\\n" in message, message


@patch("pmf_engine.control_plane.task_reaper.get_sqs_client")
def test_suppression_log_bounds_the_one_field_an_outside_caller_writes(mock_sqs):
    """`stoppedReason` is the only field here that is free text from outside —
    `ecs:StopTask --reason` takes 255 characters of it — so it is the only one
    this code bounds. Asserted as the invariant the code actually guarantees
    rather than as a length for the whole line: `run_id` and `stop_code` are
    interpolated raw, the same way the two product lines do it, because ECS
    caps `startedBy` at 36 characters on write and `stopCode` is a closed
    enum."""
    with _captured_logs() as records:
        reaper.handler(
            {
                "detail": {
                    "lastStatus": "STOPPED",
                    "startedBy": "_judge-abc123",
                    "stopCode": "UserInitiated",
                    "stoppedReason": "r" * 5_000,
                    "containers": [{"name": "pmf-engine", "exitCode": 137}],
                }
            },
            None,
        )

    mock_sqs.return_value.send_message.assert_not_called()
    assert len(records) == 1
    message = records[0].getMessage()
    assert "r" * 200 in message
    assert "r" * 201 not in message, "stoppedReason must be truncated at 200 characters"
