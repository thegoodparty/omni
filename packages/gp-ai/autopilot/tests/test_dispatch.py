"""Unit tests for the DynamoDB claim + ECS Fargate dispatch (dispatch.py).

boto3 is fully faked here — no real AWS calls. See test_router.py for the
routing/gate logic and test_route_event_dispatch.py for the end-to-end wiring
through handler.route_event.
"""

import time

import autopilot_conductor_dispatch as dispatch
import pytest
from botocore.exceptions import ClientError

TASK_ID = "task-abc123"
STAGE = "story"
TRANSITIONED_AT = "1700000000000"


class FakeDynamoDBClient:
    def __init__(self, call_order=None):
        self.items: dict[str, dict] = {}
        self.put_item_calls: list[dict] = []
        self.exception = None
        self._call_order = call_order

    def put_item(self, **kwargs):
        self.put_item_calls.append(kwargs)
        if self._call_order is not None:
            self._call_order.append("put_item")
        if self.exception is not None:
            raise self.exception

        pk = kwargs["Item"]["pk"]["S"]
        existing = self.items.get(pk)
        now = int(time.time())
        if existing is not None and int(existing["expires_at"]["N"]) >= now:
            raise ClientError({"Error": {"Code": "ConditionalCheckFailedException", "Message": "claimed"}}, "PutItem")
        self.items[pk] = kwargs["Item"]


class FakeECSClient:
    def __init__(self, call_order=None):
        self.run_task_calls: list[dict] = []
        self.response = {"tasks": [{"taskArn": "arn:aws:ecs:us-west-2:1:task/abc"}], "failures": []}
        self.exception = None
        self._call_order = call_order

    def run_task(self, **kwargs):
        self.run_task_calls.append(kwargs)
        if self._call_order is not None:
            self._call_order.append("run_task")
        if self.exception is not None:
            raise self.exception
        return self.response


@pytest.fixture
def call_order():
    return []


@pytest.fixture
def fake_dynamodb(call_order):
    return FakeDynamoDBClient(call_order)


@pytest.fixture
def fake_ecs(call_order):
    return FakeECSClient(call_order)


@pytest.fixture(autouse=True)
def boto3_clients(monkeypatch, fake_dynamodb, fake_ecs):
    def factory(service_name, *args, **kwargs):
        if service_name == "dynamodb":
            return fake_dynamodb
        if service_name == "ecs":
            return fake_ecs
        raise AssertionError(f"unexpected client requested: {service_name}")

    monkeypatch.setattr(dispatch.boto3, "client", factory)
    dispatch._dynamodb_client = None
    dispatch._ecs_client = None
    yield
    dispatch._dynamodb_client = None
    dispatch._ecs_client = None


@pytest.fixture(autouse=True)
def ecs_env(monkeypatch):
    monkeypatch.setenv("ECS_CLUSTER_ARN", "arn:aws:ecs:us-west-2:1:cluster/autopilot")
    monkeypatch.setenv("ECS_TASK_DEFINITION", "autopilot-agent:1")
    monkeypatch.setenv("ECS_TASK_DEFINITION_PLAYWRIGHT", "autopilot-agent-playwright:1")
    monkeypatch.setenv("SUBNET_IDS", "subnet-1,subnet-2")
    monkeypatch.setenv("SECURITY_GROUP_ID", "sg-1")
    monkeypatch.setenv("AUTOPILOT_SLACK_CHANNEL", "#autopilot-test")


@pytest.fixture(autouse=True)
def dedup_table_env(monkeypatch):
    monkeypatch.setenv("AUTOPILOT_DEDUP_TABLE", "autopilot-dedup-test")


def envelope(stage=STAGE, epic_task_id=None, max_budget_usd=15.0, deadline_seconds=45 * 60):
    return dispatch.StageEnvelope(
        stage=stage,
        task_id=TASK_ID,
        epic_task_id=epic_task_id,
        model="sonnet",
        max_budget_usd=max_budget_usd,
        deadline_seconds=deadline_seconds,
    )


# ---------------------------------------------------------------------------
# AC6 — envelope assembly
# ---------------------------------------------------------------------------


def test_envelope_carries_every_var(monkeypatch):
    monkeypatch.delenv("AUTOPILOT_SLACK_CHANNEL", raising=False)
    env = envelope(epic_task_id="epic-1").to_environment()
    by_name = {e["name"]: e["value"] for e in env}

    assert by_name == {
        "AUTOPILOT_STAGE": STAGE,
        "CLICKUP_TASK_ID": TASK_ID,
        "AGENT_MODEL": "sonnet",
        "AGENT_MAX_BUDGET_USD": "15.0",
        "AGENT_DEADLINE_SECONDS": str(45 * 60),
        "EPIC_TASK_ID": "epic-1",
    }


def test_envelope_omits_epic_task_id_when_none():
    env = envelope(epic_task_id=None).to_environment()

    assert "EPIC_TASK_ID" not in {e["name"] for e in env}


def test_envelope_forwards_the_conductors_slack_channel(monkeypatch):
    # The agent-side feedback primitives (park, notify) post to this channel,
    # and the task definition carries no channel of its own — the envelope is
    # the only path it can reach the container by.
    monkeypatch.setenv("AUTOPILOT_SLACK_CHANNEL", "C0TEST")
    env = envelope().to_environment()
    by_name = {e["name"]: e["value"] for e in env}

    assert by_name["AUTOPILOT_SLACK_CHANNEL"] == "C0TEST"


def test_envelope_omits_a_blank_slack_channel(monkeypatch):
    monkeypatch.setenv("AUTOPILOT_SLACK_CHANNEL", "   ")
    env = envelope().to_environment()

    assert "AUTOPILOT_SLACK_CHANNEL" not in {e["name"] for e in env}


# ---------------------------------------------------------------------------
# Claim ordering — claim strictly before RunTask
# ---------------------------------------------------------------------------


def test_claim_then_run_task_ordering(call_order, fake_ecs):
    dispatch.dispatch_stage(TASK_ID, STAGE, TRANSITIONED_AT, envelope())

    assert call_order == ["put_item", "run_task"]
    assert len(fake_ecs.run_task_calls) == 1


# ---------------------------------------------------------------------------
# AC3 — duplicate delivery / sweep dispatch once
# ---------------------------------------------------------------------------


def test_duplicate_transition_dispatches_once(fake_ecs):
    # Models both a duplicate webhook redelivery and a sweep re-discovering
    # the same in-flight transition: both go through this exact claim path,
    # keyed on the same (task_id, stage, transitioned_at).
    dispatch.dispatch_stage(TASK_ID, STAGE, TRANSITIONED_AT, envelope())
    result = dispatch.dispatch_stage(TASK_ID, STAGE, TRANSITIONED_AT, envelope())

    assert result == {"dispatched": False, "reason": "already claimed"}
    assert len(fake_ecs.run_task_calls) == 1


def test_different_transition_timestamp_dispatches_again(fake_ecs):
    # A genuine human re-entry (a fresh status transition) gets a fresh key.
    dispatch.dispatch_stage(TASK_ID, STAGE, TRANSITIONED_AT, envelope())
    dispatch.dispatch_stage(TASK_ID, STAGE, "1700000999000", envelope())

    assert len(fake_ecs.run_task_calls) == 2


def test_claim_ttl_outlives_the_stages_own_deadline(fake_dynamodb):
    # A flat, short TTL (e.g. a fixed 900s) would let a ClickUp webhook
    # redelivery (see handler.py's module docstring) reclaim and
    # double-launch a run that is still legitimately executing inside a
    # longer stage deadline like story's 45 minutes. The TTL must always
    # exceed the envelope's own deadline_seconds, not just a fixed window.
    long_deadline_seconds = 45 * 60
    before = int(time.time())

    dispatch.dispatch_stage(TASK_ID, STAGE, TRANSITIONED_AT, envelope(deadline_seconds=long_deadline_seconds))

    pk = dispatch.claim_pk(TASK_ID, STAGE, TRANSITIONED_AT)
    expires_at = int(fake_dynamodb.items[pk]["expires_at"]["N"])
    assert expires_at >= before + long_deadline_seconds + dispatch.DEDUP_TTL_GRACE_SECONDS


# ---------------------------------------------------------------------------
# qa dispatch runs on the Playwright task definition, never the base one
# ---------------------------------------------------------------------------


def test_qa_stage_uses_playwright_task_definition(fake_ecs):
    dispatch.dispatch_stage(TASK_ID, dispatch.QA_STAGE, TRANSITIONED_AT, envelope(stage=dispatch.QA_STAGE))

    call = fake_ecs.run_task_calls[0]
    assert call["taskDefinition"] == "autopilot-agent-playwright:1"
    # The override must name the container the Playwright task definition
    # actually declares — RunTask rejects an override for a container the
    # definition doesn't have, which would fail every qa dispatch at launch.
    assert call["overrides"]["containerOverrides"][0]["name"] == "autopilot-agent-playwright"


def test_non_qa_stage_uses_base_task_definition(fake_ecs):
    dispatch.dispatch_stage(TASK_ID, STAGE, TRANSITIONED_AT, envelope())

    call = fake_ecs.run_task_calls[0]
    assert call["taskDefinition"] == "autopilot-agent:1"
    assert call["overrides"]["containerOverrides"][0]["name"] == "autopilot-agent"


def test_dispatch_refuses_when_slack_channel_unset(monkeypatch, fake_dynamodb, fake_ecs, capsys):
    # Same fail-closed contract as the ECS config vars: the agent-side park
    # and notify primitives hard-require the channel, and a dispatch without
    # it fails inside the container after real work instead of here.
    monkeypatch.delenv("AUTOPILOT_SLACK_CHANNEL", raising=False)

    result = dispatch.dispatch_stage(TASK_ID, STAGE, TRANSITIONED_AT, envelope())

    assert result["dispatched"] is False
    assert result["error"] == "AUTOPILOT_SLACK_CHANNEL not configured; refusing dispatch"
    assert fake_ecs.run_task_calls == []
    assert "ERROR: AUTOPILOT_SLACK_CHANNEL not configured" in capsys.readouterr().out


def test_qa_dispatch_refuses_when_playwright_task_definition_unset(monkeypatch, fake_dynamodb, fake_ecs, capsys):
    monkeypatch.delenv("ECS_TASK_DEFINITION_PLAYWRIGHT", raising=False)

    result = dispatch.dispatch_stage(TASK_ID, dispatch.QA_STAGE, TRANSITIONED_AT, envelope(stage=dispatch.QA_STAGE))

    assert result["dispatched"] is False
    assert result["error"] == "playwright task definition not configured"
    assert fake_ecs.run_task_calls == []
    out = capsys.readouterr().out
    assert "ERROR: playwright task definition not configured" in out
    # Same contract as test_claim_left_in_place_when_launch_fails: the claim
    # is written before the launch attempt and must survive the refusal, so a
    # redelivery cannot re-drive this transition once the env is fixed — the
    # sweep plus a fresh transition is the recovery path.
    assert len(fake_dynamodb.items) == 1
    assert "claim left in place" in out


# ---------------------------------------------------------------------------
# Misconfiguration — fail closed, log loudly
# ---------------------------------------------------------------------------


def test_unconfigured_dedup_table_refuses_dispatch_and_logs(monkeypatch, fake_ecs, capsys):
    monkeypatch.delenv("AUTOPILOT_DEDUP_TABLE", raising=False)

    result = dispatch.dispatch_stage(TASK_ID, STAGE, TRANSITIONED_AT, envelope())

    assert result == {"dispatched": False, "reason": "dedup table not configured"}
    assert fake_ecs.run_task_calls == []
    assert "ERROR: AUTOPILOT_DEDUP_TABLE not configured" in capsys.readouterr().out


def test_ecs_misconfiguration_refuses_launch_and_logs(monkeypatch, fake_ecs, capsys):
    monkeypatch.delenv("ECS_CLUSTER_ARN", raising=False)

    result = dispatch.dispatch_stage(TASK_ID, STAGE, TRANSITIONED_AT, envelope())

    assert result["dispatched"] is False
    assert fake_ecs.run_task_calls == []
    assert "ERROR: ECS configuration is missing" in capsys.readouterr().out


def test_dynamodb_table_unreachable_refuses_dispatch_and_logs(fake_dynamodb, fake_ecs, capsys):
    fake_dynamodb.exception = RuntimeError("DynamoDB unreachable")

    result = dispatch.dispatch_stage(TASK_ID, STAGE, TRANSITIONED_AT, envelope())

    assert result == {"dispatched": False, "reason": "dedup table unavailable"}
    assert fake_ecs.run_task_calls == []
    assert "ERROR: dedup table unavailable, refusing to dispatch" in capsys.readouterr().out


# ---------------------------------------------------------------------------
# Claim survives a failed launch (step 5: no rollback on RunTask failure)
# ---------------------------------------------------------------------------


def test_claim_left_in_place_when_launch_fails(fake_dynamodb, fake_ecs, capsys):
    fake_ecs.exception = RuntimeError("ECS unavailable")

    result = dispatch.dispatch_stage(TASK_ID, STAGE, TRANSITIONED_AT, envelope())

    assert result["dispatched"] is False
    assert len(fake_dynamodb.items) == 1  # the claim from before the failed launch
    assert "claim left in place" in capsys.readouterr().out
    calls_after_failed_launch = len(fake_ecs.run_task_calls)

    # A retry within the SAME transition must not re-launch either — the
    # claim it left behind still stands, so run_task is never called again.
    dispatch.dispatch_stage(TASK_ID, STAGE, TRANSITIONED_AT, envelope())
    assert len(fake_ecs.run_task_calls) == calls_after_failed_launch
