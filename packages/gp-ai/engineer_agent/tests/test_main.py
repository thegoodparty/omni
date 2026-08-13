"""Pins run_agent's per-run ceilings as behavior, not just configuration.

test_config.py proves the deadline is *parsed*; these prove it is *enforced*.
That gap matters because the deadline is the only bound on a run that has
stopped spending — a hung Bash call or a tool blocked on a socket that never
returns — and Fargate will hold such a task open indefinitely. Every reported
bug now launches a run automatically, so a silent regression here is a bill
nobody notices rather than a test failure.
"""

import asyncio

from engineer_agent.agent.config import AgentConfig
from engineer_agent.agent.main import run_agent


def _configured(monkeypatch, **env):
    monkeypatch.setenv("TASK_ID", "TEST-1")
    monkeypatch.setenv("INSTRUCTION", "do something")
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    return AgentConfig.from_env()


async def test_deadline_stops_a_hung_run_and_reports_why(monkeypatch):
    config = _configured(monkeypatch, AGENT_DEADLINE_SECONDS="0.01")

    async def never_returns(config, prompt, options):
        await asyncio.sleep(30)
        raise AssertionError("deadline did not fire")

    monkeypatch.setattr("engineer_agent.agent.main._consume_agent_stream", never_returns)

    # Timing is the assertion, not decoration: without wait_for this awaits the
    # full sleep, so a generous ceiling still fails on a regression while
    # staying far from flaky on a loaded CI runner.
    started = asyncio.get_running_loop().time()
    result = await run_agent(config)
    elapsed = asyncio.get_running_loop().time() - started

    assert elapsed < 5
    assert result["status"] == "error"
    # The subtype is what clickup_bot reads to phrase the ticket comment as
    # "stopped at its limit" rather than "crashed", so it is part of the
    # contract and not an implementation detail.
    assert result["error_subtype"] == "error_deadline_exceeded"
    assert result["task_id"] == "TEST-1"


async def test_a_run_that_finishes_inside_the_deadline_is_untouched(monkeypatch):
    # The other half of the guard: wrapping the stream in wait_for must not
    # rewrite the result of a run that completed normally.
    config = _configured(monkeypatch, AGENT_DEADLINE_SECONDS="30")
    expected = {"status": "success", "task_id": "TEST-1", "result": "done"}

    async def completes(config, prompt, options):
        return expected

    monkeypatch.setattr("engineer_agent.agent.main._consume_agent_stream", completes)

    assert await run_agent(config) == expected


async def test_a_missing_instruction_never_starts_a_run(monkeypatch):
    # Cheapest possible ceiling: refuse before the SDK is engaged at all.
    config = _configured(monkeypatch, INSTRUCTION="")

    async def must_not_run(config, prompt, options):
        raise AssertionError("run_agent started the agent without an instruction")

    monkeypatch.setattr("engineer_agent.agent.main._consume_agent_stream", must_not_run)

    result = await run_agent(config)

    assert result["status"] == "error"
