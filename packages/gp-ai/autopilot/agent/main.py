"""The stage runner: a single top-level Claude Agent SDK session bounded by a
budget ceiling (SDK-enforced) and a wall-clock deadline (this module).

Structure mirrors engineer_agent/agent/main.py — same reasoning for the dual
ceiling (budget bounds money, deadline bounds a run that has stopped spending;
neither subsumes the other) and the same "return a clean error result instead
of raising" discipline, because an uncaught exception here is a bare Fargate
task failure nobody is watching, where a returned error result still produces
a metric line.

This is a TOP-LEVEL SDK session, not a session wrapped inside another agent
layer — that is what lets the stage's own subagent dispatch (if the stage
instruction uses it) work normally.
"""

import asyncio
import os
import sys
import time
from pathlib import Path

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
    query,
)

from shared.logger import get_logger

from .config import CAPABILITIES, AgentConfig, UnknownStageError
from .feedback import apply_park_outcome, park_if_stranded
from .github_auth import setup_github_auth
from .metrics import format_metric_line
from .workspace import WorkspaceCloneError, clone_omni, point_playwright_mcp_at_chromium

logger = get_logger(__name__)

STAGES_DIR = Path(__file__).resolve().parent / "stages"

BASE_PROMPT = """You are Autopilot, GoodParty's staged engineering agent.

## TOOLS AVAILABLE

**CLI**: git, gh, aws, python, node, npm (can install more via apt-get/pip)

**GitHub org**: thegoodparty. Your workspace is already a clone of
`thegoodparty/omni` at `main`; you do not need to clone it yourself.

**ClickUp**: use `shared.clickup_client.ClickUpClient` (reads `CLICKUP_API_KEY`
from the environment) to read tasks/comments and to post updates. Scope every
write — comments, status changes, tags — to `CLICKUP_TASK_ID` (or
`EPIC_TASK_ID`, if you were given one). Never write to any other card.

**Slack**: use `shared.slack_client.SlackClient` (reads `SLACK_BOT_TOKEN` from
the environment) to read threads.

## HOW YOU ARE RUN

You run once per ClickUp task lifecycle event, as one stage in a pipeline.
Below this section is the instruction for the stage you were dispatched to run
— follow it. You are budget- and deadline-capped; if you are approaching
either limit, wrap up cleanly rather than starting new work.

## WHEN YOU NEED A HUMAN

This run is headless — nobody is watching it live, so you have no interactive
way to ask a question. When your stage's instructions call for one, park
instead of guessing or stalling:

    python -m autopilot.agent.feedback park --task-id <CLICKUP_TASK_ID> \\
        --stage <this stage's name> \\
        --question "First question" --question "Second question"

This posts your questions as one ClickUp comment, moves the card to
"feedback needed", and notifies `#autopilot` in Slack. Once it succeeds, END
YOUR TURN — do not keep working. A human answering, or moving the card back,
dispatches a fresh `resume` run that rebuilds context from the card and
continues your stage's work. Parking is a normal, successful way for a run to
end, not a failure.
"""


def load_stage_instruction(stage: str) -> str:
    path = STAGES_DIR / f"{stage}.md"
    try:
        return path.read_text()
    except FileNotFoundError as e:
        raise UnknownStageError(f"No instruction file for stage {stage!r} at {path}") from e


def build_system_prompt(stage: str) -> str:
    return BASE_PROMPT + "\n" + load_stage_instruction(stage)


def build_task_prompt(config: AgentConfig) -> str:
    lines = [f"ClickUp task ID: {config.task_id}"]
    if config.epic_task_id:
        lines.append(f"Epic task ID: {config.epic_task_id}")
    if config.stage == "resume" and config.resume_stage:
        lines.append(f"Resuming stage: {config.resume_stage}")
    lines.append("\nComplete the task according to your instructions.")
    return "\n".join(lines)


async def _consume_agent_stream(config: AgentConfig, prompt: str, options: ClaudeAgentOptions) -> dict:
    # Split out of run_agent so the whole stream can be wrapped in a single
    # asyncio.wait_for. Note the `except Exception` below deliberately does
    # NOT swallow the deadline: asyncio.CancelledError derives from
    # BaseException, so a timeout cancels straight through this handler to
    # run_agent.
    result_text = ""
    session_id = None

    message_count = 0
    try:
        async for message in query(prompt=prompt, options=options):
            if isinstance(message, AssistantMessage):
                message_count += 1
                for block in message.content:
                    if isinstance(block, TextBlock):
                        logger.info(f"[{message_count}] 💬 {block.text}")
                    elif isinstance(block, ToolUseBlock):
                        logger.info(f"[{message_count}] 🔧 {block.name}: {block.input}")

            elif isinstance(message, UserMessage):
                for block in message.content:
                    if isinstance(block, ToolResultBlock):
                        content = block.content if block.content else "(empty)"
                        status = "❌" if block.is_error else "✅"
                        logger.info(f"[{message_count}] {status} Result: {content}")

            elif isinstance(message, ResultMessage):
                result_text = message.result or ""
                total_cost = message.total_cost_usd or 0.0
                num_turns = message.num_turns
                session_id = message.session_id

                if message.is_error:
                    # subtype distinguishes "hit the budget ceiling" from a
                    # genuine failure — both end the run, but only one of them
                    # means the stage was still working when it stopped.
                    if message.subtype == "error_max_budget_usd":
                        logger.error(
                            f"Agent hit its ${config.max_budget_usd:.2f} budget ceiling after "
                            f"{num_turns} turns (spent ${total_cost:.4f})"
                        )
                    else:
                        logger.error(f"Agent ended with error after {num_turns} turns: {result_text}")
                    return {
                        "status": "error",
                        "task_id": config.task_id,
                        "error": result_text,
                        "error_subtype": message.subtype,
                        "cost_usd": total_cost,
                        "num_turns": num_turns,
                        "session_id": session_id,
                    }

                logger.info(
                    f"Agent completed: {num_turns} turns, {message_count} messages. "
                    f"Cost: ${total_cost:.4f}. Session: {session_id}"
                )
                return {
                    "status": "success",
                    "task_id": config.task_id,
                    "result": result_text,
                    "cost_usd": total_cost,
                    "num_turns": num_turns,
                    "session_id": session_id,
                }

        logger.error("Agent stream ended without ResultMessage")
        return {
            "status": "error",
            "task_id": config.task_id,
            "error": "Stream ended unexpectedly without result",
            "session_id": session_id,
        }

    except Exception as e:
        logger.exception(f"Agent failed: {e}")
        return {"status": "error", "task_id": config.task_id, "error": str(e), "session_id": session_id}


async def run_agent(config: AgentConfig) -> dict:
    logger.info(
        f"Starting {config.stage} stage for task: {config.task_id} (model: {config.model}, "
        f"budget: ${config.max_budget_usd:.2f}, deadline: {config.deadline_seconds:.0f}s)"
    )

    try:
        system_prompt = build_system_prompt(config.stage)
    except UnknownStageError as e:
        # Something dispatched this run at a stage with no instruction file.
        # Reported as a failed run rather than raised, so a container that
        # can't build a prompt still emits a metric line instead of a bare
        # Fargate task failure nobody is watching.
        logger.error(f"Cannot run: {e}")
        return {"status": "error", "task_id": config.task_id, "error": str(e)}

    options = ClaudeAgentOptions(
        system_prompt=system_prompt,
        allowed_tools=CAPABILITIES["sdk_tools"],
        permission_mode="bypassPermissions",
        cwd=config.workspace_dir,
        max_turns=200,
        model=config.model,
        # Enforced by the SDK, which ends the run with an error_max_budget_usd
        # result rather than us policing cost between messages — the cost of
        # a single expensive turn is only knowable after it has been paid.
        max_budget_usd=config.max_budget_usd,
    )

    prompt = build_task_prompt(config)

    # The budget ceiling cannot bound a run that has stopped spending — a hung
    # Bash call, a tool waiting on a network read that never returns — and
    # Fargate would happily hold that task open indefinitely. The deadline is
    # the backstop for wall-clock, the budget for money; neither subsumes the
    # other.
    try:
        return await asyncio.wait_for(_consume_agent_stream(config, prompt, options), timeout=config.deadline_seconds)
    except TimeoutError:
        # Whatever the stage was doing is abandoned mid-flight. That can leave
        # a pushed branch with no PR, which is recoverable and visible; a
        # stage burning Fargate for hours is neither.
        logger.error(f"Agent exceeded its {config.deadline_seconds:.0f}s deadline and was stopped")
        return {
            "status": "error",
            "task_id": config.task_id,
            "error": f"Deadline exceeded ({config.deadline_seconds:.0f}s)",
            "error_subtype": "error_deadline_exceeded",
        }


async def main():
    try:
        config = AgentConfig.from_env()
    except (UnknownStageError, ValueError) as e:
        # Fails before anything is spent: an unknown stage or a missing task
        # id means there is no run to bill or time-box in the first place.
        logger.error(f"Invalid autopilot envelope: {e}")
        sys.exit(1)

    os.makedirs(config.workspace_dir, exist_ok=True)

    auth_mode = setup_github_auth(os.environ)
    logger.info(f"GitHub auth mode: {auth_mode}")
    if auth_mode == "error":
        logger.error("GitHub App key present but token minting failed and no fallback PAT — aborting before agent run")
        sys.exit(1)

    try:
        # Reassigned onto workspace_dir (rather than a separate field) because
        # that is exactly what run_agent hands the SDK as `cwd` — the stage
        # works inside the omni checkout, not its parent directory.
        config.workspace_dir = clone_omni(config.workspace_dir, os.environ.get("GITHUB_TOKEN", ""))
        # This container has no branded Chrome (none exists for ARM64 Linux);
        # the repo's .mcp.json default would break the first browser call.
        point_playwright_mcp_at_chromium(config.workspace_dir)
    except WorkspaceCloneError as e:
        logger.error(f"omni clone failed: {e}")
        sys.exit(1)

    # monotonic, not wall clock: this number is reported as the run's duration
    # and an NTP correction mid-run would otherwise be able to make it
    # negative.
    started = time.monotonic()
    result = await run_agent(config)
    duration_s = time.monotonic() - started

    logger.info(f"Agent result: {result}")

    # Reads the sentinel feedback.park_for_feedback writes as its LAST step —
    # not config.workspace_dir, which by now points at the omni clone
    # (reassigned above), not the container-wide directory the CLI wrote
    # into. Only tags an already-successful run; see apply_park_outcome.
    apply_park_outcome(result, os.environ.get("WORKSPACE_DIR", "/workspace"))

    # Deterministic backstop for the model ending its turn with the card
    # still in progress (both live story runs did, despite the instruction):
    # park it so the card can never strand. A resume run parks as the stage
    # it was resuming — "resume" itself carries no ceiling and no marker.
    park_if_stranded(
        result,
        config.resume_stage if config.stage == "resume" else config.stage,
        config.task_id,
        workspace_dir=os.environ.get("WORKSPACE_DIR", "/workspace"),
    )

    logger.info(format_metric_line(result, config.stage, duration_s, config.epic_task_id))

    if result["status"] == "error":
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
