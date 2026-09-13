"""Unit tests for the reconciliation sweep (sweep.py).

ClickUp (plain HTTP), DynamoDB, and ECS are all faked here — no real network
calls. See test_supervisor.py for the epic-tick logic the sweep also
triggers for executing feature cards.
"""

import time

import autopilot_conductor_dispatch as dispatch
import autopilot_conductor_handler as handler
import autopilot_conductor_router as router
import autopilot_conductor_sweep as sweep
import pytest
from botocore.exceptions import ClientError

STORY_LIST_ID = "901300000777"
FEATURE_LIST_ID = "901300000001"
BOT_USER_ID = "bot-42"
HUMAN_USER_ID = "human-7"


class FakeDynamoDBClient:
    def __init__(self):
        self.items: dict[str, dict] = {}

    def put_item(self, TableName, Item, ConditionExpression=None, **kwargs):
        pk = Item["pk"]["S"]
        existing = self.items.get(pk)
        now = int(time.time())
        if ConditionExpression is not None and existing is not None and int(existing["expires_at"]["N"]) >= now:
            raise ClientError({"Error": {"Code": "ConditionalCheckFailedException", "Message": "claimed"}}, "PutItem")
        self.items[pk] = Item

    def get_item(self, TableName, Key, **kwargs):
        item = self.items.get(Key["pk"]["S"])
        return {"Item": item} if item is not None else {}

    def delete_item(self, TableName, Key, **kwargs):
        self.items.pop(Key["pk"]["S"], None)


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
    monkeypatch.setenv("AUTOPILOT_CLICKUP_API_KEY", "test-clickup-key")


class FakeClickUp:
    def __init__(self):
        # Two separate registries, mirroring the two real, differently-
        # filtered ClickUp queries sweep.py issues against the same
        # /list/{id}/task endpoint: list_tasks answers the lookback-scanned
        # "recently updated" query, executing_tasks answers the dedicated,
        # unconditional "currently executing" query.
        self.list_tasks: dict[str, list[dict]] = {}
        self.executing_tasks: dict[str, list[dict]] = {}
        self.comments: dict[str, list[dict]] = {}

    def request(self, method, endpoint, data=None):
        if method == "GET" and endpoint.startswith("/list/") and "/task?" in endpoint:
            list_id, query = endpoint.split("/list/", 1)[1].split("/task?", 1)
            if "statuses" in query:
                return {"tasks": self.executing_tasks.get(list_id, [])}
            return {"tasks": self.list_tasks.get(list_id, [])}
        if method == "GET" and endpoint.endswith("/comment"):
            task_id = endpoint.split("/task/", 1)[1].split("/comment", 1)[0]
            return {"comments": self.comments.get(task_id, [])}
        raise AssertionError(f"no fake response registered for {method} {endpoint}")


@pytest.fixture(autouse=True)
def fake_clickup(monkeypatch):
    fake = FakeClickUp()
    monkeypatch.setattr(sweep.supervisor, "clickup_request", fake.request)
    return fake


def now_ms() -> int:
    return int(time.time() * 1000)


def task(task_id, status, date_updated=None, parent=None):
    return {
        "id": task_id,
        "status": {"status": status},
        "date_updated": str(date_updated if date_updated is not None else now_ms()),
        "parent": parent,
    }


def env_vars(run_task_call: dict) -> dict:
    return {e["name"]: e["value"] for e in run_task_call["overrides"]["containerOverrides"][0]["environment"]}


# ---------------------------------------------------------------------------
# Lookback window
# ---------------------------------------------------------------------------


def test_missed_transition_inside_lookback_dispatches_once(fake_clickup, fake_ecs):
    fake_clickup.list_tasks[FEATURE_LIST_ID] = [
        task("epic-1", router.STATUS_IN_PROGRESS, date_updated=now_ms() - 60_000)
    ]
    fake_clickup.comments["epic-1"] = []  # no evidence the bot touched it

    result = sweep.handle_sweep({"autopilot_sweep": True})

    assert len(fake_ecs.run_task_calls) == 1
    assert env_vars(fake_ecs.run_task_calls[0])["AUTOPILOT_STAGE"] == router.STAGE_EPIC_CREATE
    assert result["statusCode"] == 200


def test_task_outside_lookback_window_is_not_dispatched(fake_clickup, fake_ecs, monkeypatch):
    monkeypatch.setenv("SWEEP_LOOKBACK_MINUTES", "45")
    stale_ms = now_ms() - 46 * 60 * 1000
    fake_clickup.list_tasks[FEATURE_LIST_ID] = [task("epic-1", router.STATUS_IN_PROGRESS, date_updated=stale_ms)]
    fake_clickup.comments["epic-1"] = []

    sweep.handle_sweep({"autopilot_sweep": True})

    assert fake_ecs.run_task_calls == []


def test_task_inside_lookback_window_boundary_is_dispatched(fake_clickup, fake_ecs, monkeypatch):
    monkeypatch.setenv("SWEEP_LOOKBACK_MINUTES", "45")
    fresh_ms = now_ms() - 44 * 60 * 1000
    fake_clickup.list_tasks[FEATURE_LIST_ID] = [task("epic-1", router.STATUS_IN_PROGRESS, date_updated=fresh_ms)]
    fake_clickup.comments["epic-1"] = []

    sweep.handle_sweep({"autopilot_sweep": True})

    assert len(fake_ecs.run_task_calls) == 1


# ---------------------------------------------------------------------------
# Overlap with the webhook path / a previous sweep = one dispatch total
# ---------------------------------------------------------------------------


def test_sweep_and_webhook_overlap_share_one_dedup_key(fake_clickup, fake_ecs):
    fake_clickup.list_tasks[FEATURE_LIST_ID] = [task("epic-1", router.STATUS_IN_PROGRESS)]
    fake_clickup.comments["epic-1"] = []

    # A webhook delivery for the exact same transition (same from/to status,
    # same transitioned_at derived from date_updated) claims first.
    envelope = dispatch.StageEnvelope(
        stage=router.STAGE_EPIC_CREATE,
        task_id="epic-1",
        epic_task_id=None,
        model=router.DEFAULT_AGENT_MODEL,
        max_budget_usd=10.0,
        deadline_seconds=30 * 60,
    )
    transitioned_at = str(int(task("epic-1", router.STATUS_IN_PROGRESS)["date_updated"]))
    dispatch.dispatch_stage("epic-1", router.STAGE_EPIC_CREATE, transitioned_at, envelope)
    assert len(fake_ecs.run_task_calls) == 1

    sweep.handle_sweep({"autopilot_sweep": True})

    assert len(fake_ecs.run_task_calls) == 1  # sweep's own claim attempt lost the race


def test_repeated_sweep_passes_dispatch_once(fake_clickup, fake_ecs):
    fake_clickup.list_tasks[FEATURE_LIST_ID] = [task("epic-1", router.STATUS_IN_PROGRESS)]
    fake_clickup.comments["epic-1"] = []

    sweep.handle_sweep({"autopilot_sweep": True})
    sweep.handle_sweep({"autopilot_sweep": True})

    assert len(fake_ecs.run_task_calls) == 1


# ---------------------------------------------------------------------------
# Trigger cap
# ---------------------------------------------------------------------------


def test_trigger_cap_respected_and_logged(fake_clickup, fake_ecs, monkeypatch, capsys):
    monkeypatch.setenv("SWEEP_MAX_TRIGGERS", "1")
    fake_clickup.list_tasks[FEATURE_LIST_ID] = [
        task("epic-1", router.STATUS_IN_PROGRESS),
        task("epic-2", router.STATUS_IN_PROGRESS),
    ]
    fake_clickup.comments["epic-1"] = []
    fake_clickup.comments["epic-2"] = []

    sweep.handle_sweep({"autopilot_sweep": True})

    assert len(fake_ecs.run_task_calls) == 1
    assert "ERROR: sweep hit its cap of 1 triggers" in capsys.readouterr().out


# ---------------------------------------------------------------------------
# Actor check still enforced on sweep-discovered gate transitions
# ---------------------------------------------------------------------------


def test_gate_transition_by_bot_actor_is_not_dispatched(fake_clickup, fake_ecs):
    fake_clickup.list_tasks[FEATURE_LIST_ID] = [task("epic-1", router.STATUS_IN_PROGRESS)]
    # The bot itself is the last commenter — the only signal available to a
    # poll — so this must be treated as a bot-authored transition.
    fake_clickup.comments["epic-1"] = [{"user": {"id": BOT_USER_ID}}]

    sweep.handle_sweep({"autopilot_sweep": True})

    assert fake_ecs.run_task_calls == []


def test_gate_transition_with_no_comment_evidence_still_dispatches(fake_clickup, fake_ecs):
    # No comments at all — no evidence of bot involvement — must fail toward
    # treating the transition as human-triggered, not toward silently
    # dropping real work.
    fake_clickup.list_tasks[FEATURE_LIST_ID] = [task("epic-1", router.STATUS_IN_PROGRESS)]
    fake_clickup.comments["epic-1"] = []

    sweep.handle_sweep({"autopilot_sweep": True})

    assert len(fake_ecs.run_task_calls) == 1


def test_non_gate_transition_never_checks_actor(fake_clickup, fake_ecs):
    # STORY -> qa is not in GATE_TO_STATUSES; a bot actor is legitimate there
    # (the qa stage-runner itself commonly moves the card), and the sweep
    # must not even ask for comments to decide.
    fake_clickup.list_tasks[STORY_LIST_ID] = [task("story-1", router.STATUS_QA, parent="epic-1")]

    sweep.handle_sweep({"autopilot_sweep": True})

    assert len(fake_ecs.run_task_calls) == 1
    assert env_vars(fake_ecs.run_task_calls[0])["EPIC_TASK_ID"] == "epic-1"


# ---------------------------------------------------------------------------
# Story-done -> supervisor (no from_status reconstruction needed)
# ---------------------------------------------------------------------------


def test_story_done_hands_off_to_supervisor_not_fargate(fake_clickup, fake_ecs, monkeypatch):
    fake_clickup.list_tasks[STORY_LIST_ID] = [task("story-1", router.STATUS_DONE, parent="epic-1")]
    calls = []
    monkeypatch.setattr(handler.supervisor, "handle_routed_event", calls.append)

    sweep.handle_sweep({"autopilot_sweep": True})

    assert fake_ecs.run_task_calls == []
    assert len(calls) == 1
    assert calls[0].task_id == "story-1"
    assert calls[0].epic_task_id == "epic-1"


# ---------------------------------------------------------------------------
# Supervisor tick for every executing feature card
# ---------------------------------------------------------------------------


def test_executing_feature_card_ticks_the_supervisor(fake_clickup, monkeypatch):
    fake_clickup.executing_tasks[FEATURE_LIST_ID] = [task("epic-9", router.STATUS_EXECUTING)]
    ticked = []
    monkeypatch.setattr(sweep.supervisor, "run_supervisor_tick", ticked.append)

    sweep.handle_sweep({"autopilot_sweep": True})

    assert ticked == ["epic-9"]


def test_executing_card_ticked_even_when_outside_the_lookback_window(fake_clickup, monkeypatch):
    # An epic that has been executing far longer than SWEEP_LOOKBACK_MINUTES,
    # with no other field changing on its card, must still get driven — the
    # dedicated executing-cards query is not scoped to the lookback window.
    fake_clickup.executing_tasks[FEATURE_LIST_ID] = [
        task("epic-9", router.STATUS_EXECUTING, date_updated=now_ms() - 10 * 24 * 60 * 60 * 1000)
    ]
    ticked = []
    monkeypatch.setattr(sweep.supervisor, "run_supervisor_tick", ticked.append)

    sweep.handle_sweep({"autopilot_sweep": True})

    assert ticked == ["epic-9"]


def test_recently_updated_executing_card_is_not_double_ticked(fake_clickup, monkeypatch):
    # The same card can legitimately show up in BOTH the dedicated
    # executing-cards query and the lookback-scanned "recently updated" one
    # (it was just moved to executing) — it must still only be ticked once.
    fake_clickup.executing_tasks[FEATURE_LIST_ID] = [task("epic-9", router.STATUS_EXECUTING)]
    fake_clickup.list_tasks[FEATURE_LIST_ID] = [task("epic-9", router.STATUS_EXECUTING)]
    fake_clickup.comments["epic-9"] = []
    ticked = []
    monkeypatch.setattr(sweep.supervisor, "run_supervisor_tick", ticked.append)

    sweep.handle_sweep({"autopilot_sweep": True})

    assert ticked == ["epic-9"]


# ---------------------------------------------------------------------------
# Sweep payload recognized only by internal shape
# ---------------------------------------------------------------------------


def test_sweep_payload_with_alb_headers_key_is_not_treated_as_internal(monkeypatch):
    swept = []
    monkeypatch.setattr(handler.sweep, "handle_sweep", lambda e: swept.append(e) or {"statusCode": 200, "body": "{}"})
    event = {"autopilot_sweep": True, "headers": {}, "body": "{}"}

    handler.handler(event, None)

    assert swept == []


def test_sweep_payload_with_request_context_key_is_not_treated_as_internal(monkeypatch):
    swept = []
    monkeypatch.setattr(handler.sweep, "handle_sweep", lambda e: swept.append(e) or {"statusCode": 200, "body": "{}"})
    event = {"autopilot_sweep": True, "requestContext": {}, "body": "{}", "headers": {}}

    handler.handler(event, None)

    assert swept == []


def test_genuine_sweep_payload_is_dispatched_to_handle_sweep(monkeypatch):
    swept = []
    monkeypatch.setattr(handler.sweep, "handle_sweep", lambda e: swept.append(e) or {"statusCode": 200, "body": "{}"})

    resp = handler.handler({"autopilot_sweep": True}, None)

    assert swept == [{"autopilot_sweep": True}]
    assert resp["statusCode"] == 200
