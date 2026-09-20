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
poll and is out of scope here; the webhook remains its only path. Parked
stories with NO reply are a different matter: auto_resume_actionable_parks
drives the ones whose park is obvious work rather than a question, so a
stalled PR never waits on a human typing "fix your own CI".

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
from urllib.request import Request, urlopen

DEFAULT_LOOKBACK_MINUTES = 45.0
DEFAULT_MAX_TRIGGERS = 10

GITHUB_API_BASE_URL = "https://api.github.com"
# The one repo autopilot ever opens a story PR against — a bare constant, not
# an env var, for the same reason the rest of this module hardcodes ClickUp's
# base URL: there is exactly one value this has ever needed or is expected to.
GITHUB_REPO = "thegoodparty/omni"

# Claim-key namespace for the "PR closed without merging" Slack alert (see
# resolve_merge_pending_parks) — never a real dispatched stage, just a second
# key family sharing dispatch.claim_transition's table so the alert fires
# exactly once per PR, the same "claim first, alert second" shape
# supervisor.try_claim_stall_alert uses for its own once-only Slack posts.
CLOSED_PR_ALERT_STAGE = "merge-closed-alert"
# Long-lived, like supervisor.EPIC_CLOSE_OUT_TTL_SECONDS: this alert is a
# one-time event for a given PR, not a per-run transition with a natural
# deadline to size a shorter TTL against.
CLOSED_PR_ALERT_TTL_SECONDS = 30 * 24 * 60 * 60


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
github_auth = _load_sibling_module("github_auth")
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


# A story that keeps re-parking eventually needs a human, not more paid laps
# — but the count is per THREAD LIFETIME, not per relapse streak, and a
# normal story legitimately accrues markers along the way (a merge-pending
# park, a deploy-pending park, a stranded-run park). The first live epic hit
# a cap of 3 on a healthy story before its qa park was ever auto-resumed
# once, so the ceiling sits well above routine accrual.
AUTO_RESUME_MAX_PARKS = 10


def _parked_stories() -> list[dict]:
    """Every story currently in feedback needed across the scoped lists —
    the same unconditional statuses[] query shape as _feature_cards_in_status,
    but WITH subtasks (stories are subtasks) and keeping only subtasks."""
    tasks: list[dict] = []
    for list_id in sorted(handler.in_scope_list_ids()):
        query = urlencode(
            {"statuses[]": router.STATUS_FEEDBACK_NEEDED, "subtasks": "true", "include_closed": "false"},
            quote_via=quote,
            safe="[]",
        )
        try:
            result = supervisor.clickup_request("GET", f"/list/{list_id}/task?{query}")
        except Exception as e:
            print(f"ERROR: sweep failed to list parked stories for list {list_id}: {type(e).__name__}")
            continue
        raw_tasks = result.get("tasks")
        if isinstance(raw_tasks, list):
            tasks.extend(t for t in raw_tasks if isinstance(t, dict) and isinstance(t.get("parent"), str))
    return tasks


def auto_resume_actionable_parks(cap: int) -> int:
    """Dispatches ONE resume per park instance for parks that are obvious
    work, not questions: a status note (merge/deploy pending), or a
    stranded-run park — states where the story's own PR carries whatever
    needs doing (failing checks, delegate blockers, a completed merge) and
    asking a human "may I fix my own PR?" just stalls the epic (the first
    live epic stalled three stories this way). Skipped, and left to a human:

    - "QA failed" parks — deciding whether findings mean a code fix, an
      answer, or a cancellation is the human call resume.md's intent check
      exists for.
    - Any park with a comment after it: a reply already dispatched (or will
      dispatch) the comment-resume route; racing it would double-dispatch.
    - Threads carrying AUTO_RESUME_MAX_PARKS or more park markers: a story
      relapsing that often needs a human, and each park already pinged Slack.

    Dedup: the park comment's own id keys the claim, so each park instance
    gets exactly one auto-resume, and a fresh re-park (new comment) earns
    exactly one more, up to the marker cap."""
    resumed = 0
    for task in _parked_stories():
        if resumed >= cap:
            print(f"Auto-resume cap reached ({cap}); remaining parked stories wait for the next pass")
            break
        task_id = task.get("id")
        if not isinstance(task_id, str) or not task_id:
            continue
        try:
            comments = supervisor.get_task_comments(task_id)
        except Exception as e:
            print(f"ERROR: sweep failed to read comments for parked story {task_id}: {type(e).__name__}")
            continue
        park = router.latest_park(comments)
        if park is None or park.comment_id is None:
            continue
        if park.question.lower().startswith("qa failed"):
            continue
        if router.merge_pending_pr_number(park.question) is not None:
            # resolve_merge_pending_parks (run earlier this same tick) owns
            # every merge-pending park, resolved or not: a paid resume here
            # would just re-run the identical GitHub check that pass already
            # made for free, and racing the two on the same park risks a
            # double qa-move if both land in the same tick.
            continue
        if any(router._comment_date_ms(c) > park.date_ms for c in comments if c.get("id") != park.comment_id):
            continue
        if router.park_marker_count(comments) >= AUTO_RESUME_MAX_PARKS:
            print(
                f"Story {task_id} has re-parked {router.park_marker_count(comments)} times; "
                "leaving it for a human instead of another auto-resume lap"
            )
            continue

        ceiling = router.STAGE_CEILINGS[router.STAGE_RESUME]
        envelope = dispatch.StageEnvelope(
            stage=router.STAGE_RESUME,
            task_id=task_id,
            epic_task_id=None,
            model=router.DEFAULT_AGENT_MODEL,
            max_budget_usd=ceiling.max_budget_usd,
            deadline_seconds=ceiling.deadline_seconds,
            resume_stage=park.stage,
        )
        result = dispatch.dispatch_stage(task_id, router.STAGE_RESUME, f"auto-resume-{park.comment_id}", envelope)
        if result.get("dispatched"):
            print(f"Auto-resumed parked story {task_id} (stage {park.stage!r}, park {park.comment_id})")
            resumed += 1
    return resumed


def fetch_pull_request(pr_number: int) -> dict | None:
    """One read of a story's PR (GET /repos/{repo}/pulls/{n}) — just the
    `merged` / `state` fields callers need. None on ANY failure: no token
    minted, a network error, a non-2xx response, or unparseable JSON. Every
    caller treats None identically to "leave the park untouched" (see
    resolve_merge_pending_parks) — a GitHub outage must never move a story or
    alert on a PR nobody actually confirmed the state of."""
    token = github_auth.installation_token()
    if token is None:
        return None
    req = Request(
        f"{GITHUB_API_BASE_URL}/repos/{GITHUB_REPO}/pulls/{pr_number}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        method="GET",
    )
    try:
        with urlopen(req, timeout=10) as response:
            if response.status >= 300:
                print(f"ERROR: GitHub returned {response.status} reading PR #{pr_number}")
                return None
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"ERROR: sweep failed to read PR #{pr_number}: {type(e).__name__}")
        return None


def _dispatch_qa_after_merge(task_id: str, epic_task_id: str | None, pr_number: int) -> bool:
    """Moves a merge-pending story straight to `qa` and launches its QA stage
    run directly — never through ROUTING_TABLE. A second to_status="qa" row
    there (reachable from `feedback needed`, alongside the existing
    `in progress` one) would make sweep._from_status_for_current's
    reconstruction pass treat EVERY story landing in `qa` as ambiguous and
    skip it, blinding the sweep to a lost `in progress -> qa` webhook — today
    the sweep's only entry point there. Dispatching here directly, the same
    way supervisor.dispatch_story does for story kickoff, reaches `qa`
    without ever adding that row.

    Claimed on the PR number, not a ClickUp-delivered transition timestamp:
    there is no real transition to derive one from yet (same reasoning as
    supervisor.dispatch_story's identical comment), and the PR number is
    stable across however many sweep ticks discover the same merge — a claim
    keyed on it, taken BEFORE the ClickUp write, is what stops two
    overlapping ticks from launching two QA runs for one merge.

    The move happens BEFORE the launch, never after: a normal qa dispatch
    only ever fires once its triggering webhook already reflects the card in
    `qa` (the write happens first, then the webhook), and qa.md's
    stranded-run guard (feedback.STRANDED_STATUSES) depends on that being
    true the moment the container starts.
    """
    ceiling = router.STAGE_CEILINGS[router.STAGE_QA]
    ttl = ceiling.deadline_seconds + dispatch.DEDUP_TTL_GRACE_SECONDS
    reason = dispatch.claim_transition(task_id, router.STAGE_QA, f"merge-{pr_number}", ttl)
    if reason is not None:
        return False

    try:
        supervisor.move_task_status(task_id, router.STATUS_QA)
    except Exception as e:
        print(f"ERROR: sweep failed to move {task_id} to qa after PR #{pr_number} merged: {type(e).__name__}")
        return False

    envelope = dispatch.StageEnvelope(
        stage=router.STAGE_QA,
        task_id=task_id,
        epic_task_id=epic_task_id,
        model=router.DEFAULT_AGENT_MODEL,
        max_budget_usd=ceiling.max_budget_usd,
        deadline_seconds=ceiling.deadline_seconds,
    )
    result = dispatch.launch_fargate_stage(envelope)
    if not result["launched"]:
        print(
            "ERROR: moved to qa but failed to launch its stage run; claim left in place for the sweep to recover: "
            f"task_id={task_id} pr=#{pr_number}"
        )
    return bool(result["launched"])


def _alert_closed_unmerged_pr(task_id: str, pr_number: int) -> bool:
    """Posts ONE Slack alert for a merge-pending story whose PR closed
    without merging — claimed on the PR number so a relapsing sweep tick
    (the PR stays closed forever) never posts a second one, the same
    claim-first-post-second shape supervisor.try_claim_stall_alert uses."""
    reason = dispatch.claim_transition(task_id, CLOSED_PR_ALERT_STAGE, str(pr_number), CLOSED_PR_ALERT_TTL_SECONDS)
    if reason is not None:
        return False
    supervisor.post_slack_message(
        f":warning: Autopilot story {supervisor.clickup_task_url(task_id)} parked waiting on PR #{pr_number}, "
        "which closed without merging. It will not resolve on its own — comment on the card to resume once "
        "you've decided what happens next."
    )
    return True


def resolve_merge_pending_parks() -> dict[str, int]:
    """Runs BEFORE auto_resume_actionable_parks (see handle_sweep): for every
    story parked on a "Merge pending: PR #<n>" status note, one GitHub read
    decides the outcome — merged moves the story to `qa` and launches QA
    (see _dispatch_qa_after_merge), closed-unmerged posts one Slack alert,
    and still-open (or an unreadable PR) leaves the park exactly where it is.
    Not bounded by the sweep's own trigger cap: like the executing-feature-
    card tick, the actions here are cheap and self-limiting (bounded by how
    many stories are ever simultaneously parked on a pending merge, never by
    dispatch fan-out)."""
    resolved = 0
    alerted = 0
    for task in _parked_stories():
        task_id = task.get("id")
        if not isinstance(task_id, str) or not task_id:
            continue
        try:
            comments = supervisor.get_task_comments(task_id)
        except Exception as e:
            print(f"ERROR: sweep failed to read comments for parked story {task_id}: {type(e).__name__}")
            continue
        park = router.latest_park(comments)
        if park is None:
            continue
        pr_number = router.merge_pending_pr_number(park.question)
        if pr_number is None:
            continue  # some other status note, or a real question — not ours

        pull_request = fetch_pull_request(pr_number)
        if pull_request is None:
            print(f"ERROR: sweep could not confirm PR #{pr_number}'s state for {task_id}; leaving it parked")
            continue

        if pull_request.get("merged"):
            parent_id = task.get("parent")
            epic_task_id = parent_id if isinstance(parent_id, str) else None
            if _dispatch_qa_after_merge(task_id, epic_task_id, pr_number):
                resolved += 1
            continue

        if pull_request.get("state") == "closed" and _alert_closed_unmerged_pr(task_id, pr_number):
            alerted += 1
        # else: still open — leave it exactly where it is.

    return {"merge_resolved": resolved, "merge_closed_alerted": alerted}


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

    # Before auto-resume, and uncapped (see resolve_merge_pending_parks): every
    # merge-pending park it finds is EXCLUDED from the auto-resume pass below
    # (auto_resume_actionable_parks' own skip), so a paid resume can never
    # race this free GitHub-backed resolution for the same park.
    merge_pending_result = resolve_merge_pending_parks()

    # After the lookback pass so reconstruction gets first claim at the cap:
    # an undelivered transition is lost work, an unparked resume is deferred
    # work — the next pass reaches it.
    auto_resumed = auto_resume_actionable_parks(max(cap - triggered, 0))

    print(
        f"Sweep complete: {ticked} epics ticked, {alerted} stall alerts, "
        f"{scanned} candidates scanned, {triggered} triggered, "
        f"{merge_pending_result['merge_resolved']} merges resolved, "
        f"{merge_pending_result['merge_closed_alerted']} closed-PR alerts, {auto_resumed} auto-resumed"
    )
    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "ticked": ticked,
                "alerted": alerted,
                "scanned": scanned,
                "triggered": triggered,
                "merge_resolved": merge_pending_result["merge_resolved"],
                "merge_closed_alerted": merge_pending_result["merge_closed_alerted"],
                "auto_resumed": auto_resumed,
            }
        ),
    }
