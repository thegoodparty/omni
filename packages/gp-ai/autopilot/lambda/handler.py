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
import json
import os
from dataclasses import dataclass
from typing import Any, Literal

import boto3
from botocore.config import Config

EventKind = Literal["statusUpdated", "taskCreated", "commentPosted"]

# ClickUp's own webhook `event` values, mapped to autopilot's internal kind
# names. Kept as an explicit table (not a string transform) so an event
# autopilot does not understand yet fails closed (KeyError-free .get() miss)
# rather than silently matching something it was never taught to parse.
RAW_EVENT_TO_KIND: dict[str, EventKind] = {
    "taskStatusUpdated": "statusUpdated",
    "taskCreated": "taskCreated",
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
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "AutopilotEvent":
        return cls(
            kind=payload["kind"],
            task_id=payload["task_id"],
            list_id=payload.get("list_id"),
            transitions=[StatusTransition.from_dict(t) for t in payload.get("transitions", [])],
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


def in_scope_list_ids() -> frozenset[str]:
    raw = os.environ.get("AUTOPILOT_LIST_IDS", "")
    return frozenset(part.strip() for part in raw.split(",") if part.strip())


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
                transitioned_at=date if isinstance(date, str) else None,
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

    list_id = body.get("list_id")
    if not isinstance(list_id, str):
        list_id = None

    return AutopilotEvent(
        kind=kind,
        task_id=task_id,
        list_id=list_id,
        transitions=parse_history_items(body.get("history_items")),
    )


def route_event(event: AutopilotEvent) -> None:
    """Routes a validated autopilot event to the stage-runner pipeline.

    STUBBED for this task — the next task in the epic implements real
    routing/dispatch. This only logs receipt so the conductor's fast-ack +
    self-invoke wiring can be exercised end-to-end before routing exists.
    """
    print(f"Autopilot event received (routing not yet implemented): kind={event.kind} task_id={event.task_id}")


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

    try:
        route_event(autopilot_event)
    except Exception as e:
        # The worker must never raise: an unhandled exception in an async
        # ("Event") invocation makes Lambda auto-retry it, which would
        # re-create the exact duplicate-run risk this design avoids.
        print(f"ERROR: Async processing failed: {e}")
        return {"statusCode": 500, "body": json.dumps({"error": "async processing failed"})}

    return {"statusCode": 200, "body": json.dumps({"status": "processed", "task_id": autopilot_event.task_id})}


def handler(event: dict, context: Any) -> dict:
    # INTERNAL ASYNC DISPATCH: the fast-ack path re-invokes this same function
    # asynchronously with {"autopilot_async": true, ...}. Only dispatch to the
    # trusted worker path when the marker is top-level AND the event carries
    # no ALB envelope keys: an ALB-wrapped attacker request ALWAYS has
    # "headers"/"requestContext", and its JSON body lands in event["body"] as
    # a string — so top-level keys are unspoofable through the ALB, and a body
    # containing autopilot_async falls through to normal signature verification.
    if event.get("autopilot_async") and "headers" not in event and "requestContext" not in event:
        return handle_async_processing(event)

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

    if autopilot_event.list_id not in in_scope_list_ids():
        return {"statusCode": 200, "body": json.dumps({"skipped": "list not in scope"})}

    # FAST-ACK: the request is authenticated and in scope — answer ClickUp NOW,
    # with zero ClickUp API calls in-path, and let the async worker route it.
    if not enqueue_async_processing(autopilot_event):
        return {"statusCode": 500, "body": json.dumps({"error": "failed to enqueue async processing"})}

    return {
        "statusCode": 200,
        "body": json.dumps({"status": "accepted", "task_id": autopilot_event.task_id, "kind": autopilot_event.kind}),
    }
