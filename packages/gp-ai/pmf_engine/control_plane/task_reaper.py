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
    # callback would only log `Experiment run not found`. Suppress the
    # NOTIFICATION, and only the notification: a judge run now reaches the same
    # liveness verdict off the same fields as a product one, and stops short of
    # the send. The earlier top-of-handler skip collapsed the two, so an
    # OOM-killed judge task logged a single line carrying no exit code, no
    # stopCode and no stoppedReason — indistinguishable from a clean finish,
    # which is the one thing this reaper exists to tell apart.
    #
    # No TTL is involved, in either direction, and none is wanted: this Lambda
    # is an EventBridge target on ECS Task State Change with lastStatus=STOPPED
    # (see infrastructure/modules/pmf-engine-control-plane/main.tf), so it only
    # ever sees tasks that have ALREADY stopped, and its role is granted
    # sqs:SendMessage and nothing else. It cannot stop a live task — not a judge
    # one, not a product one. What bounds a runaway task is the runner's own
    # `asyncio.wait_for(timeout=config.timeout_seconds)` plus `_hard_exit(1)`
    # in runner/main.py, which is identical for both, so a judge run needs no
    # timeout of its own here.
    if run_id.startswith(JUDGE_RUN_ID_PREFIX):
        # `stoppedReason` is the one field here an outside caller writes freely
        # — `ecs:StopTask --reason` takes 255 characters of arbitrary text — so
        # it is the one field bounded and `!r`-quoted, which is what stops a
        # newline in it from forging a second log line. `run_id` and `stop_code`
        # go in raw, exactly as the two product lines below interpolate them:
        # ECS caps `startedBy` at 36 characters on write and `stopCode` is a
        # closed enum, so there is nothing to bound, and guarding them here but
        # not there would only make the difference look meaningful. `str()`
        # first because slicing a non-string would raise in a handler that has
        # no outer guard.
        #
        # `reason=` is the suppression reason and matches the other two
        # suppression sites (`scheduler_handler._send_callback`, the broker's
        # `run_status`) so one query spans all three; the ECS field is spelled
        # `stoppedReason` so the two cannot be confused during an incident.
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
