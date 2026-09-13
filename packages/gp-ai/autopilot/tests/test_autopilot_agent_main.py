"""Pins run_agent's per-run ceilings and system-prompt assembly as behavior.

test_autopilot_agent_config.py proves the deadline is *parsed*; these prove it
is *enforced*, and that the stage instruction file is what actually reaches the
model. Named distinctly from engineer_agent/tests/test_main.py per the gp-ai
suite's basename-clash rule.
"""

import asyncio

import pytest

from autopilot.agent import main as agent_main
from autopilot.agent.config import AgentConfig, UnknownStageError
from autopilot.agent.main import build_system_prompt, build_task_prompt, load_stage_instruction, run_agent


def _configured(monkeypatch, **env):
    monkeypatch.setenv("AUTOPILOT_STAGE", "story")
    monkeypatch.setenv("CLICKUP_TASK_ID", "TEST-1")
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    return AgentConfig.from_env()


# ---------------------------------------------------------------------------
# Deadline enforcement
# ---------------------------------------------------------------------------


async def test_deadline_stops_a_hung_run_and_reports_why(monkeypatch):
    config = _configured(monkeypatch, AGENT_DEADLINE_SECONDS="0.01")

    async def never_returns(config, prompt, options):
        await asyncio.sleep(30)
        raise AssertionError("deadline did not fire")

    monkeypatch.setattr("autopilot.agent.main._consume_agent_stream", never_returns)

    started = asyncio.get_running_loop().time()
    result = await run_agent(config)
    elapsed = asyncio.get_running_loop().time() - started

    assert elapsed < 5
    assert result["status"] == "error"
    assert result["error_subtype"] == "error_deadline_exceeded"
    assert result["task_id"] == "TEST-1"


async def test_a_run_that_finishes_inside_the_deadline_is_untouched(monkeypatch):
    config = _configured(monkeypatch, AGENT_DEADLINE_SECONDS="30")
    expected = {"status": "success", "task_id": "TEST-1", "result": "done"}

    async def completes(config, prompt, options):
        return expected

    monkeypatch.setattr("autopilot.agent.main._consume_agent_stream", completes)

    assert await run_agent(config) == expected


async def test_an_unknown_stage_instruction_never_starts_a_run(monkeypatch):
    config = _configured(monkeypatch, AUTOPILOT_STAGE="qa")
    # Simulate a stage file that vanished after config validation passed.
    monkeypatch.setattr(agent_main, "STAGES_DIR", agent_main.STAGES_DIR / "does-not-exist")

    async def must_not_run(config, prompt, options):
        raise AssertionError("run_agent started the agent without a stage instruction")

    monkeypatch.setattr(agent_main, "_consume_agent_stream", must_not_run)

    result = await agent_main.run_agent(config)

    assert result["status"] == "error"


# ---------------------------------------------------------------------------
# Stage instruction loading
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("stage", ["epic-create", "story", "qa", "resume"])
def test_every_real_stage_has_a_loadable_instruction_file(stage):
    instruction = load_stage_instruction(stage)

    assert instruction.strip()


def test_unknown_stage_file_raises():
    with pytest.raises(UnknownStageError, match="no-such-stage"):
        load_stage_instruction("no-such-stage")


def test_system_prompt_combines_base_prompt_and_stage_instruction():
    prompt = build_system_prompt("qa")

    assert "You are Autopilot" in prompt
    assert "STAGE: qa" in prompt


def test_system_prompt_for_unknown_stage_raises():
    with pytest.raises(UnknownStageError):
        build_system_prompt("no-such-stage")


# ---------------------------------------------------------------------------
# Task prompt
# ---------------------------------------------------------------------------


def test_task_prompt_carries_the_task_and_epic_ids(monkeypatch):
    config = _configured(monkeypatch, EPIC_TASK_ID="EPIC-1")

    prompt = build_task_prompt(config)

    assert "TEST-1" in prompt
    assert "EPIC-1" in prompt


def test_task_prompt_names_the_resumed_stage(monkeypatch):
    config = _configured(monkeypatch, AUTOPILOT_STAGE="resume", RESUME_STAGE="story")

    prompt = build_task_prompt(config)

    assert "story" in prompt


def test_task_prompt_omits_epic_id_when_unset(monkeypatch):
    monkeypatch.delenv("EPIC_TASK_ID", raising=False)
    config = _configured(monkeypatch)

    prompt = build_task_prompt(config)

    assert "Epic task ID" not in prompt
