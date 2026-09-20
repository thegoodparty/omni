"""Unit tests for the reconciliation sweep (sweep.py).

ClickUp (plain HTTP), DynamoDB, and ECS are all faked here — no real network
calls. See test_supervisor.py for the epic-tick logic the sweep also
triggers for executing feature cards.
"""

import json
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
def fake_slack_status_card(monkeypatch):
    """Every handle_sweep() call now also updates the pinned status card
    (ENG-11151), which would otherwise make a real Slack HTTP call from every
    single test in this file. Autouse, harmless fakes by default; tests that
    care about the status card itself inspect the returned lists/dict."""
    messages: dict[str, str] = {}
    posted: list[tuple[str, str]] = []
    updated: list[tuple[str, str]] = []
    pinned: list[tuple[str, str]] = []
    counter = {"n": 0}

    def fake_post_with_ts(channel, text):
        counter["n"] += 1
        ts = f"ts-{counter['n']}"
        messages[ts] = text
        posted.append((channel, text))
        return ts

    def fake_update(channel, ts, text):
        if ts not in messages:
            return False
        messages[ts] = text
        updated.append((channel, text))
        return True

    def fake_pin(channel, ts):
        pinned.append((channel, ts))
        return True

    monkeypatch.setattr(sweep.supervisor, "post_slack_message_with_ts", fake_post_with_ts)
    monkeypatch.setattr(sweep.supervisor, "update_slack_message", fake_update)
    monkeypatch.setattr(sweep.supervisor, "pin_slack_message", fake_pin)
    return {"messages": messages, "posted": posted, "updated": updated, "pinned": pinned}


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
    monkeypatch.setenv("AUTOPILOT_CLICKUP_API_KEY", "test-clickup-key")
    monkeypatch.setenv("AUTOPILOT_SLACK_CHANNEL", "#autopilot-test")


class FakeClickUp:
    def __init__(self):
        # Separate registries, mirroring the differently-filtered ClickUp
        # queries sweep.py issues against the same /list/{id}/task endpoint:
        # list_tasks answers the lookback-scanned "recently updated" query,
        # executing_tasks / in_progress_tasks answer the two dedicated,
        # unconditional statuses[] queries.
        self.list_tasks: dict[str, list[dict]] = {}
        self.executing_tasks: dict[str, list[dict]] = {}
        self.in_progress_tasks: dict[str, list[dict]] = {}
        self.parked_tasks: dict[str, list[dict]] = {}
        # Backs the flag-cleanup ramp pass's own statuses[]=done query
        # (ENG-11152) — its own registry, not folded into executing_tasks'
        # catch-all below: "done" and "executing" are both single words with
        # no space to distinguish by substring the way feedback/in-progress
        # already are.
        self.done_tasks: dict[str, list[dict]] = {}
        self.comments: dict[str, list[dict]] = {}
        self.time_in_status_since: dict[str, int] = {}
        self.task_queries: list[str] = []
        self.status_updates: dict[str, list[str]] = {}
        self.status_update_failures: dict[str, int] = {}
        # Backs supervisor.load_epic_stories, which the status card
        # (ENG-11151) now calls per executing epic to find its in-flight
        # stories under bounded concurrency (ENG-11148) — subtasks maps an
        # epic id to its story ids, tasks answers the per-story GET each one
        # triggers. Empty by default so a test that never registers an
        # epic's stories gets "no story in flight" rather than an
        # unregistered-endpoint AssertionError.
        self.subtasks: dict[str, list[str]] = {}
        self.tasks: dict[str, dict] = {}

    def request(self, method, endpoint, data=None):
        if method == "GET" and endpoint.startswith("/list/") and "/task?" in endpoint:
            list_id, query = endpoint.split("/list/", 1)[1].split("/task?", 1)
            self.task_queries.append(query)
            if "statuses" in query:
                if "feedback%20needed" in query:
                    registry = self.parked_tasks
                elif "in%20progress" in query:
                    registry = self.in_progress_tasks
                elif f"statuses[]={router.STATUS_DONE}" in query:
                    registry = self.done_tasks
                else:
                    registry = self.executing_tasks
                return {"tasks": registry.get(list_id, [])}
            return {"tasks": self.list_tasks.get(list_id, [])}
        if method == "GET" and endpoint.endswith("/comment"):
            task_id = endpoint.split("/task/", 1)[1].split("/comment", 1)[0]
            return {"comments": self.comments.get(task_id, [])}
        if method == "GET" and endpoint.endswith("/time_in_status"):
            task_id = endpoint.split("/task/", 1)[1].split("/time_in_status", 1)[0]
            since = self.time_in_status_since.get(task_id)
            return {"current_status": {"since": str(since)}} if since is not None else {}
        if method == "GET" and "include_subtasks=true" in endpoint:
            task_id = endpoint.split("/task/", 1)[1].split("?", 1)[0]
            return {"subtasks": [{"id": sid} for sid in self.subtasks.get(task_id, [])]}
        if method == "GET" and endpoint.startswith("/task/") and "/" not in endpoint[len("/task/") :]:
            task_id = endpoint[len("/task/") :]
            return self.tasks.get(task_id, task(task_id, router.STATUS_DONE))
        if method == "PUT" and endpoint.startswith("/task/") and "/" not in endpoint[len("/task/") :]:
            task_id = endpoint[len("/task/") :]
            if self.status_update_failures.get(task_id, 0) > 0:
                self.status_update_failures[task_id] -= 1
                raise RuntimeError("transient ClickUp 500")
            self.status_updates.setdefault(task_id, []).append((data or {}).get("status"))
            # Mirrors a real ClickUp status write: a subsequent GET of this
            # same task_id (e.g. a supervisor tick reading it back mid-flow,
            # as the flag-cleanup promote-then-dispatch pass does) must see
            # the new status, not the pre-move one it was registered with.
            new_status = (data or {}).get("status")
            if task_id in self.tasks and new_status is not None:
                self.tasks[task_id] = {**self.tasks[task_id], "status": {"status": new_status}}
            return {"id": task_id}
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
    fake_clickup.list_tasks[STORY_LIST_ID] = [
        task("story-1", router.STATUS_QA, date_updated=now_ms() - 60_000, parent="epic-1")
    ]

    result = sweep.handle_sweep({"autopilot_sweep": True})

    assert len(fake_ecs.run_task_calls) == 1
    assert env_vars(fake_ecs.run_task_calls[0])["AUTOPILOT_STAGE"] == router.STAGE_QA
    assert result["statusCode"] == 200


def test_task_outside_lookback_window_is_not_dispatched(fake_clickup, fake_ecs, monkeypatch):
    monkeypatch.setenv("SWEEP_LOOKBACK_MINUTES", "45")
    stale_ms = now_ms() - 46 * 60 * 1000
    fake_clickup.list_tasks[STORY_LIST_ID] = [task("story-1", router.STATUS_QA, date_updated=stale_ms, parent="epic-1")]

    sweep.handle_sweep({"autopilot_sweep": True})

    assert fake_ecs.run_task_calls == []


def test_task_inside_lookback_window_boundary_is_dispatched(fake_clickup, fake_ecs, monkeypatch):
    monkeypatch.setenv("SWEEP_LOOKBACK_MINUTES", "45")
    fresh_ms = now_ms() - 44 * 60 * 1000
    fake_clickup.list_tasks[STORY_LIST_ID] = [task("story-1", router.STATUS_QA, date_updated=fresh_ms, parent="epic-1")]

    sweep.handle_sweep({"autopilot_sweep": True})

    assert len(fake_ecs.run_task_calls) == 1


# ---------------------------------------------------------------------------
# Overlap with the webhook path / a previous sweep = one dispatch total
# ---------------------------------------------------------------------------


def test_sweep_and_webhook_overlap_share_one_dedup_key(fake_clickup, fake_ecs):
    story = task("story-1", router.STATUS_QA, parent="epic-1")
    fake_clickup.list_tasks[STORY_LIST_ID] = [story]

    # A webhook delivery for the exact same transition (same from/to status,
    # same transitioned_at derived from date_updated) claims first.
    envelope = dispatch.StageEnvelope(
        stage=router.STAGE_QA,
        task_id="story-1",
        epic_task_id="epic-1",
        model=router.DEFAULT_AGENT_MODEL,
        max_budget_usd=8.0,
        deadline_seconds=30 * 60,
    )
    transitioned_at = str(int(story["date_updated"]))
    dispatch.dispatch_stage("story-1", router.STAGE_QA, transitioned_at, envelope)
    assert len(fake_ecs.run_task_calls) == 1

    sweep.handle_sweep({"autopilot_sweep": True})

    assert len(fake_ecs.run_task_calls) == 1  # sweep's own claim attempt lost the race


def test_repeated_sweep_passes_dispatch_once(fake_clickup, fake_ecs):
    fake_clickup.list_tasks[STORY_LIST_ID] = [task("story-1", router.STATUS_QA, parent="epic-1")]

    sweep.handle_sweep({"autopilot_sweep": True})
    sweep.handle_sweep({"autopilot_sweep": True})

    assert len(fake_ecs.run_task_calls) == 1


# ---------------------------------------------------------------------------
# Trigger cap
# ---------------------------------------------------------------------------


def test_trigger_cap_respected_and_logged(fake_clickup, fake_ecs, monkeypatch, capsys):
    monkeypatch.setenv("SWEEP_MAX_TRIGGERS", "1")
    fake_clickup.list_tasks[STORY_LIST_ID] = [
        task("story-1", router.STATUS_QA, parent="epic-1"),
        task("story-2", router.STATUS_QA, parent="epic-2"),
    ]

    sweep.handle_sweep({"autopilot_sweep": True})

    assert len(fake_ecs.run_task_calls) == 1
    assert "ERROR: sweep hit its cap of 1 triggers" in capsys.readouterr().out


# ---------------------------------------------------------------------------
# Mid-run cards are never re-dispatched off a board poll
# ---------------------------------------------------------------------------


def test_mid_run_feature_card_in_in_progress_is_never_redispatched(fake_clickup, fake_ecs):
    # A feature card in "in progress" means epic-create is actively running.
    # (FEATURE, to="in progress") is unambiguous in the routing table, so
    # without the explicit skip any date_updated bump (a comment, a rename)
    # would mint a fresh dedup key and launch a duplicate epic-create run —
    # no comments here, so the actor approximation would NOT have refused it.
    fake_clickup.list_tasks[FEATURE_LIST_ID] = [task("epic-1", router.STATUS_IN_PROGRESS)]
    fake_clickup.comments["epic-1"] = []

    sweep.handle_sweep({"autopilot_sweep": True})

    assert fake_ecs.run_task_calls == []


# ---------------------------------------------------------------------------
# Stall alert for feature cards stranded in "in progress"
# ---------------------------------------------------------------------------


@pytest.fixture
def slack_posts(monkeypatch):
    posts = []
    monkeypatch.setattr(sweep.supervisor, "post_slack_message", posts.append)
    return posts


def test_stalled_in_progress_feature_card_alerts_once(fake_clickup, fake_ecs, slack_posts):
    # The reconstruction skip means nothing ever re-dispatches this card, so
    # the sweep's own unconditional query is the one automated signal. Two
    # passes must still produce exactly one alert (per-epic claim).
    fake_clickup.in_progress_tasks[FEATURE_LIST_ID] = [task("epic-1", router.STATUS_IN_PROGRESS)]
    ttl = sweep.supervisor.STATUS_TTL_SECONDS[router.STATUS_IN_PROGRESS]
    fake_clickup.time_in_status_since["epic-1"] = now_ms() - (ttl + 60) * 1000

    result_1 = sweep.handle_sweep({"autopilot_sweep": True})
    result_2 = sweep.handle_sweep({"autopilot_sweep": True})

    assert fake_ecs.run_task_calls == []
    assert len(slack_posts) == 1
    assert "stalled" in slack_posts[0] and "epic-1" in slack_posts[0]
    import json as _json

    assert _json.loads(result_1["body"])["alerted"] == 1
    assert _json.loads(result_2["body"])["alerted"] == 0


def test_in_progress_feature_card_within_ttl_does_not_alert(fake_clickup, fake_ecs, slack_posts):
    fake_clickup.in_progress_tasks[FEATURE_LIST_ID] = [task("epic-1", router.STATUS_IN_PROGRESS)]
    fake_clickup.time_in_status_since["epic-1"] = now_ms() - 60 * 1000

    sweep.handle_sweep({"autopilot_sweep": True})

    assert slack_posts == []
    assert fake_ecs.run_task_calls == []


# ---------------------------------------------------------------------------
# Actor approximation — no currently-reconstructable transition lands in a
# gate status (in-progress is skipped for both card types, executing for
# features), so the helper is covered directly, ready for a future gate row.
# ---------------------------------------------------------------------------


def test_approximate_actor_reads_last_comment_author(fake_clickup):
    fake_clickup.comments["epic-1"] = [{"user": {"id": HUMAN_USER_ID}}, {"user": {"id": BOT_USER_ID}}]

    assert sweep._approximate_actor("epic-1") == BOT_USER_ID


def test_approximate_actor_without_comments_is_none(fake_clickup):
    # No evidence of bot involvement must fail toward "human" (None), which
    # router.route()'s gate treats as a legitimate trigger — toward NOT
    # silently dropping real work.
    fake_clickup.comments["epic-1"] = []

    assert sweep._approximate_actor("epic-1") is None


def test_non_gate_transition_never_checks_actor(fake_clickup, fake_ecs):
    # STORY -> qa is not in GATE_TO_STATUSES; a bot actor is legitimate there
    # (the qa stage-runner itself commonly moves the card), and the sweep
    # must not even ask for comments to decide.
    fake_clickup.list_tasks[STORY_LIST_ID] = [task("story-1", router.STATUS_QA, parent="epic-1")]

    sweep.handle_sweep({"autopilot_sweep": True})

    assert len(fake_ecs.run_task_calls) == 1
    assert env_vars(fake_ecs.run_task_calls[0])["EPIC_TASK_ID"] == "epic-1"


def test_mid_run_story_in_in_progress_is_never_redispatched(fake_clickup, fake_ecs):
    # (STORY, to_status="in progress") is deliberately ambiguous in the
    # routing table — kickoff and feedback-resume both land there — so the
    # reconstruction must skip it entirely. Guessing either row would dispatch
    # a duplicate run against a story that is legitimately mid-run.
    fake_clickup.list_tasks[STORY_LIST_ID] = [task("story-1", router.STATUS_IN_PROGRESS, parent="epic-1")]
    fake_clickup.comments["story-1"] = []

    sweep.handle_sweep({"autopilot_sweep": True})

    assert fake_ecs.run_task_calls == []


def test_lookback_scan_requests_subtasks(fake_clickup):
    # Stories are subtasks of their feature card; ClickUp's list-task query
    # excludes subtasks by default, which would blind the reconstruction pass
    # to every story on the board.
    fake_clickup.list_tasks[FEATURE_LIST_ID] = []

    sweep.handle_sweep({"autopilot_sweep": True})

    lookback_queries = [q for q in fake_clickup.task_queries if "statuses" not in q]
    assert lookback_queries and all("subtasks=true" in q for q in lookback_queries)


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


def test_executing_subtask_never_ticks_the_supervisor(fake_clickup, monkeypatch):
    # Only top-level cards are epics. The executing-cards query already omits
    # subtasks, but a story that leaks into the result anyway (the API's
    # subtasks default changing server-side) must still be filtered out — a
    # supervisor tick keyed on a story id would read the wrong "epic".
    fake_clickup.executing_tasks[FEATURE_LIST_ID] = [task("story-3", router.STATUS_EXECUTING, parent="epic-9")]
    ticked = []
    monkeypatch.setattr(sweep.supervisor, "run_supervisor_tick", ticked.append)

    sweep.handle_sweep({"autopilot_sweep": True})

    assert ticked == []


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


# ---------------------------------------------------------------------------
# Auto-resume of actionable parks
# ---------------------------------------------------------------------------


def parked_comment(stage, question, comment_id="park-1", date="2000"):
    return {
        "id": comment_id,
        "comment_text": f"[autopilot:parked stage={stage}]\n\n1. {question}",
        "date": date,
    }


def test_actionable_park_gets_exactly_one_auto_resume(fake_clickup, fake_ecs):
    # "Deploy pending" (qa.md), not "Merge pending" — the latter is excluded
    # from auto-resume entirely (see test_merge_pending_park_is_never_auto_resumed).
    fake_clickup.parked_tasks[STORY_LIST_ID] = [task("story-9", router.STATUS_FEEDBACK_NEEDED, parent="epic-1")]
    fake_clickup.comments["story-9"] = [parked_comment("qa", "Deploy pending: commit abc123 isn't live on dev yet.")]

    first = sweep.handle_sweep({"autopilot_sweep": True})
    second = sweep.handle_sweep({"autopilot_sweep": True})

    resumes = [c for c in fake_ecs.run_task_calls if env_vars(c)["AUTOPILOT_STAGE"] == router.STAGE_RESUME]
    assert len(resumes) == 1
    assert env_vars(resumes[0])["RESUME_STAGE"] == "qa"
    assert json.loads(first["body"])["auto_resumed"] == 1
    # Same park instance: the dedup claim on the park comment id holds.
    assert json.loads(second["body"])["auto_resumed"] == 0


def test_fresh_repark_earns_one_more_auto_resume(fake_clickup, fake_ecs):
    fake_clickup.parked_tasks[STORY_LIST_ID] = [task("story-9", router.STATUS_FEEDBACK_NEEDED, parent="epic-1")]
    fake_clickup.comments["story-9"] = [
        parked_comment(
            "story", "Deploy pending: commit abc123 isn't live on dev yet.", comment_id="park-1", date="2000"
        )
    ]
    sweep.handle_sweep({"autopilot_sweep": True})

    fake_clickup.comments["story-9"].append(
        parked_comment("story", "Deploy pending: still waiting.", comment_id="park-2", date="3000")
    )
    result = sweep.handle_sweep({"autopilot_sweep": True})

    resumes = [c for c in fake_ecs.run_task_calls if env_vars(c)["AUTOPILOT_STAGE"] == router.STAGE_RESUME]
    assert len(resumes) == 2
    assert json.loads(result["body"])["auto_resumed"] == 1


def test_qa_failed_park_is_left_for_a_human(fake_clickup, fake_ecs):
    fake_clickup.parked_tasks[STORY_LIST_ID] = [task("story-9", router.STATUS_FEEDBACK_NEEDED, parent="epic-1")]
    fake_clickup.comments["story-9"] = [parked_comment("qa", "QA failed: see the findings comment above.")]

    result = sweep.handle_sweep({"autopilot_sweep": True})

    assert fake_ecs.run_task_calls == []
    assert json.loads(result["body"])["auto_resumed"] == 0


def test_park_with_a_reply_after_it_is_left_to_the_comment_route(fake_clickup, fake_ecs):
    fake_clickup.parked_tasks[STORY_LIST_ID] = [task("story-9", router.STATUS_FEEDBACK_NEEDED, parent="epic-1")]
    fake_clickup.comments["story-9"] = [
        parked_comment("story", "Deploy pending: commit abc123 isn't live on dev yet.", date="2000"),
        {"id": "reply-1", "comment_text": "on it - resume please", "date": "3000"},
    ]

    result = sweep.handle_sweep({"autopilot_sweep": True})

    assert fake_ecs.run_task_calls == []
    assert json.loads(result["body"])["auto_resumed"] == 0


def test_park_with_a_relayed_slack_answer_after_it_is_left_to_the_comment_route(fake_clickup, fake_ecs):
    # ENG-11150: a relayed Slack answer is just another ClickUp comment
    # (handler.py's Slack ingress posts it with no special sweep handling —
    # see router.format_slack_answer_comment). It must count as "a reply
    # after the park" exactly like a human's own ClickUp comment does, so
    # auto-resume defers to the comment-resume route instead of double-firing.
    fake_clickup.parked_tasks[STORY_LIST_ID] = [task("story-9", router.STATUS_FEEDBACK_NEEDED, parent="epic-1")]
    fake_clickup.comments["story-9"] = [
        parked_comment("story", "Merge pending: PR #42 armed but not merged.", date="2000"),
        {"id": "reply-1", "comment_text": "[autopilot:slack-answer from U-HUMAN] merged it, go ahead", "date": "3000"},
    ]

    result = sweep.handle_sweep({"autopilot_sweep": True})

    assert fake_ecs.run_task_calls == []
    assert json.loads(result["body"])["auto_resumed"] == 0


def test_relapsing_story_stops_getting_auto_resumes(fake_clickup, fake_ecs, capsys):
    fake_clickup.parked_tasks[STORY_LIST_ID] = [task("story-9", router.STATUS_FEEDBACK_NEEDED, parent="epic-1")]
    fake_clickup.comments["story-9"] = [
        parked_comment("story", "Deploy pending: lap 1.", comment_id=f"park-{i}", date=str(1000 + i))
        for i in range(sweep.AUTO_RESUME_MAX_PARKS)
    ]

    result = sweep.handle_sweep({"autopilot_sweep": True})

    assert fake_ecs.run_task_calls == []
    assert json.loads(result["body"])["auto_resumed"] == 0
    assert "leaving it for a human" in capsys.readouterr().out


def test_top_level_card_in_feedback_needed_is_never_auto_resumed(fake_clickup, fake_ecs):
    # A feature card in feedback needed is epic-create's breakdown review or a
    # real question — human territory; only stories (subtasks) auto-resume.
    fake_clickup.parked_tasks[FEATURE_LIST_ID] = [task("feature-1", router.STATUS_FEEDBACK_NEEDED, parent=None)]

    result = sweep.handle_sweep({"autopilot_sweep": True})

    assert fake_ecs.run_task_calls == []
    assert json.loads(result["body"])["auto_resumed"] == 0


# ---------------------------------------------------------------------------
# Merge-pending resolution (ENG-11147) — the conductor-side replacement for
# story.md waiting out the merge in-turn.
# ---------------------------------------------------------------------------


class FakePullRequests(dict):
    """A dict of {pr_number: response} that also records every pr_number
    fetch_pull_request was actually called with, so a test can assert a
    non-merge-pending park never triggers a GitHub read at all."""

    def __init__(self):
        super().__init__()
        self.calls: list[int] = []


@pytest.fixture
def fake_pull_requests(monkeypatch):
    """Stubs sweep.fetch_pull_request (never the real GitHub call) keyed by PR
    number — the read itself (token minting, urllib, JSON parsing) is covered
    by test_lambda_github_auth.py and test_fetch_pull_request_* below."""
    responses = FakePullRequests()

    def fake_fetch(pr_number):
        responses.calls.append(pr_number)
        return responses.get(pr_number)

    monkeypatch.setattr(sweep, "fetch_pull_request", fake_fetch)
    return responses


def merge_pending_park(pr_number, comment_id="park-1", date="2000", stage="story"):
    return parked_comment(stage, f"Merge pending: PR #{pr_number} is approved but hasn't merged yet.", comment_id, date)


def test_merged_pr_moves_story_to_qa_and_dispatches_once(fake_clickup, fake_ecs, fake_pull_requests):
    fake_clickup.parked_tasks[STORY_LIST_ID] = [task("story-9", router.STATUS_FEEDBACK_NEEDED, parent="epic-1")]
    fake_clickup.comments["story-9"] = [merge_pending_park(42)]
    fake_pull_requests[42] = {"merged": True, "state": "closed"}

    first = sweep.handle_sweep({"autopilot_sweep": True})
    second = sweep.handle_sweep({"autopilot_sweep": True})

    assert fake_clickup.status_updates["story-9"][0] == router.STATUS_QA
    qa_dispatches = [c for c in fake_ecs.run_task_calls if env_vars(c)["AUTOPILOT_STAGE"] == router.STAGE_QA]
    assert len(qa_dispatches) == 1
    assert env_vars(qa_dispatches[0])["EPIC_TASK_ID"] == "epic-1"
    assert json.loads(first["body"])["merge_resolved"] == 1
    # Second pass still sees the park (fake ClickUp doesn't actually move the
    # story out of feedback-needed) and re-issues the idempotent qa move, but
    # the claim on PR #42 holds, so it never launches a second QA run.
    assert json.loads(second["body"])["merge_resolved"] == 0
    assert fake_clickup.status_updates["story-9"] == [router.STATUS_QA, router.STATUS_QA]


def test_failed_qa_launch_rolls_back_claim_and_status_for_a_full_retry(
    fake_clickup, fake_ecs, fake_pull_requests, monkeypatch, capsys
):
    # A launch failure after the qa move must undo BOTH the claim and the
    # move: once in qa the story leaves _parked_stories' sight, so a held
    # claim or a stuck qa status would strand it until a TTL/stall alert.
    fake_clickup.parked_tasks[STORY_LIST_ID] = [task("story-9", router.STATUS_FEEDBACK_NEEDED, parent="epic-1")]
    fake_clickup.comments["story-9"] = [merge_pending_park(42)]
    fake_pull_requests[42] = {"merged": True, "state": "closed"}

    real_launch = dispatch.launch_fargate_stage
    launch_attempts = {"n": 0}

    def flaky_launch(envelope):
        launch_attempts["n"] += 1
        if launch_attempts["n"] == 1:
            return {"launched": False, "error": "ECS capacity failure"}
        return real_launch(envelope)

    monkeypatch.setattr(dispatch, "launch_fargate_stage", flaky_launch)

    first = sweep.handle_sweep({"autopilot_sweep": True})
    assert json.loads(first["body"])["merge_resolved"] == 0
    assert fake_clickup.status_updates["story-9"] == [router.STATUS_QA, router.STATUS_FEEDBACK_NEEDED]
    assert fake_ecs.run_task_calls == []
    assert "rolling back for sweep retry" in capsys.readouterr().out

    second = sweep.handle_sweep({"autopilot_sweep": True})
    assert json.loads(second["body"])["merge_resolved"] == 1
    qa_dispatches = [c for c in fake_ecs.run_task_calls if env_vars(c)["AUTOPILOT_STAGE"] == router.STAGE_QA]
    assert len(qa_dispatches) == 1


def test_transient_move_failure_does_not_strand_the_story(fake_clickup, fake_ecs, fake_pull_requests, capsys):
    # The claim is taken only after the ClickUp move succeeds: a transient
    # ClickUp error on the move must leave nothing claimed, so the very next
    # sweep tick retries and resolves — not stranded until the claim TTL.
    fake_clickup.parked_tasks[STORY_LIST_ID] = [task("story-9", router.STATUS_FEEDBACK_NEEDED, parent="epic-1")]
    fake_clickup.comments["story-9"] = [merge_pending_park(42)]
    fake_clickup.status_update_failures["story-9"] = 1
    fake_pull_requests[42] = {"merged": True, "state": "closed"}

    first = sweep.handle_sweep({"autopilot_sweep": True})
    assert json.loads(first["body"])["merge_resolved"] == 0
    assert fake_ecs.run_task_calls == []
    assert "failed to move story-9 to qa" in capsys.readouterr().out

    second = sweep.handle_sweep({"autopilot_sweep": True})
    assert json.loads(second["body"])["merge_resolved"] == 1
    assert fake_clickup.status_updates["story-9"] == [router.STATUS_QA]
    qa_dispatches = [c for c in fake_ecs.run_task_calls if env_vars(c)["AUTOPILOT_STAGE"] == router.STAGE_QA]
    assert len(qa_dispatches) == 1


def test_still_open_pr_leaves_the_park_untouched(fake_clickup, fake_ecs, fake_pull_requests):
    fake_clickup.parked_tasks[STORY_LIST_ID] = [task("story-9", router.STATUS_FEEDBACK_NEEDED, parent="epic-1")]
    fake_clickup.comments["story-9"] = [merge_pending_park(42)]
    fake_pull_requests[42] = {"merged": False, "state": "open"}

    result = sweep.handle_sweep({"autopilot_sweep": True})

    assert fake_ecs.run_task_calls == []
    assert "story-9" not in fake_clickup.status_updates
    body = json.loads(result["body"])
    assert body["merge_resolved"] == 0
    assert body["merge_closed_alerted"] == 0


def test_closed_unmerged_pr_alerts_exactly_once(fake_clickup, fake_ecs, fake_pull_requests, slack_posts):
    fake_clickup.parked_tasks[STORY_LIST_ID] = [task("story-9", router.STATUS_FEEDBACK_NEEDED, parent="epic-1")]
    fake_clickup.comments["story-9"] = [merge_pending_park(42)]
    fake_pull_requests[42] = {"merged": False, "state": "closed"}

    first = sweep.handle_sweep({"autopilot_sweep": True})
    second = sweep.handle_sweep({"autopilot_sweep": True})

    assert fake_ecs.run_task_calls == []
    assert "story-9" not in fake_clickup.status_updates
    assert len(slack_posts) == 1
    assert "#42" in slack_posts[0] and "story-9" in slack_posts[0]
    assert json.loads(first["body"])["merge_closed_alerted"] == 1
    assert json.loads(second["body"])["merge_closed_alerted"] == 0


def test_github_read_failure_leaves_the_park_untouched_and_logs(fake_clickup, fake_ecs, fake_pull_requests, capsys):
    fake_clickup.parked_tasks[STORY_LIST_ID] = [task("story-9", router.STATUS_FEEDBACK_NEEDED, parent="epic-1")]
    fake_clickup.comments["story-9"] = [merge_pending_park(42)]
    # No entry registered for PR #42 in fake_pull_requests -> fetch_pull_request
    # returns None, the same shape a real GitHub outage produces.

    result = sweep.handle_sweep({"autopilot_sweep": True})

    assert fake_ecs.run_task_calls == []
    assert "story-9" not in fake_clickup.status_updates
    assert json.loads(result["body"])["merge_resolved"] == 0
    assert "could not confirm PR #42" in capsys.readouterr().out


def test_merge_pending_park_is_never_auto_resumed(fake_clickup, fake_ecs, fake_pull_requests):
    # Still open — resolve_merge_pending_parks leaves it alone — but it must
    # ALSO never fall through to the generic auto-resume path: that would
    # spend a paid resume run re-doing the identical GitHub check for free.
    fake_clickup.parked_tasks[STORY_LIST_ID] = [task("story-9", router.STATUS_FEEDBACK_NEEDED, parent="epic-1")]
    fake_clickup.comments["story-9"] = [merge_pending_park(42)]
    fake_pull_requests[42] = {"merged": False, "state": "open"}

    result = sweep.handle_sweep({"autopilot_sweep": True})

    resumes = [c for c in fake_ecs.run_task_calls if env_vars(c)["AUTOPILOT_STAGE"] == router.STAGE_RESUME]
    assert resumes == []
    assert json.loads(result["body"])["auto_resumed"] == 0


def test_non_merge_pending_park_is_unaffected_by_the_resolution_pass(fake_clickup, fake_ecs, fake_pull_requests):
    # A real question, or "QA failed", or "Deploy pending" must never even
    # trigger a GitHub read.
    fake_clickup.parked_tasks[STORY_LIST_ID] = [task("story-9", router.STATUS_FEEDBACK_NEEDED, parent="epic-1")]
    fake_clickup.comments["story-9"] = [parked_comment("story", "Should this endpoint require an admin role?")]

    sweep.handle_sweep({"autopilot_sweep": True})

    assert fake_pull_requests.calls == []


# ---------------------------------------------------------------------------
# fetch_pull_request — the GitHub read itself
# ---------------------------------------------------------------------------


def test_fetch_pull_request_none_without_a_token(monkeypatch):
    monkeypatch.setattr(sweep.github_auth, "installation_token", lambda: None)

    assert sweep.fetch_pull_request(42) is None


def test_fetch_pull_request_returns_parsed_json(monkeypatch):
    monkeypatch.setattr(sweep.github_auth, "installation_token", lambda: "ghs_test")

    class FakeResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

        def read(self):
            return json.dumps({"merged": True, "state": "closed"}).encode()

    monkeypatch.setattr(sweep, "urlopen", lambda req, timeout=10: FakeResponse())

    assert sweep.fetch_pull_request(42) == {"merged": True, "state": "closed"}


def test_fetch_pull_request_none_and_logs_on_network_failure(monkeypatch, capsys):
    monkeypatch.setattr(sweep.github_auth, "installation_token", lambda: "ghs_test")

    def failing_urlopen(req, timeout=10):
        raise TimeoutError("connection timed out")

    monkeypatch.setattr(sweep, "urlopen", failing_urlopen)

    assert sweep.fetch_pull_request(42) is None
    assert "ERROR: sweep failed to read PR #42" in capsys.readouterr().out


def run_summary_comment(stage, outcome, cost_usd=None, comment_id="summary-1", date="3000"):
    marker = f"[autopilot:run-summary stage={stage} outcome={outcome}"
    if cost_usd is not None:
        marker += f" cost_usd={cost_usd}"
    marker += "]"
    return {"id": comment_id, "comment_text": f"{marker}\n\n**Outcome:** {outcome}", "date": date}


def test_bot_run_summary_after_a_park_does_not_falsely_mark_it_answered(fake_clickup, fake_ecs):
    # ENG-11151's critical interaction: main.py posts a run-summary comment at
    # the end of EVERY run, including a run that itself just parked. That
    # comment always lands with a LATER date than the park it describes, so
    # naively treating "any comment after the park" as a human answer would
    # permanently wedge this park — no other path would ever wake it, since
    # the comment-resume route already (and correctly) drops the same
    # comment as a bot-authored, non-slack-answer write (see half 2 below).
    # A "Deploy pending" park: still auto-resume's domain after ENG-11147
    # (merge-pending parks moved to the sweep's own resolution pass, so a
    # merge-pending fixture here would test that skip, not this exclusion).
    fake_clickup.parked_tasks[STORY_LIST_ID] = [task("story-9", router.STATUS_FEEDBACK_NEEDED, parent="epic-1")]
    fake_clickup.comments["story-9"] = [
        parked_comment("story", "Deploy pending: PR #42 merged, dev deploy not yet verified.", date="2000"),
        run_summary_comment("story", "feedback_parked", cost_usd=3.71, date="3000"),
    ]

    # Half 1: the sweep's auto-resume still fires — the run-summary comment
    # must not read as "answered".
    result = sweep.handle_sweep({"autopilot_sweep": True})

    resumes = [c for c in fake_ecs.run_task_calls if env_vars(c)["AUTOPILOT_STAGE"] == router.STAGE_RESUME]
    assert len(resumes) == 1
    assert json.loads(result["body"])["auto_resumed"] == 1

    # Half 2: if ClickUp's own webhook also fires for that same comment (a
    # real commentPosted delivery, independent of the sweep), the self-resume
    # guard drops it too — the bot's own narration must never be the thing
    # that wakes a resume.
    event = router.RoutableEvent(
        kind="commentPosted",
        task_id="story-9",
        list_id=STORY_LIST_ID,
        current_status=router.STATUS_FEEDBACK_NEEDED,
        transitions=[],
        event_ts="1700000000000",
        event_actor_id=BOT_USER_ID,
        epic_task_id="epic-1",
        latest_comment_text=fake_clickup.comments["story-9"][-1]["comment_text"],
    )
    assert router.route(event) == []


# ---------------------------------------------------------------------------
# Pinned #autopilot status card (ENG-11151)
# ---------------------------------------------------------------------------


def test_status_card_is_posted_fresh_on_the_first_tick(fake_clickup, fake_slack_status_card):
    sweep.handle_sweep({"autopilot_sweep": True})

    assert len(fake_slack_status_card["posted"]) == 1
    assert len(fake_slack_status_card["pinned"]) == 1
    state = sweep.get_status_card_state()
    assert state is not None
    assert state["channel"] == "#autopilot-test"


def test_status_card_is_edited_in_place_on_the_next_tick(fake_clickup, fake_slack_status_card):
    sweep.handle_sweep({"autopilot_sweep": True})
    sweep.handle_sweep({"autopilot_sweep": True})

    assert len(fake_slack_status_card["posted"]) == 1
    assert len(fake_slack_status_card["updated"]) == 1
    assert len(fake_slack_status_card["pinned"]) == 1  # never re-pinned on an in-place edit


def test_status_card_self_heals_when_the_message_was_deleted(fake_clickup, fake_slack_status_card):
    sweep.handle_sweep({"autopilot_sweep": True})
    first_state = sweep.get_status_card_state()
    # Simulate the message having been deleted out from under the card: the
    # fake's chat.update fails for a ts it no longer knows about.
    del fake_slack_status_card["messages"][first_state["ts"]]

    sweep.handle_sweep({"autopilot_sweep": True})

    assert len(fake_slack_status_card["posted"]) == 2
    assert len(fake_slack_status_card["pinned"]) == 2
    second_state = sweep.get_status_card_state()
    assert second_state["ts"] != first_state["ts"]


def test_status_card_skips_gracefully_without_a_configured_channel(fake_clickup, fake_slack_status_card, monkeypatch):
    monkeypatch.setenv("AUTOPILOT_SLACK_CHANNEL", "")

    result = sweep.handle_sweep({"autopilot_sweep": True})

    assert result["statusCode"] == 200
    assert fake_slack_status_card["posted"] == []
    assert sweep.get_status_card_state() is None


def test_status_card_reports_in_flight_story_outcome_and_cost_from_active_claim(
    fake_clickup, fake_slack_status_card, monkeypatch
):
    # "In-flight stories (from board state + active per-story claims)": the
    # epic is executing (board state), its one subtask is still formally
    # queued on the board (the race window before the stage runner's own
    # first ClickUp status write lands), and the supervisor's own per-story
    # DynamoDB claim is what names it as in flight.
    monkeypatch.setattr(sweep.supervisor, "run_supervisor_tick", lambda epic_task_id: None)
    fake_clickup.executing_tasks[FEATURE_LIST_ID] = [task("epic-9", router.STATUS_EXECUTING)]
    fake_clickup.subtasks["epic-9"] = ["story-42"]
    fake_clickup.tasks["story-42"] = task("story-42", router.STATUS_APPROVED_TDD)
    fake_clickup.comments["story-42"] = [run_summary_comment("story", "success", cost_usd=3.71)]
    sweep.supervisor.claim_story_in_flight("epic-9", "story-42", ttl_seconds=3600)

    sweep.handle_sweep({"autopilot_sweep": True})

    text = fake_slack_status_card["posted"][0][1]
    assert "epic-9" in text
    assert "story-42" in text
    assert "success" in text
    assert "$3.71" in text


def test_status_card_reports_no_story_in_flight_when_the_claim_is_empty(
    fake_clickup, fake_slack_status_card, monkeypatch
):
    monkeypatch.setattr(sweep.supervisor, "run_supervisor_tick", lambda epic_task_id: None)
    fake_clickup.executing_tasks[FEATURE_LIST_ID] = [task("epic-9", router.STATUS_EXECUTING)]
    fake_clickup.subtasks["epic-9"] = []

    sweep.handle_sweep({"autopilot_sweep": True})

    text = fake_slack_status_card["posted"][0][1]
    assert "no story in flight" in text


def test_status_card_lists_parked_stories_awaiting_feedback(fake_clickup, fake_slack_status_card):
    fake_clickup.parked_tasks[STORY_LIST_ID] = [task("story-9", router.STATUS_FEEDBACK_NEEDED, parent="epic-1")]
    fake_clickup.comments["story-9"] = [parked_comment("story", "Merge pending: PR #42 armed but not merged.")]

    sweep.handle_sweep({"autopilot_sweep": True})

    text = fake_slack_status_card["posted"][0][1]
    assert "story-9" in text
    assert "Awaiting feedback" in text


def test_status_card_escapes_slack_markdown_in_task_names(fake_clickup, fake_slack_status_card):
    # A ClickUp task titled with '<', '>', or '&' must not break the Slack
    # mrkdwn link syntax (`<url|label>`) the status card builds around it.
    fake_clickup.in_progress_tasks[FEATURE_LIST_ID] = [
        {**task("epic-1", router.STATUS_IN_PROGRESS), "name": "Fix <select> & <Foo> component"}
    ]

    sweep.handle_sweep({"autopilot_sweep": True})

    text = fake_slack_status_card["posted"][0][1]
    assert "Fix &lt;select&gt; &amp; &lt;Foo&gt; component" in text
    assert "Fix <select>" not in text


def test_status_card_skips_a_malformed_task_without_a_valid_id(fake_clickup, fake_slack_status_card):
    # Defensive against ClickUp's untrusted response shape, same as every
    # other task-id check in this module — one bad row must not crash the
    # whole status-card build (which would otherwise lose the update for
    # every OTHER, well-formed card this same tick).
    fake_clickup.in_progress_tasks[FEATURE_LIST_ID] = [{"status": {"status": router.STATUS_IN_PROGRESS}}]

    result = sweep.handle_sweep({"autopilot_sweep": True})

    assert result["statusCode"] == 200
    text = fake_slack_status_card["posted"][0][1]
    assert "*Planning (in progress)* (0)" in text


def test_status_card_failure_never_fails_the_sweep_tick(fake_clickup, fake_slack_status_card, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("Slack is down")

    monkeypatch.setattr(sweep.supervisor, "post_slack_message_with_ts", boom)

    result = sweep.handle_sweep({"autopilot_sweep": True})

    assert result["statusCode"] == 200


def test_status_card_state_save_failure_skips_the_pin_and_fails_no_tick(
    fake_clickup, fake_slack_status_card, monkeypatch
):
    # If the ts never persisted, the next tick can't find this message and
    # will post a fresh one — pinning here would accumulate one pinned
    # duplicate per tick for the whole DynamoDB outage.
    def boom(*args, **kwargs):
        raise RuntimeError("DynamoDB is down")

    monkeypatch.setattr(sweep, "save_status_card_state", boom)

    result = sweep.handle_sweep({"autopilot_sweep": True})

    assert result["statusCode"] == 200
    assert fake_slack_status_card["pinned"] == []


# ---------------------------------------------------------------------------
# Flag-cleanup ramp pickup (ENG-11152)
# ---------------------------------------------------------------------------

FLAG_KEY = "win-new-thing"
CLEANUP_TASK_ID = "cleanup-1"
CLOSED_EPIC_ID = "epic-closed-1"


def flag_state(rollout_percentage=100.0, enabled=True):
    return {"enabled": enabled, "rollout_percentage": rollout_percentage}


def register_flag_cleanup_candidate(
    fake_clickup, epic_id=CLOSED_EPIC_ID, cleanup_task_id=CLEANUP_TASK_ID, flag_key=FLAG_KEY
):
    fake_clickup.subtasks[epic_id] = [cleanup_task_id]
    fake_clickup.tasks[cleanup_task_id] = {
        "id": cleanup_task_id,
        "status": {"status": router.STATUS_DONE},
        "description": f"Flag cleanup ticket.\n\nflag-key: {flag_key}\n",
    }


def seed_old_ramp_timer(fake_dynamodb, flag_key=FLAG_KEY, days_ago=8):
    old_ts = time.time() - days_ago * 24 * 60 * 60
    fake_dynamodb.items[sweep.flag_ramp_pk(flag_key)] = {
        "pk": {"S": sweep.flag_ramp_pk(flag_key)},
        "flag_key": {"S": flag_key},
        "first_seen_full_ramp_at": {"N": str(old_ts)},
        "expires_at": {"N": str(int(time.time() + 999_999))},
    }


def test_flag_below_full_rollout_never_promotes_or_starts_a_timer(fake_clickup, fake_ecs, monkeypatch):
    register_flag_cleanup_candidate(fake_clickup)
    monkeypatch.setattr(sweep, "_read_prod_flag_rollout", lambda key: flag_state(rollout_percentage=50.0))

    promoted = sweep.check_flag_cleanup_ramps([{"id": CLOSED_EPIC_ID}])

    assert promoted == 0
    assert sweep.get_flag_ramp_first_seen(FLAG_KEY) is None
    assert CLEANUP_TASK_ID not in fake_clickup.status_updates
    assert fake_ecs.run_task_calls == []


def test_flag_at_full_rollout_starts_the_timer_without_promoting(fake_clickup, fake_ecs, monkeypatch):
    register_flag_cleanup_candidate(fake_clickup)
    monkeypatch.setattr(sweep, "_read_prod_flag_rollout", lambda key: flag_state())

    promoted = sweep.check_flag_cleanup_ramps([{"id": CLOSED_EPIC_ID}])

    assert promoted == 0
    assert sweep.get_flag_ramp_first_seen(FLAG_KEY) is not None
    assert CLEANUP_TASK_ID not in fake_clickup.status_updates
    assert fake_ecs.run_task_calls == []


def test_rollback_below_full_rollout_resets_an_already_running_timer(fake_clickup, fake_dynamodb, monkeypatch):
    register_flag_cleanup_candidate(fake_clickup)
    seed_old_ramp_timer(fake_dynamodb, days_ago=1)  # running, but not yet past the 7-day default
    monkeypatch.setattr(sweep, "_read_prod_flag_rollout", lambda key: flag_state(rollout_percentage=80.0))

    promoted = sweep.check_flag_cleanup_ramps([{"id": CLOSED_EPIC_ID}])

    assert promoted == 0
    assert sweep.get_flag_ramp_first_seen(FLAG_KEY) is None


def test_flag_ramped_past_threshold_promotes_exactly_once_and_dispatches(
    fake_clickup, fake_ecs, fake_dynamodb, monkeypatch
):
    register_flag_cleanup_candidate(fake_clickup)
    seed_old_ramp_timer(fake_dynamodb, days_ago=8)
    monkeypatch.setattr(sweep, "_read_prod_flag_rollout", lambda key: flag_state())

    first = sweep.check_flag_cleanup_ramps([{"id": CLOSED_EPIC_ID}])
    second = sweep.check_flag_cleanup_ramps([{"id": CLOSED_EPIC_ID}])

    assert first == 1
    # The second tick finds no candidate at all: the ticket's own status
    # already moved off `done` (the fake mirrors the real ClickUp write —
    # see FakeClickUp's PUT handler), so it drops out of
    # _flag_cleanup_candidates before the dedup claim is even consulted.
    # test_flag_cleanup_promotion_claim_survives_a_racing_overlapping_tick
    # below exercises the claim itself, for the narrower race where two
    # ticks reach the claim before either has written the status back.
    assert second == 0
    assert fake_clickup.status_updates[CLEANUP_TASK_ID] == [router.STATUS_APPROVED_TDD]
    # The queue move alone dispatches nothing — check_flag_cleanup_ramps must
    # drive the closed epic's supervisor tick itself so the promoted story is
    # picked up in the very same pass, since no other sweep path or webhook
    # would ever reach a `done` feature card.
    assert len(fake_ecs.run_task_calls) == 1
    assert env_vars(fake_ecs.run_task_calls[0])["CLICKUP_TASK_ID"] == CLEANUP_TASK_ID
    assert env_vars(fake_ecs.run_task_calls[0])["AUTOPILOT_STAGE"] == router.STAGE_STORY


def test_supervisor_tick_failure_after_promotion_rolls_back_for_a_clean_retry(fake_clickup, fake_dynamodb, monkeypatch):
    # Once the ticket's status leaves `done`, _flag_cleanup_candidates never
    # finds it again, and nothing else in the sweep drives a story under a
    # closed feature card — so a tick failure right after the promote move
    # must roll both the move and the claim back, or the story is silently
    # stranded in the queue forever.
    register_flag_cleanup_candidate(fake_clickup)
    seed_old_ramp_timer(fake_dynamodb, days_ago=8)
    monkeypatch.setattr(sweep, "_read_prod_flag_rollout", lambda key: flag_state())

    def failing_tick(epic_task_id):
        raise RuntimeError("ClickUp unavailable")

    monkeypatch.setattr(sweep.supervisor, "run_supervisor_tick", failing_tick)

    promoted = sweep.check_flag_cleanup_ramps([{"id": CLOSED_EPIC_ID}])

    assert promoted == 0
    assert fake_clickup.status_updates[CLEANUP_TASK_ID][-1] == router.STATUS_DONE
    # Claim released — the next tick must not see "already promoted" and skip
    # a ticket that never actually got dispatched.
    assert sweep.claim_flag_cleanup_promotion(CLEANUP_TASK_ID) is None


def test_promoted_cleanup_story_reaching_done_closes_out_without_duplicating(
    fake_clickup, fake_ecs, fake_dynamodb, monkeypatch
):
    # End-to-end AC: promote -> dispatch -> the cleanup story finishes like
    # any other story and reaches `done`. The epic's real close-out already
    # happened once (that's how the flag-cleanup ticket got filed in the
    # first place) and holds its own claim — this drives the SAME
    # `run_supervisor_tick` a real story-done webhook would, confirming the
    # closed-card path reaches `done` cleanly rather than filing a second
    # cleanup ticket or posting a second Slack summary.
    register_flag_cleanup_candidate(fake_clickup)
    seed_old_ramp_timer(fake_dynamodb, days_ago=8)
    monkeypatch.setattr(sweep, "_read_prod_flag_rollout", lambda key: flag_state())
    assert sweep.supervisor.claim_epic_close_out(CLOSED_EPIC_ID) is None  # models the epic's earlier real close-out

    promoted = sweep.check_flag_cleanup_ramps([{"id": CLOSED_EPIC_ID}])
    assert promoted == 1
    assert len(fake_ecs.run_task_calls) == 1

    # The cleanup story finishes and its own stage run moves it to `done`.
    fake_clickup.tasks[CLEANUP_TASK_ID] = {
        **fake_clickup.tasks[CLEANUP_TASK_ID],
        "status": {"status": router.STATUS_DONE},
    }

    sweep.supervisor.run_supervisor_tick(CLOSED_EPIC_ID)

    # No second dispatch, and (implicitly) no crash reaching for a POST this
    # fake doesn't even answer — close_out_epic's own claim short-circuits
    # before it would ever try to file a second ticket or post a second
    # summary.
    assert len(fake_ecs.run_task_calls) == 1


def test_flag_cleanup_promotion_claim_survives_a_racing_overlapping_tick(fake_clickup, fake_ecs, fake_dynamodb):
    # Models two overlapping sweep invocations (a slow prior Lambda still
    # finishing when the next 15-minute cron fires) both past the promotion
    # decision at once — the dedup claim, not the ClickUp move itself, is
    # what must make this exactly one promotion.
    register_flag_cleanup_candidate(fake_clickup)

    first_reason = sweep.claim_flag_cleanup_promotion(CLEANUP_TASK_ID)
    second_reason = sweep.claim_flag_cleanup_promotion(CLEANUP_TASK_ID)

    assert first_reason is None
    assert second_reason == "already promoted"


def test_amplitude_read_failure_skips_the_flag_this_tick_without_crashing(fake_clickup, fake_ecs, monkeypatch):
    register_flag_cleanup_candidate(fake_clickup)
    monkeypatch.setattr(sweep, "_read_prod_flag_rollout", lambda key: None)

    promoted = sweep.check_flag_cleanup_ramps([{"id": CLOSED_EPIC_ID}])

    assert promoted == 0
    assert sweep.get_flag_ramp_first_seen(FLAG_KEY) is None
    assert fake_ecs.run_task_calls == []


def test_missing_flag_key_skips_the_candidate_entirely(fake_clickup, fake_ecs, monkeypatch):
    # A cleanup ticket filed without a parseable flag-key line (epic-create's
    # summary never named one) must never be guessed at — it's invisible to
    # this pass, not merely skipped for one tick.
    fake_clickup.subtasks[CLOSED_EPIC_ID] = [CLEANUP_TASK_ID]
    fake_clickup.tasks[CLEANUP_TASK_ID] = {
        "id": CLEANUP_TASK_ID,
        "status": {"status": router.STATUS_DONE},
        "description": "Flag cleanup ticket. No machine-readable key here.",
    }
    read_calls = []
    monkeypatch.setattr(sweep, "_read_prod_flag_rollout", lambda key: read_calls.append(key))

    promoted = sweep.check_flag_cleanup_ramps([{"id": CLOSED_EPIC_ID}])

    assert promoted == 0
    assert read_calls == []
    assert fake_ecs.run_task_calls == []


def test_flag_cleanup_ramp_check_is_bounded_per_tick(fake_clickup, fake_ecs, monkeypatch):
    epic_ids = [f"epic-{i}" for i in range(sweep.FLAG_CLEANUP_AMPLITUDE_READ_CAP + 2)]
    for i, epic_id in enumerate(epic_ids):
        register_flag_cleanup_candidate(
            fake_clickup, epic_id=epic_id, cleanup_task_id=f"cleanup-{i}", flag_key=f"flag-{i}"
        )
    read_calls = []

    def fake_read(flag_key):
        read_calls.append(flag_key)
        return flag_state(rollout_percentage=50.0)  # never promotes — isolates the cap itself

    monkeypatch.setattr(sweep, "_read_prod_flag_rollout", fake_read)

    sweep.check_flag_cleanup_ramps([{"id": epic_id} for epic_id in epic_ids])

    assert len(read_calls) == sweep.FLAG_CLEANUP_AMPLITUDE_READ_CAP


def test_flag_cleanup_ramp_days_env_overrides_the_default(monkeypatch):
    monkeypatch.setenv("FLAG_CLEANUP_RAMP_DAYS", "1")
    assert sweep.flag_cleanup_ramp_days() == 1.0


def test_flag_cleanup_ramp_days_ignores_unusable_env(monkeypatch):
    monkeypatch.setenv("FLAG_CLEANUP_RAMP_DAYS", "not-a-number")
    assert sweep.flag_cleanup_ramp_days() == sweep.DEFAULT_FLAG_CLEANUP_RAMP_DAYS


def test_handle_sweep_reports_flag_cleanup_promotions(fake_clickup, fake_ecs, fake_dynamodb, monkeypatch):
    register_flag_cleanup_candidate(fake_clickup)
    fake_clickup.done_tasks[FEATURE_LIST_ID] = [task(CLOSED_EPIC_ID, router.STATUS_DONE)]
    seed_old_ramp_timer(fake_dynamodb, days_ago=8)
    monkeypatch.setattr(sweep, "_read_prod_flag_rollout", lambda key: flag_state())

    result = sweep.handle_sweep({"autopilot_sweep": True})

    assert json.loads(result["body"])["flag_cleanup_promoted"] == 1


def test_flag_cleanup_check_failure_never_fails_the_sweep_tick(fake_clickup, monkeypatch):
    fake_clickup.done_tasks[FEATURE_LIST_ID] = [task(CLOSED_EPIC_ID, router.STATUS_DONE)]
    monkeypatch.setattr(
        sweep,
        "_flag_cleanup_candidates",
        lambda closed_epics: (_ for _ in ()).throw(RuntimeError("boom")),
    )

    result = sweep.handle_sweep({"autopilot_sweep": True})

    assert result["statusCode"] == 200
    assert json.loads(result["body"])["flag_cleanup_promoted"] == 0
