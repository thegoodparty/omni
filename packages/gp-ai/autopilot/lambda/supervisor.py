"""Autopilot conductor: epic supervisor.

Runs once per epic per tick (a routed webhook event, or a sweep discovering
an executing feature card — see sweep.py). Reads the epic's stories straight
from ClickUp (plain HTTP, mirroring clickup_bot's client — see handler.py's
module docstring for why this Lambda stays dependency-light) and decides one
of three things:

  - dispatch the next unblocked story (ClickUp dependency links first, then
    board order; a story sitting in "feedback needed" is a human's turn, not
    a candidate)
  - do nothing, because a story is already in flight (phase 1 is strictly
    one story at a time — no concurrency knobs)
  - close the epic out, because every story is done

A DynamoDB claim (same table dispatch.py's per-transition claims live in,
but a SEPARATE key family: `epic#{epic_task_id}` vs. dispatch.claim_pk's
`{task_id}#{stage}#{transitioned_at}`) makes "one story in flight" safe
against two ticks racing on the same epic — a webhook and an overlapping
sweep pass, most concretely. The claim's TTL always exceeds the story
stage's own deadline (plus dispatch's grace window), so it can never expire
out from under a story that is still legitimately running.

Stall detection is a Slack alert only, never an auto-retry: a story that
sits past its per-status TTL gets exactly one alert (recorded on the epic
claim item as `alerted_at`, so a repeated sweep tick does not re-alert), and
that is where phase 1 stops. Diagnosing *why* a story stalled is phase 2.
"""

import importlib.util
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from botocore.exceptions import ClientError

CLICKUP_BASE_URL = "https://api.clickup.com/api/v2"
SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage"
SLACK_CONVERSATIONS_REPLIES_URL = "https://slack.com/api/conversations.replies"

# Plain env var, not Secrets Manager — same posture as
# AUTOPILOT_CLICKUP_WEBHOOK_SECRET (see handler.py's module docstring): this
# Lambda has no secrets-outage degrade mode to reproduce, so there is no
# reason to add the extra dependency and failure mode.
CLICKUP_API_KEY_ENV = "AUTOPILOT_CLICKUP_API_KEY"
SLACK_BOT_TOKEN_ENV = "SLACK_BOT_TOKEN"
SLACK_CHANNEL_ENV = "AUTOPILOT_SLACK_CHANNEL"

EPIC_CLAIM_PREFIX = "epic#"
EPIC_CLOSE_OUT_PREFIX = "epic-closed#"
# Long-lived, unlike the in-flight claim's TTL: close-out is a one-time
# terminal action, not a per-run transition with a natural deadline to size
# a TTL against. 30 days comfortably outlives any operator's incident
# window while still letting the table eventually reclaim the item.
EPIC_CLOSE_OUT_TTL_SECONDS = 30 * 24 * 60 * 60


def _load_sibling_module(stem: str) -> Any:
    """See handler.py's own copy for why this can't be a normal import."""
    module_name = f"autopilot_conductor_{stem}"
    if module_name in sys.modules:
        return sys.modules[module_name]
    module_path = Path(__file__).resolve().parent / f"{stem}.py"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


router = _load_sibling_module("router")
dispatch = _load_sibling_module("dispatch")
# Only for _normalize_ts / _status_label — safe to load back even though
# handler.py loads this module: see the long comment at the bottom of
# handler.py for why the ordering makes that safe.
handler = _load_sibling_module("handler")


# ---------------------------------------------------------------------------
# ClickUp HTTP (plain, dependency-light — mirrors clickup_bot's client).
# sweep.py reuses these rather than keeping its own copy.
# ---------------------------------------------------------------------------


def clickup_request(method: str, endpoint: str, data: dict | None = None) -> dict:
    url = f"{CLICKUP_BASE_URL}{endpoint}"
    headers = {
        "Authorization": os.environ.get(CLICKUP_API_KEY_ENV, ""),
        "Content-Type": "application/json",
    }
    body = json.dumps(data).encode() if data is not None else None
    req = Request(url, data=body, headers=headers, method=method)
    with urlopen(req, timeout=10) as response:
        return json.loads(response.read().decode())


def get_task(task_id: str) -> dict:
    return clickup_request("GET", f"/task/{task_id}")


def get_task_comments(task_id: str) -> list[dict]:
    result = clickup_request("GET", f"/task/{task_id}/comment")
    comments = result.get("comments")
    return [c for c in comments if isinstance(c, dict)] if isinstance(comments, list) else []


def clickup_task_url(task_id: str) -> str:
    return f"https://app.clickup.com/t/{task_id}"


def move_task_status(task_id: str, status: str) -> None:
    clickup_request("PUT", f"/task/{task_id}", {"status": status})


def create_task_comment(task_id: str, comment_text: str) -> dict:
    """Used by handler.py's Slack ingress to relay a thread reply onto the
    card as an ordinary comment — deliberately just another ClickUp write,
    not a special path: ClickUp's own webhook fires for it and drives the
    resume through the same hardened commentPosted route a human's own
    ClickUp comment takes (see router.route()'s is_slack_relay_comment)."""
    return clickup_request("POST", f"/task/{task_id}/comment", {"comment_text": comment_text})


# ---------------------------------------------------------------------------
# Slack HTTP (plain, dependency-light — same posture as clickup_request
# above and post_slack_message below).
# ---------------------------------------------------------------------------


def slack_conversations_replies(channel: str, thread_ts: str | None) -> list[dict]:
    """The messages in a Slack thread, oldest first — index 0 is the thread
    root, which is what handler.py's Slack ingress needs to confirm a reply
    landed on one of our own park/notify pings (see router.slack_ping_task_id).
    Needs the bot's channels:history scope; chat:write (already granted for
    park/notify) does NOT imply it — see autopilot/README.md's ops note."""
    token = os.environ.get(SLACK_BOT_TOKEN_ENV, "")
    if not token:
        raise RuntimeError("SLACK_BOT_TOKEN not configured; cannot read Slack thread")
    if not thread_ts:
        raise ValueError("thread_ts is required to read a Slack thread")

    query = urlencode({"channel": channel, "ts": thread_ts})
    req = Request(
        f"{SLACK_CONVERSATIONS_REPLIES_URL}?{query}",
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    with urlopen(req, timeout=10) as response:
        result = json.loads(response.read().decode())
    if not result.get("ok"):
        raise RuntimeError(f"Slack conversations.replies returned an error: {result.get('error')}")
    messages = result.get("messages")
    return [m for m in messages if isinstance(m, dict)] if isinstance(messages, list) else []


# ---------------------------------------------------------------------------
# Story model
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Story:
    task_id: str
    status: str
    order_index: str
    depends_on: frozenset[str]

    @property
    def is_done(self) -> bool:
        return self.status == router.STATUS_DONE

    @property
    def is_feedback_needed(self) -> bool:
        return self.status == router.STATUS_FEEDBACK_NEEDED

    @property
    def is_in_flight(self) -> bool:
        # Everything that is neither queued (a fresh story lands in the
        # list's first status, "approved tdd" — the shared board has no
        # story-specific "to do" column), done, nor waiting on a human.
        return self.status not in (router.STATUS_APPROVED_TDD, router.STATUS_DONE, router.STATUS_FEEDBACK_NEEDED)


def _story_from_task(task: dict) -> Story | None:
    if not isinstance(task, dict):
        return None
    task_id = task.get("id")
    if not isinstance(task_id, str) or not task_id:
        return None
    status = handler._status_label(task.get("status"))
    if status is None:
        return None
    order_index = task.get("orderindex")
    if not isinstance(order_index, str):
        order_index = ""

    depends_on = set()
    for dep in task.get("dependencies") or []:
        if not isinstance(dep, dict):
            continue
        # ClickUp's dependency object reads as "task_id is blocked on
        # depends_on" — only entries naming THIS task as the blocked side
        # count as one of its own blockers.
        if dep.get("task_id") == task_id and isinstance(dep.get("depends_on"), str):
            depends_on.add(dep["depends_on"])

    return Story(task_id=task_id, status=status, order_index=order_index, depends_on=frozenset(depends_on))


def load_epic_stories(epic_task_id: str) -> list[Story]:
    try:
        # include_closed pins the contract close-out depends on: every story
        # must stay visible here whatever status it reaches. Probed live
        # (2026-09-14): this endpoint returns done- and even closed-type
        # subtasks without the flag, so it changes nothing today — it exists
        # so a ClickUp default change can't silently strand a fully-done epic.
        epic = clickup_request("GET", f"/task/{epic_task_id}?include_subtasks=true&include_closed=true")
    except Exception as e:
        print(f"ERROR: supervisor failed to load epic {epic_task_id}: {type(e).__name__}")
        return []

    subtasks = epic.get("subtasks")
    if not isinstance(subtasks, list):
        return []

    stories: list[Story] = []
    for entry in subtasks:
        if not isinstance(entry, dict):
            continue
        story_id = entry.get("id")
        if not isinstance(story_id, str) or not story_id:
            continue
        try:
            task = clickup_request("GET", f"/task/{story_id}")
        except Exception as e:
            print(f"ERROR: supervisor failed to load story {story_id} under epic {epic_task_id}: {type(e).__name__}")
            continue
        story = _story_from_task(task)
        if story is None:
            print(f"ERROR: story {story_id} under epic {epic_task_id} has an unreadable shape, skipping")
            continue
        stories.append(story)
    return stories


# ---------------------------------------------------------------------------
# Next-story selection — AC: dependency links first, then board order
# ---------------------------------------------------------------------------


def _order_key(order_index: str) -> float:
    # ClickUp's real orderindex is a large decimal-like string (a Trello-
    # style fractional position, not a small sequential integer), so a plain
    # string sort would misorder it past a handful of stories — "10" sorts
    # before "2" lexicographically. Parse numerically; an unparseable value
    # (missing/malformed) sorts last rather than crashing the tick.
    try:
        return float(order_index)
    except ValueError:
        return float("inf")


def select_next_story(stories: list[Story]) -> Story | None:
    done_ids = {s.task_id for s in stories if s.is_done}
    candidates = [s for s in stories if s.status == router.STATUS_APPROVED_TDD and s.depends_on <= done_ids]
    if not candidates:
        return None

    not_done = [s for s in stories if not s.is_done]
    # "Dependency links first": prefer a candidate that unblocks the most
    # other not-yet-done work, board order (orderindex) only as the tiebreak.
    blocks_count = {c.task_id: sum(1 for s in not_done if c.task_id in s.depends_on) for c in candidates}
    return sorted(candidates, key=lambda c: (-blocks_count[c.task_id], _order_key(c.order_index)))[0]


# ---------------------------------------------------------------------------
# One-in-flight-story epic claim
# ---------------------------------------------------------------------------


def epic_claim_pk(epic_task_id: str) -> str:
    return f"{EPIC_CLAIM_PREFIX}{epic_task_id}"


def _epic_claim_ttl_seconds() -> float:
    # Must exceed the story stage's own deadline (plus dispatch's grace
    # window) — sized any shorter and this claim could expire while a
    # dispatched story is still legitimately running, letting a second tick
    # dispatch a duplicate.
    story_ceiling = router.STAGE_CEILINGS[router.STAGE_STORY]
    return story_ceiling.deadline_seconds + dispatch.DEDUP_TTL_GRACE_SECONDS


def claim_epic_in_flight(epic_task_id: str, story_task_id: str, ttl_seconds: float) -> str | None:
    """Conditionally claims "this epic has one story in flight" so two
    supervisor ticks racing on the same epic (a webhook and an overlapping
    sweep tick, most concretely) can never both dispatch a second story.
    None = this call won the claim. A non-None string is the failure reason
    ("already claimed" | "dedup table not configured" | "dedup table
    unavailable") — distinct reasons for the same operational reason
    dispatch.claim_transition's are: a missing env var must not read as a
    phantom duplicate in CloudWatch.

    Separate key family from dispatch.claim_pk's `{task_id}#{stage}#{ts}`:
    this claim is scoped to the EPIC, never to one story's own transition,
    and must never be conflated with the per-transition claims
    dispatch_story's own dispatch.dispatch_stage call takes out.

    Records story_task_id on the item: the claim's own release is driven by
    "has THIS story reached done", not by "does ClickUp currently show
    anything in flight" — the latter is briefly, and normally, false in the
    window between a dispatch and the stage runner's own first ClickUp
    status write, and releasing on that signal would let the very next tick
    dispatch a second run for the same story.
    """
    table_name = os.environ.get("AUTOPILOT_DEDUP_TABLE")
    if not table_name:
        print("ERROR: AUTOPILOT_DEDUP_TABLE not configured; refusing epic dispatch")
        return "dedup table not configured"

    pk = epic_claim_pk(epic_task_id)
    expires_at = int(time.time() + ttl_seconds)
    try:
        dispatch.get_dynamodb_client().put_item(
            TableName=table_name,
            Item={
                "pk": {"S": pk},
                "epic_task_id": {"S": epic_task_id},
                "story_task_id": {"S": story_task_id},
                "expires_at": {"N": str(expires_at)},
            },
            # The third clause lets a real dispatch claim overwrite an
            # alert-only item: try_claim_stall_alert (notably the sweep's
            # pre-supervisor feature-card pass) writes this same pk with a
            # live expires_at but NO story_task_id, and without the clause
            # that item would block every dispatch on the epic until its TTL
            # lapses. A genuine in-flight claim always carries story_task_id,
            # so the clause is inert for those. Overwriting resets alerted_at
            # on purpose — a real dispatch starts a new phase with a fresh
            # one-alert budget.
            ConditionExpression="attribute_not_exists(pk) OR #exp < :now OR attribute_not_exists(story_task_id)",
            ExpressionAttributeNames={"#exp": "expires_at"},
            ExpressionAttributeValues={":now": {"N": str(int(time.time()))}},
        )
        return None
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            print(f"Epic already has a story in flight, skipping dispatch: {pk}")
            return "already claimed"
        print(f"ERROR: dedup table unavailable, refusing epic dispatch: {e}")
        return "dedup table unavailable"
    except Exception as e:
        print(f"ERROR: dedup table unavailable, refusing epic dispatch: {e}")
        return "dedup table unavailable"


def claimed_story_task_id(claim_item: dict | None) -> str | None:
    if claim_item is None:
        return None
    story_task_id = claim_item.get("story_task_id", {}).get("S")
    return story_task_id if isinstance(story_task_id, str) else None


def release_epic_claim(epic_task_id: str) -> None:
    table_name = os.environ.get("AUTOPILOT_DEDUP_TABLE")
    if not table_name:
        return
    try:
        dispatch.get_dynamodb_client().delete_item(
            TableName=table_name,
            Key={"pk": {"S": epic_claim_pk(epic_task_id)}},
        )
    except Exception as e:
        # Best-effort: a stale claim self-heals via its own TTL, so a failed
        # delete costs at most a delayed next dispatch, never a stuck epic.
        print(f"ERROR: failed to release epic claim for {epic_task_id}: {type(e).__name__}")


def get_epic_claim_item(epic_task_id: str) -> dict | None:
    table_name = os.environ.get("AUTOPILOT_DEDUP_TABLE")
    if not table_name:
        return None
    try:
        response = dispatch.get_dynamodb_client().get_item(
            TableName=table_name,
            Key={"pk": {"S": epic_claim_pk(epic_task_id)}},
        )
    except Exception as e:
        print(f"ERROR: failed to read epic claim for {epic_task_id}: {type(e).__name__}")
        return None
    item = response.get("Item")
    return item if isinstance(item, dict) else None


def try_claim_stall_alert(epic_task_id: str) -> bool:
    """Atomically claims the right to post ONE stall alert for this epic.
    Returns whether this call won. The DynamoDB write happens BEFORE the
    Slack post (see check_for_stalls) rather than after a separate read
    that decided whether to post: a webhook-triggered tick and the sweep's
    own unconditional per-executing-card pass (sweep.py) can run against the
    same epic at effectively the same time, and a read-then-write here would
    let both see "not yet alerted" and both post.

    A full PutItem, not an UpdateItem gated on the item already existing: a
    story can be discovered already in flight (e.g. a manual ClickUp drag,
    or a dispatch whose claim write failed) with NO claim item ever written
    for it, and an UpdateItem there would either upsert a pk with no
    expires_at (permanently jamming claim_epic_in_flight's own condition,
    which can never be satisfied against a missing expires_at) or,
    conditioned on existence, silently never claim and alert on every single
    tick forever. The condition below covers both "no item yet" and "item
    exists but has not alerted yet" in one atomic write, and preserves
    story_task_id from any existing claim: overwriting it away would make
    the NEXT tick's claimed_story_task_id read back None, forgetting which
    story this claim is protecting and letting that tick dispatch a
    duplicate for a story that is stalled, not finished.
    """
    table_name = os.environ.get("AUTOPILOT_DEDUP_TABLE")
    if not table_name:
        print("ERROR: AUTOPILOT_DEDUP_TABLE not configured; refusing to alert")
        return False

    existing = get_epic_claim_item(epic_task_id)
    item = {
        "pk": {"S": epic_claim_pk(epic_task_id)},
        "epic_task_id": {"S": epic_task_id},
        "expires_at": {"N": str(int(time.time() + _epic_claim_ttl_seconds()))},
        "alerted_at": {"N": str(int(time.time()))},
    }
    if existing is not None and "story_task_id" in existing:
        item["story_task_id"] = existing["story_task_id"]

    try:
        dispatch.get_dynamodb_client().put_item(
            TableName=table_name,
            Item=item,
            ConditionExpression="attribute_not_exists(pk) OR attribute_not_exists(alerted_at)",
        )
        return True
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False  # another tick already claimed this alert
        print(f"ERROR: failed to record stall alert for {epic_task_id}: {type(e).__name__}")
        return False
    except Exception as e:
        print(f"ERROR: failed to record stall alert for {epic_task_id}: {type(e).__name__}")
        return False


# ---------------------------------------------------------------------------
# Stall detection — alert only, never auto-retry
# ---------------------------------------------------------------------------

# Per-status TTLs for stories. STATUS_FEEDBACK_NEEDED is deliberately
# absent: waiting on a human is not a stall. STATUS_APPROVED_TDD (the story
# queue) and STATUS_DONE are absent too: nothing is "in flight" there.
# "in progress"'s 2h covers the whole dispatch-to-merge window — the story
# stage's first act on kickoff is moving the card there, so a dispatch that
# never starts surfaces as a story sitting in the queue while the epic claim
# expires, not as a distinct status.
STATUS_TTL_SECONDS: dict[str, int] = {
    router.STATUS_IN_PROGRESS: 2 * 60 * 60,
    router.STATUS_QA: 60 * 60,
    # Stories never reach executing in the pipeline (it is the feature card's
    # post-approval column), but a manual drag can put one there — and it
    # would read as in-flight with no TTL, silently freezing its epic once
    # the claim expires. A short TTL surfaces the anomaly fast instead.
    router.STATUS_EXECUTING: 30 * 60,
}


def _seconds_in_current_status(task_id: str) -> float | None:
    try:
        response = clickup_request("GET", f"/task/{task_id}/time_in_status")
    except Exception as e:
        print(f"ERROR: failed to read time_in_status for {task_id}: {type(e).__name__}")
        return None
    current = response.get("current_status")
    if not isinstance(current, dict):
        return None
    since = handler._normalize_ts(current.get("since"))
    if since is None:
        return None
    return time.time() - int(since) / 1000.0


def post_slack_message(text: str) -> None:
    token = os.environ.get(SLACK_BOT_TOKEN_ENV, "")
    channel = os.environ.get(SLACK_CHANNEL_ENV, "")
    if not token or not channel:
        print("ERROR: SLACK_BOT_TOKEN or AUTOPILOT_SLACK_CHANNEL not configured; dropping Slack message")
        return

    body = json.dumps({"channel": channel, "text": text}).encode()
    req = Request(
        SLACK_POST_MESSAGE_URL,
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=10) as response:
            result = json.loads(response.read().decode())
    except Exception as e:
        print(f"ERROR: failed to post Slack message: {type(e).__name__}")
        return
    if not result.get("ok"):
        print(f"ERROR: Slack chat.postMessage returned an error: {result.get('error')}")


def post_stall_alert(epic_task_id: str, story: Story) -> None:
    minutes = STATUS_TTL_SECONDS[story.status] // 60
    post_slack_message(
        f":warning: Autopilot story stalled in *{story.status}* for over {minutes} min: "
        f"{clickup_task_url(story.task_id)} (epic {clickup_task_url(epic_task_id)})"
    )


def check_for_stalls(epic_task_id: str, stories: list[Story]) -> None:
    for story in stories:
        ttl = STATUS_TTL_SECONDS.get(story.status)
        if ttl is None:
            continue
        elapsed = _seconds_in_current_status(story.task_id)
        if elapsed is None or elapsed < ttl:
            continue
        # Claim first, post second: see try_claim_stall_alert for why this
        # order (not a read-then-decide) is what makes "exactly one alert"
        # hold under two ticks racing on the same stalled story.
        if try_claim_stall_alert(epic_task_id):
            post_stall_alert(epic_task_id, story)


# ---------------------------------------------------------------------------
# Close-out
# ---------------------------------------------------------------------------


def epic_close_out_pk(epic_task_id: str) -> str:
    return f"{EPIC_CLOSE_OUT_PREFIX}{epic_task_id}"


def claim_epic_close_out(epic_task_id: str) -> str | None:
    """Conditionally claims "this epic has started closing out" so a
    redelivered webhook or an overlapping tick (the story-done path carries
    no per-transition dedup claim of its own, unlike a Fargate stage
    dispatch) can never file a second flag-cleanup ticket or post a second
    Slack summary for the same epic. None = this call won the claim and
    must proceed; a non-None string is the failure reason
    ("already closed" | "dedup table not configured" | "dedup table
    unavailable") — the caller must not proceed either way."""
    table_name = os.environ.get("AUTOPILOT_DEDUP_TABLE")
    if not table_name:
        print("ERROR: AUTOPILOT_DEDUP_TABLE not configured; refusing epic close-out")
        return "dedup table not configured"

    pk = epic_close_out_pk(epic_task_id)
    expires_at = int(time.time() + EPIC_CLOSE_OUT_TTL_SECONDS)
    try:
        dispatch.get_dynamodb_client().put_item(
            TableName=table_name,
            Item={"pk": {"S": pk}, "epic_task_id": {"S": epic_task_id}, "expires_at": {"N": str(expires_at)}},
            ConditionExpression="attribute_not_exists(pk)",
        )
        return None
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            print(f"Epic already closed out, skipping duplicate close-out: {pk}")
            return "already closed"
        print(f"ERROR: dedup table unavailable, refusing epic close-out: {e}")
        return "dedup table unavailable"
    except Exception as e:
        print(f"ERROR: dedup table unavailable, refusing epic close-out: {e}")
        return "dedup table unavailable"


def release_epic_close_out_claim(epic_task_id: str) -> None:
    table_name = os.environ.get("AUTOPILOT_DEDUP_TABLE")
    if not table_name:
        return
    try:
        dispatch.get_dynamodb_client().delete_item(
            TableName=table_name, Key={"pk": {"S": epic_close_out_pk(epic_task_id)}}
        )
    except Exception as e:
        print(f"ERROR: failed to release epic close-out claim for {epic_task_id}: {type(e).__name__}")


def file_flag_cleanup_ticket(epic_task_id: str) -> str | None:
    try:
        epic = get_task(epic_task_id)
    except Exception as e:
        print(f"ERROR: failed to read epic {epic_task_id} before filing its flag-cleanup ticket: {type(e).__name__}")
        return None

    epic_list = epic.get("list")
    list_id = epic_list.get("id") if isinstance(epic_list, dict) else None
    if not isinstance(list_id, str):
        print(f"ERROR: epic {epic_task_id} has no readable list id; cannot file flag-cleanup ticket")
        return None

    epic_name = epic.get("name") if isinstance(epic.get("name"), str) else epic_task_id
    try:
        created = clickup_request(
            "POST",
            f"/list/{list_id}/task",
            {
                "name": f"Flag cleanup: {epic_name}",
                "description": (
                    f"{epic_name} shipped dark behind a feature flag. Follow up to flip it on "
                    "in prod, or clean it up if the experiment did not land. (Filed by autopilot "
                    "at epic close-out; created in done so the pipeline never dispatches it — "
                    "reopen it when a human picks it up.)"
                ),
                "parent": epic_task_id,
                # Born done, deliberately: as a subtask of the epic it IS a
                # story to the supervisor, and the list default status is the
                # story queue — a later tick (a story-done webhook redelivery
                # racing close-out) would select it and burn a story-agent
                # run on an administrative ticket. is_done excludes it from
                # every candidate/all-done computation.
                "status": router.STATUS_DONE,
            },
        )
    except Exception as e:
        print(f"ERROR: failed to file flag-cleanup ticket for epic {epic_task_id}: {type(e).__name__}")
        return None

    cleanup_task_id = created.get("id")
    return cleanup_task_id if isinstance(cleanup_task_id, str) else None


def post_close_out_summary(epic_task_id: str, cleanup_task_id: str | None) -> None:
    cleanup_line = f" Flag cleanup: {clickup_task_url(cleanup_task_id)}." if cleanup_task_id else ""
    post_slack_message(f":white_check_mark: Autopilot epic complete: {clickup_task_url(epic_task_id)}.{cleanup_line}")


def close_out_epic(epic_task_id: str) -> None:
    """Runs exactly once per epic. Reached from two call sites in
    run_supervisor_tick (both once nothing is left in flight, and both fed
    purely by ClickUp's own story statuses — neither the epic-in-flight
    claim nor its own release protects a duplicate CALL to this function),
    and the story-done path that lands here carries no dedup claim of its
    own the way a Fargate stage dispatch does. A redelivered webhook for the
    final story reaching done, or a webhook tick racing an overlapping sweep
    tick, would otherwise file a second flag-cleanup ticket and post a
    second Slack summary — claim_epic_close_out is this function's own,
    dedicated guard against exactly that.
    """
    claim_reason = claim_epic_close_out(epic_task_id)
    if claim_reason is not None:
        return

    release_epic_claim(epic_task_id)
    try:
        move_task_status(epic_task_id, router.STATUS_DONE)
    except Exception as e:
        # Don't file a cleanup ticket or announce completion for a card that
        # was never actually marked done — a partial close-out would be
        # worse than none (a "complete" Slack post for a card still sitting
        # in executing). Release the claim too: nothing real happened yet,
        # so a later tick must be free to retry the whole close-out.
        print(f"ERROR: failed to move epic {epic_task_id} to done: {type(e).__name__}")
        release_epic_close_out_claim(epic_task_id)
        return
    cleanup_task_id = file_flag_cleanup_ticket(epic_task_id)
    post_close_out_summary(epic_task_id, cleanup_task_id)


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------


def dispatch_story(epic_task_id: str, story: Story) -> None:
    ceiling = router.STAGE_CEILINGS[router.STAGE_STORY]
    envelope = dispatch.StageEnvelope(
        stage=router.STAGE_STORY,
        task_id=story.task_id,
        epic_task_id=epic_task_id,
        model=router.DEFAULT_AGENT_MODEL,
        max_budget_usd=ceiling.max_budget_usd,
        deadline_seconds=ceiling.deadline_seconds,
    )
    # There is no ClickUp-delivered transition timestamp here — the
    # supervisor's own decision to dispatch IS the transition — so
    # dispatch.dispatch_stage's per-transition claim key is keyed off "now".
    # The real duplicate-dispatch protection is the epic claim the caller
    # already holds by this point.
    transitioned_at = str(int(time.time() * 1000))
    result = dispatch.dispatch_stage(story.task_id, router.STAGE_STORY, transitioned_at, envelope)
    if not result.get("dispatched"):
        print(
            "ERROR: supervisor failed to dispatch story "
            f"{story.task_id} for epic {epic_task_id}: {result.get('reason')}"
        )


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------


def run_supervisor_tick(epic_task_id: str) -> None:
    """The epic conductor loop. Called for every entry point: the
    breakdown-approval gate, a story reaching done, and a sweep tick over
    every card sitting in "executing" (see sweep.py)."""
    stories = load_epic_stories(epic_task_id)
    by_task_id = {s.task_id: s for s in stories}

    check_for_stalls(epic_task_id, stories)

    claim_item = get_epic_claim_item(epic_task_id)
    claimed_id = claimed_story_task_id(claim_item)

    if claimed_id is not None:
        claimed_story = by_task_id.get(claimed_id)
        if claimed_story is not None and claimed_story.is_done:
            # The story the claim was protecting has actually finished —
            # release it before deciding what happens next.
            release_epic_claim(epic_task_id)
            claimed_id = None
        else:
            # The claim still protects a story that has not reached done —
            # including the normal window right after a dispatch, before the
            # stage runner's own first ClickUp status write lands, when
            # is_in_flight below would otherwise read as "nothing running"
            # and let this very tick dispatch a duplicate. One story at a
            # time, full stop, while a claim stands.
            if stories and all(s.is_done for s in stories):
                close_out_epic(epic_task_id)
            return

    if stories and all(s.is_done for s in stories):
        close_out_epic(epic_task_id)
        return

    # No claim in force. A story ClickUp itself shows in flight without our
    # own claim (a manual kickoff, or a claim that already expired) must
    # still block a new dispatch.
    if any(s.is_in_flight for s in stories):
        return

    next_story = select_next_story(stories)
    if next_story is None:
        return  # nothing unblocked right now (e.g. everything left is feedback needed)

    claim_reason = claim_epic_in_flight(epic_task_id, next_story.task_id, _epic_claim_ttl_seconds())
    if claim_reason is not None:
        print(f"Epic {epic_task_id} dispatch skipped: {claim_reason}")
        return

    dispatch_story(epic_task_id, next_story)


def handle_routed_event(decision: Any) -> None:
    """router.dispatch_to_supervisor's entry point."""
    epic_task_id = decision.epic_task_id
    if not epic_task_id:
        print(f"ERROR: supervisor received a decision with no epic_task_id: task_id={decision.task_id}")
        return
    run_supervisor_tick(epic_task_id)
