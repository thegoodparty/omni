"""Autopilot conductor Lambda: the ClickUp webhook edge.

Deliberately isolated from clickup_bot/lambda/handler.py (copied, never
imported — sharing the module would couple the two deploys). This handler
carries the same fast-ack/self-invoke mechanics gpbot's operators learned the
hard way: on 2026-07-14 one retried ClickUp webhook delivery ran the in-path
work (dedup GET + task launch) 6 times because the response was too slow and
ClickUp redelivered — so this handler does ZERO ClickUp calls on the
internet-facing path. It validates, hands the parsed event to itself via an
async self-invoke, and answers ClickUp in milliseconds.

Unlike clickup_bot, there is no synchronous fallback path here: route_event
only ever runs from the async branch (see enqueue_async_processing), and the
webhook secret is a plain env var rather than a Secrets Manager lookup, so
there is no secrets-outage degrade mode to reproduce either.
"""

import hashlib
import hmac
import importlib.util
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import boto3
from botocore.config import Config

EventKind = Literal["statusUpdated", "taskCreated", "commentPosted"]


def _load_sibling_module(stem: str) -> Any:
    """Loads router.py / dispatch.py from this file's own directory by path.

    A plain `import router` would only work if this Lambda's packaging puts
    lambda/ on sys.path, which isn't guaranteed across deploy topologies —
    and definitely isn't true under pytest, where conftest.py loads THIS file
    the same way (necessary because `lambda` is a keyword, so
    `autopilot.lambda.handler` cannot be a real dotted import). Loading every
    module in this directory by path, under one private sys.modules key,
    works the same way regardless of what's on sys.path, and lets tests
    monkeypatch the exact module object this handler uses.
    """
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

# ClickUp's own webhook `event` values, mapped to autopilot's internal kind
# names. Kept as an explicit table (not a string transform) so an event
# autopilot does not understand yet fails closed (KeyError-free .get() miss)
# rather than silently matching something it was never taught to parse.
# taskCreated is deliberately absent even though the webhook subscribes to
# it: nothing routes on it yet, and mapping it would pay a hydration task
# read (with Lambda's async retry loop on a ClickUp blip) per created story
# just to drop the event — the edge acks it as "not a triggering event"
# instead. Add the row back when a taskCreated stage exists.
RAW_EVENT_TO_KIND: dict[str, EventKind] = {
    "taskStatusUpdated": "statusUpdated",
    "taskCommentPosted": "commentPosted",
}

# FAST-ACK BUDGET for the self-invoke call (see module docstring): botocore's
# defaults (60s connect + 60s read, with retries) could blow the whole webhook
# timeout on a hung Lambda control plane. Tight timeouts, single attempt.
#
# total_max_attempts, NOT max_attempts — a botocore trap: in legacy retry mode
# (the default) "max_attempts" counts RETRIES AFTER the initial call, so
# {"max_attempts": 1} normalizes to total_max_attempts=2 — one silent full
# retry on this budget-critical path. "total_max_attempts" counts the initial
# call itself, so 1 here truly means a single attempt.
LAMBDA_CLIENT_CONFIG = Config(connect_timeout=2, read_timeout=5, retries={"total_max_attempts": 1})

# Module-level boto3 client cache: boto3.client() re-runs endpoint resolution
# on every call, which is in-path latency against the fast-ack promise, and
# Lambda freezes the execution environment between warm invocations. Cached
# lazily (not at import) so tests can swap boto3.client for fakes.
_lambda_client: Any = None


def get_lambda_client() -> Any:
    global _lambda_client
    if _lambda_client is None:
        _lambda_client = boto3.client("lambda", config=LAMBDA_CLIENT_CONFIG)
    return _lambda_client


@dataclass(frozen=True)
class StatusTransition:
    actor_user_id: str | None
    from_status: str | None
    to_status: str | None
    transitioned_at: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "actor_user_id": self.actor_user_id,
            "from_status": self.from_status,
            "to_status": self.to_status,
            "transitioned_at": self.transitioned_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "StatusTransition":
        return cls(
            actor_user_id=data.get("actor_user_id"),
            from_status=data.get("from_status"),
            to_status=data.get("to_status"),
            transitioned_at=data.get("transitioned_at"),
        )


@dataclass(frozen=True)
class AutopilotEvent:
    kind: EventKind
    task_id: str
    list_id: str | None
    transitions: list[StatusTransition]
    # Current board status at delivery time. Only meaningful for kinds with
    # no before/after pair of their own (commentPosted): the router uses it
    # to catch "a comment landed while the card sits in feedback needed".
    # Hydrated from the task's own status by _hydrate_from_clickup — real
    # deliveries never carry it.
    current_status: str | None = None
    # The task's ClickUp parent: a story's epic, None for a feature card —
    # this is also what card typing keys on (router.derive_card_type).
    # Hydrated from the task read; real deliveries never carry it.
    epic_task_id: str | None = None
    # The delivery's timestamp. Real taskCommentPosted deliveries carry NO
    # top-level `date` — the timestamp lives on the history items (verified
    # against ClickUp's documented payloads after the first live park's
    # answer path was refused for a missing dedup key) — so parsing falls
    # back to the first history item's date.
    event_ts: str | None = None
    # Who caused this delivery, from the first history item's user id. The
    # comment-resume route needs it to tell a human's answer from the park's
    # own parking comment: without the distinction, every park would resume
    # itself the moment its own comment webhook lands.
    event_actor_id: str | None = None
    # The most recently posted comment's text — hydrated ONLY for a
    # commentPosted delivery whose actor is the bot (see
    # _hydrate_from_clickup), since that is the only case route()'s
    # self-resume guard needs it for (the Slack-answer-relay exemption).
    # Real deliveries never carry it.
    latest_comment_text: str | None = None

    def to_payload(self) -> dict[str, Any]:
        # autopilot_async is the internal-dispatch marker handler() checks for
        # (see the ALB-envelope reasoning below) — it travels inside the
        # payload itself so the async branch never has to re-derive it.
        return {
            "autopilot_async": True,
            "kind": self.kind,
            "task_id": self.task_id,
            "list_id": self.list_id,
            "transitions": [t.to_dict() for t in self.transitions],
            "current_status": self.current_status,
            "epic_task_id": self.epic_task_id,
            "event_ts": self.event_ts,
            "event_actor_id": self.event_actor_id,
            "latest_comment_text": self.latest_comment_text,
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "AutopilotEvent":
        return cls(
            kind=payload["kind"],
            task_id=payload["task_id"],
            list_id=payload.get("list_id"),
            transitions=[StatusTransition.from_dict(t) for t in payload.get("transitions", [])],
            current_status=payload.get("current_status"),
            epic_task_id=payload.get("epic_task_id"),
            event_ts=payload.get("event_ts"),
            event_actor_id=payload.get("event_actor_id"),
            latest_comment_text=payload.get("latest_comment_text"),
        )


def get_header_case_insensitive(headers: dict, name: str, default: str = "") -> str:
    name_lower = name.lower()
    for key, value in headers.items():
        if key.lower() == name_lower:
            return value
    return default


def verify_webhook_signature(body: str, signature: str) -> bool:
    secret = os.environ.get("AUTOPILOT_CLICKUP_WEBHOOK_SECRET", "")
    if not secret:
        print("ERROR: No AUTOPILOT_CLICKUP_WEBHOOK_SECRET configured, rejecting request")
        return False

    expected = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    try:
        is_valid = hmac.compare_digest(expected, signature)
    except TypeError:
        # compare_digest raises TypeError on non-ASCII str input. The header is
        # attacker-controlled, so a malformed signature is an invalid signature
        # (401), never a crash.
        print("ERROR: Webhook signature verification failed: malformed signature header")
        return False

    if not is_valid:
        print("ERROR: Webhook signature verification failed: signature mismatch")
    return is_valid


# The ALB path the Slack Events API is registered against (see
# infrastructure/modules/autopilot-bot and the environment roots' listener
# rule) — distinct from /autopilot/webhook, which stays ClickUp-only. Both
# paths forward to this same Lambda/target group.
SLACK_INGRESS_PATH = "/autopilot/slack"

# Slack's own recommended replay window: a request whose timestamp is older
# than this is rejected even if the signature verifies, so a captured
# request can't be replayed indefinitely.
SLACK_SIGNATURE_TOLERANCE_SECONDS = 5 * 60


def verify_slack_signature(raw_body: str, timestamp: str, signature: str) -> bool:
    secret = os.environ.get("AUTOPILOT_SLACK_SIGNING_SECRET", "")
    if not secret:
        print("ERROR: No AUTOPILOT_SLACK_SIGNING_SECRET configured, rejecting request")
        return False

    try:
        request_time = int(timestamp)
    except (TypeError, ValueError):
        print("ERROR: Slack signature verification failed: missing or malformed timestamp")
        return False

    if abs(time.time() - request_time) > SLACK_SIGNATURE_TOLERANCE_SECONDS:
        print("ERROR: Slack signature verification failed: stale timestamp")
        return False

    basestring = f"v0:{timestamp}:{raw_body}"
    expected = "v0=" + hmac.new(secret.encode(), basestring.encode(), hashlib.sha256).hexdigest()
    try:
        is_valid = hmac.compare_digest(expected, signature)
    except TypeError:
        # Same non-ASCII-header defense as verify_webhook_signature: a
        # malformed signature header is an invalid signature (401), never a
        # crash.
        print("ERROR: Slack signature verification failed: malformed signature header")
        return False

    if not is_valid:
        print("ERROR: Slack signature verification failed: signature mismatch")
    return is_valid


def in_scope_list_ids() -> frozenset[str]:
    raw = os.environ.get("AUTOPILOT_LIST_IDS", "")
    ids = frozenset(part.strip() for part in raw.split(",") if part.strip())
    if not ids:
        # Without this signal a missing env var turns the whole service into a
        # silent no-op: every event 200-skips as "list not in scope".
        print("ERROR: No AUTOPILOT_LIST_IDS configured, all events will be dropped")
    return ids


def _status_label(value: Any) -> str | None:
    # ClickUp history_items carry "before"/"after" as either a bare status
    # string or an object with a "status" key, depending on the field — handle
    # both rather than assuming a shape we have not captured live yet.
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        status = value.get("status")
        return status if isinstance(status, str) else None
    return None


def _normalize_ts(value: Any) -> str | None:
    """ClickUp timestamps arrive as epoch-ms strings or numbers (json.loads
    can yield a float); bool is excluded as an int subclass. A dropped
    timestamp downstream means a refused dispatch, so every real shape must
    normalize."""
    if isinstance(value, str) and value:
        # A float-formatted string ("...000.0") must not survive into the
        # dedup key path where int() would raise and drop the dispatch.
        try:
            return str(int(float(value)))
        except ValueError:
            return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(int(value))
    return None


def parse_history_items(history_items: Any) -> list[StatusTransition]:
    if not isinstance(history_items, list):
        return []
    transitions = []
    for item in history_items:
        if not isinstance(item, dict):
            continue
        user = item.get("user")
        actor_user_id = None
        if isinstance(user, dict) and user.get("id") is not None:
            actor_user_id = str(user["id"])
        date = item.get("date")
        transitions.append(
            StatusTransition(
                actor_user_id=actor_user_id,
                from_status=_status_label(item.get("before")),
                to_status=_status_label(item.get("after")),
                transitioned_at=_normalize_ts(date),
            )
        )
    return transitions


def parse_webhook_event(body: dict) -> AutopilotEvent | None:
    """Parses a verified webhook body into a typed event, or None if this is
    not an event kind/shape autopilot acts on (an unrecognized `event` value,
    or a recognized one missing its task_id)."""
    raw_event = body.get("event")
    kind = RAW_EVENT_TO_KIND.get(raw_event) if isinstance(raw_event, str) else None
    if kind is None:
        return None

    task_id = body.get("task_id")
    if not isinstance(task_id, str) or not task_id:
        return None

    # Real ClickUp deliveries carry only task_id + history_items — no list,
    # no current status, no parent (clickup_bot learned the same and fetches
    # the task). These three fields therefore normally stay None here and are
    # hydrated by ONE task read in the async worker (_hydrate_from_clickup);
    # a payload that does carry them (tests, console invokes, the async
    # round-trip of an already-hydrated event) is trusted as-is.
    list_id = body.get("list_id")
    if not isinstance(list_id, str):
        list_id = None

    # Reuse the history-item normalizer: ClickUp status fields arrive as
    # either a bare string or a {"status": ...} object depending on the
    # surface, and commentPosted routing depends entirely on this value.
    current_status = _status_label(body.get("current_status"))

    epic_task_id = body.get("epic_task_id")
    if not isinstance(epic_task_id, str):
        epic_task_id = None

    # Real deliveries carry no top-level `date` (same reason list_id above
    # stays None) — the timestamp and the acting user live on the history
    # items, including for taskCommentPosted, whose items parse to no status
    # transition but still carry `date` and `user`. Without this fallback
    # every comment-triggered resume was refused at dispatch for a missing
    # dedup timestamp, which is the whole answer-a-parked-question loop.
    event_ts = _normalize_ts(body.get("date"))
    event_actor_id = None
    raw_items = body.get("history_items")
    if isinstance(raw_items, list):
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            if event_ts is None:
                event_ts = _normalize_ts(item.get("date"))
            if event_actor_id is None:
                user = item.get("user")
                if isinstance(user, dict) and user.get("id") is not None:
                    event_actor_id = str(user["id"])
            if event_ts is not None and event_actor_id is not None:
                break

    return AutopilotEvent(
        kind=kind,
        task_id=task_id,
        list_id=list_id,
        transitions=parse_history_items(body.get("history_items")),
        current_status=current_status,
        epic_task_id=epic_task_id,
        event_ts=event_ts,
        event_actor_id=event_actor_id,
    )


class RetryableRouteError(Exception):
    """A pre-dispatch routing failure worth a Lambda async retry.

    handle_async_processing swallows every ordinary route_event exception
    into a returned 500 on purpose — a raise AFTER a dedup claim or a
    RunTask could double-run a stage on retry. This sentinel is the narrow
    exception to that rule: it may only be raised BEFORE any claim or
    dispatch side effect (the resume route's comments read), where a retry
    replays a pure read and the dedup claim still guards everything after.
    """


def route_event(event: AutopilotEvent) -> None:
    """Routes a validated autopilot event to the stage-runner pipeline.

    Maps the parsed event into router.route()'s decoupled shapes, then for
    each decision either hands it to the (stubbed) supervisor or claims the
    transition and launches its Fargate stage run. See router.py and
    dispatch.py for the routing table / gate / claim / dispatch logic
    itself — this function is just the wiring between them.
    """
    routable_event = router.RoutableEvent(
        kind=event.kind,
        task_id=event.task_id,
        list_id=event.list_id,
        current_status=event.current_status,
        event_ts=event.event_ts,
        event_actor_id=event.event_actor_id,
        epic_task_id=event.epic_task_id,
        latest_comment_text=event.latest_comment_text,
        transitions=[
            router.Transition(
                actor_user_id=t.actor_user_id,
                from_status=t.from_status,
                to_status=t.to_status,
                transitioned_at=t.transitioned_at,
            )
            for t in event.transitions
        ],
    )

    for decision in router.route(routable_event):
        if decision.to_supervisor:
            router.dispatch_to_supervisor(decision)
            continue

        if decision.transitioned_at is None:
            # A genuine ClickUp delivery for a matched transition always
            # carries a timestamp; without one there is no stable dedup key
            # to claim, so refuse rather than dispatch unclaimed.
            print(
                "ERROR: routed decision missing transitioned_at, refusing to dispatch: "
                f"task_id={event.task_id} stage={decision.stage}"
            )
            continue

        resume_stage = None
        if decision.stage == router.STAGE_RESUME:
            # The agent's config requires RESUME_STAGE for a resume run —
            # the first live resume died at startup without it. The parked
            # stage lives in the card's park marker, so this is the one
            # route that costs a comments read. A read failure RAISES for
            # the same reason hydration's does: the sweep cannot reconstruct
            # this trigger (STORY->in progress is an ambiguous pair it
            # skips), so only Lambda's async retry can save the event.
            try:
                comments = supervisor.get_task_comments(event.task_id)
            except Exception as e:
                print(
                    f"ERROR: failed to read comments to resolve the parked stage for "
                    f"{event.task_id}: {type(e).__name__}"
                )
                # Not a bare raise: route_event's caller swallows ordinary
                # exceptions into a returned 500, and a returned payload is a
                # SUCCESSFUL async invocation — no retry. The sentinel is
                # what handle_async_processing re-raises to reach Lambda.
                raise RetryableRouteError(
                    f"comments read failed while resolving RESUME_STAGE for {event.task_id}"
                ) from e
            resume_stage = router.parked_stage_from_comments(comments)
            if resume_stage is None:
                # No marker means nothing ever parked (a card dragged back
                # without a park — e.g. a run that stranded before parking).
                # There is no stage to re-enter; the recovery is re-kicking
                # the story from approved tdd, not a blind resume.
                print(
                    f"ERROR: no park marker on {event.task_id}; cannot resolve RESUME_STAGE, "
                    "refusing resume dispatch (re-kick the story from approved tdd instead)"
                )
                continue

        ceiling = router.STAGE_CEILINGS[decision.stage]
        epic_task_id = event.epic_task_id if decision.stage in router.EPIC_SCOPED_STAGES else None

        envelope = dispatch.StageEnvelope(
            stage=decision.stage,
            task_id=event.task_id,
            epic_task_id=epic_task_id,
            model=router.DEFAULT_AGENT_MODEL,
            max_budget_usd=ceiling.max_budget_usd,
            deadline_seconds=ceiling.deadline_seconds,
            resume_stage=resume_stage,
        )
        dispatch.dispatch_stage(event.task_id, decision.stage, decision.transitioned_at, envelope)


def enqueue_async_processing(autopilot_event: AutopilotEvent) -> bool:
    """Self-invokes this function asynchronously with the parsed event.

    Returns whether the invoke definitely succeeded. Unlike clickup_bot's
    enqueue_async_processing, there is no synchronous fallback to degrade to
    here — route_event only ever runs from the async branch — so ANY invoke
    failure (a provable rejection or an ambiguous one) is handled the same
    way: the caller 500s and lets ClickUp redeliver.
    """
    function_name = os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
    if not function_name:
        print("Failed to enqueue async processing: AWS_LAMBDA_FUNCTION_NAME not set")
        return False
    try:
        get_lambda_client().invoke(
            FunctionName=function_name,
            InvocationType="Event",
            Payload=json.dumps(autopilot_event.to_payload()),
        )
        return True
    except Exception as e:
        print(f"Failed to enqueue async processing: {type(e).__name__}")
        return False


# ---------------------------------------------------------------------------
# Slack ingress: a thread reply to a park/notify ping resumes the parked run.
#
# Mirrors the ClickUp path's discipline exactly: verify in-path, do ZERO
# Slack/ClickUp API calls on the internet-facing edge, fast-ack, and hand the
# parsed event to an async self-invoke. The async worker does the one thing
# the edge can't (fetch the thread root to confirm it's really one of our
# pings) and then RELAYS the reply onto the card as an ordinary ClickUp
# comment — it never dispatches a resume itself. ClickUp's own webhook fires
# for that new comment and drives it through the EXACT SAME hardened
# commentPosted path a human's own reply takes (see router.route()'s
# is_slack_relay_comment exemption); this file must never grow a second,
# parallel comment-hydration path to short-circuit that.
# ---------------------------------------------------------------------------

# Slack redelivers a "message" event it believes wasn't handled; claiming
# this key before relaying (through the same DynamoDB table dispatch.py's
# per-transition claims live in) makes a redelivery of the same event a
# no-op. TTL only needs to outlive Slack's own retry window, not a whole
# stage run.
SLACK_RELAY_DEDUP_TTL_SECONDS = 15 * 60

# The claim above is taken BEFORE the two API calls below (conversations.replies,
# then create_task_comment) so a genuine Slack redelivery of the same event
# can't relay twice — but that means a transient failure in either call, with
# the claim already held, would otherwise drop the human's answer for good:
# this Lambda's async self-invoke has ZERO platform retries
# (aws_lambda_function_event_invoke_config sets maximum_retry_attempts = 0,
# function-wide), and Slack already got its 200 from the fast-ack edge, so it
# won't redeliver either. A short bounded retry inside THIS invocation is the
# only thing standing between an ordinary transient blip and a silently lost
# answer — there is no Slack-side reconciliation sweep to fall back on.
SLACK_RELAY_RETRY_ATTEMPTS = 3
SLACK_RELAY_RETRY_BACKOFF_SECONDS = 1.0


def _retry_relay_call(fn: Any) -> Any:
    last_exc: Exception | None = None
    for attempt in range(SLACK_RELAY_RETRY_ATTEMPTS):
        try:
            return fn()
        except Exception as e:
            last_exc = e
            if attempt < SLACK_RELAY_RETRY_ATTEMPTS - 1:
                time.sleep(SLACK_RELAY_RETRY_BACKOFF_SECONDS * (attempt + 1))
    assert last_exc is not None
    raise last_exc


# Subtypes a genuine human thread reply may still carry. "thread_broadcast"
# is what Slack sets when a user checks "Also send to #channel" on a thread
# reply — the message is otherwise ordinary (real user, real thread_ts, real
# text). Every OTHER subtype (message_changed, message_deleted, bot_message,
# channel_join, ...) is an edit/deletion/system message/bot post, never an
# answer to relay, so anything not in this set is dropped.
ALLOWED_SLACK_MESSAGE_SUBTYPES = frozenset({"thread_broadcast"})


def parse_slack_message_event(body: dict) -> Any:
    """Parses a verified Slack Events API body into a typed reply event, or
    None if this is not a shape autopilot acts on: anything but a real
    `message` event (a URL-verification body is handled by the caller before
    this is ever reached), and a `message` whose `subtype` isn't in
    ALLOWED_SLACK_MESSAGE_SUBTYPES — failing closed here rather than relying
    on the bot_id/user checks below to catch every unwanted subtype shape.
    """
    if body.get("type") != "event_callback":
        return None
    inner = body.get("event")
    if not isinstance(inner, dict) or inner.get("type") != "message":
        return None
    subtype = inner.get("subtype")
    if subtype is not None and subtype not in ALLOWED_SLACK_MESSAGE_SUBTYPES:
        return None

    channel = inner.get("channel")
    ts = inner.get("ts")
    text = inner.get("text")
    if not isinstance(channel, str) or not isinstance(ts, str) or not isinstance(text, str):
        return None

    thread_ts = inner.get("thread_ts")
    user_id = inner.get("user")
    bot_id = inner.get("bot_id")
    event_id = body.get("event_id")
    return router.SlackReplyEvent(
        channel=channel,
        ts=ts,
        thread_ts=thread_ts if isinstance(thread_ts, str) else None,
        user_id=user_id if isinstance(user_id, str) else None,
        bot_id=bot_id if isinstance(bot_id, str) else None,
        text=text,
        event_id=event_id if isinstance(event_id, str) else None,
    )


def enqueue_slack_async_processing(slack_event: Any) -> bool:
    function_name = os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
    if not function_name:
        print("Failed to enqueue Slack async processing: AWS_LAMBDA_FUNCTION_NAME not set")
        return False
    try:
        get_lambda_client().invoke(
            FunctionName=function_name,
            InvocationType="Event",
            Payload=json.dumps(
                {
                    "autopilot_slack_async": True,
                    "channel": slack_event.channel,
                    "ts": slack_event.ts,
                    "thread_ts": slack_event.thread_ts,
                    "user_id": slack_event.user_id,
                    "bot_id": slack_event.bot_id,
                    "text": slack_event.text,
                    "event_id": slack_event.event_id,
                }
            ),
        )
        return True
    except Exception as e:
        print(f"Failed to enqueue Slack async processing: {type(e).__name__}")
        return False


def handle_slack_request(event: dict) -> dict:
    """Webhook-facing half of the Slack ingress. Same ordering as the
    ClickUp path above: parse first (so a malformed body always gets a clean
    400 regardless of its signature), verify against the ORIGINAL raw body
    string, THEN branch on content — never the other way around."""
    headers = event.get("headers", {})
    timestamp = get_header_case_insensitive(headers, "x-slack-request-timestamp")
    signature = get_header_case_insensitive(headers, "x-slack-signature")
    raw_body = event.get("body", "{}")

    body: Any = raw_body
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except json.JSONDecodeError:
            print("Invalid JSON in Slack request body")
            return {"statusCode": 400, "body": json.dumps({"error": "invalid JSON body"})}

    if not isinstance(body, dict):
        print("Invalid JSON in Slack request body")
        return {"statusCode": 400, "body": json.dumps({"error": "invalid JSON body"})}

    if not isinstance(raw_body, str):
        raw_body = json.dumps(raw_body)

    if not verify_slack_signature(raw_body, timestamp, signature):
        return {"statusCode": 401, "body": json.dumps({"error": "Unauthorized"})}

    if body.get("type") == "url_verification":
        # Answered in-path: this is the one-time app-setup handshake, not a
        # recurring delivery, and involves no Slack/ClickUp API calls, so
        # there's no fast-ack budget to protect here.
        return {"statusCode": 200, "body": json.dumps({"challenge": body.get("challenge")})}

    slack_event = parse_slack_message_event(body)
    if slack_event is None:
        return {"statusCode": 200, "body": json.dumps({"skipped": "not a triggering Slack event"})}

    channel = os.environ.get("AUTOPILOT_SLACK_CHANNEL", "").strip()
    # Filtered at the edge, same spirit as the ClickUp path's list-id scope
    # check: obviously-irrelevant deliveries (the bot's own messages, a
    # non-thread message, a message in some other channel) are dropped
    # WITHOUT paying a self-invoke. Whether the thread is actually one of our
    # pings is the one question only the async worker can answer.
    if not channel or not router.is_relayable_slack_reply(slack_event, expected_channel=channel):
        return {"statusCode": 200, "body": json.dumps({"skipped": "not a relayable Slack reply"})}

    if not enqueue_slack_async_processing(slack_event):
        return {"statusCode": 500, "body": json.dumps({"error": "failed to enqueue async processing"})}

    return {"statusCode": 200, "body": json.dumps({"status": "accepted"})}


def handle_slack_async_processing(event: dict) -> dict:
    """Worker half of the Slack ingress. Reached only through the
    unspoofable-through-ALB dispatch check in handler() — see there and
    handle_async_processing's docstring for why the payload can be trusted
    without re-verifying anything."""
    try:
        slack_event = router.SlackReplyEvent(
            channel=event["channel"],
            ts=event["ts"],
            thread_ts=event.get("thread_ts"),
            user_id=event.get("user_id"),
            bot_id=event.get("bot_id"),
            text=event["text"],
            event_id=event.get("event_id"),
        )
    except KeyError as e:
        print(f"ERROR: Slack async processing failed: invalid internal payload ({type(e).__name__})")
        return {"statusCode": 400, "body": json.dumps({"error": "invalid async payload"})}

    channel = os.environ.get("AUTOPILOT_SLACK_CHANNEL", "").strip()
    if not channel or not router.is_relayable_slack_reply(slack_event, expected_channel=channel):
        # Re-checked here, not just trusted from the edge: the payload is
        # self-generated, but AUTOPILOT_SLACK_CHANNEL could differ between
        # the edge invocation and this one (a mid-flight config change), and
        # the worker must apply the same gate the edge did, not assume it.
        return {"statusCode": 200, "body": json.dumps({"skipped": "not a relayable Slack reply"})}

    dedup_key = slack_event.event_id or f"{slack_event.channel}:{slack_event.ts}"
    reason = dispatch.claim_transition(
        f"slack-reply:{slack_event.channel}", "slack-relay", dedup_key, SLACK_RELAY_DEDUP_TTL_SECONDS
    )
    if reason is not None:
        # "already claimed" is a genuine Slack redelivery of the same event —
        # relay exactly once. The other reasons (table unconfigured/
        # unavailable) fail closed, same posture as dispatch.claim_transition
        # everywhere else it's called.
        return {"statusCode": 200, "body": json.dumps({"skipped": reason})}

    try:
        thread = _retry_relay_call(
            lambda: supervisor.slack_conversations_replies(slack_event.channel, slack_event.thread_ts)
        )
    except Exception as e:
        print(f"ERROR: failed to read Slack thread for channel {slack_event.channel}: {type(e).__name__}")
        return {"statusCode": 500, "body": json.dumps({"error": "failed to read slack thread"})}

    root_text = thread[0].get("text") if thread and isinstance(thread[0], dict) else None
    task_id = router.slack_ping_task_id(root_text)
    if task_id is None:
        print(f"Slack reply in channel {slack_event.channel} is not on one of our pings; ignoring")
        return {"statusCode": 200, "body": json.dumps({"skipped": "thread root is not an autopilot ping"})}

    comment_text = router.format_slack_answer_comment(slack_event.user_id, slack_event.text)
    try:
        _retry_relay_call(lambda: supervisor.create_task_comment(task_id, comment_text))
    except Exception as e:
        # The retries above are what stand between an ordinary transient
        # blip and losing this answer for good (see SLACK_RELAY_RETRY_ATTEMPTS'
        # comment) — this is the exhausted-retries case: a SUSTAINED ClickUp
        # outage, not a blip. Logged loudly (feeds the handler-errors alarm);
        # the claim above is not rolled back, same posture as a claimed-but-
        # failed Fargate launch in dispatch.dispatch_stage.
        print(f"ERROR: failed to relay a Slack reply onto {task_id}: {type(e).__name__}")
        return {"statusCode": 500, "body": json.dumps({"error": "failed to relay comment"})}

    print(f"Relayed a Slack reply onto {task_id}")
    return {"statusCode": 200, "body": json.dumps({"status": "relayed", "task_id": task_id})}


def _hydrate_from_clickup(event: AutopilotEvent) -> AutopilotEvent:
    """Fills the fields a real ClickUp delivery doesn't carry — the task's
    list (scope gate), current status (comment routing), and parent (card
    typing + epic scoping) — with ONE task read. Runs only in the async
    worker, never on the fast-ack edge.

    A failed read RAISES instead of degrading: routing unhydrated would
    misclassify a story (unknown parent) as a feature card, and swallowing
    the failure would permanently lose the event — ClickUp already got its
    200 from the fast-ack, and commentPosted has no sweep reconstruction.
    Raising here is what makes Lambda's async delivery retry the event
    (async invokes discard the returned payload, so a returned 500 would NOT
    retry — only a function error does), and it is duplicate-safe because
    hydration runs before any claim or dispatch side effect."""
    try:
        task = supervisor.get_task(event.task_id)
    except Exception as e:
        print(f"ERROR: failed to hydrate task {event.task_id} from ClickUp: {type(e).__name__}")
        raise

    task_list = task.get("list")
    list_id = task_list.get("id") if isinstance(task_list, dict) else None
    parent = task.get("parent")

    latest_text = event.latest_comment_text
    bot_user_id = os.environ.get("AUTOPILOT_BOT_USER_ID")
    # Only the self-resume guard's Slack-relay exemption (router.
    # is_slack_relay_comment) needs comment content, and only when the actor
    # IS the bot — a human comment never needs this read, so paying it on
    # every commentPosted delivery would double this hydration step's
    # ClickUp calls for no reason. A read failure is NOT caught here: it
    # propagates out of _hydrate_from_clickup exactly like the task read
    # above, for the same reason (see this function's docstring) — losing it
    # silently would drop a real relayed answer with no retry.
    if event.kind == "commentPosted" and bot_user_id and event.event_actor_id == bot_user_id:
        latest_text = router.latest_comment_text(supervisor.get_task_comments(event.task_id))

    return AutopilotEvent(
        kind=event.kind,
        task_id=event.task_id,
        list_id=list_id if isinstance(list_id, str) else None,
        transitions=event.transitions,
        current_status=_status_label(task.get("status")),
        epic_task_id=parent if isinstance(parent, str) else None,
        event_ts=event.event_ts,
        # Delivery-derived, not task-derived: hydration must carry it through
        # like event_ts, or every real delivery (which always hydrates) hits
        # the comment-resume bot filter with None and the park self-resume
        # loop comes back.
        event_actor_id=event.event_actor_id,
        latest_comment_text=latest_text,
    )


def handle_async_processing(event: dict) -> dict:
    """Worker half of the fast-ack design. Reached only through the
    unspoofable-through-ALB dispatch check in handler() — see there for why
    the payload can be trusted without re-verifying anything."""
    try:
        autopilot_event = AutopilotEvent.from_payload(event)
    except (KeyError, TypeError) as e:
        # Defensive re-validation: the payload is self-generated, so a miss
        # here means a bug (or a direct invoke by something with AWS creds).
        print(f"ERROR: Async processing failed: invalid internal payload ({type(e).__name__})")
        return {"statusCode": 400, "body": json.dumps({"error": "invalid async payload"})}

    # list_id present means the payload already knows its board context (a
    # test/console payload, or the edge passed one through); absent means a
    # real ClickUp delivery that still needs the task read. commentPosted
    # additionally hydrates whenever current_status is missing: it routes
    # entirely on current_status + the parent, so a pre-hydrated payload that
    # set list_id but skipped those would silently misclassify a story as a
    # feature card and drop its resume trigger. A hydration failure raises
    # out of the worker ON PURPOSE — see _hydrate_from_clickup for why that
    # (and only that) is allowed to, despite the never-raise rule around
    # route_event below.
    # epic_task_id None is ambiguous for commentPosted ("feature card" vs
    # "story whose payload skipped the parent"), so it hydrates too — for an
    # actual feature card that costs one redundant read on synthetic payloads
    # only (real deliveries always hydrate via list_id None).
    needs_hydration = autopilot_event.list_id is None or (
        autopilot_event.kind == "commentPosted"
        and (autopilot_event.current_status is None or autopilot_event.epic_task_id is None)
    )
    if needs_hydration:
        autopilot_event = _hydrate_from_clickup(autopilot_event)
        if autopilot_event.list_id is None:
            # The read succeeded but the task's list field was unreadable —
            # falling through would drop this as "not in scope", losing the
            # event with no retry and a misleading log. Same contract as a
            # failed read: raise so Lambda's async delivery retries it.
            print(f"ERROR: hydrated task {autopilot_event.task_id} has no readable list id; raising for retry")
            raise RuntimeError(f"hydrated task {autopilot_event.task_id} returned no list id")

    # Unconditional, not only on the hydration path: a pre-hydrated payload
    # (console invoke, test) must not bypass the scope gate the edge applies
    # to ALB-routed requests.
    if autopilot_event.list_id not in in_scope_list_ids():
        return {"statusCode": 200, "body": json.dumps({"skipped": "list not in scope"})}

    try:
        route_event(autopilot_event)
    except RetryableRouteError:
        # The one sanctioned escape from the never-raise rule below: raised
        # only before any claim or dispatch side effect (see the class
        # docstring), so Lambda's async retry replays a pure read — and a
        # returned 500 would NOT retry (a returned payload is a successful
        # async invocation), permanently losing the event.
        raise
    except Exception as e:
        # The worker must never raise: an unhandled exception in an async
        # ("Event") invocation makes Lambda auto-retry it, which would
        # re-create the exact duplicate-run risk this design avoids.
        print(f"ERROR: Async processing failed: {e}")
        return {"statusCode": 500, "body": json.dumps({"error": "async processing failed"})}

    return {"statusCode": 200, "body": json.dumps({"status": "processed", "task_id": autopilot_event.task_id})}


def handler(event: dict, context: Any) -> dict:
    # INTERNAL SWEEP DISPATCH: .github/workflows/autopilot-sweep.yml invokes
    # this function directly with {"autopilot_sweep": true} on a cron. Same
    # unspoofable-through-the-ALB reasoning as the async marker below.
    if event.get("autopilot_sweep") and "headers" not in event and "requestContext" not in event:
        return sweep.handle_sweep(event)

    # INTERNAL ASYNC DISPATCH: the fast-ack path re-invokes this same function
    # asynchronously with {"autopilot_async": true, ...}. Only dispatch to the
    # trusted worker path when the marker is top-level AND the event carries
    # no ALB envelope keys: an ALB-wrapped attacker request ALWAYS has
    # "headers"/"requestContext", and its JSON body lands in event["body"] as
    # a string — so top-level keys are unspoofable through the ALB, and a body
    # containing autopilot_async falls through to normal signature verification.
    if event.get("autopilot_async") and "headers" not in event and "requestContext" not in event:
        return handle_async_processing(event)

    # Same unspoofable-through-ALB reasoning as the two markers above, for
    # the Slack ingress's own self-invoke.
    if event.get("autopilot_slack_async") and "headers" not in event and "requestContext" not in event:
        return handle_slack_async_processing(event)

    # Path-based routing: the ALB forwards both /autopilot/webhook (ClickUp)
    # and /autopilot/slack (Slack Events API) to this one Lambda/target group
    # (see infrastructure/modules/autopilot-bot). Only the ALB can invoke this
    # function (its Lambda permission is scoped to the
    # elasticloadbalancing.amazonaws.com principal), so `path` here reflects
    # whichever listener rule actually matched the request. Absent or any
    # other value falls through to the ClickUp logic below, unchanged.
    if event.get("path") == SLACK_INGRESS_PATH:
        return handle_slack_request(event)

    headers = event.get("headers", {})
    signature = get_header_case_insensitive(headers, "x-signature")
    raw_body = event.get("body", "{}")

    body: Any = raw_body
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except json.JSONDecodeError:
            print("Invalid JSON in webhook body")
            return {"statusCode": 400, "body": json.dumps({"error": "invalid JSON body"})}

    if not isinstance(body, dict):
        print("Invalid JSON in webhook body")
        return {"statusCode": 400, "body": json.dumps({"error": "invalid JSON body"})}

    # Direct invocations (console/tests) can pass body as an already-parsed
    # dict; re-serializing it can never match the HMAC, so this ends in a
    # clean 401 rather than a crash inside verify_webhook_signature.
    if not isinstance(raw_body, str):
        raw_body = json.dumps(raw_body)

    if not verify_webhook_signature(raw_body, signature):
        return {"statusCode": 401, "body": json.dumps({"error": "Unauthorized"})}

    autopilot_event = parse_webhook_event(body)
    if autopilot_event is None:
        return {"statusCode": 200, "body": json.dumps({"skipped": "not a triggering event"})}

    # Scope can only be short-circuited here when the payload names its list —
    # real deliveries don't (see parse_webhook_event), so they pass through and
    # the async worker's hydration read decides scope instead. The webhook
    # registration is folder-scoped, so nearly everything arriving is ours.
    if autopilot_event.list_id is not None and autopilot_event.list_id not in in_scope_list_ids():
        return {"statusCode": 200, "body": json.dumps({"skipped": "list not in scope"})}

    # FAST-ACK: the request is authenticated and in scope — answer ClickUp NOW,
    # with zero ClickUp API calls in-path, and let the async worker route it.
    if not enqueue_async_processing(autopilot_event):
        return {"statusCode": 500, "body": json.dumps({"error": "failed to enqueue async processing"})}

    return {
        "statusCode": 200,
        "body": json.dumps({"status": "accepted", "task_id": autopilot_event.task_id, "kind": autopilot_event.kind}),
    }


# Loaded here, at the very BOTTOM of the file rather than alongside router/
# dispatch above: both supervisor.py and sweep.py load handler.py back (for
# _normalize_ts/_status_label) using the exact same by-path loader. That is
# only safe because every name they read off this module — every function
# above this line — is already bound by the time either is first loaded. Load
# them any earlier and a nested handler-loads-supervisor-loads-handler
# reentry would hand supervisor.py a handler module that has not defined
# those functions yet.
supervisor = _load_sibling_module("supervisor")
sweep = _load_sibling_module("sweep")
