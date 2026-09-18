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
    monkeypatch.setenv("AUTOPILOT_LIST_IDS", f"{STORY_LIST_ID},{FEATURE_LIST_ID}")
    monkeypatch.setenv("AUTOPILOT_DEDUP_TABLE", "autopilot-dedup-test")
    monkeypatch.setenv("ECS_CLUSTER_ARN", "arn:aws:ecs:us-west-2:1:cluster/autopilot")
    monkeypatch.setenv("ECS_TASK_DEFINITION", "autopilot-agent:1")
    monkeypatch.setenv("ECS_TASK_DEFINITION_PLAYWRIGHT", "autopilot-agent-playwright:1")
    monkeypatch.setenv("SUBNET_IDS", "subnet-1,subnet-2")
    monkeypatch.setenv("SECURITY_GROUP_ID", "sg-1")
    monkeypatch.setenv("AUTOPILOT_SLACK_CHANNEL", "#autopilot-test")


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
        # No epic_task_id: setting one would make this a STORY event under
        # parent-based card typing. The non-vacuous EPIC_SCOPED_STAGES
        # exclusion check lives on the resume test below, where a story
        # legitimately carries a parent that must still not reach the env.
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


def _parked_comment(stage, date="1700000000000"):
    return {"id": "c1", "comment_text": f"[autopilot:parked stage={stage}]\n\n1. Q?", "date": date}


def test_feedback_needed_to_in_progress_dispatches_resume(fake_ecs, monkeypatch):
    monkeypatch.setattr(handler.supervisor, "get_task_comments", lambda task_id: [_parked_comment("qa")])
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
    # The agent's config hard-requires this for a resume run (the first live
    # resume died at startup without it); resolved from the park marker.
    assert vars["RESUME_STAGE"] == "qa"
    assert "EPIC_TASK_ID" not in vars


def test_comment_posted_while_feedback_needed_dispatches_resume(fake_ecs, monkeypatch):
    monkeypatch.setattr(handler.supervisor, "get_task_comments", lambda task_id: [_parked_comment("story")])
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
    assert vars["RESUME_STAGE"] == "story"
    assert "EPIC_TASK_ID" not in vars


def test_resume_without_a_park_marker_is_refused_and_logged(fake_ecs, monkeypatch, capsys):
    # A card dragged back without ever parking (a run that stranded before
    # its park) names no stage to re-enter — a blind resume would guess.
    monkeypatch.setattr(handler.supervisor, "get_task_comments", lambda task_id: [{"comment_text": "hi", "date": "1"}])
    event = make_event(
        STORY_LIST_ID,
        [transition(HUMAN_USER_ID, router.STATUS_FEEDBACK_NEEDED, router.STATUS_IN_PROGRESS)],
        epic_task_id="epic-9",
    )

    handler.route_event(event)

    assert fake_ecs.run_task_calls == []
    assert "no park marker" in capsys.readouterr().out


def test_resume_raises_when_the_comments_read_fails(fake_ecs, monkeypatch):
    # Same retry contract as hydration: the sweep cannot reconstruct this
    # trigger (STORY -> in progress is an ambiguous pair it skips), so only
    # Lambda's async retry can save the event — a swallowed read failure
    # would drop the human's answer silently.
    def boom(task_id):
        raise RuntimeError("clickup down")

    monkeypatch.setattr(handler.supervisor, "get_task_comments", boom)
    event = make_event(
        STORY_LIST_ID,
        [transition(HUMAN_USER_ID, router.STATUS_FEEDBACK_NEEDED, router.STATUS_IN_PROGRESS)],
        epic_task_id="epic-9",
    )

    with pytest.raises(RuntimeError):
        handler.route_event(event)
    assert fake_ecs.run_task_calls == []


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
        "AUTOPILOT_SLACK_CHANNEL": "#autopilot-test",
    }
    call = fake_ecs.run_task_calls[0]
    assert call["launchType"] == "FARGATE"
    assert call["networkConfiguration"]["awsvpcConfiguration"]["assignPublicIp"] == "DISABLED"


# ---------------------------------------------------------------------------
# Story done -> supervisor, not Fargate
# ---------------------------------------------------------------------------


def test_story_done_calls_supervisor_not_fargate(fake_ecs, monkeypatch):
    # The supervisor's own next-story/close-out/stall logic is exercised in
    # test_supervisor.py; this test only pins the wiring — route_event must
    # hand story-done decisions to the supervisor with the right epic id,
    # and must never touch Fargate directly for them.
    calls = []
    monkeypatch.setattr(handler.supervisor, "handle_routed_event", calls.append)
    event = make_event(
        STORY_LIST_ID,
        [transition(HUMAN_USER_ID, router.STATUS_QA, router.STATUS_DONE)],
        epic_task_id="epic-7",
    )

    handler.route_event(event)

    assert fake_ecs.run_task_calls == []
    assert len(calls) == 1
    assert calls[0].task_id == TASK_ID
    assert calls[0].epic_task_id == "epic-7"


def test_breakdown_approval_gate_calls_supervisor_with_its_own_id(fake_ecs, monkeypatch):
    calls = []
    monkeypatch.setattr(handler.supervisor, "handle_routed_event", calls.append)
    event = make_event(
        FEATURE_LIST_ID,
        [transition(HUMAN_USER_ID, router.STATUS_FEEDBACK_NEEDED, router.STATUS_EXECUTING)],
    )

    handler.route_event(event)

    assert fake_ecs.run_task_calls == []
    assert len(calls) == 1
    assert calls[0].task_id == TASK_ID
    assert calls[0].epic_task_id == TASK_ID


def test_breakdown_approval_gate_by_bot_dispatches_nothing(fake_ecs, monkeypatch):
    calls = []
    monkeypatch.setattr(handler.supervisor, "handle_routed_event", calls.append)
    event = make_event(
        FEATURE_LIST_ID,
        [transition(BOT_USER_ID, router.STATUS_FEEDBACK_NEEDED, router.STATUS_EXECUTING)],
    )

    handler.route_event(event)

    assert fake_ecs.run_task_calls == []
    assert calls == []


# ---------------------------------------------------------------------------
# Guard - missing transitioned_at refuses dispatch without a dedup key
# ---------------------------------------------------------------------------


def test_missing_transitioned_at_refuses_dispatch(fake_ecs, capsys):
    event = make_event(
        FEATURE_LIST_ID,
        [
            handler.StatusTransition(
                actor_user_id=HUMAN_USER_ID,
                from_status=router.STATUS_APPROVED_TDD,
                to_status=router.STATUS_IN_PROGRESS,
                transitioned_at=None,
            )
        ],
    )

    handler.route_event(event)

    assert fake_ecs.run_task_calls == []
    assert "refusing to dispatch" in capsys.readouterr().out


def test_comment_posted_without_event_ts_refuses_dispatch(fake_ecs, capsys):
    # A taskCommentPosted delivery with a malformed or missing date yields
    # comment_trigger_key(None) -> None, which must hit the same guard.
    event = make_event(
        STORY_LIST_ID,
        [],
        kind="commentPosted",
        current_status=router.STATUS_FEEDBACK_NEEDED,
        epic_task_id="epic-1",
        event_ts=None,
    )

    handler.route_event(event)

    assert fake_ecs.run_task_calls == []
    assert "refusing to dispatch" in capsys.readouterr().out
