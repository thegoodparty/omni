from __future__ import annotations

import json
import os

import boto3

try:
    from shared.logger import get_logger

    logger = get_logger(__name__)
except (ImportError, OSError):
    import logging

    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

# The judge run-id prefix is defined once, beside the rest of the judge
# dispatch contract, and imported by both this reaper and dispatch_handler.
# Both layouts are real: the Lambda zip is flat (handler = `task_reaper.handler`)
# while the test suite imports the package.
try:
    from .manifest_loader import JUDGE_RUN_ID_PREFIX
except ImportError:
    from manifest_loader import JUDGE_RUN_ID_PREFIX  # type: ignore[no-redef]

RESULTS_QUEUE_URL = os.environ.get("RESULTS_QUEUE_URL", "")
CONTAINER_NAME = os.environ.get("CONTAINER_NAME", "pmf-engine")

_sqs_client = None


def get_sqs_client():
    global _sqs_client
    if _sqs_client is None:
        _sqs_client = boto3.client("sqs")
    return _sqs_client


def _container_exit_code(containers: list) -> int | None:
    """Exit code of the agent container (CONTAINER_NAME), falling back to the
    first container. None when the task never produced a running container
    (e.g. stopCode=TaskFailedToStart) — treated as an abnormal stop."""
    for c in containers:
        if c.get("name") == CONTAINER_NAME:
            return c.get("exitCode")
    return containers[0].get("exitCode") if containers else None


def handler(event: dict, context) -> None:
    """EventBridge target for ECS Task State Change (STOPPED) on the pmf-engine
    cluster. When an agent task stops WITHOUT a clean exit, the runner did not
    report a result (OOM/SIGKILL/eviction/failed-to-start), so gp-api's run row
    would otherwise sit RUNNING forever. Send a `failed` callback to reconcile it.

    Safe against the common case (task completed normally): a clean exit (code 0)
    means the runner published its own terminal result, so we stay out. And the
    results queue is FIFO with one message group, so even on a non-zero exit the
    runner's own callback (sent before the task exits) is ordered ahead of ours
    and gp-api's terminal guard drops our late duplicate — a successful run can't
    be flipped to FAILED.

    A judge run reaches the same diagnosis and then stops short of the send; see
    the comment at that branch for why the suppression sits there rather than at
    the top of this function.
    """
    detail = event.get("detail", {})
    if detail.get("lastStatus") != "STOPPED":
        return

    run_id = detail.get("startedBy")
    if not run_id:
        # Not a scheduler-launched agent task (we tag those with startedBy=run_id).
        return

    exit_code = _container_exit_code(detail.get("containers", []))
    if exit_code == 0:
        # Clean exit — the runner reported its own result; nothing to reconcile.
        return

    stop_code = detail.get("stopCode", "unknown")
    reason = detail.get("stoppedReason", "")

    # A judge dispatch has no `experiment_run` row in gp-api, so a reconciling
    # callback would only log `Experiment run not found`. The suppression sits
    # here, at the send, and not at the top of the handler: the abnormal-stop
    # diagnosis above is why the reaper exists, and a top-of-handler skip threw
    # it away, leaving an OOM-killed judge task indistinguishable from a clean
    # finish.
    #
    # This reaper stops nothing. It is an EventBridge target on ECS Task State
    # Change with lastStatus=STOPPED (packages/gp-ai/infrastructure/modules/
    # pmf-engine-control-plane/main.tf) and its role holds sqs:SendMessage and
    # nothing else, so it only ever sees tasks that have already stopped. A
    # runaway task is bounded by the runner's own
    # `asyncio.wait_for(timeout=config.timeout_seconds)` plus `_hard_exit(1)`.
    if run_id.startswith(JUDGE_RUN_ID_PREFIX):
        # `stoppedReason` is the one field here an outside caller writes freely
        # (`ecs:StopTask --reason` takes 255 characters of arbitrary text), so
        # it is bounded and `!r`-quoted: that is what stops a newline in it from
        # forging a second log line. `str()` first because slicing a non-string
        # would raise in a handler with no outer guard.
        #
        # `reason=eval_run` matches the four other suppression sites
        # (`scheduler_handler`, `dispatch_handler`, the broker's `run_status`
        # and `artifact_publish`) so one query spans all five.
        logger.info(
            f"results_callback_suppressed reason=eval_run run_id={run_id} "
            f"stopCode={stop_code} exit={exit_code} stoppedReason={str(reason)[:200]!r}"
        )
        return

    if not RESULTS_QUEUE_URL:
        logger.error(f"RESULTS_QUEUE_URL unset; cannot reap dead task for run {run_id}")
        return

    error = f"Agent task stopped without reporting a result (stopCode={stop_code}, exit={exit_code}): {reason}"[:1000]
    body = {
        "type": "agentExperimentResult",
        "data": {
            "experimentId": "unknown",
            "runId": run_id,
            "organizationSlug": "unknown",
            "status": "failed",
            "error": error,
            "detail": error,
            "reasonCode": "TaskStopped",
        },
    }
    try:
        get_sqs_client().send_message(
            QueueUrl=RESULTS_QUEUE_URL,
            MessageBody=json.dumps(body),
            MessageGroupId="agentExperiments",
            MessageDeduplicationId=f"{run_id}-task-stopped",
        )
        logger.info(f"reaped dead task for run {run_id} (stopCode={stop_code}, exit={exit_code})")
    except Exception as e:
        logger.exception(f"failed to send reaper callback for run {run_id} ({type(e).__name__})")
