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
from urllib.request import Request, urlopen

from botocore.exceptions import ClientError

CLICKUP_BASE_URL = "https://api.clickup.com/api/v2"
SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage"

# Plain env var, not Secrets Manager — same posture as
# AUTOPILOT_CLICKUP_WEBHOOK_SECRET (see handler.py's module docstring): this
# Lambda has no secrets-outage degrade mode to reproduce, so there is no
# reason to add the extra dependency and failure mode.
CLICKUP_API_KEY_ENV = "AUTOPILOT_CLICKUP_API_KEY"
SLACK_BOT_TOKEN_ENV = "SLACK_BOT_TOKEN"
SLACK_CHANNEL_ENV = "AUTOPILOT_SLACK_CHANNEL"

EPIC_CLAIM_PREFIX = "epic#"


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
        # Everything that is neither queued, done, nor waiting on a human.
        return self.status not in (router.STATUS_TO_DO, router.STATUS_DONE, router.STATUS_FEEDBACK_NEEDED)


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
        epic = clickup_request("GET", f"/task/{epic_task_id}?include_subtasks=true")
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


def select_next_story(stories: list[Story]) -> Story | None:
    done_ids = {s.task_id for s in stories if s.is_done}
    candidates = [s for s in stories if s.status == router.STATUS_TO_DO and s.depends_on <= done_ids]
    if not candidates:
        return None

    not_done = [s for s in stories if not s.is_done]
    # "Dependency links first": prefer a candidate that unblocks the most
    # other not-yet-done work, board order (orderindex) only as the tiebreak.
    blocks_count = {c.task_id: sum(1 for s in not_done if c.task_id in s.depends_on) for c in candidates}
    return sorted(candidates, key=lambda c: (-blocks_count[c.task_id], c.order_index))[0]


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
            ConditionExpression="attribute_not_exists(pk) OR #exp < :now",
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


def mark_epic_claim_alerted(epic_task_id: str) -> None:
    """Unconditionally (re-)writes the epic claim item with alerted_at set,
    rather than an UpdateItem gated on the item already existing. A story
    can be discovered already in flight (e.g. a manual ClickUp drag, or a
    dispatch whose claim write failed) with NO claim item ever written for
    it — an UpdateItem there would either upsert a pk with no expires_at
    (permanently jamming claim_epic_in_flight's own condition, which can
    never be satisfied against a missing expires_at) or, conditioned on
    existence, silently no-op every tick and alert on every single sweep
    pass forever. A full PutItem sidesteps both: it always leaves a valid,
    TTL'd claim behind, and overwriting an existing one only EXTENDS its
    protection window (recomputed fresh from now), never shortens it.
    """
    table_name = os.environ.get("AUTOPILOT_DEDUP_TABLE")
    if not table_name:
        return

    # Preserve story_task_id from any existing claim: overwriting it away
    # here would make the NEXT tick's claimed_story_task_id read back None,
    # forgetting which story this claim is protecting and letting that tick
    # dispatch a duplicate for a story that is stalled, not finished.
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
        dispatch.get_dynamodb_client().put_item(TableName=table_name, Item=item)
    except Exception as e:
        print(f"ERROR: failed to record stall alert for {epic_task_id}: {type(e).__name__}")


# ---------------------------------------------------------------------------
# Stall detection — alert only, never auto-retry
# ---------------------------------------------------------------------------

# Per-status TTLs. "executing"'s is short (30min) relative to "in progress"
# (2h) and "qa" (1h) on purpose: a story stuck in "executing" means the
# story-stage agent never got past its own kickoff — a dispatch problem that
# should surface fast — whereas real story/QA work can legitimately run
# longer. STATUS_FEEDBACK_NEEDED is deliberately absent: waiting on a human
# is not a stall. STATUS_TO_DO / STATUS_DONE are absent too: nothing is "in
# flight" there.
STATUS_TTL_SECONDS: dict[str, int] = {
    router.STATUS_EXECUTING: 30 * 60,
    router.STATUS_IN_PROGRESS: 2 * 60 * 60,
    router.STATUS_QA: 60 * 60,
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
        claim_item = get_epic_claim_item(epic_task_id)
        if claim_item is not None and "alerted_at" in claim_item:
            continue  # already alerted once for this in-flight story
        post_stall_alert(epic_task_id, story)
        mark_epic_claim_alerted(epic_task_id)


# ---------------------------------------------------------------------------
# Close-out
# ---------------------------------------------------------------------------


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
                    "in prod, or clean it up if the experiment did not land."
                ),
                "parent": epic_task_id,
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
    release_epic_claim(epic_task_id)
    try:
        move_task_status(epic_task_id, router.STATUS_DONE)
    except Exception as e:
        # Don't file a cleanup ticket or announce completion for a card that
        # was never actually marked done — a partial close-out would be
        # worse than none (a "complete" Slack post for a card still sitting
        # in executing).
        print(f"ERROR: failed to move epic {epic_task_id} to done: {type(e).__name__}")
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
    breakdown-review gate, a story reaching done, and a sweep tick over
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
