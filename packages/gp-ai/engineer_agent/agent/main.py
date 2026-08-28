import asyncio
import os
import sys
import time

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

from .config import CAPABILITIES, AgentConfig, build_capability_prompt
from .escalation import maybe_escalate
from .github_auth import setup_github_auth
from .metrics import format_metric_line

logger = get_logger(__name__)


def build_system_prompt(instruction: str) -> str:
    capability = build_capability_prompt()
    return capability + "\n" + instruction


def build_task_prompt(config: AgentConfig) -> str:
    return f"""Task ID: {config.task_id}

Complete the task according to your instructions.
"""


async def _consume_agent_stream(config: AgentConfig, prompt: str, options: ClaudeAgentOptions) -> dict:
    # Split out of run_agent so the whole stream can be wrapped in a single
    # asyncio.wait_for. Note the `except Exception` below deliberately does NOT
    # swallow the deadline: asyncio.CancelledError derives from BaseException,
    # so a timeout cancels straight through this handler to run_agent.
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
                    # genuine failure. Both end the run, but only one of them
                    # means the agent was still working when it stopped, so
                    # the ticket comment should not read like a crash.
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
                    f"Agent completed: {num_turns} turns, {message_count} messages. Cost: ${total_cost:.4f}. Session: {session_id}"
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
        f"Starting agent for task: {config.task_id} (model: {config.model}, "
        f"budget: ${config.max_budget_usd:.2f}, deadline: {config.deadline_seconds:.0f}s)"
    )

    if not config.instruction:
        logger.error("No INSTRUCTION provided")
        return {"status": "error", "task_id": config.task_id, "error": "No INSTRUCTION provided"}

    options = ClaudeAgentOptions(
        system_prompt=build_system_prompt(config.instruction),
        allowed_tools=CAPABILITIES["sdk_tools"],
        permission_mode="bypassPermissions",
        cwd=config.workspace_dir,
        max_turns=200,
        model=config.model,
        # Enforced by the SDK, which ends the run with an
        # error_max_budget_usd result rather than us policing cost between
        # messages — the cost of a single expensive turn is only knowable
        # after it has already been paid.
        max_budget_usd=config.max_budget_usd,
    )

    prompt = build_task_prompt(config)

    # The budget ceiling cannot bound a run that has stopped spending — a
    # hung Bash call, a tool waiting on a network read that never returns —
    # and Fargate would happily hold that task open indefinitely. The deadline
    # is the backstop for wall-clock, the budget for money; neither subsumes
    # the other.
    try:
        return await asyncio.wait_for(_consume_agent_stream(config, prompt, options), timeout=config.deadline_seconds)
    except TimeoutError:
        # Whatever the agent was doing is abandoned mid-flight. That can leave
        # a pushed branch with no PR, which is recoverable and visible; an
        # agent burning Fargate for hours is neither.
        logger.error(f"Agent exceeded its {config.deadline_seconds:.0f}s deadline and was stopped")
        return {
            "status": "error",
            "task_id": config.task_id,
            "error": f"Deadline exceeded ({config.deadline_seconds:.0f}s)",
            "error_subtype": "error_deadline_exceeded",
        }


async def main():
    config = AgentConfig.from_env()

    if not config.task_id:
        logger.error("TASK_ID (or CLICKUP_TASK_ID) environment variable required")
        sys.exit(1)

    if not config.instruction:
        logger.error("INSTRUCTION environment variable required")
        sys.exit(1)

    os.makedirs(config.workspace_dir, exist_ok=True)

    auth_mode = setup_github_auth(os.environ)
    logger.info(f"GitHub auth mode: {auth_mode}")
    if auth_mode == "error":
        logger.error("GitHub App key present but token minting failed and no fallback PAT — aborting before agent run")
        sys.exit(1)

    # monotonic, not wall clock: this number is reported as the run's duration
    # and an NTP correction mid-run would otherwise be able to make it negative.
    started = time.monotonic()
    result = await run_agent(config)
    duration_s = time.monotonic() - started

    logger.info(f"Agent result: {result}")

    # AFTER the result is logged and BEFORE the exit code is decided: an
    # analysis that concluded there is a bounded fix to make queues the
    # implementation run itself (see escalation.maybe_escalate). It reports its
    # outcome instead of raising, so a failure to escalate cannot turn a
    # successful analysis into a failed container.
    outcome = maybe_escalate(result, config.label)
    logger.info(f"Escalation: {outcome}")

    # LAST, so the line carries what the escalation decided as well as what the
    # run concluded — a `fix` verdict that did not escalate is exactly the gap
    # the weekly digest exists to surface. See agent/metrics.py for why the run
    # states its own outcome instead of leaving it to be scraped back out of the
    # prose above.
    logger.info(format_metric_line(result, config.label, outcome, duration_s))

    if result["status"] == "error":
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
