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
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from botocore.exceptions import ClientError

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

# Fixed DynamoDB key (same table dispatch.py's per-transition claims and
# supervisor.py's epic claims live in, a separate key family from both) for
# the pinned #autopilot status message's ts — a singleton row, not a
# per-transition claim, so it carries no expires_at and never self-expires.
STATUS_CARD_PK = "status_card"


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


DEFAULT_FLAG_CLEANUP_RAMP_DAYS = 7.0


def flag_cleanup_ramp_days() -> float:
    return _positive_float_env("FLAG_CLEANUP_RAMP_DAYS", DEFAULT_FLAG_CLEANUP_RAMP_DAYS)


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


def auto_resume_actionable_parks(cap: int, parked_stories: list[dict]) -> int:
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
    exactly one more, up to the marker cap.

    `parked_stories` is passed in (from handle_sweep's own _parked_stories()
    call) rather than fetched here — it doubles as the status card's
    "awaiting feedback" list, and re-querying it would be exactly the extra
    ClickUp read this module's docstring says the status card must not add."""
    resumed = 0
    for task in parked_stories:
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
        # A run's own run-summary comment (ENG-11151) is excluded from this
        # check by MARKER, not by author: it always lands after the park it
        # describes (every run posts one at its end, including a run that
        # just parked), but it is never a human answer — see
        # router.RUN_SUMMARY_MARKER_PATTERN's docstring for why author-based
        # exclusion would be wrong (it would also swallow a genuine relayed
        # Slack answer, which is bot-authored too).
        if any(
            router._comment_date_ms(c) > park.date_ms
            for c in comments
            if c.get("id") != park.comment_id and not router.is_run_summary_comment(c.get("comment_text"))
        ):
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
    keyed on it is what stops two overlapping ticks from launching two QA
    runs for one merge.

    Ordering is move, then claim, then launch. The ClickUp move is idempotent
    (qa -> qa is a no-op), so claiming only after it succeeds means a failed
    move leaves nothing claimed and the next tick retries freely — claiming
    first would strand the story for the claim's full TTL on one transient
    ClickUp error. The move also must precede the launch: a normal qa
    dispatch only ever fires once its triggering webhook already reflects the
    card in `qa`, and qa.md's stranded-run guard (feedback.STRANDED_STATUSES)
    depends on that being true the moment the container starts. A failed
    launch undoes both earlier writes (claim first, then the move) so the
    next tick retries the whole dispatch — see the inline comment below.
    """
    try:
        supervisor.move_task_status(task_id, router.STATUS_QA)
    except Exception as e:
        print(f"ERROR: sweep failed to move {task_id} to qa after PR #{pr_number} merged: {type(e).__name__}")
        return False

    ceiling = router.STAGE_CEILINGS[router.STAGE_QA]
    ttl = ceiling.deadline_seconds + dispatch.DEDUP_TTL_GRACE_SECONDS
    reason = dispatch.claim_transition(task_id, router.STAGE_QA, f"merge-{pr_number}", ttl)
    if reason is not None:
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
        # Undo both writes so the next tick retries the whole dispatch: once
        # a story sits in `qa`, no sweep path re-attempts this launch
        # (_parked_stories only sees feedback-needed). The claim is released
        # FIRST — a rolled-back park with a live claim would re-enter here
        # next tick, re-move to qa, lose the claim, and strand the story
        # unlaunched. If a rollback step itself fails, the story sits in qa
        # and the supervisor's stall TTL alerts — the same backstop as
        # before, now only on a double failure instead of every one.
        print(
            "ERROR: moved to qa but failed to launch its stage run; rolling back for sweep retry: "
            f"task_id={task_id} pr=#{pr_number}"
        )
        _release_qa_dispatch_claim(task_id, pr_number)
        try:
            supervisor.move_task_status(task_id, router.STATUS_FEEDBACK_NEEDED)
        except Exception as e:
            print(f"ERROR: rollback of {task_id} to feedback-needed failed: {type(e).__name__}")
    return bool(result["launched"])


def _release_qa_dispatch_claim(task_id: str, pr_number: int) -> None:
    """Deletes the exact claim _dispatch_qa_after_merge just won — safe to
    scope to the bare key because the caller holds it (nothing else can have
    claimed the same (task, qa, merge-PR) triple while it exists)."""
    table_name = os.environ.get("AUTOPILOT_DEDUP_TABLE")
    if not table_name:
        return
    try:
        dispatch.get_dynamodb_client().delete_item(
            TableName=table_name,
            Key={"pk": {"S": dispatch.claim_pk(task_id, router.STAGE_QA, f"merge-{pr_number}")}},
        )
    except Exception as e:
        print(f"ERROR: releasing qa dispatch claim for {task_id} PR #{pr_number} failed: {type(e).__name__}")


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


def resolve_merge_pending_parks(parked_stories: list[dict]) -> dict[str, int]:
    """Runs BEFORE auto_resume_actionable_parks (see handle_sweep): for every
    story parked on a "Merge pending: PR #<n>" status note, one GitHub read
    decides the outcome — merged moves the story to `qa` and launches QA
    (see _dispatch_qa_after_merge), closed-unmerged posts one Slack alert,
    and still-open (or an unreadable PR) leaves the park exactly where it is.
    Not bounded by the sweep's own trigger cap: like the executing-feature-
    card tick, the actions here are cheap and self-limiting (bounded by how
    many stories are ever simultaneously parked on a pending merge, never by
    dispatch fan-out). `parked_stories` is handle_sweep's single per-tick
    fetch, shared with auto_resume_actionable_parks — safe even though this
    pass moves resolved stories to `qa`, because auto-resume's own
    merge-pending skip drops those same entries."""
    resolved = 0
    alerted = 0
    for task in parked_stories:
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


def alert_stalled_in_progress_feature_cards(cards: list[dict]) -> int:
    """A feature card in "in progress" means epic-create is running. The
    reconstruction loop deliberately never re-dispatches one (see
    handle_sweep), so a run that died — or a kickoff whose webhook was lost —
    would otherwise strand the card with no automated signal. This pass posts
    the same once-per-epic Slack stall alert the supervisor posts for
    stories, off `cards` — handle_sweep's own unconditional statuses[] query
    (passed in rather than re-fetched here; see auto_resume_actionable_parks'
    docstring for why) rather than the lookback scan: a card stalled for
    hours stops updating and falls out of the lookback window exactly when
    the alert matters. Returns how many alerts this pass actually posted."""
    ttl = supervisor.STATUS_TTL_SECONDS[router.STATUS_IN_PROGRESS]
    alerted = 0
    for task in cards:
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
    # Captured once and reused below by the status card (ENG-11151) instead
    # of being re-queried: "cards by status" / "in-flight stories" must come
    # purely from ClickUp reads this tick already makes, never a fresh query
    # family of their own (see update_status_card's docstring).
    executing_cards = list_executing_feature_cards()
    ticked = 0
    for task in executing_cards:
        task_id = task.get("id")
        if isinstance(task_id, str) and task_id:
            supervisor.run_supervisor_tick(task_id)
            ticked += 1

    # Alert-only, never a dispatch: the one automated signal for a feature
    # card stranded mid-epic-create (see alert_stalled_in_progress_feature_cards).
    in_progress_cards = _feature_cards_in_status(router.STATUS_IN_PROGRESS)
    alerted = alert_stalled_in_progress_feature_cards(in_progress_cards)

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

    # One parked-stories fetch per tick, shared by both passes below.
    parked_stories = _parked_stories()

    # Before auto-resume, and uncapped (see resolve_merge_pending_parks): every
    # merge-pending park it finds is EXCLUDED from the auto-resume pass below
    # (auto_resume_actionable_parks' own skip), so a paid resume can never
    # race this free GitHub-backed resolution for the same park.
    merge_pending_result = resolve_merge_pending_parks(parked_stories)

    # After the lookback pass so reconstruction gets first claim at the cap:
    # an undelivered transition is lost work, an unparked resume is deferred
    # work — the next pass reaches it.
    auto_resumed = auto_resume_actionable_parks(max(cap - triggered, 0), parked_stories)

    # A separate, unconditional statuses[] query (own read family, like
    # executing_cards/in_progress_cards above) — cheap ClickUp reads; the
    # Amplitude reads this feeds are the part bounded and guarded below (see
    # check_flag_cleanup_ramps).
    try:
        flag_cleanup_promoted = check_flag_cleanup_ramps(_feature_cards_in_status(router.STATUS_DONE))
    except Exception as e:
        print(f"ERROR: flag-cleanup ramp check failed: {type(e).__name__}: {e}")
        flag_cleanup_promoted = 0

    # Status-card failures are lost visibility, never a failed tick: every
    # helper below already logs-and-continues on its own, and this catches
    # anything else (a bad board shape) that would otherwise bubble past them.
    try:
        update_status_card(executing_cards, in_progress_cards, parked_stories)
    except Exception as e:
        print(f"ERROR: status card update failed: {type(e).__name__}: {e}")

    print(
        f"Sweep complete: {ticked} epics ticked, {alerted} stall alerts, "
        f"{scanned} candidates scanned, {triggered} triggered, "
        f"{merge_pending_result['merge_resolved']} merges resolved, "
        f"{merge_pending_result['merge_closed_alerted']} closed-PR alerts, {auto_resumed} auto-resumed, "
        f"{flag_cleanup_promoted} flag-cleanup tickets promoted"
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
                "flag_cleanup_promoted": flag_cleanup_promoted,
            }
        ),
    }


# ---------------------------------------------------------------------------
# Flag-cleanup ramp pickup (ENG-11152)
#
# Phase 2 closes the loop supervisor.file_flag_cleanup_ticket opens at epic
# close-out: that ticket is filed born in `done`, deliberately outside the
# story queue so the pipeline never dispatches it before a human has ramped
# the flag. This pass notices once a human HAS ramped it — a prod flag at
# 100% (all users, no partial targeting) continuously for
# FLAG_CLEANUP_RAMP_DAYS — and promotes the ticket into the queue itself,
# where the supervisor dispatches it like any other story. Ramping stays a
# human-only action end to end; only the pickup afterward is automated, and
# this pass never writes to Amplitude, only reads it.
#
# Amplitude reads are the expensive/rate-limited part of this pass, not the
# ClickUp discovery reads that find candidates — capped at a small constant
# (never an env var: this isn't expected to need live tuning) so a future
# burst of simultaneously-closed, unpromoted epics can't turn one 15-minute
# sweep tick into an Amplitude rate-limit incident. Candidates beyond the cap
# simply wait for the next tick, same "remainder deferred" shape as
# SWEEP_MAX_TRIGGERS above.
# ---------------------------------------------------------------------------

FLAG_CLEANUP_AMPLITUDE_READ_CAP = 5

AMPLITUDE_MANAGEMENT_BASE_URL = "https://experiment.amplitude.com/api/1"
# "All users, no partial targeting" for this codebase's flag shape (a plain
# on/off flag — see agent/amplitude_flags.py's module docstring): the client
# that creates every flag only ever writes rolloutWeights={"on": 1}, so a
# rollout at 100% IS "every request that reaches the flag gets on," with no
# narrower segment carving out less than that.
FULL_ROLLOUT_PERCENTAGE = 100

FLAG_RAMP_PK_PREFIX = "flagramp#"
# Refreshed every tick a flag is seen fully ramped, so this only expires if
# the sweep goes dark for far longer than any real FLAG_CLEANUP_RAMP_DAYS
# window — a safety net against an abandoned item, never the mechanism that
# resets the ramp clock (a sub-100% or partial-targeting read does that
# explicitly; see clear_flag_ramp_timer).
FLAG_RAMP_TIMER_TTL_SECONDS = 90 * 24 * 60 * 60

FLAG_CLEANUP_PROMOTED_PREFIX = "flagcleanup-promoted#"
# One-time terminal action, same long-lived shape as
# supervisor.EPIC_CLOSE_OUT_TTL_SECONDS: not a per-run transition with a
# natural deadline to size a shorter TTL against.
FLAG_CLEANUP_PROMOTED_TTL_SECONDS = 30 * 24 * 60 * 60


def _flag_cleanup_candidates(closed_epics: list[dict]) -> list[dict]:
    """One candidate per closed (done) feature card whose flag-cleanup
    subtask (filed by supervisor.file_flag_cleanup_ticket at close-out) is
    still parked in `done` and carries a parseable `flag-key: <key>` line —
    that exact line is what tells this pass "this subtask IS the flag-cleanup
    ticket," not an ordinary finished story that happens to also sit in
    `done` (see supervisor.FLAG_KEY_LINE_PATTERN's docstring). One ClickUp
    read per closed epic's subtask listing, plus one per subtask actually
    sitting in `done` — bounded by how many epics are ever simultaneously
    closed with an unresolved cleanup ticket, not a new unbounded query
    family."""
    candidates: list[dict] = []
    for epic in closed_epics:
        epic_task_id = epic.get("id")
        if not isinstance(epic_task_id, str) or not epic_task_id:
            continue
        try:
            epic_detail = supervisor.clickup_request(
                "GET", f"/task/{epic_task_id}?include_subtasks=true&include_closed=true"
            )
        except Exception as e:
            print(f"ERROR: flag-cleanup sweep failed to load epic {epic_task_id}: {type(e).__name__}")
            continue
        subtasks = epic_detail.get("subtasks")
        if not isinstance(subtasks, list):
            continue
        for entry in subtasks:
            if not isinstance(entry, dict):
                continue
            sub_id = entry.get("id")
            if not isinstance(sub_id, str) or not sub_id:
                continue
            try:
                full_task = supervisor.get_task(sub_id)
            except Exception as e:
                print(f"ERROR: flag-cleanup sweep failed to load subtask {sub_id}: {type(e).__name__}")
                continue
            if handler._status_label(full_task.get("status")) != router.STATUS_DONE:
                continue
            description = full_task.get("text_content")
            if not isinstance(description, str):
                description = full_task.get("description")
            flag_key = supervisor.parse_flag_key(description)
            if flag_key is None:
                continue
            candidates.append({"epic_task_id": epic_task_id, "cleanup_task_id": sub_id, "flag_key": flag_key})
    return candidates


def _read_prod_flag_rollout(flag_key: str) -> dict | None:
    """One GET .../flags?key=&projectId= against the PROD Amplitude project
    (mirrors agent/amplitude_flags.py's _get_flag_by_key, re-implemented here
    with stdlib urllib rather than imported — this Lambda's zip carries no
    pip-installed dependencies, same reason lambda/github_auth.py
    re-implements RS256 signing instead of importing agent/github_auth.py).
    Returns {"enabled": bool, "rollout_percentage": float} for the matching,
    non-deleted flag, or None on ANY failure: missing config, a network
    error, a non-2xx response, unparseable JSON, or no matching flag. Every
    caller treats None identically to "skip this flag's ramp check this
    tick," never as "0% rolled out" — an Amplitude outage must never look
    like a rollback and clear a flag's ramp timer."""
    api_key = os.environ.get("AMPLITUDE_MANAGEMENT_API_KEY", "")
    project_id = os.environ.get("AMPLITUDE_PROD_PROJECT_ID", "")
    if not api_key or not project_id:
        print(
            "ERROR: AMPLITUDE_MANAGEMENT_API_KEY or AMPLITUDE_PROD_PROJECT_ID not configured; skipping flag-ramp check"
        )
        return None

    query = urlencode({"key": flag_key, "projectId": project_id})
    req = Request(
        f"{AMPLITUDE_MANAGEMENT_BASE_URL}/flags?{query}",
        headers={"Authorization": f"Bearer {api_key}"},
        method="GET",
    )
    try:
        with urlopen(req, timeout=10) as response:
            if response.status >= 300:
                print(f"ERROR: Amplitude returned {response.status} reading flag {flag_key!r}")
                return None
            payload = json.loads(response.read().decode())
    except Exception as e:
        print(f"ERROR: flag-cleanup sweep failed to read Amplitude flag {flag_key!r}: {type(e).__name__}")
        return None

    flags = payload.get("flags")
    if not isinstance(flags, list):
        return None
    matches = [
        f
        for f in flags
        if isinstance(f, dict)
        and f.get("key") == flag_key
        and str(f.get("projectId", "")) == project_id
        and not f.get("deleted", False)
    ]
    if not matches:
        return None
    rollout = matches[0].get("rolloutPercentage")
    if not isinstance(rollout, (int, float)):
        return None
    return {"enabled": bool(matches[0].get("enabled", False)), "rollout_percentage": float(rollout)}


def _is_fully_ramped(flag_state: dict) -> bool:
    return bool(flag_state["enabled"]) and flag_state["rollout_percentage"] >= FULL_ROLLOUT_PERCENTAGE


def flag_ramp_pk(flag_key: str) -> str:
    return f"{FLAG_RAMP_PK_PREFIX}{flag_key}"


def get_flag_ramp_first_seen(flag_key: str) -> float | None:
    table_name = os.environ.get("AUTOPILOT_DEDUP_TABLE")
    if not table_name:
        return None
    try:
        response = dispatch.get_dynamodb_client().get_item(
            TableName=table_name, Key={"pk": {"S": flag_ramp_pk(flag_key)}}
        )
    except Exception as e:
        print(f"ERROR: failed to read flag-ramp state for {flag_key!r}: {type(e).__name__}")
        return None
    item = response.get("Item")
    if not isinstance(item, dict):
        return None
    raw = item.get("first_seen_full_ramp_at", {}).get("N")
    try:
        return float(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def record_flag_fully_ramped(flag_key: str) -> float:
    """Idempotently marks flag_key as fully ramped as of NOW, preserving an
    already-recorded first-seen timestamp rather than resetting the clock on
    every tick the flag stays ramped. Returns that first-seen timestamp
    (whichever tick actually recorded it) — the caller measures elapsed time
    against it."""
    first_seen = get_flag_ramp_first_seen(flag_key)
    if first_seen is None:
        first_seen = time.time()
    table_name = os.environ.get("AUTOPILOT_DEDUP_TABLE")
    if not table_name:
        print("ERROR: AUTOPILOT_DEDUP_TABLE not configured; cannot persist flag-ramp state")
        return first_seen
    try:
        dispatch.get_dynamodb_client().put_item(
            TableName=table_name,
            Item={
                "pk": {"S": flag_ramp_pk(flag_key)},
                "flag_key": {"S": flag_key},
                "first_seen_full_ramp_at": {"N": str(first_seen)},
                "expires_at": {"N": str(int(time.time() + FLAG_RAMP_TIMER_TTL_SECONDS))},
            },
        )
    except Exception as e:
        print(f"ERROR: failed to persist flag-ramp state for {flag_key!r}: {type(e).__name__}")
    return first_seen


def clear_flag_ramp_timer(flag_key: str) -> None:
    """A rollback (below 100%, or partial targeting) resets the clock: the
    NEXT full-ramp sighting starts a fresh window rather than counting time
    the flag spent below 100% toward the threshold."""
    table_name = os.environ.get("AUTOPILOT_DEDUP_TABLE")
    if not table_name:
        return
    try:
        dispatch.get_dynamodb_client().delete_item(TableName=table_name, Key={"pk": {"S": flag_ramp_pk(flag_key)}})
    except Exception as e:
        print(f"ERROR: failed to clear flag-ramp state for {flag_key!r}: {type(e).__name__}")


def claim_flag_cleanup_promotion(cleanup_task_id: str) -> str | None:
    """Conditionally claims "this flag-cleanup ticket has been promoted to
    the story queue" so an overlapping sweep tick (a slow prior invocation
    still finishing when the next 15-minute cron fires, most concretely)
    can never move it twice. None = this call won the claim and must
    proceed; a non-None string is the failure reason ("already promoted" |
    "dedup table not configured" | "dedup table unavailable") — the same
    contract shape as supervisor.claim_epic_close_out."""
    table_name = os.environ.get("AUTOPILOT_DEDUP_TABLE")
    if not table_name:
        print("ERROR: AUTOPILOT_DEDUP_TABLE not configured; refusing flag-cleanup promotion")
        return "dedup table not configured"

    pk = f"{FLAG_CLEANUP_PROMOTED_PREFIX}{cleanup_task_id}"
    try:
        dispatch.get_dynamodb_client().put_item(
            TableName=table_name,
            Item={
                "pk": {"S": pk},
                "cleanup_task_id": {"S": cleanup_task_id},
                "expires_at": {"N": str(int(time.time() + FLAG_CLEANUP_PROMOTED_TTL_SECONDS))},
            },
            ConditionExpression="attribute_not_exists(pk)",
        )
        return None
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return "already promoted"
        print(f"ERROR: dedup table unavailable, refusing flag-cleanup promotion: {e}")
        return "dedup table unavailable"
    except Exception as e:
        print(f"ERROR: dedup table unavailable, refusing flag-cleanup promotion: {e}")
        return "dedup table unavailable"


def _release_flag_cleanup_promotion_claim(cleanup_task_id: str) -> None:
    """Undoes claim_flag_cleanup_promotion after a move that failed before
    anything real happened — same rollback shape as
    supervisor.close_out_epic's own claim-then-move: the claim only protects
    a COMPLETED promotion, so a transient ClickUp error must not permanently
    strand the ticket un-promoted for the claim's full 30-day TTL."""
    table_name = os.environ.get("AUTOPILOT_DEDUP_TABLE")
    if not table_name:
        return
    try:
        dispatch.get_dynamodb_client().delete_item(
            TableName=table_name, Key={"pk": {"S": f"{FLAG_CLEANUP_PROMOTED_PREFIX}{cleanup_task_id}"}}
        )
    except Exception as e:
        print(f"ERROR: failed to release flag-cleanup promotion claim for {cleanup_task_id}: {type(e).__name__}")


def check_flag_cleanup_ramps(closed_epics: list[dict]) -> int:
    """Runs every tick, bounded and cheap (see this section's module
    comment). For up to FLAG_CLEANUP_AMPLITUDE_READ_CAP candidates: one
    Amplitude read decides whether the flag is fully ramped right now; a
    ramped flag's timer is recorded (or left alone if already running), and
    once it has run for flag_cleanup_ramp_days(), the ticket is promoted to
    the story queue under a dedup claim and the supervisor is ticked
    directly for that exact epic — a closed feature card no longer sits in
    `executing`, so no other sweep or webhook path would ever drive it (see
    the module docstring's DESIGN note in the ticket this implements).
    Returns how many tickets this pass actually promoted."""
    candidates = _flag_cleanup_candidates(closed_epics)
    threshold_days = flag_cleanup_ramp_days()
    promoted = 0

    for candidate in candidates[:FLAG_CLEANUP_AMPLITUDE_READ_CAP]:
        flag_key = candidate["flag_key"]
        cleanup_task_id = candidate["cleanup_task_id"]
        epic_task_id = candidate["epic_task_id"]

        flag_state = _read_prod_flag_rollout(flag_key)
        if flag_state is None:
            continue  # Amplitude read failed or the flag wasn't found — try again next tick

        if not _is_fully_ramped(flag_state):
            clear_flag_ramp_timer(flag_key)
            continue

        first_seen = record_flag_fully_ramped(flag_key)
        elapsed_days = (time.time() - first_seen) / (24 * 60 * 60)
        if elapsed_days < threshold_days:
            continue

        claim_reason = claim_flag_cleanup_promotion(cleanup_task_id)
        if claim_reason is not None:
            continue  # already promoted by an earlier tick, or the dedup table is unavailable this tick

        try:
            supervisor.move_task_status(cleanup_task_id, router.STATUS_APPROVED_TDD)
        except Exception as e:
            print(
                f"ERROR: failed to promote flag-cleanup ticket {cleanup_task_id} to the story queue: {type(e).__name__}"
            )
            _release_flag_cleanup_promotion_claim(cleanup_task_id)
            continue

        print(
            f"Promoted flag-cleanup ticket {cleanup_task_id} (flag {flag_key!r}) to the story queue "
            f"after {elapsed_days:.1f} days fully ramped"
        )

        # The queue move alone dispatches nothing: this epic's feature card
        # is `done`, not `executing`, so the unconditional executing-cards
        # tick above never reaches it and no webhook fires off a status move
        # this pass itself just made. Tick the supervisor directly for this
        # one epic so the promoted story is picked up in the SAME pass it
        # was promoted in — run_supervisor_tick's own per-story claim is
        # still what actually protects against a duplicate dispatch.
        #
        # A failure here must not strand the ticket silently: once its status
        # is `approved tdd`, _flag_cleanup_candidates (which gates on `done`)
        # never finds it again, and nothing else in the sweep drives a story
        # under a closed feature card — unlike a normal story dispatch, there
        # is no lookback-reconstruction fallback for this transition (no
        # ROUTING_TABLE row lands on it). Roll the move and the claim back so
        # the next tick treats it as a fresh, unpromoted candidate — same
        # claim-released-before-status-restored order as
        # _release_qa_dispatch_claim's own rollback, for the same reason: a
        # rollback that only partially completes should fail toward "no
        # stale claim blocking a future retry" rather than toward "story
        # sitting in `done` again behind a claim nothing will ever release."
        try:
            supervisor.run_supervisor_tick(epic_task_id)
        except Exception as e:
            print(
                f"ERROR: supervisor tick for closed epic {epic_task_id} failed after flag-cleanup promotion; "
                f"rolling back the promotion for a clean retry next tick: {type(e).__name__}"
            )
            _release_flag_cleanup_promotion_claim(cleanup_task_id)
            try:
                supervisor.move_task_status(cleanup_task_id, router.STATUS_DONE)
            except Exception as rollback_error:
                print(
                    f"ERROR: rollback of {cleanup_task_id} back to done failed too; it will sit in the story "
                    f"queue undriven until a human intervenes: {type(rollback_error).__name__}"
                )
            continue

        promoted += 1

    return promoted


# ---------------------------------------------------------------------------
# Pinned #autopilot status card (ENG-11151, phase 2)
#
# The one pinned, sweep-updated Slack message answering "what is running
# right now": feature cards by status, in-flight stories, and — per
# in-flight story — its last-run outcome and cost, read off the newest
# run-summary comment main.post_run_summary_comment posts on every stage run
# (see metrics.format_run_summary_comment / router.latest_run_summary).
#
# Built from board state this tick already has for the two "cards by
# status" sections (executing_cards, in_progress_cards, parked_stories — all
# passed in from handle_sweep, never re-queried), plus one
# supervisor.load_epic_stories call per EXECUTING epic to find which
# stories are actually in flight (supervisor.in_flight_story_ids — board
# status union active per-story DynamoDB claims, since a bounded-concurrency
# epic can have more than one story running at once; see supervisor.py) and
# a per-in-flight-story comments read (the same /task/{id}/comment endpoint
# the sweep already calls elsewhere) for that story's last-run outcome/cost.
# The load_epic_stories call is the same one run_supervisor_tick already
# makes for this exact epic a few lines up in handle_sweep — reused for a
# second purpose here, not a new query family. No log/CloudWatch access:
# cost is derivable by a human from the card's own comment thread, and this
# reads the exact same comment. Eventually consistent by design, same as the
# rest of the sweep — a 15-minute-old number here is expected, not a bug.
# ---------------------------------------------------------------------------


def get_status_card_state() -> dict | None:
    table_name = os.environ.get("AUTOPILOT_DEDUP_TABLE")
    if not table_name:
        return None
    try:
        response = dispatch.get_dynamodb_client().get_item(TableName=table_name, Key={"pk": {"S": STATUS_CARD_PK}})
    except Exception as e:
        print(f"ERROR: failed to read status card state: {type(e).__name__}")
        return None
    item = response.get("Item")
    if not isinstance(item, dict):
        return None
    channel = item.get("channel", {}).get("S")
    ts = item.get("ts", {}).get("S")
    if not isinstance(channel, str) or not isinstance(ts, str):
        return None
    return {"channel": channel, "ts": ts}


def save_status_card_state(channel: str, ts: str) -> None:
    table_name = os.environ.get("AUTOPILOT_DEDUP_TABLE")
    if not table_name:
        print("ERROR: AUTOPILOT_DEDUP_TABLE not configured; status card ts will not survive to the next tick")
        return
    try:
        dispatch.get_dynamodb_client().put_item(
            TableName=table_name,
            Item={"pk": {"S": STATUS_CARD_PK}, "channel": {"S": channel}, "ts": {"S": ts}},
        )
    except Exception as e:
        # Re-raise into handle_sweep's status-card guard: swallowing here
        # would let the pin below run on a ts the next tick can't find,
        # accumulating one more pinned duplicate per tick until DynamoDB
        # recovers. Skipping the pin leaves one unpinned orphan the next
        # successful tick's repost supersedes.
        print(f"ERROR: failed to persist status card state: {type(e).__name__}")
        raise


def _slack_escape(text: str) -> str:
    # Slack's mrkdwn link syntax is `<url|label>` — a ClickUp task title
    # containing '<', '>', or '&' (e.g. "Fix <select> dropdown") would
    # otherwise break the link or get eaten by Slack's own entity decoding.
    # Order matters: '&' first, or escaping '<'/'>' would double-escape the
    # '&' just introduced.
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _card_link(task: dict) -> str:
    task_id = task.get("id")
    name = task.get("name") if isinstance(task.get("name"), str) else task_id
    return f"<{supervisor.clickup_task_url(task_id)}|{_slack_escape(name)}>"


def _story_status_line(story_task_id: str) -> str:
    story_link = f"<{supervisor.clickup_task_url(story_task_id)}|{story_task_id}>"
    try:
        comments = supervisor.get_task_comments(story_task_id)
    except Exception as e:
        print(f"ERROR: status card failed to read comments for story {story_task_id}: {type(e).__name__}")
        return f"{story_link} in flight, last run unknown"

    summary = router.latest_run_summary(comments)
    if summary is None:
        return f"{story_link} in flight, no run reported yet"

    cost = f"${summary['cost_usd']:.2f}" if summary["cost_usd"] is not None else "cost unknown"
    return f"{story_link} ({summary['stage']}): last run {summary['outcome']}, {cost}"


def _in_flight_story_line(epic_task_id: str) -> str:
    """What's actually running under one executing epic: every story
    currently in flight (board status union an active per-story DynamoDB
    claim — see supervisor.in_flight_story_ids; a bounded-concurrency epic
    can have more than one), each with its own last-run outcome/cost read
    off the newest run-summary comment on its thread."""
    stories = supervisor.load_epic_stories(epic_task_id)
    in_flight_ids = supervisor.in_flight_story_ids(stories)
    if not in_flight_ids:
        return "no story in flight"

    return "; ".join(_story_status_line(story_task_id) for story_task_id in sorted(in_flight_ids))


def _status_timestamp() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")


def _with_valid_id(tasks: list[dict]) -> list[dict]:
    # Same defensive shape-check as everywhere else in this module (e.g. the
    # ticked/scanned loops in handle_sweep): ClickUp's response is untrusted
    # JSON, not a validated schema, and a malformed entry (missing/non-string
    # id) must be skipped rather than blow up the whole status-card build —
    # the try/except around update_status_card would otherwise drop the
    # ENTIRE card's update over one bad row.
    return [t for t in tasks if isinstance(t.get("id"), str) and t["id"]]


def build_status_text(executing_cards: list[dict], in_progress_cards: list[dict], parked_stories: list[dict]) -> str:
    lines = [f"*Autopilot status* — updated {_status_timestamp()}", ""]

    executing = _with_valid_id(executing_cards)
    lines.append(f"*Executing* ({len(executing)})")
    if executing:
        lines.extend(f"• {_card_link(t)} — {_in_flight_story_line(t['id'])}" for t in executing)
    else:
        lines.append("_none_")
    lines.append("")

    in_progress = _with_valid_id(in_progress_cards)
    lines.append(f"*Planning (in progress)* ({len(in_progress)})")
    if in_progress:
        lines.extend(f"• {_card_link(t)}" for t in in_progress)
    else:
        lines.append("_none_")
    lines.append("")

    parked = _with_valid_id(parked_stories)
    lines.append(f"*Awaiting feedback* ({len(parked)})")
    if parked:
        lines.extend(f"• {_card_link(t)}" for t in parked)
    else:
        lines.append("_none_")

    return "\n".join(lines)


def update_status_card(executing_cards: list[dict], in_progress_cards: list[dict], parked_stories: list[dict]) -> None:
    """Maintains the single pinned #autopilot status message. Edits it in
    place via chat.update when the stored ts still resolves; self-heals
    (posts fresh, re-pins, stores the new ts) whenever it doesn't — covering
    both a genuinely deleted message and there being no ts yet (the very
    first tick). The pin itself is cosmetic (see supervisor.pin_slack_message)
    — the sweep finds its own message by the ts in DynamoDB, never by
    scanning pins, so a failed pin never blocks anything else here."""
    channel = os.environ.get("AUTOPILOT_SLACK_CHANNEL", "").strip()
    if not channel:
        print("ERROR: AUTOPILOT_SLACK_CHANNEL not configured; skipping status card update")
        return

    text = build_status_text(executing_cards, in_progress_cards, parked_stories)

    state = get_status_card_state()
    if state is not None and state.get("channel") == channel:
        if supervisor.update_slack_message(channel, state["ts"], text):
            return
        print(f"Status card message {state['ts']} could not be updated (likely deleted); reposting")

    ts = supervisor.post_slack_message_with_ts(channel, text)
    if ts is None:
        print("ERROR: status card could not be posted; will retry next tick")
        return
    save_status_card_state(channel, ts)
    if not supervisor.pin_slack_message(channel, ts):
        print(f"WARNING: could not pin status card message {ts}; leaving it unpinned (cosmetic only)")
