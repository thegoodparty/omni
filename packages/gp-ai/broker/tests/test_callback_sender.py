import json
import logging
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from broker.callback_sender import CallbackSender


class TestCallbackSenderMessageBody:
    def test_send_result_constructs_correct_body(self):
        sqs = MagicMock()
        sender = CallbackSender(sqs_client=sqs, queue_url="https://sqs.example.com/queue.fifo")

        sender.send_result(
            run_id="run-001",
            organization_slug="org-42",
            experiment_id="voter_targeting",
            status="success",
            artifact_key="voter_targeting/org-42/latest.json",
            artifact_bucket="gp-agent-artifacts-dev",
            duration_seconds=120.5,
            cost_usd=0.03,
        )

        sqs.send_message.assert_called_once()
        call_kwargs = sqs.send_message.call_args[1]
        body = json.loads(call_kwargs["MessageBody"])

        assert body["type"] == "agentExperimentResult"
        assert body["data"]["experimentId"] == "voter_targeting"
        assert body["data"]["runId"] == "run-001"
        assert body["data"]["organizationSlug"] == "org-42"
        assert body["data"]["status"] == "success"
        assert body["data"]["artifactKey"] == "voter_targeting/org-42/latest.json"
        assert body["data"]["artifactBucket"] == "gp-agent-artifacts-dev"
        assert body["data"]["durationSeconds"] == 120.5
        assert body["data"]["costUsd"] == 0.03
        assert body["data"]["reasonCode"] == ""
        assert body["data"]["detail"] == ""


class TestCallbackSenderDedupId:
    def test_dedup_id_format(self):
        sqs = MagicMock()
        sender = CallbackSender(sqs_client=sqs, queue_url="https://sqs.example.com/queue.fifo")

        sender.send_result(
            run_id="run-001",
            organization_slug="org-42",
            experiment_id="voter_targeting",
            status="failed",
        )

        call_kwargs = sqs.send_message.call_args[1]
        assert call_kwargs["MessageDeduplicationId"] == "run-001-failed"
        assert call_kwargs["MessageGroupId"] == "run-001"
        assert call_kwargs["QueueUrl"] == "https://sqs.example.com/queue.fifo"


class TestCallbackSenderErrorPropagation:
    def test_sqs_error_propagates(self):
        sqs = MagicMock()
        sqs.send_message.side_effect = Exception("SQS connection refused")
        sender = CallbackSender(sqs_client=sqs, queue_url="https://sqs.example.com/queue.fifo")

        with pytest.raises(Exception, match="SQS connection refused"):
            sender.send_result(
                run_id="run-001",
                organization_slug="org-42",
                experiment_id="voter_targeting",
                status="success",
            )


class TestCallbackSenderFailureFields:
    def test_send_result_with_failure_fields(self):
        sqs = MagicMock()
        sender = CallbackSender(sqs_client=sqs, queue_url="https://sqs.example.com/queue.fifo")

        sender.send_result(
            run_id="run-002",
            organization_slug="org-99",
            experiment_id="district_intel",
            status="failed",
            reason_code="timeout",
            detail="Agent exceeded 4h limit",
        )

        call_kwargs = sqs.send_message.call_args[1]
        body = json.loads(call_kwargs["MessageBody"])
        assert body["data"]["status"] == "failed"
        assert body["data"]["reasonCode"] == "timeout"
        assert body["data"]["detail"] == "Agent exceeded 4h limit"


class TestCallbackSenderFailureCarriesDurationAndCost:
    """gp-api's ExperimentRun.durationSeconds and .costUsd were always 0 for
    failed runs because the runner didn't forward the numbers and the broker
    defaulted them to 0. Lock in that when the broker passes real values to
    send_result, they land on the SQS envelope as camelCase for gp-api's zod
    schema.
    """

    def test_failed_callback_includes_duration_and_cost(self):
        sqs = MagicMock()
        sender = CallbackSender(sqs_client=sqs, queue_url="https://sqs.example.com/queue.fifo")

        sender.send_result(
            run_id="run-fail-dc",
            organization_slug="org-7",
            experiment_id="voter_targeting",
            status="failed",
            reason_code="Timeout",
            detail="Agent exceeded limit",
            duration_seconds=42.5,
            cost_usd=0.37,
        )

        body = json.loads(sqs.send_message.call_args[1]["MessageBody"])
        assert body["data"]["status"] == "failed"
        assert body["data"]["durationSeconds"] == 42.5
        assert body["data"]["costUsd"] == 0.37


class TestCallbackSenderErrorFieldBackCompat:
    """gp-api's queue consumer reads `data.error` to populate the
    ExperimentRun.error column (the only user-visible failure message in the
    webapp). The runner stopped sending `error` when it switched to
    reason_code/detail — every failure callback lost its error text in the UI.
    This test locks in that the callback body always carries `error` populated
    with detail.
    """

    def test_failed_callback_includes_error_field_for_backcompat(self):
        sqs = MagicMock()
        sender = CallbackSender(sqs_client=sqs, queue_url="https://sqs.example.com/queue.fifo")

        sender.send_result(
            run_id="run-003",
            organization_slug="org-7",
            experiment_id="voter_targeting",
            status="failed",
            reason_code="Timeout",
            detail="Agent exceeded 600s limit",
        )

        body = json.loads(sqs.send_message.call_args[1]["MessageBody"])
        # gp-api reads data.error; keep populated with the same text as detail.
        assert body["data"]["error"] == "Agent exceeded 600s limit"
        # Structured fields still present — gp-api's current schema ignores
        # them but they're on the wire for future consumption.
        assert body["data"]["reasonCode"] == "Timeout"
        assert body["data"]["detail"] == "Agent exceeded 600s limit"

    def test_success_callback_has_empty_error_field(self):
        """Success runs carry an empty error — gp-api's schema treats missing
        as undefined, which throws under strict zod parsing. Always present."""
        sqs = MagicMock()
        sender = CallbackSender(sqs_client=sqs, queue_url="https://sqs.example.com/queue.fifo")

        sender.send_result(
            run_id="run-004",
            organization_slug="org-7",
            experiment_id="voter_targeting",
            status="success",
        )

        body = json.loads(sqs.send_message.call_args[1]["MessageBody"])
        assert body["data"]["error"] == ""

    def test_contract_violation_callback_includes_error_field(self):
        sqs = MagicMock()
        sender = CallbackSender(sqs_client=sqs, queue_url="https://sqs.example.com/queue.fifo")

        sender.send_result(
            run_id="run-005",
            organization_slug="org-7",
            experiment_id="voter_targeting",
            status="contract_violation",
            reason_code="ContractViolation",
            detail="Missing required field: voters[0].address",
        )

        body = json.loads(sqs.send_message.call_args[1]["MessageBody"])
        assert body["data"]["error"] == "Missing required field: voters[0].address"


class TestCallbackSenderMessageGroupId:
    """FIFO queues serialize by MessageGroupId. Using a single static group
    ("agentExperiments") means one poison-pill message blocks every other
    callback. Per-run_id groups keep ordering within a run (running ->
    success/failed) but isolate runs from each other."""

    def test_message_group_id_is_run_id(self):
        sqs = MagicMock()
        sender = CallbackSender(sqs_client=sqs, queue_url="https://sqs.example.com/queue.fifo")

        sender.send_result(
            run_id="run-abc-123",
            organization_slug="org-42",
            experiment_id="voter_targeting",
            status="success",
        )

        call_kwargs = sqs.send_message.call_args[1]
        assert call_kwargs["MessageGroupId"] == "run-abc-123"
        assert call_kwargs["MessageGroupId"] != "agentExperiments"

    def test_two_different_runs_use_different_group_ids(self):
        sqs = MagicMock()
        sender = CallbackSender(sqs_client=sqs, queue_url="https://sqs.example.com/queue.fifo")

        sender.send_result(
            run_id="run-alpha",
            organization_slug="org-1",
            experiment_id="voter_targeting",
            status="success",
        )
        sender.send_result(
            run_id="run-beta",
            organization_slug="org-2",
            experiment_id="voter_targeting",
            status="success",
        )

        assert sqs.send_message.call_count == 2
        first_group = sqs.send_message.call_args_list[0][1]["MessageGroupId"]
        second_group = sqs.send_message.call_args_list[1][1]["MessageGroupId"]
        assert first_group == "run-alpha"
        assert second_group == "run-beta"
        assert first_group != second_group


class TestCallbackSenderSqsFailureLogging:
    def test_sqs_send_failure_logs_and_reraises(self, caplog):
        queue_url = "https://sqs.example.com/queue.fifo"
        sqs = MagicMock()
        sqs.send_message.side_effect = ClientError(
            {"Error": {"Code": "ThrottlingException", "Message": "rate"}},
            "SendMessage",
        )
        sender = CallbackSender(sqs_client=sqs, queue_url=queue_url)

        with caplog.at_level(logging.ERROR, logger="broker.callback_sender"):
            with pytest.raises(ClientError):
                sender.send_result(
                    run_id="run-abc",
                    organization_slug="org-42",
                    experiment_id="voter_targeting",
                    status="failed",
                    reason_code="AgentError",
                    detail="agent crashed",
                )

        error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
        assert len(error_records) >= 1, "expected an ERROR-level log record for SQS failure"
        record = error_records[0]
        message = record.getMessage()
        assert "run-abc" in message
        assert "failed" in message
        assert queue_url in message or "SendMessage" in message
        assert record.exc_info is not None


class TestCallbackSenderOmitsAnUnmeasuredCost:
    """`costUsd` is the one envelope field that must be able to say "unknown".
    Every other field has a meaningful empty value; a cost does not — 0 reads
    as a free run, and the cost is printed beside a verdict as evidence.

    It is OMITTED rather than sent as null because gp-api's zod field is
    `z.number().optional()`: a missing key parses, an explicit null does not,
    and a callback that fails to parse dead-letters and leaves the run row
    non-terminal forever. Its consumer writes `data.costUsd ?? null`, so the
    omission lands as a null column — the representation of "unknown" that
    `AgentRun.schema.ts` already declares.
    """

    def test_default_omits_the_cost_key(self):
        sqs = MagicMock()
        sender = CallbackSender(sqs_client=sqs, queue_url="https://sqs.example.com/q.fifo")

        sender.send_result(
            run_id="run-no-cost",
            organization_slug="org-7",
            experiment_id="voter_targeting",
            status="failed",
        )

        body = json.loads(sqs.send_message.call_args[1]["MessageBody"])
        assert "costUsd" not in body["data"]

    def test_an_explicit_none_omits_the_cost_key(self):
        """The shape the broker's own endpoints pass through: the runner
        withheld the figure, so there is nothing to report."""
        sqs = MagicMock()
        sender = CallbackSender(sqs_client=sqs, queue_url="https://sqs.example.com/q.fifo")

        sender.send_result(
            run_id="run-withheld",
            organization_slug="org-7",
            experiment_id="voter_targeting",
            status="failed",
            cost_usd=None,
        )

        body = json.loads(sqs.send_message.call_args[1]["MessageBody"])
        assert "costUsd" not in body["data"]

    def test_an_observed_zero_is_sent(self):
        """A measured zero is a measurement. Only absence is absent — a falsy
        guard here would collapse the two back together."""
        sqs = MagicMock()
        sender = CallbackSender(sqs_client=sqs, queue_url="https://sqs.example.com/q.fifo")

        sender.send_result(
            run_id="run-free",
            organization_slug="org-7",
            experiment_id="voter_targeting",
            status="success",
            cost_usd=0.0,
        )

        body = json.loads(sqs.send_message.call_args[1]["MessageBody"])
        assert body["data"]["costUsd"] == 0.0


class TestCallbackSenderNoQaVerdictOnCallback:
    """gp-api is DROPPED as a consumer of the QA verdict — its SQS callback
    schema strips qaVerdict, so forwarding it on the callback is dead weight.
    The verdict's system of record is now the broker's durable S3 write
    (`<exp>/<run>/qa/verdict.json`). The
    callback must NEVER carry a `qaVerdict` key, and `send_result` must no
    longer accept a `qa_verdict` parameter at all.
    """

    def test_success_callback_never_carries_qa_verdict_key(self):
        """Even on a fully-populated success callback, the SQS `data` envelope
        carries no `qaVerdict` key — the verdict does not ride the callback."""
        sqs = MagicMock()
        sender = CallbackSender(sqs_client=sqs, queue_url="https://sqs.example.com/queue.fifo")

        sender.send_result(
            run_id="run-qa-1",
            organization_slug="org-7",
            experiment_id="voter_targeting",
            status="success",
            artifact_key="voter_targeting/run-qa-1/artifact.json",
            artifact_bucket="gp-agent-artifacts-dev",
            # `costUsd` and `durationSeconds` are on the envelope only when
            # actually observed, so a fully-populated callback has to pass both
            # for this to still be the FULL key set.
            cost_usd=0.21,
            duration_seconds=12.5,
        )

        body = json.loads(sqs.send_message.call_args[1]["MessageBody"])
        assert "qaVerdict" not in body["data"]
        # Pin the FULL data envelope key set — exactly these 11 keys, with no
        # qaVerdict and no accidental new key.
        assert set(body["data"].keys()) == {
            "experimentId",
            "runId",
            "organizationSlug",
            "status",
            "artifactKey",
            "artifactBucket",
            "durationSeconds",
            "costUsd",
            "reasonCode",
            "detail",
            "error",
        }

    def test_send_result_does_not_accept_qa_verdict_parameter(self):
        """The qa_verdict parameter is REMOVED. Passing it must raise a
        TypeError — there is no longer any path for the verdict onto the
        callback."""
        sqs = MagicMock()
        sender = CallbackSender(sqs_client=sqs, queue_url="https://sqs.example.com/queue.fifo")

        with pytest.raises(TypeError):
            sender.send_result(
                run_id="run-qa-reject",
                organization_slug="org-7",
                experiment_id="voter_targeting",
                status="success",
                qa_verdict={"pass": False},
            )


class TestAnUnmeasuredDurationIsOmittedNotZero:
    """Duration had the defect cost had, one line apart in run_status.py: an
    absent duration became a measured-looking 0 seconds. And it has to be
    OMITTED rather than sent as null, because gp-api's field is
    `durationSeconds: z.number().optional()` — which accepts a missing key and
    rejects a null, and a rejected callback dead-letters the run forever."""

    def _data(self, **kwargs) -> dict:
        sqs = MagicMock()
        sender = CallbackSender(sqs_client=sqs, queue_url="https://sqs.example.com/queue.fifo")
        sender.send_result(
            run_id="run-1", organization_slug="org-1", experiment_id="voter_targeting", status="failed", **kwargs
        )
        return json.loads(sqs.send_message.call_args[1]["MessageBody"])["data"]

    def test_an_unmeasured_duration_leaves_the_key_out(self):
        assert "durationSeconds" not in self._data()
        assert "durationSeconds" not in self._data(duration_seconds=None)

    def test_a_measured_duration_is_sent(self):
        assert self._data(duration_seconds=42.5)["durationSeconds"] == 42.5

    def test_a_measured_zero_survives_as_zero(self):
        """0 is a real measurement and must not be confused with an absence."""
        assert self._data(duration_seconds=0.0)["durationSeconds"] == 0.0
