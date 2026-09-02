"""What the agent is told about the repo it was pointed at.

The expensive failure this guards is not a crash. It is a run that works
confidently in the wrong codebase, or in the right one with the wrong tools, and
produces something that looks like an answer.
"""

import re
from pathlib import Path

import pytest

from engineer_agent.agent.config import build_capability_prompt
from engineer_agent.agent.repos import (
    MARKETING,
    OMNI,
    REPO_PROFILES,
    UnknownRepoError,
    resolve_repo,
)


class TestPickingTheRepo:
    def test_nothing_asked_for_means_omni(self):
        # Every run before routing existed meant omni, and some still do: a
        # local invocation, a script, a task definition that predates the
        # TARGET_REPO override. None of those should break.
        assert resolve_repo(None).full_name == OMNI
        assert resolve_repo("").full_name == OMNI
        assert resolve_repo("   ").full_name == OMNI

    def test_a_named_repo_is_the_one_you_get(self):
        assert resolve_repo(MARKETING).full_name == MARKETING
        assert resolve_repo(f"  {MARKETING} ").full_name == MARKETING

    def test_a_repo_with_no_briefing_stops_the_run(self):
        # NOT a fallback to omni. Something routed this run deliberately, and
        # pointing it at the monorepo instead would produce a fluent analysis of
        # a codebase the bug is not in — the failure that looks most like work.
        with pytest.raises(UnknownRepoError):
            resolve_repo("thegoodparty/gp-data-platform")

    def test_the_error_names_what_it_would_have_accepted(self):
        with pytest.raises(UnknownRepoError) as caught:
            resolve_repo("thegoodparty/nope")
        assert "thegoodparty/nope" in str(caught.value)
        assert OMNI in str(caught.value)


class TestTheBriefingTheModelReads:
    def test_only_the_target_repo_is_described(self):
        # The whole point of routing. A prompt carrying every repo and trusting
        # the model to choose is the single-repo prompt with extra steps.
        marketing_prompt = build_capability_prompt(MARKETING)
        assert MARKETING in marketing_prompt
        assert "packages/gp-webapp" not in marketing_prompt

        omni_prompt = build_capability_prompt(OMNI)
        assert OMNI in omni_prompt
        assert MARKETING not in omni_prompt

    def test_each_repo_states_the_branch_a_pr_targets(self):
        # gp-marketing's default is `develop`, not `main`. A PR opened against
        # the wrong branch fails at the gh call, after the whole run is paid for.
        assert "`develop`" in build_capability_prompt(MARKETING)
        assert "`main`" in build_capability_prompt(OMNI)

    @pytest.mark.parametrize("repo", sorted(REPO_PROFILES))
    def test_every_repo_names_its_own_branch_in_the_prompt(self, repo):
        prompt = build_capability_prompt(repo)
        assert f"`{REPO_PROFILES[repo].base_branch}` branch" in prompt

    def test_the_omni_prompt_keeps_its_archived_repo_warning(self):
        # The July 2026 incident class: agents cloning read-only repos and
        # burning whole runs. Routing must not have quietly dropped it.
        prompt = build_capability_prompt(OMNI)
        assert "archived" in prompt
        assert "never clone them" in prompt

    def test_the_marketing_prompt_carries_the_package_manager(self):
        # Bun is pinned and CI installs --frozen-lockfile. An agent reaching for
        # npm writes a lockfile that fails CI, after doing all the work.
        prompt = build_capability_prompt(MARKETING)
        assert "bun" in prompt.lower()
        assert "1.2.23" in prompt

    def test_the_marketing_prompt_says_a_green_build_proves_little(self):
        # This repo's defining hazard: a broken block renders as nothing, the
        # error boundary swallows it, and every check passes. An agent that
        # trusts CI here will report a fix that shipped an empty section.
        prompt = build_capability_prompt(MARKETING)
        assert "renders as" in prompt
        assert "Vercel preview" in prompt

    def test_the_marketing_prompt_warns_the_bug_may_not_be_code(self):
        # A large share of reports against the site are Sanity content or
        # election data. Writing code for those is the most expensive wrong
        # answer available, because the PR looks entirely reasonable.
        prompt = build_capability_prompt(MARKETING)
        assert "content-vs-code" in prompt
        assert "sanity.types.ts" in prompt

    def test_the_marketing_prompt_asks_for_submodules(self):
        # ai-rules/ is a submodule and CI runs a check out of it.
        assert "--recurse-submodules" in build_capability_prompt(MARKETING)


def test_the_image_ships_the_bun_the_prompt_promises():
    """A tool the briefing names has to exist in the container.

    The prompt and the Dockerfile are edited by different people for different
    reasons, and nothing else connects them. A briefing that promises a pinned
    `bun` the image does not carry fails deep inside a run, after the clone and
    the reading, as a bare "command not found" — which reads like a repo problem
    rather than an image problem and is expensive to chase from a log.
    """
    dockerfile = (Path(__file__).resolve().parents[1] / "Dockerfile").read_text()

    version = re.search(r"bun@(\d+\.\d+\.\d+)", build_capability_prompt(MARKETING))
    assert version, "the marketing briefing no longer pins a bun version"
    assert f"bun-v{version.group(1)}" in dockerfile
