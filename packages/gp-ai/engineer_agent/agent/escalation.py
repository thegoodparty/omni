"""Queue an implementation run when an analysis concluded there is a fix to make.

WHY THIS EXISTS: the bot used to be pointed at a ticket by a human who had
already decided the ticket was a real, fixable code defect. Once every reported
bug started triggering a run automatically, nothing upstream made that judgement
any more — and the evidence says it matters. Of the five bugs reported
2026-08-14..17, the analyses found one feature request, one upstream vendor data
gap, and two tickets sharing a single root cause. Sending an implement agent at
all five would have produced at least two PRs that should never have been
written, plus a duplicate.

So the judgement is the model's, made with the whole codebase in front of it, but
the ACTION is this module: deterministic, unit-testable, and the one place where
a guard rail can be added. Escalation is a plain ClickUp tag write, which re-
enters the normal webhook path — the same route a human tagging by hand takes, so
the scope guard, both dedup layers, and the PR triage workflow all still apply.
"""

import os
import re
from typing import Any

from shared.logger import get_logger

from .config import ANALYZE_LABEL

logger = get_logger(__name__)

IMPLEMENT_TAG = "gpbot-work"

# The verdict the analyze prompt asks for. Matched case-insensitively and
# anywhere in the final response rather than strictly on the last line: models
# reliably emit the token and unreliably emit it as the *final* characters
# (trailing prose, a code fence, a stray newline). Being strict here would fail
# closed on a correct analysis, which is a silent loss of the whole feature.
VERDICT_PATTERN = re.compile(r"GPBOT-VERDICT:\s*([a-z-]+)", re.IGNORECASE)

VERDICT_FIX = "fix"
VERDICT_NO_CODE_CHANGE = "no-code-change"
VERDICT_NEEDS_HUMAN = "needs-human"
KNOWN_VERDICTS = frozenset({VERDICT_FIX, VERDICT_NO_CODE_CHANGE, VERDICT_NEEDS_HUMAN})

# Ramp switch. Defaults to OFF: turning this on changes what lands in the
# repository without a human in the loop first, and it should not become live
# merely because this code deployed. Flip it in
# infrastructure/modules/engineer-agent-fargate once the reviewer Slack channel
# and the dev announcement are in place.
ESCALATION_ENABLED_ENV = "GPBOT_ESCALATE_TO_WORK"

_TRUTHY = frozenset({"1", "true", "yes", "on"})


def escalation_enabled(env: dict[str, str] | None = None) -> bool:
    source = os.environ if env is None else env
    return source.get(ESCALATION_ENABLED_ENV, "").strip().lower() in _TRUTHY


def parse_verdict(result_text: Any) -> str | None:
    """The verdict token from an analyze run's final response, or None.

    Returns None for a missing, malformed or unrecognized verdict — every one of
    which must leave the ticket alone rather than guess.
    """
    if not isinstance(result_text, str):
        return None
    matches = VERDICT_PATTERN.findall(result_text)
    if not matches:
        return None
    # LAST match, not first: the run's own final response can quote the
    # instruction it was given ("...end with GPBOT-VERDICT: fix..."), and an
    # echo of the menu appears before the actual answer.
    verdict = matches[-1].lower()
    return verdict if verdict in KNOWN_VERDICTS else None


def already_queued(task: Any) -> bool:
    # A gpbot-work tag already on the ticket means an implementation run has
    # been queued or has already happened. Re-adding a tag ClickUp already has
    # is a no-op that emits no webhook, so this is not about preventing a
    # duplicate run so much as not reporting success for a write that would do
    # nothing.
    if not isinstance(task, dict):
        return False
    tags = task.get("tags")
    if not isinstance(tags, list):
        return False
    for tag in tags:
        if isinstance(tag, dict) and isinstance(tag.get("name"), str) and tag["name"].lower() == IMPLEMENT_TAG:
            return True
    return False


def maybe_escalate(result: dict, label: str, client_factory: Any = None) -> str:
    """Queue an implementation run if this analysis earned one.

    Returns a short reason string for the logs — the outcome is observable but
    never raised. This runs after the agent has already done its work and posted
    its analysis; failing the container here would turn a successful, useful run
    into a task-failed alarm and lose nothing but the escalation.
    """
    if label != ANALYZE_LABEL:
        return "not an analyze run"
    if result.get("status") != "success":
        # An errored, budget-capped or deadline-killed run may have posted a
        # confident-looking partial analysis. Its verdict is not trustworthy
        # precisely because we know it did not finish.
        return f"run did not succeed (status={result.get('status')})"

    verdict = parse_verdict(result.get("result"))
    if verdict is None:
        # Alarm-worthy: the prompt asks for this line, so a missing one means
        # either the prompt and this parser have drifted apart or the model is
        # ignoring the contract. Either way every ticket silently stops
        # escalating, which looks exactly like "the feature is off".
        logger.error("Analysis produced no usable GPBOT-VERDICT line; not escalating")
        return "no verdict"
    if verdict != VERDICT_FIX:
        logger.info(f"Analysis verdict '{verdict}' does not call for a code change; not escalating")
        return f"verdict {verdict}"

    task_id = result.get("task_id")
    if not task_id:
        logger.error("Verdict called for a fix but the result carries no task_id; not escalating")
        return "no task_id"

    # Checked last, deliberately: the log lines above are how anyone judges
    # whether the model's verdicts are any good, and they are worth having on
    # every run well before the switch is flipped.
    if not escalation_enabled():
        logger.info(f"Analysis verdict 'fix' for {task_id}; escalation disabled ({ESCALATION_ENABLED_ENV} unset)")
        return "disabled"

    if client_factory is None:
        from shared.clickup_client import ClickUpClient

        client_factory = ClickUpClient

    try:
        with client_factory() as client:
            if already_queued(client.get_task(task_id).model_dump()):
                logger.info(f"Task {task_id} already carries {IMPLEMENT_TAG}; not re-tagging")
                return "already queued"
            client.add_tag_to_task(task_id, IMPLEMENT_TAG)
    except Exception as e:
        # Alarm-matching, and swallowed: see the docstring. The recovery is a
        # human adding the tag, which is what they did before this existed.
        logger.error(f"Failed to escalate {task_id} to {IMPLEMENT_TAG}: {e}")
        return "escalation failed"

    logger.info(f"Escalated {task_id}: added {IMPLEMENT_TAG} to queue an implementation run")
    return "escalated"
