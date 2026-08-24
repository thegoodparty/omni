"""Pins the capability-prompt contract: the single source of repo guidance.

clickup_bot's instruction templates deliberately do NOT carry repo guidance;
if it disappears from build_capability_prompt(), agents clone archived repos
and burn whole runs (July 2026 incident class).
"""

import pytest

from engineer_agent.agent.config import (
    DEFAULT_DEADLINE_SECONDS,
    DEFAULT_MAX_BUDGET_USD,
    AgentConfig,
    build_capability_prompt,
)


def test_capability_prompt_points_at_omni_monorepo():
    prompt = build_capability_prompt()
    assert "thegoodparty/omni" in prompt
    assert "packages/" in prompt
    assert "gp-webapp" in prompt


def test_capability_prompt_warns_off_archived_repos():
    prompt = build_capability_prompt()
    assert "archived" in prompt
    assert "never clone them" in prompt


def test_capability_prompt_keeps_gp_data_platform_as_live_repo():
    prompt = build_capability_prompt()
    assert "gp-data-platform" in prompt


def test_capability_prompt_lists_gp_ai_projects_as_archived():
    # gp-ai-projects was archived 2026-07-23 when it merged into omni as
    # packages/gp-ai. The prompt described it as a live standalone repo for
    # weeks afterwards, which is the archived-repo trap the tests above exist
    # to prevent — so pin it on the archived side of the sentence, not merely
    # "mentioned somewhere".
    prompt = build_capability_prompt()
    archived_sentence = prompt.split("**archived**")[0]
    assert "gp-ai-projects" in archived_sentence


def test_capability_prompt_locates_gp_ai_inside_omni():
    prompt = build_capability_prompt()
    assert "packages/gp-ai" in prompt


def test_capability_prompt_omits_people_api_from_live_packages():
    # packages/people-api no longer exists in omni; people-api survives only as
    # an archived standalone repo. Listing it as a live package sends the agent
    # hunting for a directory that isn't there, which burns a run the same way
    # cloning an archived repo does.
    prompt = build_capability_prompt()
    live_section = prompt.split("The old standalone repos")[0]
    assert "people-api" not in live_section
    assert "people-api" in prompt


def test_capability_prompt_targets_omni_main_for_prs():
    # `develop` was deleted in the single-trunk migration; a PR opened against
    # it fails at the gh call after the agent has already done all the work.
    # The negative assertion is the load-bearing half.
    prompt = build_capability_prompt()
    assert "`main`" in prompt
    assert "develop" not in prompt


# ---------------------------------------------------------------------------
# Per-run ceilings. A run had neither a budget nor a clock while gpbot-work was
# hand-applied one ticket at a time. Every reported bug now launches one
# automatically, so these are what keep a pathological run from being a
# recurring bill nobody notices.
# ---------------------------------------------------------------------------


def test_defaults_carry_both_ceilings(monkeypatch):
    for var in ("AGENT_MAX_BUDGET_USD", "AGENT_DEADLINE_SECONDS"):
        monkeypatch.delenv(var, raising=False)

    config = AgentConfig.from_env()

    assert config.max_budget_usd == DEFAULT_MAX_BUDGET_USD
    assert config.deadline_seconds == DEFAULT_DEADLINE_SECONDS


def test_ceilings_are_overridable(monkeypatch):
    monkeypatch.setenv("AGENT_MAX_BUDGET_USD", "2.5")
    monkeypatch.setenv("AGENT_DEADLINE_SECONDS", "600")

    config = AgentConfig.from_env()

    assert config.max_budget_usd == 2.5
    assert config.deadline_seconds == 600


@pytest.mark.parametrize("bad", ["nan", "inf", "-inf", "0", "-5", "abc", ""])
def test_unusable_ceiling_values_fall_back_to_the_default(monkeypatch, bad):
    # 'nan' and 'inf' are the dangerous ones: float() parses both, and either
    # would silently REMOVE the ceiling rather than misconfigure it — every
    # comparison against NaN is False, and nothing exceeds inf.
    monkeypatch.setenv("AGENT_MAX_BUDGET_USD", bad)

    assert AgentConfig.from_env().max_budget_usd == DEFAULT_MAX_BUDGET_USD


def test_run_label_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("AGENT_LABEL", "analyze")

    assert AgentConfig.from_env().label == "analyze"


def test_an_unset_run_label_is_empty_not_analyze(monkeypatch):
    # Defaulting to "analyze" would let any run started without the ClickUp bot
    # (a local invocation, an older task definition that predates AGENT_LABEL)
    # queue implementation work off its own verdict. Unknown provenance has to
    # leave the escalation path closed.
    monkeypatch.delenv("AGENT_LABEL", raising=False)

    assert AgentConfig.from_env().label == ""
