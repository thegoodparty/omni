"""The ask-and-park primitive: how a headless stage gets human input.

A Fargate stage run has nobody watching it live, so it cannot use an
interactive AskUserQuestion. When a stage's instructions call for one, it
parks instead: post the questions to the card, move the card to a status a
human will notice, ping Slack, and end the run. A human answering (or moving
the card back) re-dispatches a fresh `resume` run, which has no memory of this
one — every run is stateless and safe to retry, so the durable artifacts this
module writes to ClickUp are the ONLY record of what was asked.

Exposed to stages as a CLI (see main.BASE_PROMPT), the same convention
engineer_agent uses for its post_to_clickup script: a stage's only tool is
Bash, so the primitive has to be something a shell command can invoke, not a
Python function only importable from inside this process.

    python -m autopilot.agent.feedback park --task-id <id> --stage <stage> \\
        --question "..." --question "..."
    python -m autopilot.agent.feedback parked-stage --task-id <id>
    python -m autopilot.agent.feedback notify --task-id <id> --stage <stage> \\
        --message "..."

`notify` is the park's Slack ping without the park: no comment, no status
move, no marker, no sentinel. It exists for handoffs that already put the
card where a human will review it (epic-create's finished breakdown lands in
`feedback needed` by its own status move) but still owe the TDD's promise
that every card arriving there pings #autopilot.
"""

import argparse
import json
import os
import re
import sys
from collections.abc import Callable, Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

from shared.clickup_client import ClickUpClient
from shared.logger import get_logger
from shared.slack_client import SlackClient

from .config import STAGE_CEILINGS

logger = get_logger(__name__)

# The status a parked card moves to. A plain ClickUp status name, matching how
# shared.clickup_client.ClickUpClient.update_task takes it (see
# TaskStatus.IN_PROGRESS et al for the same lowercase convention).
FEEDBACK_NEEDED_STATUS = "feedback needed"

# Recorded as the FIRST LINE of every parking comment (see format_park_comment)
# — human-readable in the ClickUp UI, and machine-greppable by
# parse_parked_stage. One format serves both readers on purpose: a second,
# LLM-facing marker would drift from what a human sees on the card.
PARK_MARKER_PATTERN = re.compile(r"\[autopilot:parked stage=([a-z0-9][a-z0-9-]*)\]", re.IGNORECASE)

# A numbered list line ("1. question text"), the shape format_park_comment
# writes and the shape a human is expected to answer inline against.
_QUESTION_LINE_PATTERN = re.compile(r"^\s*\d+\.\s+(.+?)\s*$", re.MULTILINE)

# Sibling to the omni clone (config.workspace_dir becomes "{this}/omni" once
# main.clone_omni runs), not inside it — a git checkout is the wrong place for
# a run-scoped sentinel, and this file has no reason to ever be committed.
PARK_SENTINEL_FILENAME = ".autopilot-parked.json"


class UnknownStageError(ValueError):
    """A stage name that carries no ceiling defaults — see config.py — was
    passed to `park`. The marker this module writes is read back by other
    stages and by resume.md; a typo here would silently mislabel the card."""


def format_park_marker(stage: str) -> str:
    return f"[autopilot:parked stage={stage}]"


def format_park_comment(stage: str, questions: Sequence[str]) -> str:
    lines = [format_park_marker(stage), ""]
    lines.extend(f"{i}. {question}" for i, question in enumerate(questions, start=1))
    return "\n".join(lines)


def _comment_text(comment: Any) -> str:
    # Duck-typed rather than isinstance-checked against ClickUpComment: tests
    # build these directly, and the real client already normalizes both
    # comment-text shapes behind get_text() (see shared.clickup_client's own
    # SHAPE CONTRACT note) — reimplementing that here would be exactly the
    # near-duplicate parser this repo's cross-file review looks for.
    if hasattr(comment, "get_text"):
        text = comment.get_text()
        return text if isinstance(text, str) else ""
    return comment if isinstance(comment, str) else ""


def _comment_date_ms(comment: Any) -> int:
    # ClickUp's own listing order is not a contract this codebase relies on
    # elsewhere (clickup_bot's dedup checks compute age from the `date` field
    # rather than trusting position) — sort explicitly rather than assume.
    # Undatable comments sort first (0), the same "fail toward not blocking"
    # direction clickup_bot takes on an unparseable date.
    date = getattr(comment, "date", None)
    try:
        return int(date)
    except (TypeError, ValueError):
        return 0


def _ordered_by_date(comments: Iterable[Any]) -> list[Any]:
    return sorted(comments, key=_comment_date_ms)


def parse_parked_stage(comments: Iterable[Any]) -> str | None:
    """The stage named by the MOST RECENT park marker in a comment thread, or
    None if the thread carries none.

    LATEST WINS: a card can park more than once (park, resume, re-park), and
    only the newest marker describes where the card actually is now — an
    older one is history, not current state.
    """
    stage = None
    for comment in _ordered_by_date(comments):
        for match in PARK_MARKER_PATTERN.finditer(_comment_text(comment)):
            stage = match.group(1).lower()
    return stage


def _extract_questions(text: str) -> list[str]:
    return [match.group(1) for match in _QUESTION_LINE_PATTERN.finditer(text)]


def _normalize_question(question: str) -> str:
    return " ".join(question.split()).casefold()


def previously_asked_questions(comments: Iterable[Any]) -> list[str]:
    """Every question asked across every park-marker comment in this thread,
    oldest first, de-duplicated by normalized text.

    Only comments carrying the marker count: a human's reply, or an unrelated
    bot comment, may itself contain a numbered list without being a question
    autopilot asked.
    """
    seen: set[str] = set()
    asked: list[str] = []
    for comment in _ordered_by_date(comments):
        text = _comment_text(comment)
        if not PARK_MARKER_PATTERN.search(text):
            continue
        for question in _extract_questions(text):
            normalized = _normalize_question(question)
            if normalized not in seen:
                seen.add(normalized)
                asked.append(question)
    return asked


def new_questions(candidates: Sequence[str], comments: Iterable[Any]) -> list[str]:
    """`candidates` with anything already asked in a prior parking comment
    removed, so a re-park never repeats a question the thread already
    carries. Preserves order; also de-duplicates within `candidates` itself.
    """
    already_asked = {_normalize_question(q) for q in previously_asked_questions(comments)}
    seen: set[str] = set()
    result = []
    for question in candidates:
        normalized = _normalize_question(question)
        if normalized in already_asked or normalized in seen:
            continue
        seen.add(normalized)
        result.append(question)
    return result


def _allowed_task_ids(env: Mapping[str, str]) -> frozenset[str]:
    ids = {env.get("CLICKUP_TASK_ID", "").strip(), env.get("EPIC_TASK_ID", "").strip()}
    return frozenset(i for i in ids if i)


def _slack_message(card_url: str, stage: str, questions: Sequence[str]) -> str:
    lines = [f"Autopilot parked <{card_url}|a card> during *{stage}* — needs your input:"]
    lines.extend(f"{i}. {question}" for i, question in enumerate(questions, start=1))
    return "\n".join(lines)


def _notify_message(card_url: str, stage: str, message: str) -> str:
    return f"Autopilot *{stage}* on <{card_url}|a card>: {message}"


def _sentinel_path(workspace_dir: str) -> Path:
    return Path(workspace_dir) / PARK_SENTINEL_FILENAME


def write_park_sentinel(workspace_dir: str, stage: str, task_id: str) -> None:
    _sentinel_path(workspace_dir).write_text(json.dumps({"stage": stage, "task_id": task_id}))


def read_park_sentinel(workspace_dir: str) -> dict | None:
    path = _sentinel_path(workspace_dir)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        # A sentinel this run cannot read is not evidence the run parked —
        # fail toward the ordinary outcome rather than inventing one.
        logger.error(f"Could not read park sentinel at {path}; treating this run as not parked")
        return None
    return data if isinstance(data, dict) else None


def apply_park_outcome(result: dict, workspace_dir: str) -> dict:
    """Tags `result` with the stage this run parked at, if it did, so
    metrics.format_metric_line reports `feedback_parked` instead of `success`.

    Only consulted on an already-successful run: a run that errored or hit a
    ceiling did not cleanly end by parking, whatever sentinel a half-finished
    `park` call might have left behind (see park_for_feedback's write order —
    the sentinel is the LAST step, so a real partial failure should not have
    produced one anyway).
    """
    if not isinstance(result, dict) or result.get("status") != "success":
        return result
    parked = read_park_sentinel(workspace_dir)
    if isinstance(parked, dict) and parked.get("stage"):
        result["parked_stage"] = parked["stage"]
    return result


def park_for_feedback(
    task_id: str,
    stage: str,
    questions: Sequence[str],
    *,
    channel: str | None = None,
    workspace_dir: str | None = None,
    clickup_client_factory: Callable[[], Any] = ClickUpClient,
    slack_client_factory: Callable[[], Any] = SlackClient,
    env: Mapping[str, str] | None = None,
) -> dict:
    """Posts the questions, moves the card, and notifies Slack — in that
    order, and DELIBERATELY NOT WRAPPED in a try/except that could swallow a
    mid-sequence failure. A card left half-parked (comment posted, status
    never moved; or moved, Slack never notified) must surface as a raised
    exception, not a clean-looking result: see write_park_sentinel, which
    only ever runs after every step above it has already succeeded.

    MUST STILL BE SAFE TO RETRY after exactly that kind of partial failure —
    every autopilot run is stateless and expected to be re-runnable (see the
    module docstring). If the comment step already succeeded and a later one
    then raised, a retry with the same arguments sees its own prior comment
    in `existing_comments`, dedupes every candidate question against it, and
    must complete the remaining steps rather than raising "nothing new to
    park for": that would wedge the card behind its own dedup guard forever,
    with no path through this primitive to finish the job. Same shape as
    engineer_agent's escalation.already_queued() treating an already-applied
    write as a no-op to proceed past, not an error.
    """
    source_env = env if env is not None else os.environ

    if stage not in STAGE_CEILINGS:
        raise UnknownStageError(f"Unknown stage {stage!r}; known stages: {sorted(STAGE_CEILINGS)}")

    allowed_task_ids = _allowed_task_ids(source_env)
    if task_id not in allowed_task_ids:
        raise ValueError(
            f"Refusing to write to {task_id!r}: writes are scoped to CLICKUP_TASK_ID/EPIC_TASK_ID "
            f"({sorted(allowed_task_ids) if allowed_task_ids else 'neither is set'})"
        )

    resolved_channel = channel or source_env.get("AUTOPILOT_SLACK_CHANNEL", "").strip()
    if not resolved_channel:
        raise ValueError("No Slack channel: pass --channel or set AUTOPILOT_SLACK_CHANNEL")

    if not questions:
        raise ValueError("At least one question is required to park for feedback")

    with clickup_client_factory() as clickup:
        existing_comments = clickup.get_task_comments(task_id)
        to_ask = new_questions(questions, existing_comments)
        if to_ask:
            clickup.create_task_comment(task_id, format_park_comment(stage, to_ask))
        else:
            # Nothing new to add on top of what the thread already carries —
            # either a genuine no-op re-park, or (the case that matters) a
            # retry after `questions` was already posted by an earlier call
            # to this function that failed on a later step. Either way,
            # re-posting would duplicate the card's question list, so skip
            # the comment and fall through to the steps below: they must
            # still run so a retry is not permanently blocked here. See the
            # docstring above.
            logger.info(f"All {len(questions)} question(s) for {task_id} were already asked; not re-posting")

        updated_task = clickup.update_task(task_id, status=FEEDBACK_NEEDED_STATUS)

    card_url = getattr(updated_task, "url", None) or f"https://app.clickup.com/t/{task_id}"

    slack = slack_client_factory()
    slack.client.chat_postMessage(channel=resolved_channel, text=_slack_message(card_url, stage, to_ask or questions))

    write_park_sentinel(workspace_dir or source_env.get("WORKSPACE_DIR", "/workspace"), stage, task_id)

    logger.info(f"Parked {task_id} for feedback at stage {stage!r} ({len(to_ask)} question(s))")
    return {
        "status": "parked",
        "task_id": task_id,
        "stage": stage,
        "questions": to_ask,
        "card_url": card_url,
        "channel": resolved_channel,
    }


def notify_slack(
    task_id: str,
    stage: str,
    message: str,
    *,
    channel: str | None = None,
    slack_client_factory: Callable[[], Any] = SlackClient,
    env: Mapping[str, str] | None = None,
) -> dict:
    """The park's Slack ping on its own (see the module docstring): posts one
    message linking the card, touching nothing on the card itself. The same
    scope and channel guards as park_for_feedback, because a notify that can
    address arbitrary cards or silently drop for a missing channel would be
    the same bug in a smaller box. The card URL is constructed, not fetched —
    notify runs after the caller already wrote the card, and a read here
    would add a failure mode to a step whose only job is the ping.
    """
    source_env = env if env is not None else os.environ

    if stage not in STAGE_CEILINGS:
        raise UnknownStageError(f"Unknown stage {stage!r}; known stages: {sorted(STAGE_CEILINGS)}")

    allowed_task_ids = _allowed_task_ids(source_env)
    if task_id not in allowed_task_ids:
        raise ValueError(
            f"Refusing to notify about {task_id!r}: writes are scoped to CLICKUP_TASK_ID/EPIC_TASK_ID "
            f"({sorted(allowed_task_ids) if allowed_task_ids else 'neither is set'})"
        )

    resolved_channel = channel or source_env.get("AUTOPILOT_SLACK_CHANNEL", "").strip()
    if not resolved_channel:
        raise ValueError("No Slack channel: pass --channel or set AUTOPILOT_SLACK_CHANNEL")

    if not message or not message.strip():
        raise ValueError("A non-empty message is required to notify")

    card_url = f"https://app.clickup.com/t/{task_id}"
    slack = slack_client_factory()
    slack.client.chat_postMessage(channel=resolved_channel, text=_notify_message(card_url, stage, message.strip()))

    logger.info(f"Notified {resolved_channel} about {task_id} at stage {stage!r}")
    return {
        "status": "notified",
        "task_id": task_id,
        "stage": stage,
        "card_url": card_url,
        "channel": resolved_channel,
    }


def _park_command(args: argparse.Namespace) -> int:
    try:
        # ClickUpClient/SlackClient looked up as module globals HERE, at call
        # time, rather than left to park_for_feedback's own defaults (bound
        # once, at import time) — the indirection is what lets tests swap
        # them out with monkeypatch.setattr(feedback, "ClickUpClient", ...).
        result = park_for_feedback(
            args.task_id,
            args.stage,
            args.question,
            channel=args.channel,
            clickup_client_factory=ClickUpClient,
            slack_client_factory=SlackClient,
        )
    except Exception as e:
        print(f"Failed to park {args.task_id} for feedback: {e}", file=sys.stderr)
        return 1

    print(f"Parked {result['task_id']} for feedback at stage {result['stage']!r}: {result['card_url']}")
    for i, question in enumerate(result["questions"], start=1):
        print(f"{i}. {question}")
    return 0


def _notify_command(args: argparse.Namespace) -> int:
    try:
        # Same call-time factory lookup as _park_command, for the same
        # monkeypatch reason.
        result = notify_slack(
            args.task_id,
            args.stage,
            args.message,
            channel=args.channel,
            slack_client_factory=SlackClient,
        )
    except Exception as e:
        print(f"Failed to notify about {args.task_id}: {e}", file=sys.stderr)
        return 1

    print(f"Notified {result['channel']} about {result['task_id']} at stage {result['stage']!r}: {result['card_url']}")
    return 0


def _parked_stage_command(args: argparse.Namespace) -> int:
    try:
        with ClickUpClient() as clickup:
            comments = clickup.get_task_comments(args.task_id)
    except Exception as e:
        print(f"Failed to read comments on {args.task_id}: {e}", file=sys.stderr)
        return 1

    stage = parse_parked_stage(comments)
    if stage is None:
        print(f"No park marker found on {args.task_id}.")
        return 1
    print(stage)
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ask-and-park primitive for autopilot stages")
    subparsers = parser.add_subparsers(dest="command", required=True)

    park = subparsers.add_parser("park", help="Post questions, move the card, and notify Slack")
    park.add_argument("--task-id", required=True)
    park.add_argument("--stage", required=True, choices=sorted(STAGE_CEILINGS))
    park.add_argument("--question", action="append", default=[], help="Repeatable: one per question")
    park.add_argument("--channel", default=None, help="Defaults to AUTOPILOT_SLACK_CHANNEL")
    park.set_defaults(func=_park_command)

    parked_stage = subparsers.add_parser(
        "parked-stage", help="Print which stage parked this card, read from its comment thread"
    )
    parked_stage.add_argument("--task-id", required=True)
    parked_stage.set_defaults(func=_parked_stage_command)

    notify = subparsers.add_parser("notify", help="Ping Slack about a card without touching the card")
    notify.add_argument("--task-id", required=True)
    notify.add_argument("--stage", required=True, choices=sorted(STAGE_CEILINGS))
    notify.add_argument("--message", required=True)
    notify.add_argument("--channel", default=None, help="Defaults to AUTOPILOT_SLACK_CHANNEL")
    notify.set_defaults(func=_notify_command)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
