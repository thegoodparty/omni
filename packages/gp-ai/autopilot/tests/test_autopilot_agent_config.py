"""Config parsing for an autopilot stage run.

Named distinctly from engineer_agent/tests/test_config.py per the gp-ai suite's
basename-clash rule (see the root AGENTS.md's Testing section).
"""

import pytest

from autopilot.agent.config import STAGE_CEILINGS, AgentConfig, UnknownStageError


def _configured(monkeypatch, **env):
    monkeypatch.setenv("AUTOPILOT_STAGE", "story")
    monkeypatch.setenv("CLICKUP_TASK_ID", "TEST-1")
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    return AgentConfig.from_env()


class TestHappyPath:
    def test_parses_the_full_envelope(self, monkeypatch):
        config = _configured(
            monkeypatch,
            AUTOPILOT_STAGE="story",
            EPIC_TASK_ID="EPIC-1",
            AGENT_MODEL="sonnet",
            AGENT_MAX_BUDGET_USD="5",
            AGENT_DEADLINE_SECONDS="600",
            WORKSPACE_DIR="/tmp/ws",
        )

        assert config.stage == "story"
        assert config.task_id == "TEST-1"
        assert config.epic_task_id == "EPIC-1"
        assert config.model == "sonnet"
        assert config.max_budget_usd == 5.0
        assert config.deadline_seconds == 600.0
        assert config.workspace_dir == "/tmp/ws"

    def test_model_and_workspace_dir_default(self, monkeypatch):
        config = _configured(monkeypatch)

        assert config.model == "opus"
        assert config.workspace_dir == "/workspace"

    def test_epic_task_id_defaults_to_empty(self, monkeypatch):
        monkeypatch.delenv("EPIC_TASK_ID", raising=False)

        assert _configured(monkeypatch).epic_task_id == ""


class TestFailFast:
    def test_missing_clickup_task_id_raises(self, monkeypatch):
        monkeypatch.setenv("AUTOPILOT_STAGE", "story")
        monkeypatch.delenv("CLICKUP_TASK_ID", raising=False)

        with pytest.raises(ValueError, match="CLICKUP_TASK_ID"):
            AgentConfig.from_env()

    def test_unknown_stage_raises(self, monkeypatch):
        monkeypatch.setenv("AUTOPILOT_STAGE", "not-a-real-stage")
        monkeypatch.setenv("CLICKUP_TASK_ID", "TEST-1")

        with pytest.raises(UnknownStageError, match="not-a-real-stage"):
            AgentConfig.from_env()

    def test_missing_stage_raises(self, monkeypatch):
        monkeypatch.delenv("AUTOPILOT_STAGE", raising=False)
        monkeypatch.setenv("CLICKUP_TASK_ID", "TEST-1")

        with pytest.raises(UnknownStageError):
            AgentConfig.from_env()


class TestPerStageCeilingDefaults:
    @pytest.mark.parametrize(
        "stage,expected_budget,expected_deadline",
        [
            ("epic-create", 10.0, 30 * 60),
            ("story", 15.0, 45 * 60),
            ("qa", 8.0, 45 * 60),
        ],
    )
    def test_defaults_applied_when_ceiling_vars_absent(self, monkeypatch, stage, expected_budget, expected_deadline):
        monkeypatch.setenv("AUTOPILOT_STAGE", stage)
        monkeypatch.setenv("CLICKUP_TASK_ID", "TEST-1")
        monkeypatch.delenv("AGENT_MAX_BUDGET_USD", raising=False)
        monkeypatch.delenv("AGENT_DEADLINE_SECONDS", raising=False)

        config = AgentConfig.from_env()

        assert config.max_budget_usd == expected_budget
        assert config.deadline_seconds == expected_deadline

    def test_ceilings_are_overridable_per_run(self, monkeypatch):
        config = _configured(
            monkeypatch,
            AUTOPILOT_STAGE="qa",
            AGENT_MAX_BUDGET_USD="1.5",
            AGENT_DEADLINE_SECONDS="120",
        )

        assert config.max_budget_usd == 1.5
        assert config.deadline_seconds == 120.0

    @pytest.mark.parametrize("bad", ["nan", "inf", "-inf", "0", "-5", "abc", ""])
    def test_unusable_ceiling_values_fall_back_to_the_stage_default(self, monkeypatch, bad):
        monkeypatch.setenv("AGENT_MAX_BUDGET_USD", bad)

        config = _configured(monkeypatch, AUTOPILOT_STAGE="qa")

        assert config.max_budget_usd == STAGE_CEILINGS["qa"][0]


class TestResumeInheritsItsStagesCeilings:
    def test_resume_takes_on_the_resumed_stages_defaults(self, monkeypatch):
        config = _configured(monkeypatch, AUTOPILOT_STAGE="resume", RESUME_STAGE="story")

        assert config.max_budget_usd == STAGE_CEILINGS["story"][0]
        assert config.deadline_seconds == STAGE_CEILINGS["story"][1]
        assert config.resume_stage == "story"

    def test_resume_without_a_resume_stage_fails_fast(self, monkeypatch):
        monkeypatch.delenv("RESUME_STAGE", raising=False)

        with pytest.raises(UnknownStageError):
            _configured(monkeypatch, AUTOPILOT_STAGE="resume")

    def test_resume_naming_an_unknown_resume_stage_fails_fast(self, monkeypatch):
        with pytest.raises(UnknownStageError, match="nonsense"):
            _configured(monkeypatch, AUTOPILOT_STAGE="resume", RESUME_STAGE="nonsense")

    def test_resume_cannot_name_itself_as_the_resumed_stage(self, monkeypatch):
        # "resume" has no ceiling default of its own — see STAGE_CEILINGS.
        with pytest.raises(UnknownStageError):
            _configured(monkeypatch, AUTOPILOT_STAGE="resume", RESUME_STAGE="resume")

    def test_non_resume_stages_ignore_resume_stage_env(self, monkeypatch):
        # RESUME_STAGE is irrelevant outside a resume run; a stray/leftover
        # value must not affect a normal stage's ceilings.
        config = _configured(monkeypatch, AUTOPILOT_STAGE="qa", RESUME_STAGE="story")

        assert config.max_budget_usd == STAGE_CEILINGS["qa"][0]
