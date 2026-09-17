"""Autopilot conductor: reconciliation sweep backstop.

Mirrors clickup_bot's handle_sweep (see its module's SWEEP block): webhooks
are not a complete feed. A ClickUp automation that both tags and transitions
a card in one write can suppress the delta event, and a suspended webhook
stops delivering silently. This sweep re-derives what a webhook would have
delivered from ClickUp's current board state and feeds it through the EXACT
SAME router.route() + dispatch path the webhook uses (see handler.route_event),
so there is exactly one decision-making path for "should this transition
dispatch a stage" — exercised the same way whether or not a webhook ever
arrived.

It also ticks the epic supervisor (supervisor.run_supervisor_tick) for
EVERY feature card currently sitting in "executing" — AC's entry point (c).
This is a SEPARATE query, not scoped to the lookback window below: an epic
can run for far longer than SWEEP_LOOKBACK_MINUTES with no other field on
its card changing in the meantime, and it must keep being driven for the
epic's whole lifetime, not just while its card looks freshly updated. Once a
card is confirmed to already be executing, driving it needs no actor check —
nothing in this codebase ever writes a feature card into "executing" except
the human action the breakdown-approval gate exists to require, so there is no
bot self-trigger to guard against once it is there.

Cannot reconstruct a genuine history_items delivery — that only exists on a
live webhook payload — so it approximates two things a webhook's
history_items gives for free:

  - from_status: reverse-derived from ROUTING_TABLE, matching the row whose
    to_status equals the task's current status for this card_type. An
    AMBIGUOUS (card_type, to_status) pair — more than one row lands there —
    is skipped entirely rather than guessed: a story sitting in "in progress"
    is reachable from both its kickoff and its feedback-resume rows, and
    reconstructing either against a legitimately mid-run story would dispatch
    a duplicate run. The transitions this forgoes are alert-backed instead
    (the supervisor's stall TTLs surface a story stuck in "in progress").
  - actor_user_id: approximated from the task's most recent comment author.
    ClickUp's REST API exposes no per-field change history outside of a live
    webhook delivery. Absent evidence the bot itself last touched the
    ticket, the actor is left None, which router.route()'s gate treats the
    same as a definitely-human actor — failing toward NOT silently dropping
    a real human-triggered dispatch, never toward silently admitting a bot
    self-trigger.

Scoped to statusUpdated-shaped transitions only — a card's CURRENT status is
all a poll can see. commentPosted's resume trigger (a feedback-needed card
that got a new comment) has no board-state signature to reconstruct from a
poll and is out of scope here; the webhook remains its only path.

Idempotent by construction, same as clickup_bot's: every candidate goes
through dispatch.claim_transition (via the same router.route -> dispatch
path the webhook uses), so an overlapping webhook delivery and a sweep pass
share one dedup key and only one of them ever wins the claim.
"""

import importlib.util
import json
import os
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

DEFAULT_LOOKBACK_MINUTES = 45.0
DEFAULT_MAX_TRIGGERS = 10


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
supervisor = _load_sibling_module("supervisor")
# Only for _normalize_ts / _status_label / in_scope_list_ids — safe to load
# back even though handler.py loads this module: see the comment at the
# bottom of handler.py for why the ordering makes that safe.
handler = _load_sibling_module("handler")


def _positive_float_env(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except (TypeError, ValueError):
        print(f"Ignoring unusable {name}={raw!r}, using {default}")
        return default
    if value <= 0:
        print(f"Ignoring non-positive {name}={raw!r}, using {default}")
        return default
    return value


def sweep_lookback_ms() -> int:
    return int(_positive_float_env("SWEEP_LOOKBACK_MINUTES", DEFAULT_LOOKBACK_MINUTES) * 60 * 1000)


def sweep_max_triggers() -> int:
    return int(_positive_float_env("SWEEP_MAX_TRIGGERS", DEFAULT_MAX_TRIGGERS))


def list_recently_updated_tasks(list_id: str, since_ms: int) -> list[dict]:
    # subtasks=true is load-bearing: stories are subtasks of their feature
    # card on the shared board, and the default (top-level only) would make
    # every story invisible to this reconstruction pass.
    query = urlencode({"date_updated_gt": since_ms, "include_closed": "false", "subtasks": "true"})
    try:
        result = supervisor.clickup_request("GET", f"/list/{list_id}/task?{query}")
    except Exception as e:
        print(f"ERROR: sweep failed to list tasks for list {list_id}: {type(e).__name__}")
        return []

    raw_tasks = result.get("tasks")
    if not isinstance(raw_tasks, list):
        return []

    tasks = []
    for task in raw_tasks:
        if not isinstance(task, dict):
            continue
        # Defense in depth against the query's own date_updated_gt filter
        # being silently ignored or misconfigured server-side: without this,
        # a filter drift would make every task in the list look "recently
        # updated" on every single pass, forever.
        updated = handler._normalize_ts(task.get("date_updated"))
        if updated is not None and int(updated) < since_ms:
            continue
        tasks.append(task)
    return tasks


def _feature_cards_in_status(status: str) -> list[dict]:
    """Every top-level card currently in `status` across the scoped lists —
    unconditional, not filtered by the lookback window (see the module
    docstring for why). A ClickUp filter on `statuses[]`, not on
    `date_updated_gt`. Feature cards only by construction: the query omits
    subtasks (ClickUp's default), and on the shared board every top-level
    card is a feature card; the parent guard is belt-and-suspenders against
    that default changing server-side."""
    tasks: list[dict] = []
    for list_id in sorted(handler.in_scope_list_ids()):
        query = urlencode(
            {"statuses[]": status, "include_closed": "false"},
            quote_via=quote,
            safe="[]",
        )
        try:
            result = supervisor.clickup_request("GET", f"/list/{list_id}/task?{query}")
        except Exception as e:
            print(f"ERROR: sweep failed to list {status!r} feature cards for list {list_id}: {type(e).__name__}")
            continue
        raw_tasks = result.get("tasks")
        if isinstance(raw_tasks, list):
            tasks.extend(t for t in raw_tasks if isinstance(t, dict) and not isinstance(t.get("parent"), str))
    return tasks


def list_executing_feature_cards() -> list[dict]:
    return _feature_cards_in_status(router.STATUS_EXECUTING)


def alert_stalled_in_progress_feature_cards() -> int:
    """A feature card in "in progress" means epic-create is running. The
    reconstruction loop deliberately never re-dispatches one (see
    handle_sweep), so a run that died — or a kickoff whose webhook was lost —
    would otherwise strand the card with no automated signal. This pass posts
    the same once-per-epic Slack stall alert the supervisor posts for
    stories, off its own unconditional statuses[] query rather than the
    lookback scan: a card stalled for hours stops updating and falls out of
    the lookback window exactly when the alert matters. Returns how many
    alerts this pass actually posted."""
    ttl = supervisor.STATUS_TTL_SECONDS[router.STATUS_IN_PROGRESS]
    alerted = 0
    for task in _feature_cards_in_status(router.STATUS_IN_PROGRESS):
        task_id = task.get("id")
        if not isinstance(task_id, str) or not task_id:
            continue
        elapsed = supervisor._seconds_in_current_status(task_id)
        if elapsed is None or elapsed < ttl:
            continue
        # Claim first, post second — same atomic once-only contract as
        # supervisor.check_for_stalls, and the same per-epic claim item, so
        # each epic still gets at most one stall alert total.
        if supervisor.try_claim_stall_alert(task_id):
            supervisor.post_slack_message(
                f":warning: Autopilot feature card stalled in *{router.STATUS_IN_PROGRESS}* for over "
                f"{ttl // 60} min (epic-create died, or its kickoff webhook was lost — move the card back to "
                f"*{router.STATUS_APPROVED_TDD}* and into *{router.STATUS_IN_PROGRESS}* to retry): "
                f"{supervisor.clickup_task_url(task_id)}"
            )
            alerted += 1
    return alerted


def _from_status_for_current(card_type: str, current_status: str) -> str | None:
    """Reverse-looks-up which from_status ROUTING_TABLE associates with
    reaching `current_status` for this card_type — see the module docstring
    for why the sweep has to reconstruct this instead of reading it off a
    real webhook delivery, and for why an ambiguous (card_type, to_status)
    pair is skipped rather than guessed."""
    matches = [
        from_status
        for (row_card_type, from_status, to_status) in router.ROUTING_TABLE
        if row_card_type == card_type and to_status == current_status
    ]
    return matches[0] if len(matches) == 1 else None


def _approximate_actor(task_id: str) -> str | None:
    """Best-available signal for who is responsible for a sweep-discovered
    gate transition (see the module docstring's ACTOR note). None means "no
    evidence the bot itself did this" — router.route()'s gate treats that
    the same as a human actor, matching its own fail-open-to-human default
    for an unset actor."""
    try:
        comments = supervisor.get_task_comments(task_id)
    except Exception as e:
        print(f"ERROR: sweep failed to read comments for actor check on {task_id}: {type(e).__name__}")
        return None
    if not comments:
        return None
    last_comment = comments[-1]
    user = last_comment.get("user")
    if isinstance(user, dict) and isinstance(user.get("id"), (str, int)) and not isinstance(user.get("id"), bool):
        return str(user["id"])
    return None


def _candidate_transition(card_type: str, task: dict, current_status: str) -> Any:
    if card_type == router.STORY_CARD and current_status == router.STATUS_DONE:
        from_status = None
    else:
        from_status = _from_status_for_current(card_type, current_status)
        if from_status is None:
            return None

    task_id = task["id"]
    actor_user_id = _approximate_actor(task_id) if current_status in router.GATE_TO_STATUSES else None
    transitioned_at = handler._normalize_ts(task.get("date_updated"))
    return router.Transition(
        actor_user_id=actor_user_id,
        from_status=from_status,
        to_status=current_status,
        transitioned_at=transitioned_at,
    )


def _dispatch_decision(task_id: str, epic_task_id: str | None, decision: Any) -> bool:
    """Returns whether this decision actually launched something (a Fargate
    stage, or a hand-off to the supervisor) — the same "did a real trigger
    happen" question clickup_bot's own sweep asks, so the cap only counts
    real launches, never declines."""
    if decision.to_supervisor:
        router.dispatch_to_supervisor(decision)
        return True

    if decision.transitioned_at is None:
        print(f"ERROR: sweep-discovered decision missing transitioned_at, refusing to dispatch: task_id={task_id}")
        return False

    ceiling = router.STAGE_CEILINGS[decision.stage]
    envelope = dispatch.StageEnvelope(
        stage=decision.stage,
        task_id=task_id,
        epic_task_id=epic_task_id if decision.stage in router.EPIC_SCOPED_STAGES else None,
        model=router.DEFAULT_AGENT_MODEL,
        max_budget_usd=ceiling.max_budget_usd,
        deadline_seconds=ceiling.deadline_seconds,
    )
    result = dispatch.dispatch_stage(task_id, decision.stage, decision.transitioned_at, envelope)
    return bool(result.get("dispatched"))


def handle_sweep(event: dict) -> dict:
    since_ms = int(time.time() * 1000) - sweep_lookback_ms()
    cap = sweep_max_triggers()

    # Entry point (c) first, and entirely separate from the lookback-scanned
    # pass below: every card currently executing gets ticked, unconditionally
    # and every pass, for as long as its epic runs. Not counted against the
    # trigger cap — a tick is cheap orchestration bounded by the one-story-
    # per-epic invariant and by how many epics are actually executing, not by
    # the unbounded-fan-out risk the cap exists to guard against.
    ticked = 0
    for task in list_executing_feature_cards():
        task_id = task.get("id")
        if isinstance(task_id, str) and task_id:
            supervisor.run_supervisor_tick(task_id)
            ticked += 1

    # Alert-only, never a dispatch: the one automated signal for a feature
    # card stranded mid-epic-create (see alert_stalled_in_progress_feature_cards).
    alerted = alert_stalled_in_progress_feature_cards()

    scanned = 0
    triggered = 0
    cap_hit = False

    for list_id in sorted(handler.in_scope_list_ids()):
        for task in list_recently_updated_tasks(list_id, since_ms):
            task_id = task.get("id")
            if not isinstance(task_id, str) or not task_id:
                continue
            scanned += 1

            parent_id = task.get("parent")
            epic_task_id = parent_id if isinstance(parent_id, str) else None
            card_type = router.derive_card_type(epic_task_id)

            current_status = handler._status_label(task.get("status"))
            if current_status is None:
                continue

            # The dedicated pass above already drives every currently-
            # executing feature card unconditionally; reconstructing this
            # same transition here would only hand it to dispatch_to_supervisor
            # a second time this same pass. "in progress" is skipped for the
            # same reason stories get the ambiguity skip: a feature card
            # sitting there means epic-create is actively running, and every
            # date_updated bump (a comment, a rename) would mint a fresh
            # dedup key and launch a duplicate run. A kickoff whose webhook
            # was lost is a human-visible no-op to retry, not worth that.
            if card_type == router.FEATURE_CARD and current_status in (
                router.STATUS_EXECUTING,
                router.STATUS_IN_PROGRESS,
            ):
                continue

            if triggered >= cap:
                cap_hit = True
                continue

            transition = _candidate_transition(card_type, task, current_status)
            if transition is None:
                continue

            routable = router.RoutableEvent(
                kind="statusUpdated",
                task_id=task_id,
                list_id=list_id,
                current_status=current_status,
                transitions=[transition],
                # Without this, a story reaching "done" (card_type STORY_CARD,
                # no ROUTING_TABLE row involved at all — see router.route()'s
                # dedicated story-done branch) would route to the supervisor
                # with RoutingDecision.epic_task_id always None, and
                # handle_routed_event refuses to act on a decision with no
                # epic id — silently no-opping this whole backstop path.
                epic_task_id=epic_task_id,
            )

            for decision in router.route(routable):
                if triggered >= cap:
                    cap_hit = True
                    break
                if _dispatch_decision(task_id, epic_task_id, decision):
                    triggered += 1

    if cap_hit:
        print(f"ERROR: sweep hit its cap of {cap} triggers; remainder deferred to the next pass")

    print(
        f"Sweep complete: {ticked} epics ticked, {alerted} stall alerts, "
        f"{scanned} candidates scanned, {triggered} triggered"
    )
    return {
        "statusCode": 200,
        "body": json.dumps({"ticked": ticked, "alerted": alerted, "scanned": scanned, "triggered": triggered}),
    }
