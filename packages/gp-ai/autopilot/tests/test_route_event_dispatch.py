"""End-to-end tests for handler.route_event: router.route() decisions wired
through to dispatch.dispatch_stage's claim + Fargate launch.

Covers ENG-11092's acceptance criteria at the wiring level. router.py's own
routing/gate logic is unit-tested in test_router.py; dispatch.py's claim/
launch logic is unit-tested in test_dispatch.py. boto3 is fully faked here —
no real AWS calls.
"""

import time

import autopilot_conductor_dispatch as dispatch
import autopilot_conductor_handler as handler
import autopilot_conductor_router as router
import pytest
from botocore.exceptions import ClientError

BOT_USER_ID = "bot-42"
HUMAN_USER_ID = "human-7"
STORY_LIST_ID = "901300000777"
FEATURE_LIST_ID = "901300000001"
TASK_ID = "task-abc123"


class FakeDynamoDBClient:
    def __init__(self):
        self.items: dict[str, dict] = {}

    def put_item(self, **kwargs):
        pk = kwargs["Item"]["pk"]["S"]
        existing = self.items.get(pk)
        now = int(time.time())
        if existing is not None and int(existing["expires_at"]["N"]) >= now:
            raise ClientError({"Error": {"Code": "ConditionalCheckFailedException", "Message": "claimed"}}, "PutItem")
        self.items[pk] = kwargs["Item"]


class FakeECSClient:
    def __init__(self):
        self.run_task_calls: list[dict] = []

    def run_task(self, **kwargs):
        self.run_task_calls.append(kwargs)
        return {"tasks": [{"taskArn": "arn:aws:ecs:us-west-2:1:task/abc"}], "failures": []}


@pytest.fixture
def fake_dynamodb():
    return FakeDynamoDBClient()


@pytest.fixture
def fake_ecs():
    return FakeECSClient()


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
def env(monkeypatch):
    monkeypatch.setenv("AUTOPILOT_BOT_USER_ID", BOT_USER_ID)
    monkeypatch.setenv("AUTOPILOT_STORY_LIST_IDS", STORY_LIST_ID)
    monkeypatch.setenv("AUTOPILOT_LIST_IDS", f"{STORY_LIST_ID},{FEATURE_LIST_ID}")
    monkeypatch.setenv("AUTOPILOT_DEDUP_TABLE", "autopilot-dedup-test")
    monkeypatch.setenv("ECS_CLUSTER_ARN", "arn:aws:ecs:us-west-2:1:cluster/autopilot")
    monkeypatch.setenv("ECS_TASK_DEFINITION", "autopilot-agent:1")
    monkeypatch.setenv("SUBNET_IDS", "subnet-1,subnet-2")
    monkeypatch.setenv("SECURITY_GROUP_ID", "sg-1")


def make_event(
    list_id,
    transitions,
    kind="statusUpdated",
    current_status=None,
    epic_task_id=None,
    task_id=TASK_ID,
    event_ts=None,
):
    return handler.AutopilotEvent(
        kind=kind,
        task_id=task_id,
        list_id=list_id,
        transitions=transitions,
        current_status=current_status,
        epic_task_id=epic_task_id,
        event_ts=event_ts,
    )


def transition(actor_user_id, from_status, to_status, transitioned_at="1700000000000"):
    return handler.StatusTransition(
        actor_user_id=actor_user_id,
        from_status=from_status,
        to_status=to_status,
        transitioned_at=transitioned_at,
    )


def env_vars(run_task_call: dict) -> dict:
    return {e["name"]: e["value"] for e in run_task_call["overrides"]["containerOverrides"][0]["environment"]}


# ---------------------------------------------------------------------------
# AC1 / AC2 — epic-create gate
# ---------------------------------------------------------------------------


def test_human_gate_transition_dispatches_exactly_one_epic_create_run(fake_ecs):
    event = make_event(
        FEATURE_LIST_ID,
        [transition(HUMAN_USER_ID, router.STATUS_APPROVED_TDD, router.STATUS_IN_PROGRESS)],
        # Set even though epic-create never carries one: this actually
        # exercises the "story/qa only" exclusion (router.EPIC_SCOPED_STAGES)
        # rather than passing vacuously because the field defaulted to None.
        epic_task_id="epic-should-not-appear",
    )

    handler.route_event(event)

    assert len(fake_ecs.run_task_calls) == 1
    vars = env_vars(fake_ecs.run_task_calls[0])
    assert vars["AUTOPILOT_STAGE"] == router.STAGE_EPIC_CREATE
    assert vars["CLICKUP_TASK_ID"] == TASK_ID
    assert "EPIC_TASK_ID" not in vars


def test_bot_actor_gate_transition_dispatches_nothing(fake_ecs):
    event = make_event(
        FEATURE_LIST_ID,
        [transition(BOT_USER_ID, router.STATUS_APPROVED_TDD, router.STATUS_IN_PROGRESS)],
    )

    handler.route_event(event)

    assert fake_ecs.run_task_calls == []


# ---------------------------------------------------------------------------
# AC3 — duplicate webhook delivery / sweep re-discovery dispatch once
# ---------------------------------------------------------------------------


def test_duplicate_webhook_delivery_dispatches_once(fake_ecs):
    # Same event object twice: a genuine ClickUp redelivery of one webhook,
    # and (since it shares the exact same claim path) also stands in for a
    # sweep re-discovering the same in-flight transition.
    event = make_event(
        FEATURE_LIST_ID,
        [transition(HUMAN_USER_ID, router.STATUS_APPROVED_TDD, router.STATUS_IN_PROGRESS)],
    )

    handler.route_event(event)
    handler.route_event(event)

    assert len(fake_ecs.run_task_calls) == 1


# ---------------------------------------------------------------------------
# AC4 — story to qa, bot actor is a legitimate non-gate trigger
# ---------------------------------------------------------------------------


def test_story_landing_in_qa_by_bot_dispatches_qa_run(fake_ecs):
    event = make_event(
        STORY_LIST_ID,
        [transition(BOT_USER_ID, router.STATUS_IN_PROGRESS, router.STATUS_QA)],
        epic_task_id="epic-1",
    )

    handler.route_event(event)

    assert len(fake_ecs.run_task_calls) == 1
    vars = env_vars(fake_ecs.run_task_calls[0])
    assert vars["AUTOPILOT_STAGE"] == router.STAGE_QA
    assert vars["EPIC_TASK_ID"] == "epic-1"


# ---------------------------------------------------------------------------
# AC5 — resume
# ---------------------------------------------------------------------------


def test_feedback_needed_to_in_progress_dispatches_resume(fake_ecs):
    event = make_event(
        STORY_LIST_ID,
        [transition(HUMAN_USER_ID, router.STATUS_FEEDBACK_NEEDED, router.STATUS_IN_PROGRESS)],
        # Set even though resume never carries one (router.EPIC_SCOPED_STAGES
        # is story/qa only) — see the epic-create test above for why.
        epic_task_id="epic-should-not-appear",
    )

    handler.route_event(event)

    assert len(fake_ecs.run_task_calls) == 1
    vars = env_vars(fake_ecs.run_task_calls[0])
    assert vars["AUTOPILOT_STAGE"] == router.STAGE_RESUME
    assert "EPIC_TASK_ID" not in vars


def test_comment_posted_while_feedback_needed_dispatches_resume(fake_ecs):
    # Production shape: taskCommentPosted has no history_items at all.
    event = make_event(
        STORY_LIST_ID,
        [],
        kind="commentPosted",
        current_status=router.STATUS_FEEDBACK_NEEDED,
        epic_task_id="epic-should-not-appear",
        event_ts="1700000555000",
    )

    handler.route_event(event)

    assert len(fake_ecs.run_task_calls) == 1
    vars = env_vars(fake_ecs.run_task_calls[0])
    assert vars["AUTOPILOT_STAGE"] == router.STAGE_RESUME
    assert "EPIC_TASK_ID" not in vars


# ---------------------------------------------------------------------------
# AC6 — full envelope + per-stage ceilings on the run_task call
# ---------------------------------------------------------------------------


def test_container_overrides_carry_full_envelope_and_ceiling(fake_ecs):
    event = make_event(
        STORY_LIST_ID,
        [transition(BOT_USER_ID, router.STATUS_IN_PROGRESS, router.STATUS_QA)],
        epic_task_id="epic-9",
    )

    handler.route_event(event)

    vars = env_vars(fake_ecs.run_task_calls[0])
    assert vars == {
        "AUTOPILOT_STAGE": router.STAGE_QA,
        "CLICKUP_TASK_ID": TASK_ID,
        "AGENT_MODEL": router.DEFAULT_AGENT_MODEL,
        "AGENT_MAX_BUDGET_USD": "8.0",
        "AGENT_DEADLINE_SECONDS": str(30 * 60),
        "EPIC_TASK_ID": "epic-9",
    }
    call = fake_ecs.run_task_calls[0]
    assert call["launchType"] == "FARGATE"
    assert call["networkConfiguration"]["awsvpcConfiguration"]["assignPublicIp"] == "DISABLED"


# ---------------------------------------------------------------------------
# Test plan — story-done routes to the supervisor stub, not Fargate
# ---------------------------------------------------------------------------


def test_story_done_calls_supervisor_stub_not_fargate(fake_ecs, capsys):
    event = make_event(
        STORY_LIST_ID,
        [transition(HUMAN_USER_ID, router.STATUS_QA, router.STATUS_DONE)],
    )

    handler.route_event(event)

    assert fake_ecs.run_task_calls == []
    assert "supervisor not yet implemented" in capsys.readouterr().out
