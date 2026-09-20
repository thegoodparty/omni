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
import re
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

# The park marker the agent's feedback primitive writes as the FIRST LINE of
# every parking comment. Deliberately duplicated from
# autopilot/agent/feedback.py (PARK_MARKER_PATTERN): the Lambda bundle stays
# dependency-light and cannot import the agent package, whose feedback module
# pulls in the shared ClickUp/Slack clients. A contract test asserts the two
# patterns stay character-identical.
PARK_MARKER_PATTERN = re.compile(r"\[autopilot:parked stage=([a-z0-9][a-z0-9-]*)\]", re.IGNORECASE)


def _comment_date_ms(comment: dict) -> int:
    try:
        return int(str(comment.get("date", "")))
    except ValueError:
        return 0


@dataclass(frozen=True)
class Park:
    stage: str
    question: str
    comment_id: str | None
    date_ms: int


def latest_park(comments: list[dict]) -> Park | None:
    """The most recent park in a comment thread, with the question text the
    auto-resume classifier keys on (the first numbered line after the marker)
    and the park comment's own id and date, so the sweep can dedup one
    auto-resume per park instance and detect replies posted after it."""
    for comment in sorted(comments, key=_comment_date_ms, reverse=True):
        text = comment.get("comment_text")
        if not isinstance(text, str):
            continue
        match = PARK_MARKER_PATTERN.search(text)
        if not match:
            continue
        question = ""
        for line in text.splitlines():
            stripped = line.strip()
            if stripped and not PARK_MARKER_PATTERN.search(stripped):
                question = stripped.lstrip("0123456789. ").strip()
                break
        comment_id = comment.get("id")
        return Park(
            stage=match.group(1).lower(),
            question=question,
            comment_id=comment_id if isinstance(comment_id, str) else None,
            date_ms=_comment_date_ms(comment),
        )
    return None


# The status note stages/story.md parks with once a PR is approved and
# auto-merge armed but hasn't merged yet (stages/story.md step 6). Scoped to
# THIS status note only: "Deploy pending" (qa.md) and stranded-run parks stay
# on the existing auto-resume/human path — the conductor can cheaply check a
# PR's merge state, but deploy verification stays agent work (see sweep.py's
# resolve_merge_pending_parks).
MERGE_PENDING_QUESTION_PATTERN = re.compile(r"^merge pending:\s*pr\s*#(\d+)", re.IGNORECASE)


def merge_pending_pr_number(question: str) -> int | None:
    """The PR number out of a Park's question text, or None if this park is
    some other status note (e.g. "Deploy pending") or a real question."""
    match = MERGE_PENDING_QUESTION_PATTERN.match(question.strip())
    return int(match.group(1)) if match else None


def park_marker_count(comments: list[dict]) -> int:
    """How many park comments the thread carries, across stages — the sweep's
    loop bound: a story that keeps re-parking needs a human, not more laps."""
    count = 0
    for comment in comments:
        text = comment.get("comment_text")
        if isinstance(text, str) and PARK_MARKER_PATTERN.search(text):
            count += 1
    return count


def parked_stage_from_comments(comments: list[dict]) -> str | None:
    """The stage named by the MOST RECENT park marker in a comment thread, or
    None. Latest wins by the comment's own date (a card can park, resume, and
    re-park); an unparseable date sorts oldest, same fail-toward-not-blocking
    direction the agent-side parse takes."""
    park = latest_park(comments)
    return park.stage if park is not None else None


# --- Status names --------------------------------------------------------
# The real board (ENG-11104): ONE ClickUp list holds both feature cards and
# stories (a story is a subtask of its feature card), with these statuses.
# Every call site reads these constants, never a literal, so a board relabel
# only has to edit this block.
#
# "approved tdd" is deliberately double-duty: it is the feature card's intake
# column AND the story queue column (a freshly created story lands in the
# list's first status). "executing" belongs to feature cards only — it is the
# post-breakdown-approval state the sweep drives every live epic from, and
# must stay distinct from "in progress" (= epic-create is still planning) or
# a sweep tick could dispatch stories before the human approved the breakdown.

STATUS_APPROVED_TDD = "approved tdd"
STATUS_IN_PROGRESS = "in progress"
STATUS_FEEDBACK_NEEDED = "feedback needed"
STATUS_EXECUTING = "executing"
STATUS_QA = "qa"
STATUS_DONE = "done"

# Gate integrity: a transition INTO one of these statuses is a human decision
# point (it kicks off paid agent work) and must never be satisfied by the
# bot's own status writes. "in progress" covers the epic-create and story
# kickoffs plus a story resuming from feedback; "executing" is the
# breakdown-approval gate on the feature card.
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
    # 45, not 30: the first live 30-minute qa run was killed mid-walk (the
    # walk shares its budget with waiting out the release train's deploy),
    # exiting with nothing parked.
    STAGE_QA: StageCeiling(max_budget_usd=8.0, deadline_seconds=45 * 60),
    # Resume continues story work rather than being its own kind of work —
    # the ticket carves out no separate budget for it, so it inherits story's.
    STAGE_RESUME: StageCeiling(max_budget_usd=15.0, deadline_seconds=45 * 60),
}

# (card type, from-status, to-status) -> stage. Data, not code: a new
# transition is a new row here, not a new branch in route(). NOTE:
# sweep._from_status_for_current reverse-looks-up rows by (card_type,
# to_status) and skips reconstruction when that pair is ambiguous — the two
# STORY rows landing in "in progress" (kickoff and resume) are a known,
# deliberate ambiguity: a mid-run story must never be re-dispatched off a
# board poll, and both of those transitions are alert-backed if their
# webhook is lost (the supervisor's stall TTLs). "qa" deliberately stays
# UNAMBIGUOUS (a single row): sweep.resolve_merge_pending_parks reaches `qa`
# straight from a merge-pending park without a second row here, launching the
# stage itself (dispatch.claim_transition + dispatch.launch_fargate_stage)
# rather than relying on the resulting bot-authored webhook to route it —
# adding a second to_status="qa" row would blind the lookback reconstruction
# below to a lost "in progress -> qa" webhook, today's only entry point here.
ROUTING_TABLE: dict[tuple[CardType, str | None, str], str] = {
    (FEATURE_CARD, STATUS_APPROVED_TDD, STATUS_IN_PROGRESS): STAGE_EPIC_CREATE,
    # A human has reviewed epic-create's story breakdown (posted to "feedback
    # needed") and kicked off the epic supervisor. Maps to STAGE_SUPERVISOR,
    # not a Fargate stage — see route()'s to_supervisor handling below, and
    # supervisor.py for what runs from here.
    (FEATURE_CARD, STATUS_FEEDBACK_NEEDED, STATUS_EXECUTING): STAGE_SUPERVISOR,
    # Manual story kickoff. The supervisor's own dispatches never pass
    # through here: it launches Fargate directly and the stage runner's first
    # "in progress" write is a bot actor the gate refuses.
    (STORY_CARD, STATUS_APPROVED_TDD, STATUS_IN_PROGRESS): STAGE_STORY,
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
    # The delivery's timestamp; the only dedup key source for kinds whose
    # history items parse to no status transition (commentPosted).
    event_ts: str | None = None
    # Who caused the delivery (first history item's user). The comment-resume
    # route keys off it: a park's own parking comment must never resume the
    # stage that just parked.
    event_actor_id: str | None = None
    # The task's ClickUp parent: set = this is a story and names its epic,
    # unset = this is a feature card (see derive_card_type). For the
    # breakdown-approval gate the epic IS the card itself, so route() derives
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
    # for the breakdown-approval gate, or the story's parent epic for a
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


def derive_card_type(epic_task_id: str | None) -> CardType:
    """Feature card vs story, derived from ClickUp parenthood (ENG-11104's
    board schema): both card kinds share one list, and a story is a subtask
    of its feature card, so "has a parent" IS the discriminator. The handler
    hydrates epic_task_id from the task's `parent` field before routing (and
    refuses to route when that read fails, so a story can never be
    misclassified as a feature card by a missing fetch)."""
    if epic_task_id is not None:
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
    """Hands an epic-supervisor-scoped decision (the breakdown-approval gate,
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
    card_type = derive_card_type(event.epic_task_id)

    if event.kind == "commentPosted":
        # commentPosted carries no status transition — the trigger is the
        # CURRENT status at delivery time, not a before/after pair.
        if card_type == STORY_CARD and event.current_status == STATUS_FEEDBACK_NEEDED:
            # The park primitive's LAST card write is its own comment, which
            # arrives right back here as a commentPosted delivery. Without
            # this check every park resumes itself immediately — and a resume
            # that re-parks comments again, so the loop self-sustains, one
            # paid Fargate run per lap. Fail closed on a missing bot id for
            # the same reason the gate check does: an unidentifiable actor
            # cannot be proven human.
            bot_user_id = os.environ.get("AUTOPILOT_BOT_USER_ID")
            if not bot_user_id:
                print("ERROR: AUTOPILOT_BOT_USER_ID not configured; refusing comment-resume dispatch")
                return []
            if event.event_actor_id == bot_user_id:
                print(
                    f"Ignoring the bot's own comment on story {event.task_id}: "
                    "a parking comment must not resume the stage that parked"
                )
                return []
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
        if card_type == STORY_CARD:
            # The status here is hydrated from a live task read AFTER the
            # fast-ack, so a card moved out of feedback-needed in that window
            # lands in this branch — and the sweep cannot reconstruct a
            # commentPosted trigger from board state, so the drop is final.
            # Loud on purpose: this log line is the only trace it happened.
            print(
                f"WARNING: commentPosted on story {event.task_id} dropped: "
                f"current_status={event.current_status!r} is not feedback-needed "
                "(possible hydration-delay race — card may have moved before the async worker read it)"
            )
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
                # The breakdown-approval gate IS the epic: a feature card's own
                # task_id is the epic id every story under it points back to.
                epic_task_id=event.task_id if to_supervisor else None,
            )
        )
    return decisions
