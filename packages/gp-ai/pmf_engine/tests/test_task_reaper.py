import json
from unittest.mock import patch

import pytest

import pmf_engine.control_plane.task_reaper as reaper


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


def test_judge_run_id_prefix_fits_the_ecs_started_by_cap():
    """ECS caps `startedBy` at 36 characters and dispatch passes the run id
    through verbatim, so a judge run id must fit in 36 including the prefix."""
    assert len(reaper.JUDGE_RUN_ID_PREFIX) < 36
