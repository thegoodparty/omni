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

Those downstream guards still hold, and this module does not stand in for any of
them. It does check one of them first — see the SCOPE note further down — because
writing a tag the Lambda will refuse still leaves the tag on the ticket and still
reports the escalation as having queued something.
"""

import os
import re
from typing import Any

from shared.logger import get_logger

from .config import ANALYZE_LABEL
from .repos import UnknownRepoError, resolve_repo

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

# SECOND RAMP, PER REPO. The switch above is the master one and stays the kill
# switch for everything. This one says which repos it applies to, so a repo the
# bot has only just learned to read can be analyzed for a while before it is
# allowed to open PRs there — the same ramp omni had, rather than inheriting
# omni's earned trust on day one.
#
# Defaults to omni alone. A repo added to REPO_BY_LIST_ID in the Lambda
# therefore starts analyze-only with no second decision required, which is the
# safe direction to be wrong in: the cost is a missing PR, and the cost of the
# other default is an unrequested PR in a repo nobody agreed to.
ESCALATION_REPOS_ENV = "GPBOT_ESCALATE_REPOS"
DEFAULT_ESCALATION_REPOS = ("thegoodparty/omni",)

_TRUTHY = frozenset({"1", "true", "yes", "on"})


def escalation_enabled(env: dict[str, str] | None = None) -> bool:
    source = os.environ if env is None else env
    return source.get(ESCALATION_ENABLED_ENV, "").strip().lower() in _TRUTHY


def escalation_repos(env: dict[str, str] | None = None) -> frozenset[str]:
    source = os.environ if env is None else env
    raw = source.get(ESCALATION_REPOS_ENV, "")
    named = frozenset(part.strip() for part in raw.split(",") if part.strip())
    # An unset or all-whitespace value means "not configured", which must mean
    # the default rather than "no repos may escalate" — the latter would turn a
    # blank environment variable into a silent, total outage of the feature.
    return named or frozenset(DEFAULT_ESCALATION_REPOS)


def escalation_enabled_for(repo: str, env: dict[str, str] | None = None) -> bool:
    # Both gates. The master switch can turn everything off; the list can only
    # narrow what it leaves on.
    if not escalation_enabled(env):
        return False
    return (repo or "").strip() in escalation_repos(env)


# Where the analysis says a fix belongs, when that is not where the run was
# pointed. Same tolerance as the verdict pattern and for the same reason.
REPO_PATTERN = re.compile(r"GPBOT-REPO:\s*([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)")

# The comment that carries the repo decision from this process to the next one.
# The implement run is launched by a ClickUp tag, and a tag cannot say which
# repo it is about, so the Lambda reads this line off the ticket instead — see
# repo_named_by_bot in clickup_bot/lambda/handler.py.
#
# WRITTEN BY THIS CODE, not by the model. The model names a repo in prose that
# is parsed and allowlisted here first, and only a resolved profile's own
# full_name is ever written back out. That keeps the string the Lambda reads
# deterministic and known-good rather than whatever the model happened to type.
REPO_MARKER_PREFIX = "[GP-Bot] Implementation will run against"


def parse_repo(result_text: Any) -> str | None:
    """The repo an analysis named as the home of the fix, or None.

    Allowlisted against REPO_PROFILES, so an unrecognised name is None and the
    caller keeps the repo it was already using. That is the safe direction: the
    cost is a redirect that did not happen and a ticket a human re-routes, where
    honouring an unknown name would point a run at a repo the agent has no
    briefing for and could not have worked in anyway.
    """
    if not isinstance(result_text, str):
        return None
    matches = REPO_PATTERN.findall(result_text)
    if not matches:
        return None
    # LAST match for the same reason as the verdict: the response may quote the
    # instruction's own example before giving the real answer.
    try:
        return resolve_repo(matches[-1]).full_name
    except UnknownRepoError:
        logger.info(f"Analysis named repo {matches[-1]!r}, which has no profile; keeping the routed repo")
        return None


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


# SCOPE, MIRRORED FROM THE LAMBDA. The authority is out_of_scope_reason() in
# clickup_bot/lambda/handler.py — that one refuses to launch the implement run,
# and it stays the thing standing between a data ticket and a code PR. This copy
# does not replace it and must never be trusted as if it did.
#
# The two cannot share a module. The Lambda ships as a single zipped file
# (archive_file's source_file is handler.py by name), so it can import nothing
# from this repository, and this agent runs in a different image entirely.
#
# WHY MIRROR IT, when the guard downstream already holds: tagging a ticket the
# guard will refuse is not free. It leaves `gpbot-work` on a data ticket that
# will never get a PR, and it records the outcome as "escalated" — a run that
# queued nothing, reported as a run that queued something. On 2026-09-01 exactly
# that combination (a `fix` verdict on DATA-2393, escalation "escalated", no
# implement run, no PR) read as a broken pipeline and cost an investigation to
# explain, for a guard that had worked correctly.
#
# Drift is caught by clickup_bot/tests/test_scope_is_mirrored.py, which runs this
# copy and the Lambda's against the same cases in one pytest session.
#
# Growth-Bugs was in this set until marketing tickets became routable to
# gp-marketing. It is not out of scope any more, it is a different repo, and the
# repo it belongs to is decided in the Lambda (REPO_BY_LIST_ID) rather than here.
DATA_BACKLOG_LIST_ID = "901326391561"

OUT_OF_SCOPE_LIST_IDS = frozenset({DATA_BACKLOG_LIST_ID})
OUT_OF_SCOPE_CUSTOM_ID_PREFIXES = ("DATA-",)
OUT_OF_SCOPE_TAG_NAMES = frozenset({"bug: district-assignment"})


def out_of_scope_reason(task: Any) -> str | None:
    # Short human-readable reason when the implement agent must NOT run for this
    # task, else None.
    #
    # Shape-defensive throughout, in both directions. A ClickUp response drift
    # must not crash the run — but it must not silently WIDEN scope either, so
    # every check is an explicit isinstance match: an unreadable field simply
    # fails to match and falls through, leaving the decision to the Lambda.
    if not isinstance(task, dict):
        return None

    custom_id = task.get("custom_id")
    if isinstance(custom_id, str):
        # Upper-cased before matching: the prefix is a human-typed convention
        # and ClickUp echoes back whatever case the workspace configured.
        normalized_custom_id = custom_id.upper()
        for prefix in OUT_OF_SCOPE_CUSTOM_ID_PREFIXES:
            if normalized_custom_id.startswith(prefix):
                return f"custom_id {custom_id} is not code work"

    task_list = task.get("list")
    if isinstance(task_list, dict):
        list_id = task_list.get("id")
        if isinstance(list_id, str) and list_id in OUT_OF_SCOPE_LIST_IDS:
            list_name = task_list.get("name")
            return f"list {list_name if isinstance(list_name, str) else list_id} is not code work"

    tags = task.get("tags")
    if isinstance(tags, list):
        for tag in tags:
            if not isinstance(tag, dict):
                continue
            tag_name = tag.get("name")
            if isinstance(tag_name, str) and tag_name.lower() in OUT_OF_SCOPE_TAG_NAMES:
                return f"tag '{tag_name}' marks this as data work"

    return None


def maybe_escalate(result: dict, label: str, client_factory: Any = None, target_repo: str = "") -> str:
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
            # by_alias, and it matters: ClickUpTask maps the API's `list` onto a
            # field named `list_id`, so a plain model_dump() carries no `list`
            # key at all and the scope rule's list check would match nothing.
            # That failure is silent and widens scope — a Growth-Bugs ticket
            # carries no DATA- prefix to catch it on the way past.
            task = client.get_task(task_id).model_dump(by_alias=True)

            # Before the tag write rather than after it, which is the point: the
            # Lambda refuses this run anyway, and the tag left behind reads to a
            # human as "a PR is coming for this".
            out_of_scope = out_of_scope_reason(task)
            if out_of_scope:
                logger.info(f"Verdict 'fix' for {task_id}, but {out_of_scope}; not queueing an implementation run")
                return f"out of scope ({out_of_scope})"

            # AFTER the scope check, deliberately, even though it is the cheaper
            # test. This outcome is the ramp's own measurement — while a repo is
            # analyze-only, counting these answers "how many PRs would this have
            # opened if I turned it on?". A data ticket refused for being data
            # work would never have become a PR, so letting it land in this
            # bucket would inflate the number the flip decision rests on.
            #
            # Empty means nobody routed this run, which resolve_repo() reads as
            # omni; read it the same way rather than failing a run that worked
            # before the field existed.
            routed = (target_repo or "").strip() or DEFAULT_ESCALATION_REPOS[0]

            # THE ANALYSIS OUTRANKS THE LIST THAT ROUTED IT. The list records
            # where a human filed the ticket; the analysis is the only thing here
            # that actually read code. When they disagree, the run that just
            # spent its budget establishing the cause is the better evidence.
            repo = parse_repo(result.get("result")) or routed

            # Against the repo the FIX is in, not the one this run read. A
            # marketing bug filed into an omni list would otherwise be waved
            # through by omni's ramp and open a PR in a repo still marked
            # analyze-only — the ramp would be measuring the wrong repo.
            if not escalation_enabled_for(repo):
                logger.info(
                    f"Analysis verdict 'fix' for {task_id} in {repo}; that repo is analyze-only, not escalating"
                )
                return f"analyze-only repo ({repo})"

            if already_queued(task):
                logger.info(f"Task {task_id} already carries {IMPLEMENT_TAG}; not re-tagging")
                return "already queued"

            # BEFORE THE TAG, and that order is the whole correctness of this.
            # The tag is what launches the implement run, and the Lambda decides
            # that run's repo by reading this comment. Written afterwards, the
            # webhook could arrive first and the run would start against the
            # list's guess — the exact redirect this exists to perform.
            redirected = repo != routed
            if redirected:
                logger.info(f"Analysis moved {task_id} from {routed} to {repo}")
                client.create_task_comment(
                    task_id,
                    f"{REPO_MARKER_PREFIX} `{repo}`, not `{routed}`. "
                    f"The ticket's list pointed here at `{routed}`; the analysis above found the cause in "
                    f"`{repo}`. Delete this comment to send the implementation run back to `{routed}`.",
                )

            try:
                client.add_tag_to_task(task_id, IMPLEMENT_TAG)
            except Exception:
                # The comment is already on the ticket and cannot be taken back:
                # ClickUpClient has no delete, and writing the comment first is
                # what makes the redirect work at all (see the note above).
                #
                # So a failed tag write leaves a ticket that ANNOUNCES a run
                # nobody queued, and the announcement is machine-read — a human
                # retrying by hand gets pointed at `repo` by a comment written
                # for a run that never happened. Say so on the ticket, next to
                # the claim it is correcting, rather than only in a log: the
                # person who has to act on it is reading the ticket.
                if redirected:
                    try:
                        client.create_task_comment(
                            task_id,
                            f"[GP-Bot] Correction: the implementation run above was never queued (tagging "
                            f"`{IMPLEMENT_TAG}` failed). The routing note above is not in effect. Delete it "
                            f"before retrying unless `{repo}` is still where the fix belongs, then add the "
                            f"`{IMPLEMENT_TAG}` tag by hand.",
                        )
                    except Exception as note_err:
                        # Best-effort by definition — this runs because ClickUp
                        # is already failing. The log is the last resort.
                        logger.error(f"Could not post the correction note on {task_id}: {note_err}")
                raise
    except Exception as e:
        # Alarm-matching, and swallowed: see the docstring. The recovery is a
        # human adding the tag, which is what they did before this existed.
        logger.error(f"Failed to escalate {task_id} to {IMPLEMENT_TAG}: {e}")
        return "escalation failed"

    logger.info(f"Escalated {task_id}: added {IMPLEMENT_TAG} to queue an implementation run")
    return "escalated"
