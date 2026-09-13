"""Unit tests for the epic supervisor (supervisor.py).

ClickUp (plain HTTP), DynamoDB, and Slack are all faked here — no real
network calls. See test_router.py / test_route_event_dispatch.py for how a
routed decision reaches handle_routed_event in the first place.
"""

import time

import autopilot_conductor_dispatch as dispatch
import autopilot_conductor_router as router
import autopilot_conductor_supervisor as supervisor
import pytest
from botocore.exceptions import ClientError

EPIC_ID = "epic-1"


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeDynamoDBClient:
    def __init__(self):
        self.items: dict[str, dict] = {}

    # supervisor.py uses three distinct ConditionExpression strings across
    # its three DynamoDB claims (in-flight, stall-alert, close-out) — each
    # must be evaluated on its own real semantics, not one blanket rule, or
    # this fake would validate atomicity the production code doesn't
    # actually have.
    def put_item(self, TableName, Item, ConditionExpression=None, **kwargs):
        pk = Item["pk"]["S"]
        existing = self.items.get(pk)
        if ConditionExpression is not None and not self._condition_met(ConditionExpression, existing):
            raise ClientError({"Error": {"Code": "ConditionalCheckFailedException", "Message": "claimed"}}, "PutItem")
        self.items[pk] = Item

    def _condition_met(self, expression, existing):
        now = int(time.time())
        if expression == "attribute_not_exists(pk)":
            return existing is None
        if expression == "attribute_not_exists(pk) OR #exp < :now":
            return existing is None or int(existing["expires_at"]["N"]) < now
        if expression == "attribute_not_exists(pk) OR attribute_not_exists(alerted_at)":
            return existing is None or "alerted_at" not in existing
        raise AssertionError(f"fake does not know how to evaluate condition: {expression!r}")

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
    monkeypatch.setenv("AUTOPILOT_DEDUP_TABLE", "autopilot-dedup-test")
    monkeypatch.setenv("ECS_CLUSTER_ARN", "arn:aws:ecs:us-west-2:1:cluster/autopilot")
    monkeypatch.setenv("ECS_TASK_DEFINITION", "autopilot-agent:1")
    monkeypatch.setenv("SUBNET_IDS", "subnet-1,subnet-2")
    monkeypatch.setenv("SECURITY_GROUP_ID", "sg-1")
    monkeypatch.setenv("AUTOPILOT_CLICKUP_API_KEY", "test-clickup-key")
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setenv("AUTOPILOT_SLACK_CHANNEL", "C123")


class FakeClickUp:
    """Records every request supervisor.clickup_request makes and answers
    from a table keyed by (method, endpoint) prefix, so tests only specify
    the shape they care about."""

    def __init__(self):
        self.calls: list[tuple[str, str, dict | None]] = []
        self.responses: dict[str, dict] = {}
        self.slack_posts: list[dict] = []

    def request(self, method, endpoint, data=None):
        self.calls.append((method, endpoint, data))
        # Longest matching prefix wins — "/task/s1" and "/task/s1/time_in_status"
        # are both valid prefixes of the latter endpoint, and registration
        # order must not decide which response answers which call.
        matches = [key for key in self.responses if endpoint.startswith(key)]
        if not matches:
            raise AssertionError(f"no fake response registered for {method} {endpoint}")
        best_key = max(matches, key=len)
        response = self.responses[best_key]
        return response(method, endpoint, data) if callable(response) else response


@pytest.fixture(autouse=True)
def fake_clickup(monkeypatch):
    fake = FakeClickUp()
    monkeypatch.setattr(supervisor, "clickup_request", fake.request)
    return fake


@pytest.fixture(autouse=True)
def fake_slack(monkeypatch, fake_clickup):
    def fake_post(text):
        fake_clickup.slack_posts.append({"text": text})

    monkeypatch.setattr(supervisor, "post_slack_message", fake_post)
    return fake_clickup


def epic_response(subtask_ids):
    return {"subtasks": [{"id": sid} for sid in subtask_ids]}


def story_task(task_id, status, order_index="1", dependencies=None):
    return {
        "id": task_id,
        "status": {"status": status},
        "orderindex": order_index,
        "dependencies": dependencies or [],
    }


def register_epic(fake_clickup, story_ids, stories):
    fake_clickup.responses[f"/task/{EPIC_ID}?include_subtasks=true"] = epic_response(story_ids)
    for story_id, task in stories.items():
        fake_clickup.responses[f"/task/{story_id}"] = task


# ---------------------------------------------------------------------------
# Next-story selection
# ---------------------------------------------------------------------------


def test_select_next_story_orders_numerically_not_lexicographically():
    # ClickUp's real orderindex is a large decimal-like string, not a small
    # sequential integer — "10" must sort AFTER "2", where a plain string
    # sort would put it first.
    stories = [
        supervisor.Story("s10", router.STATUS_TO_DO, "10", frozenset()),
        supervisor.Story("s2", router.STATUS_TO_DO, "2", frozenset()),
    ]

    assert supervisor.select_next_story(stories).task_id == "s2"


def test_select_next_story_prefers_board_order_when_no_dependencies():
    stories = [
        supervisor.Story("s2", router.STATUS_TO_DO, "2", frozenset()),
        supervisor.Story("s1", router.STATUS_TO_DO, "1", frozenset()),
    ]

    assert supervisor.select_next_story(stories).task_id == "s1"


def test_select_next_story_prefers_dependency_links_over_board_order():
    # s1 has the lower board position, but s2 blocks s3 (not yet done) — the
    # ticket's "dependency links first" beats plain board order.
    stories = [
        supervisor.Story("s1", router.STATUS_TO_DO, "1", frozenset()),
        supervisor.Story("s2", router.STATUS_TO_DO, "2", frozenset()),
        supervisor.Story("s3", router.STATUS_TO_DO, "3", frozenset({"s2"})),
    ]

    assert supervisor.select_next_story(stories).task_id == "s2"


def test_select_next_story_skips_feedback_needed():
    stories = [
        supervisor.Story("s1", router.STATUS_FEEDBACK_NEEDED, "1", frozenset()),
        supervisor.Story("s2", router.STATUS_TO_DO, "2", frozenset()),
    ]

    assert supervisor.select_next_story(stories).task_id == "s2"


def test_select_next_story_skips_stories_still_blocked():
    stories = [
        supervisor.Story("s1", router.STATUS_TO_DO, "1", frozenset({"s2"})),
        supervisor.Story("s2", router.STATUS_TO_DO, "2", frozenset()),
    ]

    assert supervisor.select_next_story(stories).task_id == "s2"


def test_select_next_story_none_when_all_remaining_are_feedback_needed():
    stories = [
        supervisor.Story("s1", router.STATUS_DONE, "1", frozenset()),
        supervisor.Story("s2", router.STATUS_FEEDBACK_NEEDED, "2", frozenset()),
    ]

    assert supervisor.select_next_story(stories) is None


# ---------------------------------------------------------------------------
# Executing gate / story-done -> dispatch first unblocked story
# ---------------------------------------------------------------------------


def test_tick_dispatches_first_unblocked_story_with_epic_task_id(fake_clickup, fake_ecs):
    register_epic(
        fake_clickup,
        ["s1"],
        {"s1": story_task("s1", router.STATUS_TO_DO)},
    )

    supervisor.run_supervisor_tick(EPIC_ID)

    assert len(fake_ecs.run_task_calls) == 1
    call = fake_ecs.run_task_calls[0]
    env_vars = {e["name"]: e["value"] for e in call["overrides"]["containerOverrides"][0]["environment"]}
    assert env_vars["AUTOPILOT_STAGE"] == router.STAGE_STORY
    assert env_vars["CLICKUP_TASK_ID"] == "s1"
    assert env_vars["EPIC_TASK_ID"] == EPIC_ID


def test_tick_dispatches_next_unblocked_after_a_story_finishes(fake_clickup, fake_ecs):
    register_epic(
        fake_clickup,
        ["s1", "s2"],
        {
            "s1": story_task("s1", router.STATUS_DONE),
            "s2": story_task("s2", router.STATUS_TO_DO, order_index="2"),
        },
    )

    supervisor.run_supervisor_tick(EPIC_ID)

    assert len(fake_ecs.run_task_calls) == 1
    call_task_id = fake_ecs.run_task_calls[0]["overrides"]["containerOverrides"][0]["environment"]
    assert {"name": "CLICKUP_TASK_ID", "value": "s2"} in call_task_id


# ---------------------------------------------------------------------------
# One-in-flight-story invariant
# ---------------------------------------------------------------------------


def test_epic_claim_blocks_second_dispatch(fake_clickup, fake_ecs):
    register_epic(
        fake_clickup,
        ["s1", "s2"],
        {
            "s1": story_task("s1", router.STATUS_TO_DO),
            "s2": story_task("s2", router.STATUS_TO_DO, order_index="2"),
        },
    )

    supervisor.run_supervisor_tick(EPIC_ID)
    assert len(fake_ecs.run_task_calls) == 1

    # A second tick before anything has moved off "to do" for s1 (dispatched)
    # must not also dispatch s2 — the sweep re-discovering the same epic
    # while s1 is still in flight is exactly this scenario.
    supervisor.run_supervisor_tick(EPIC_ID)
    assert len(fake_ecs.run_task_calls) == 1


def test_claim_survives_a_tick_before_clickup_status_catches_up(fake_clickup, fake_ecs):
    # Right after a dispatch, the story's ClickUp status is often still "to
    # do" for a beat (the stage runner itself writes "executing" as its own
    # first action) — the claim, not board status, must be what a very-next
    # tick trusts to avoid dispatching s1 twice.
    register_epic(
        fake_clickup,
        ["s1", "s2"],
        {
            "s1": story_task("s1", router.STATUS_TO_DO),
            "s2": story_task("s2", router.STATUS_TO_DO, order_index="2"),
        },
    )

    supervisor.run_supervisor_tick(EPIC_ID)
    assert len(fake_ecs.run_task_calls) == 1

    # s1's board status has NOT changed yet — still "to do" per the fake —
    # exactly the race window this test targets.
    supervisor.run_supervisor_tick(EPIC_ID)

    assert len(fake_ecs.run_task_calls) == 1


def test_in_flight_story_status_blocks_dispatch_even_without_a_claim(fake_clickup, fake_ecs):
    # No claim was ever written for s1 (e.g. the dedup table was briefly
    # unreachable when it was dispatched) but its board status already shows
    # it running — the ClickUp-status signal alone must still block a
    # second dispatch.
    register_epic(
        fake_clickup,
        ["s1", "s2"],
        {
            "s1": story_task("s1", router.STATUS_IN_PROGRESS),
            "s2": story_task("s2", router.STATUS_TO_DO, order_index="2"),
        },
    )

    supervisor.run_supervisor_tick(EPIC_ID)

    assert fake_ecs.run_task_calls == []


def test_claim_released_once_in_flight_story_reaches_done(fake_clickup, fake_ecs):
    register_epic(
        fake_clickup,
        ["s1", "s2"],
        {
            "s1": story_task("s1", router.STATUS_TO_DO),
            "s2": story_task("s2", router.STATUS_TO_DO, order_index="2"),
        },
    )
    supervisor.run_supervisor_tick(EPIC_ID)
    assert len(fake_ecs.run_task_calls) == 1

    # s1 is now done; nothing else is in flight, so the next tick must
    # release the stale claim and dispatch s2.
    fake_clickup.responses["/task/s1"] = story_task("s1", router.STATUS_DONE)

    supervisor.run_supervisor_tick(EPIC_ID)

    assert len(fake_ecs.run_task_calls) == 2
    second_call_env = fake_ecs.run_task_calls[1]["overrides"]["containerOverrides"][0]["environment"]
    assert {"name": "CLICKUP_TASK_ID", "value": "s2"} in second_call_env


# ---------------------------------------------------------------------------
# Close-out
# ---------------------------------------------------------------------------


def test_all_done_closes_out_epic(fake_clickup, fake_ecs):
    register_epic(
        fake_clickup,
        ["s1", "s2"],
        {
            "s1": story_task("s1", router.STATUS_DONE),
            "s2": story_task("s2", router.STATUS_DONE, order_index="2"),
        },
    )
    fake_clickup.responses[f"/task/{EPIC_ID}"] = {"id": EPIC_ID, "name": "Ship the thing", "list": {"id": "list-1"}}
    fake_clickup.responses["/list/list-1/task"] = {"id": "cleanup-1"}

    supervisor.run_supervisor_tick(EPIC_ID)

    assert fake_ecs.run_task_calls == []
    move_calls = [c for c in fake_clickup.calls if c[0] == "PUT" and c[1] == f"/task/{EPIC_ID}"]
    assert move_calls == [("PUT", f"/task/{EPIC_ID}", {"status": router.STATUS_DONE})]
    cleanup_calls = [c for c in fake_clickup.calls if c[1] == "/list/list-1/task"]
    assert len(cleanup_calls) == 1
    assert cleanup_calls[0][2]["parent"] == EPIC_ID
    assert len(fake_clickup.slack_posts) == 1
    assert "cleanup-1" in fake_clickup.slack_posts[0]["text"] or "complete" in fake_clickup.slack_posts[0]["text"]


def test_redelivered_story_done_event_does_not_double_close_out(fake_clickup, fake_ecs):
    # A redelivered webhook (or a webhook tick racing an overlapping sweep
    # tick) can call run_supervisor_tick for an already-closed-out epic a
    # second time — the story-done path carries no per-transition dedup
    # claim of its own (unlike a Fargate stage dispatch), so close_out_epic
    # is the only guard against filing a second cleanup ticket and posting
    # a second Slack summary.
    register_epic(
        fake_clickup,
        ["s1"],
        {"s1": story_task("s1", router.STATUS_DONE)},
    )
    fake_clickup.responses[f"/task/{EPIC_ID}"] = {"id": EPIC_ID, "name": "Ship the thing", "list": {"id": "list-1"}}
    fake_clickup.responses["/list/list-1/task"] = {"id": "cleanup-1"}

    supervisor.run_supervisor_tick(EPIC_ID)
    supervisor.run_supervisor_tick(EPIC_ID)

    move_calls = [c for c in fake_clickup.calls if c[0] == "PUT" and c[1] == f"/task/{EPIC_ID}"]
    cleanup_calls = [c for c in fake_clickup.calls if c[1] == "/list/list-1/task"]
    assert len(move_calls) == 1
    assert len(cleanup_calls) == 1
    assert len(fake_clickup.slack_posts) == 1


def test_empty_backlog_none_in_flight_none_unblocked_closes_out(fake_clickup, fake_ecs):
    # Every story already done — nothing left to dispatch and nothing in
    # flight. This is the same "empty backlog" path as test_all_done, kept
    # separate because it is its own named AC.
    register_epic(fake_clickup, ["s1"], {"s1": story_task("s1", router.STATUS_DONE)})
    fake_clickup.responses[f"/task/{EPIC_ID}"] = {"id": EPIC_ID, "name": "Epic", "list": {"id": "list-1"}}
    fake_clickup.responses["/list/list-1/task"] = {"id": "cleanup-1"}

    supervisor.run_supervisor_tick(EPIC_ID)

    assert fake_ecs.run_task_calls == []
    assert any(c[0] == "PUT" for c in fake_clickup.calls)


def test_close_out_failure_does_not_file_cleanup_ticket_or_announce(fake_clickup, fake_ecs, capsys):
    register_epic(fake_clickup, ["s1"], {"s1": story_task("s1", router.STATUS_DONE)})

    def failing_move(method, endpoint, data):
        if method == "PUT":
            raise RuntimeError("ClickUp unavailable")
        raise AssertionError(f"unexpected call {method} {endpoint}")

    fake_clickup.responses[f"/task/{EPIC_ID}"] = failing_move

    supervisor.run_supervisor_tick(EPIC_ID)

    assert fake_clickup.slack_posts == []
    assert "ERROR: failed to move epic" in capsys.readouterr().out


def test_close_out_retries_after_a_failed_move(fake_clickup, fake_ecs):
    # The close-out claim only PROTECTS a completed close-out; a move that
    # fails before anything real happened must release it, or a genuinely
    # transient ClickUp outage would permanently strand the epic un-closed.
    register_epic(fake_clickup, ["s1"], {"s1": story_task("s1", router.STATUS_DONE)})
    attempts = []

    def flaky_move(method, endpoint, data):
        if method == "PUT":
            attempts.append(1)
            if len(attempts) == 1:
                raise RuntimeError("ClickUp unavailable")
            return {}
        return {"id": EPIC_ID, "name": "Epic", "list": {"id": "list-1"}}

    fake_clickup.responses[f"/task/{EPIC_ID}"] = flaky_move
    fake_clickup.responses["/list/list-1/task"] = {"id": "cleanup-1"}

    supervisor.run_supervisor_tick(EPIC_ID)  # fails, must not strand the claim
    supervisor.run_supervisor_tick(EPIC_ID)  # retries and succeeds

    assert len(attempts) == 2
    assert len(fake_clickup.slack_posts) == 1


# ---------------------------------------------------------------------------
# Stall detection
# ---------------------------------------------------------------------------


def test_try_claim_stall_alert_is_atomic_across_racing_ticks(fake_dynamodb):
    # Models a webhook tick and the sweep's own unconditional
    # per-executing-card pass racing on the same stalled story: both would
    # see "not yet alerted" under a read-then-write design. The claim itself
    # must be the single source of truth, so only the first of two
    # back-to-back calls may win.
    first = supervisor.try_claim_stall_alert(EPIC_ID)
    second = supervisor.try_claim_stall_alert(EPIC_ID)

    assert first is True
    assert second is False


def test_stalled_story_alerts_once_across_repeated_sweeps(fake_clickup, fake_ecs):
    register_epic(fake_clickup, ["s1"], {"s1": story_task("s1", router.STATUS_IN_PROGRESS)})
    stale_since = str(int((time.time() - supervisor.STATUS_TTL_SECONDS[router.STATUS_IN_PROGRESS] - 60) * 1000))
    fake_clickup.responses["/task/s1/time_in_status"] = {"current_status": {"since": stale_since}}

    supervisor.run_supervisor_tick(EPIC_ID)
    supervisor.run_supervisor_tick(EPIC_ID)
    supervisor.run_supervisor_tick(EPIC_ID)

    assert len(fake_clickup.slack_posts) == 1
    assert fake_ecs.run_task_calls == []  # never auto-retried


def test_story_within_ttl_does_not_alert(fake_clickup, fake_ecs):
    register_epic(fake_clickup, ["s1"], {"s1": story_task("s1", router.STATUS_IN_PROGRESS)})
    fresh_since = str(int(time.time() * 1000))
    fake_clickup.responses["/task/s1/time_in_status"] = {"current_status": {"since": fresh_since}}

    supervisor.run_supervisor_tick(EPIC_ID)

    assert fake_clickup.slack_posts == []


def test_feedback_needed_story_never_counted_stalled(fake_clickup, fake_ecs):
    register_epic(fake_clickup, ["s1"], {"s1": story_task("s1", router.STATUS_FEEDBACK_NEEDED)})
    # Even a very old since would trip in_progress/qa TTLs; feedback needed
    # must never be checked against them at all.
    ancient_since = str(int((time.time() - 10 * 60 * 60) * 1000))
    fake_clickup.responses["/task/s1/time_in_status"] = {"current_status": {"since": ancient_since}}

    supervisor.run_supervisor_tick(EPIC_ID)

    assert fake_clickup.slack_posts == []


def test_alerted_at_recorded_on_the_epic_claim_item(fake_clickup, fake_ecs, fake_dynamodb):
    register_epic(fake_clickup, ["s1"], {"s1": story_task("s1", router.STATUS_QA)})
    stale_since = str(int((time.time() - supervisor.STATUS_TTL_SECONDS[router.STATUS_QA] - 60) * 1000))
    fake_clickup.responses["/task/s1/time_in_status"] = {"current_status": {"since": stale_since}}

    supervisor.run_supervisor_tick(EPIC_ID)

    item = fake_dynamodb.items[supervisor.epic_claim_pk(EPIC_ID)]
    assert "alerted_at" in item


def test_alerting_preserves_the_claimed_story_id(fake_clickup, fake_ecs, fake_dynamodb):
    # A story we ourselves dispatched (claim holds story_task_id) that then
    # stalls must still be recognized as "claimed" by the next tick after
    # the alert fires — otherwise the alert path would itself erase the
    # one-in-flight tracking it is supposed to leave alone.
    register_epic(
        fake_clickup,
        ["s1", "s2"],
        {
            "s1": story_task("s1", router.STATUS_TO_DO),
            "s2": story_task("s2", router.STATUS_TO_DO, order_index="2"),
        },
    )
    supervisor.run_supervisor_tick(EPIC_ID)
    assert len(fake_ecs.run_task_calls) == 1

    fake_clickup.responses["/task/s1"] = story_task("s1", router.STATUS_IN_PROGRESS)
    stale_since = str(int((time.time() - supervisor.STATUS_TTL_SECONDS[router.STATUS_IN_PROGRESS] - 60) * 1000))
    fake_clickup.responses["/task/s1/time_in_status"] = {"current_status": {"since": stale_since}}

    supervisor.run_supervisor_tick(EPIC_ID)  # alerts, must not forget the claim
    assert len(fake_clickup.slack_posts) == 1

    supervisor.run_supervisor_tick(EPIC_ID)  # must still refuse to dispatch s2

    assert len(fake_ecs.run_task_calls) == 1
    assert len(fake_clickup.slack_posts) == 1  # and must not re-alert either
