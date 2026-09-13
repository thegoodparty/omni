"""Autopilot conductor: routing table + human-actor gate.

Deterministic — no LLM runs in this Lambda. Maps (card type, from-status,
to-status) to a stage dispatch, and gates the transitions that kick off paid
agent work so only a human decision can trigger them.

Deliberately decoupled from handler.py's AutopilotEvent/StatusTransition:
route() takes its own small, primitive-typed RoutableEvent/Transition shapes
so this module has no import-order dependency on the handler (which cannot be
a normal dotted import — `lambda` is a keyword — and is loaded by file path;
see tests/conftest.py). handler.py maps its parsed event into these shapes
before calling route().
"""

import importlib.util
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

CardType = Literal["feature_card", "story"]

FEATURE_CARD: CardType = "feature_card"
STORY_CARD: CardType = "story"

# --- Stages ------------------------------------------------------------

STAGE_EPIC_CREATE = "epic-create"
STAGE_STORY = "story"
STAGE_QA = "qa"
STAGE_RESUME = "resume"
# Sentinel stage for RoutingDecision.to_supervisor=True. Never looked up in
# STAGE_CEILINGS and never dispatched to Fargate — see dispatch_to_supervisor.
STAGE_SUPERVISOR = "supervisor"

# Stages whose stage-runner needs to know which epic a story belongs to.
# epic-create never gets one (it IS the epic run); resume is deliberately
# excluded too — the ticket's envelope spec calls out "story/qa only".
EPIC_SCOPED_STAGES = frozenset({STAGE_STORY, STAGE_QA})

DEFAULT_AGENT_MODEL = "sonnet"

# --- Status names --------------------------------------------------------
# task 14 owns the real board schema (the exact ClickUp status labels per
# list). Every call site reads these constants, never a literal, so that
# decision only has to edit this block.

STATUS_APPROVED_TDD = "approved tdd"
STATUS_BREAKDOWN_REVIEW = "breakdown review"
STATUS_TO_DO = "to do"
STATUS_IN_PROGRESS = "in progress"
STATUS_EXECUTING = "executing"
STATUS_QA = "qa"
STATUS_DONE = "done"
STATUS_FEEDBACK_NEEDED = "feedback needed"

# Gate integrity: a transition INTO one of these statuses is a human decision
# point (it kicks off paid agent work) and must never be satisfied by the
# bot's own status writes. Two labels because different lists in the board
# spell the same "work starts now" moment differently (feature cards move to
# "in progress"; so does a story resuming from feedback — "executing" is
# reserved for the plain story-kickoff transition below).
GATE_TO_STATUSES = frozenset({STATUS_IN_PROGRESS, STATUS_EXECUTING})


@dataclass(frozen=True)
class StageCeiling:
    max_budget_usd: float
    deadline_seconds: int


# Per-stage ceilings. Both are ceilings, not targets — ported from
# engineer_agent's AgentConfig ceiling contract (AGENT_MAX_BUDGET_USD /
# AGENT_DEADLINE_SECONDS), one dict per stage instead of one global default.
STAGE_CEILINGS: dict[str, StageCeiling] = {
    STAGE_EPIC_CREATE: StageCeiling(max_budget_usd=10.0, deadline_seconds=30 * 60),
    STAGE_STORY: StageCeiling(max_budget_usd=15.0, deadline_seconds=45 * 60),
    STAGE_QA: StageCeiling(max_budget_usd=8.0, deadline_seconds=30 * 60),
    # Resume continues story work rather than being its own kind of work —
    # the ticket carves out no separate budget for it, so it inherits story's.
    STAGE_RESUME: StageCeiling(max_budget_usd=15.0, deadline_seconds=45 * 60),
}

# (card type, from-status, to-status) -> stage. Data, not code: a new
# transition is a new row here, not a new branch in route().
ROUTING_TABLE: dict[tuple[CardType, str | None, str], str] = {
    (FEATURE_CARD, STATUS_APPROVED_TDD, STATUS_IN_PROGRESS): STAGE_EPIC_CREATE,
    # A human has reviewed epic-create's story breakdown and kicked off the
    # epic supervisor. Maps to STAGE_SUPERVISOR, not a Fargate stage — see
    # route()'s to_supervisor handling below, and supervisor.py for what runs
    # from here. "executing" (not "in progress") is this transition's
    # to-status for the same board-schema reason a story's own kickoff uses
    # it (see GATE_TO_STATUSES).
    (FEATURE_CARD, STATUS_BREAKDOWN_REVIEW, STATUS_EXECUTING): STAGE_SUPERVISOR,
    (STORY_CARD, STATUS_TO_DO, STATUS_EXECUTING): STAGE_STORY,
    (STORY_CARD, STATUS_IN_PROGRESS, STATUS_QA): STAGE_QA,
    (STORY_CARD, STATUS_FEEDBACK_NEEDED, STATUS_IN_PROGRESS): STAGE_RESUME,
}


@dataclass(frozen=True)
class Transition:
    actor_user_id: str | None
    from_status: str | None
    to_status: str | None
    transitioned_at: str | None


@dataclass(frozen=True)
class RoutableEvent:
    kind: str
    task_id: str
    list_id: str | None
    current_status: str | None
    transitions: list[Transition]
    # Top-level delivery timestamp; the only dedup key source for kinds that
    # carry no history_items (commentPosted).
    event_ts: str | None = None
    # Which epic a STORY_CARD belongs to (task 14's board field; see
    # handler.AutopilotEvent). Feature cards never set this — for the
    # breakdown-review gate the epic IS the card itself, so route() derives
    # RoutingDecision.epic_task_id from task_id instead.
    epic_task_id: str | None = None


@dataclass(frozen=True)
class RoutingDecision:
    stage: str
    card_type: CardType
    task_id: str
    transitioned_at: str | None
    to_supervisor: bool = False
    # Populated only when to_supervisor is True: the feature card's own id
    # for the breakdown-review gate, or the story's parent epic for a
    # story-done event. dispatch_to_supervisor's caller (route_event) never
    # sees the original event, only this decision, so the epic id has to
    # travel on it rather than be re-derived downstream.
    epic_task_id: str | None = None


# Comment-triggered resume dedup window: comments delivered within the same
# 10-minute bucket share one claim (coalescing a burst or a webhook
# redelivery into one resume run), while a later feedback round — a comment
# after the bucket rolls over — gets a fresh key instead of being silently
# swallowed by a claim from a run that already exited. Two spaced comments in
# one long feedback phase can still each trigger a run; the resume stage
# re-reads the whole thread, so the second run is redundant but harmless.
COMMENT_TRIGGER_BUCKET_MS = 10 * 60 * 1000


def comment_trigger_key(event_ts: str | None) -> str | None:
    if event_ts is None:
        return None
    try:
        bucket = int(event_ts) // COMMENT_TRIGGER_BUCKET_MS
    except ValueError:
        return None
    return f"comment-{bucket}"


def story_list_ids() -> frozenset[str]:
    raw = os.environ.get("AUTOPILOT_STORY_LIST_IDS", "")
    ids = frozenset(part.strip() for part in raw.split(",") if part.strip())
    scope = frozenset(part.strip() for part in os.environ.get("AUTOPILOT_LIST_IDS", "").split(",") if part.strip())
    orphaned = ids - scope
    if orphaned:
        # A story list missing from AUTOPILOT_LIST_IDS is silently dropped at
        # the handler's scope gate; without this signal the misconfiguration
        # is invisible.
        print(f"ERROR: AUTOPILOT_STORY_LIST_IDS entries not in AUTOPILOT_LIST_IDS scope: {sorted(orphaned)}")
    return ids


def derive_card_type(list_id: str | None) -> CardType:
    """Feature card vs story, derived from ClickUp list membership.

    task 14 owns the real board schema (which lists are which, or whether
    this becomes a custom-field read instead) — this is the one function
    that decision touches. Until then: a list configured in
    AUTOPILOT_STORY_LIST_IDS is a story; everything else in scope is a
    feature card, matching today's single-list reality.
    """
    if list_id is not None and list_id in story_list_ids():
        return STORY_CARD
    return FEATURE_CARD


def _bot_user_id_or_none() -> str | None:
    bot_user_id = os.environ.get("AUTOPILOT_BOT_USER_ID")
    if not bot_user_id:
        # Fail CLOSED: an unset/misconfigured bot id must not silently
        # disable the gate (which would let the bot's own writes pass as a
        # human decision) — refuse every gate dispatch instead, loudly.
        print("ERROR: AUTOPILOT_BOT_USER_ID not configured; refusing gate dispatch")
        return None
    return bot_user_id


def _load_sibling_module(stem: str) -> Any:
    """Loads supervisor.py by path, same as handler.py's own copy (see its
    module docstring for why this can't be a plain import). Duplicated here
    rather than imported from handler.py: router.py is deliberately decoupled
    from handler.py (see this module's docstring), and dispatch_to_supervisor
    is the one place router.py itself needs a sibling module."""
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


# Lazy, not a module-top-level load: dispatch_to_supervisor only runs inside
# route(), well after every module in lambda/ has finished importing (see
# handler.py, which loads supervisor.py itself and is always the Lambda's
# actual entry point), so there is no real import-order hazard here — but
# loading eagerly at router.py's own top level would add one anyway, since
# supervisor.py loads router.py right back.
_supervisor_module: Any = None


def _load_supervisor_module() -> Any:
    global _supervisor_module
    if _supervisor_module is None:
        _supervisor_module = _load_sibling_module("supervisor")
    return _supervisor_module


def dispatch_to_supervisor(decision: RoutingDecision) -> None:
    """Hands an epic-supervisor-scoped decision (the breakdown-review gate,
    or a story reaching done) to supervisor.py's per-epic conductor tick. See
    supervisor.py's module docstring for the one-in-flight-story invariant,
    next-story selection, and stall detection this triggers."""
    _load_supervisor_module().handle_routed_event(decision)


def route(event: RoutableEvent) -> list[RoutingDecision]:
    """Routes one parsed webhook event to zero or more stage dispatches.

    Zero, not one: a delivery can carry more than one history item (unusual,
    but the shape allows it), and each matching transition is its own
    dispatch decision with its own dedup key.
    """
    card_type = derive_card_type(event.list_id)

    if event.kind == "commentPosted":
        # commentPosted carries no status transition — the trigger is the
        # CURRENT status at delivery time, not a before/after pair.
        if card_type == STORY_CARD and event.current_status == STATUS_FEEDBACK_NEEDED:
            # Bucketed, not the raw delivery timestamp: distinct comments in a
            # burst would each mint a fresh key and launch concurrent resume
            # runs (see COMMENT_TRIGGER_BUCKET_MS).
            return [
                RoutingDecision(
                    stage=STAGE_RESUME,
                    card_type=card_type,
                    task_id=event.task_id,
                    transitioned_at=comment_trigger_key(event.event_ts),
                )
            ]
        return []

    if event.kind != "statusUpdated":
        return []

    decisions: list[RoutingDecision] = []
    for transition in event.transitions:
        if transition.to_status is None:
            continue

        if card_type == STORY_CARD and transition.to_status == STATUS_DONE:
            decisions.append(
                RoutingDecision(
                    stage=STAGE_SUPERVISOR,
                    card_type=card_type,
                    task_id=event.task_id,
                    transitioned_at=transition.transitioned_at,
                    to_supervisor=True,
                    # The story's own id is never the epic id — the epic is
                    # whichever feature card this story's parent points to,
                    # carried on the event because RoutingDecision has no way
                    # to re-derive it downstream (see the field's docstring).
                    epic_task_id=event.epic_task_id,
                )
            )
            continue

        stage = ROUTING_TABLE.get((card_type, transition.from_status, transition.to_status))
        if stage is None:
            continue

        if transition.to_status in GATE_TO_STATUSES:
            bot_user_id = _bot_user_id_or_none()
            if bot_user_id is None or transition.actor_user_id == bot_user_id:
                # Either the gate is unconfigured (already logged above) or
                # this write came from the bot itself — neither dispatches.
                continue

        to_supervisor = stage == STAGE_SUPERVISOR
        decisions.append(
            RoutingDecision(
                stage=stage,
                card_type=card_type,
                task_id=event.task_id,
                transitioned_at=transition.transitioned_at,
                to_supervisor=to_supervisor,
                # The breakdown-review gate IS the epic: a feature card's own
                # task_id is the epic id every story under it points back to.
                epic_task_id=event.task_id if to_supervisor else None,
            )
        )
    return decisions
