"""Tell #bugs when an analysis ends with no PR and a person has to pick it up.

WHY THIS EXISTS: `needs-human` is the one outcome of this system that produces
no signal anywhere a person looks. A `fix` verdict tags the ticket, queues an
implementation run and opens a PR — which gpbot-pr-triage.yml announces in
#bugs and requests a review for, and gpbot-stale-pr-alert.yml chases if nobody
answers. A `no-code-change` verdict needs nobody. `needs-human` writes a long,
correct, actionable comment onto a ClickUp ticket that nothing then draws
attention to, and leaves the ticket in whatever status it already had.

ENG-11112 is what that costs. Reported 2026-09-15, analyzed 2026-09-17 13:53
UTC with a root cause and a five-step fix path, verdict `needs-human`. A day
later the ticket was still `to do` with no assignee, and the only reason anyone
read the analysis was the reporter asking in Slack whether it had been seen.
Nothing failed and the analysis was not wrong. The answer just had no reader.

So a handoff is announced the same way a PR is: same channel, same app, same
on-call group. The bar for posting is deliberately "no PR is coming AND the bot
believes there is something to do" — see handoff_reason — because a channel
that also carries "nothing to do here" is one the rotation learns to skim.

NEVER RAISES, like escalation.py and for the same reason: this runs after the
agent has already done its work and posted its analysis, so failing the
container here would turn a useful run into a task-failed alarm and lose
nothing but the notification.
"""

import os
from typing import Any

import httpx

from shared.logger import get_logger

from .config import ESCALATING_LABELS
from .escalation import (
    OUTCOME_ALREADY_QUEUED,
    OUTCOME_DISABLED,
    OUTCOME_ESCALATED,
    VERDICT_FIX,
    VERDICT_NEEDS_HUMAN,
    parse_repo,
    parse_verdict,
)

logger = get_logger(__name__)

# The channel, as an id rather than a name, matching vars.GPBOT_PR_CHANNEL_ID in
# the workflows (C022VR6PRQC, #bugs). Unset means "not configured yet" and the
# notification degrades to a log line — but a LOUD one, because an unset channel
# here recreates exactly the silence this module exists to end.
CHANNEL_ENV = "GPBOT_BUGS_CHANNEL_ID"

# AI_SECRETS_<ENV>.SLACK_BOT_TOKEN, already on the task definition. It holds
# gp_ai_bot, the same app behind secrets.GPBOT_SLACK_BOT_TOKEN in the workflows,
# which is what makes #bugs reachable: Slack answers `not_in_channel` for an app
# that is not a member, and the analytics app is a member of #product-analytics
# only. Token and channel are one decision, not two.
TOKEN_ENV = "SLACK_BOT_TOKEN"

SLACK_POST_URL = "https://slack.com/api/chat.postMessage"
SLACK_TIMEOUT_SECONDS = 10.0

# THE ON-CALL ROUTING, MIRRORED FROM .github/gpbot-reviewers.json.
#
# That file is the authority. gpbot-pr-triage.yml reads it directly, and it is
# deliberately a reviewable JSON file rather than workflow YAML so a rotation
# change is a normal PR. This copy exists only because the agent cannot read it:
# engineer_agent/Dockerfile's build context is packages/gp-ai, so nothing under
# .github/ is in the image, and a run's checkout of omni is neither guaranteed
# to exist nor guaranteed to be current when this code runs.
#
# Drift is caught at CI time by test_handoff.py, which parses the real JSON and
# compares it to these three constants. Same arrangement as the scope rules
# mirrored between the Lambda and escalation.py, for the same reason: the
# duplication is forced, going undetected is not.
GROUP_SLACK_IDS = {
    "serve-bugs": "S0AD54G9D3K",
    "win-bugs": "S0AE3NTCXM3",
}

LIST_ROUTING = {
    "901321761872": "win-bugs",
    "901320540273": "win-bugs",
    "901318405462": "serve-bugs",
    "901321495230": "win-bugs",
    "901328720152": "serve-bugs",
}

DEFAULT_GROUP = "win-bugs"

# Escalation outcomes that mean nobody needs telling.
#
# Everything NOT in this set is treated as a handoff, which is the safe
# direction to be wrong in: a refusal reason added to escalation.py later starts
# announcing itself instead of silently dropping a ticket, and the cost of being
# wrong is one message a human ignores.
#
# `disabled` is in here on purpose. It is the kill switch, thrown when the bot
# is opening PRs nobody wants — and a switch that also starts a #bugs message
# per analysis makes an incident noisier at the moment someone is trying to
# quiet it. With it thrown, the verdicts are still in the log, which is what the
# README already tells you to grep.
HANDLED_WITHOUT_A_HUMAN = frozenset({OUTCOME_ESCALATED, OUTCOME_ALREADY_QUEUED, OUTCOME_DISABLED})

NEEDS_HUMAN_REASON = "The analysis concluded this one needs a person."


def handoff_reason(result: Any, label: str, escalation_outcome: str) -> str | None:
    """One sentence saying why a human has to take this run's ticket, or None.

    Pure, so the judgement can be read and tested without a Slack token or a
    ClickUp client anywhere near it.
    """
    if label not in ESCALATING_LABELS:
        # An implement or ci-fix run does not end in a verdict, and its ticket
        # already has a PR carrying the attention.
        return None
    if not isinstance(result, dict):
        return None
    if result.get("status") != "success":
        # The same distrust escalation.py applies to an unfinished run's
        # verdict. A budget-capped run can post a confident-looking partial
        # analysis, and "a human must act on this conclusion" is not a claim
        # worth making on behalf of a run we know did not get to the end. The
        # container failure is alarmed separately.
        return None

    verdict = parse_verdict(result.get("result"))
    if verdict == VERDICT_NEEDS_HUMAN:
        return NEEDS_HUMAN_REASON
    if verdict == VERDICT_FIX and escalation_outcome not in HANDLED_WITHOUT_A_HUMAN:
        # A fix was identified and no run was queued to make it — the ticket is
        # out of scope for the implement agent, or names a repo still on the
        # analyze-only ramp, or the tag write failed. All three end with a
        # known fix and nothing happening, which is worth more attention than
        # `needs-human`, not less.
        return f"The analysis found a fix, but no implementation run was queued ({escalation_outcome})."
    return None


def owning_group(task: Any) -> str:
    """The on-call rotation that owns this ticket's list.

    Falls back to DEFAULT_GROUP for an unknown or unreadable list, matching
    `.listRouting[$l] // .defaultGroup` in gpbot-pr-triage.yml. Pinging the
    wrong rotation costs a glance; pinging nobody is the failure being fixed.
    """
    if isinstance(task, dict):
        task_list = task.get("list")
        if isinstance(task_list, dict):
            list_id = task_list.get("id")
            if isinstance(list_id, str):
                return LIST_ROUTING.get(list_id, DEFAULT_GROUP)
    return DEFAULT_GROUP


def group_mention(task: Any) -> str:
    """`<!subteam^...>` for the owning rotation, or "" if it has no Slack id.

    The group mention is the whole point of posting: @win-bugs and @serve-bugs
    are two-week rotations holding one person at a time, so the mention reaches
    whoever is actually on duty without anything to hand-maintain.
    """
    group_id = GROUP_SLACK_IDS.get(owning_group(task), "")
    return f"<!subteam^{group_id}> " if group_id else ""


def ticket_ref(task: Any) -> str:
    """ENG-1234 where there is one, else the raw ClickUp id."""
    if isinstance(task, dict):
        custom_id = task.get("custom_id")
        if isinstance(custom_id, str) and custom_id:
            return custom_id
        task_id = task.get("id")
        if isinstance(task_id, str) and task_id:
            return task_id
    return "an unidentified ticket"


def ticket_url(task: Any) -> str:
    """ClickUp's own url for the task, or one built from its id.

    Built rather than omitted when absent: a handoff message whose link is
    missing is a message that asks someone to go and search for the ticket.
    """
    if isinstance(task, dict):
        url = task.get("url")
        if isinstance(url, str) and url:
            return url
        task_id = task.get("id")
        if isinstance(task_id, str) and task_id:
            return f"https://app.clickup.com/t/{task_id}"
    return ""


def render_handoff(task: Any, reason: str, repo: str | None = None) -> str:
    """The message, as mrkdwn.

    Says what the bot decided, where to read why, and nothing else. It is
    deliberately not a summary of the analysis: a summary of a root cause is
    either long enough to be the analysis or short enough to be misleading, and
    the full write-up is one click away on the ticket.
    """
    ref = ticket_ref(task)
    url = ticket_url(task)
    linked = f"<{url}|{ref}>" if url else ref

    headline = f"{group_mention(task)}*No PR is coming for {linked}* — GP-Bot analyzed it and handed it back."
    name = task.get("name") if isinstance(task, dict) else None
    if isinstance(name, str) and name.strip():
        headline = f"{headline}\n> {name.strip()}"

    lines = [headline, reason]
    if repo:
        lines.append(f"The analysis places the fix in `{repo}`.")
    lines.append("The full write-up is the latest [GP-Bot] comment on the ticket.")
    return "\n".join(lines)


def post_to_slack(channel: str, token: str, text: str) -> bool:
    """One chat.postMessage. True if Slack accepted it.

    chat.postMessage answers HTTP 200 even when it refuses the message, so the
    status code proves nothing and the `ok` field is the only real answer — a
    revoked token or a channel the app was never invited to arrives as
    `{"ok": false, "error": "not_in_channel"}` with a 200. The gpbot workflows
    all check `.ok` for this reason; so does this.

    `unfurl_links` is off because the one link here is a ClickUp ticket, and
    Slack renders those as a large card that pushes the next message off screen.
    """
    body = {"channel": channel, "text": text, "unfurl_links": False, "unfurl_media": False}
    try:
        response = httpx.post(
            SLACK_POST_URL,
            json=body,
            headers={"Authorization": f"Bearer {token}"},
            timeout=SLACK_TIMEOUT_SECONDS,
        )
        parsed = response.json()
    except Exception as e:
        logger.error(f"Slack post failed: {type(e).__name__}: {e}")
        return False

    if not isinstance(parsed, dict) or not parsed.get("ok"):
        error = parsed.get("error") if isinstance(parsed, dict) else "unreadable response"
        # Slack's own error string is the actionable part. `not_in_channel` and
        # `channel_not_found` are the two setup mistakes this will actually hit,
        # and both are invisible without this line.
        logger.error(f"Slack rejected the handoff message: {error}")
        return False
    return True


def maybe_notify_handoff(
    result: Any,
    label: str,
    escalation_outcome: str,
    client_factory: Any = None,
    poster: Any = None,
    env: dict[str, str] | None = None,
) -> str:
    """Announce in #bugs if this run ended with a human holding the ticket.

    Returns a short reason string for the logs, in the same shape and for the
    same purpose as escalation.maybe_escalate's. The blanket except is that
    contract: this is the last thing a finished run does, and no shape of
    ClickUp response or Slack outage is worth converting an analysis that has
    already been posted into a task-failed alarm.
    """
    try:
        return _notify_handoff(result, label, escalation_outcome, client_factory, poster, env)
    except Exception as e:
        logger.error(f"Handoff notification failed: {type(e).__name__}: {e}")
        return "handoff notification failed"


def _notify_handoff(
    result: Any,
    label: str,
    escalation_outcome: str,
    client_factory: Any,
    poster: Any,
    env: dict[str, str] | None,
) -> str:
    # A non-None reason means handoff_reason already found this a successful,
    # verdict-emitting run, so `result` is a dict from here down.
    reason = handoff_reason(result, label, escalation_outcome)
    if reason is None:
        return "not a handoff"

    task_id = result.get("task_id")
    if not task_id:
        logger.error("A run needs a human but its result carries no task_id; nobody was told")
        return "no task_id"

    source = os.environ if env is None else env
    channel = source.get(CHANNEL_ENV, "").strip()
    token = source.get(TOKEN_ENV, "").strip()

    # ERROR, not info. Every other "unset variable" in this system degrades to
    # the behaviour that existed before the feature — this one degrades to the
    # silence the feature exists to end, on a ticket that has already been
    # decided to need a person.
    if not channel or not token:
        missing = CHANNEL_ENV if not channel else TOKEN_ENV
        logger.error(f"{task_id} needs a human and nobody was told: {missing} is unset")
        return "not configured"

    # Fetched for the ticket's name, url and list, none of which the run's own
    # result carries. Degraded rather than abandoned when ClickUp is unreachable
    # — the id alone still produces a working link and the default rotation is
    # still pinged, and a message naming only the ticket beats no message.
    task: Any = {"id": task_id}
    if client_factory is None:
        from shared.clickup_client import ClickUpClient

        client_factory = ClickUpClient
    try:
        with client_factory() as client:
            # by_alias for the same reason escalation.py needs it: ClickUpTask
            # maps the API's `list` onto a field named `list_id`, so a plain
            # model_dump() carries no `list` key and every ticket would route to
            # the default rotation.
            task = client.get_task(task_id).model_dump(by_alias=True)
    except Exception as e:
        logger.error(f"Could not read {task_id} for its handoff message; announcing with the id alone: {e}")

    repo = parse_repo(result.get("result"))
    post = post_to_slack if poster is None else poster
    if not post(channel, token, render_handoff(task, reason, repo)):
        return "slack refused"

    logger.info(f"Announced the handoff of {task_id} in {channel}")
    return "announced"
