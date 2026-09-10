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
    def test_every_repo_is_described_so_a_cause_can_be_chased_across_repos(self):
        """This reverses the rule that only the routed repo was described.

        That rule was meant to stop the model working confidently in the wrong
        codebase. It stopped the wrong thing: a bug is reported by symptom, and
        a symptom does not know which repo produced it, so the model gave up on
        exactly the tickets where finding the cause WAS the job. The boundary
        now applies to writes. See the PR-target tests below for the half that
        still holds.
        """
        marketing_prompt = build_capability_prompt(MARKETING)
        assert MARKETING in marketing_prompt
        assert "gp-webapp" in marketing_prompt, "omni's layout has to be readable from a marketing run"

        omni_prompt = build_capability_prompt(OMNI)
        assert OMNI in omni_prompt
        assert MARKETING in omni_prompt

    @pytest.mark.parametrize("repo", sorted(REPO_PROFILES))
    def test_only_the_routed_repo_may_receive_a_pr(self, repo):
        # The half of the old rule that survives, and now the only thing
        # separating "read everything" from "write anywhere". Every other repo
        # is explicitly marked as read-only for this run.
        prompt = build_capability_prompt(repo)

        assert "Any PR you open goes there" in prompt
        assert "Read anywhere, write in one place" in prompt
        assert "Do not open a PR in one" in prompt

    @pytest.mark.parametrize("repo", sorted(REPO_PROFILES))
    def test_the_routed_repo_is_named_unambiguously(self, repo):
        # With every briefing present, "which one am I allowed to push to?" is
        # answerable only if the routed repo is stated as such. Naming it once
        # among N briefings is not enough.
        prompt = build_capability_prompt(repo)

        assert f"This run is about **{repo}**" in prompt

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

    def test_a_refused_clone_does_not_end_a_marketing_analysis(self):
        # The App is installed org-wide with write to code and pull requests, so
        # a refused clone here means a broken token, not a repo the bot is not
        # allowed in. Either way the repo is public and readable, and an analysis
        # that stops at a credential error costs a human the whole investigation
        # for a repo anyone can already read.
        prompt = build_capability_prompt(MARKETING)
        assert "https://github.com/thegoodparty/gp-marketing.git" in prompt
        assert "public" in prompt
        # Read-only is the fallback's limit, and the model has to be told: a
        # branch pushed from an unauthenticated clone fails, and silently
        # retrying it burns the run instead of asking for the token to be fixed.
        assert "cannot push" in prompt


class TestBeingPointedAtTheWrongRepo:
    """Routing is a guess made from the ClickUp list, and the list can be wrong.

    Growth-Bugs, which routes to gp-marketing, held exactly one real ticket when
    routing shipped: a weekly-digest EMAIL with bad formatting and wrong dates.
    That is gp-api code, in omni. One for one, the routing key mis-routed.

    So the guess has to be able to fail loudly. Every briefing must tell the
    model to stop and hand back rather than hunt for something local to change,
    because a fluent fix in the wrong codebase is the failure that costs most:
    it survives review by looking like work.
    """

    @pytest.mark.parametrize("repo", sorted(REPO_PROFILES))
    def test_every_repo_is_told_its_routing_was_a_guess(self, repo):
        prompt = build_capability_prompt(repo)

        assert "good guess, not a fact" in prompt

    @pytest.mark.parametrize("repo", sorted(REPO_PROFILES))
    def test_the_way_out_is_to_name_the_repo_not_to_stop(self, repo):
        # This replaced "say so and stop". Stopping was a dead end: it handed a
        # human an investigation to start over. GPBOT-REPO is machine-read and
        # points the implementation run at the repo it names, so naming the
        # right repo is what makes the redirect actually happen.
        prompt = build_capability_prompt(repo)

        assert "GPBOT-REPO" in prompt
        assert "follow the cause wherever it goes" in prompt.lower()

    @pytest.mark.parametrize("repo", sorted(REPO_PROFILES))
    def test_a_fix_needing_two_repos_is_handed_back(self, repo):
        # One run opens one PR. A defect that genuinely needs coordinated
        # changes in two repos cannot be delivered by this pipeline at all, so
        # the honest answer is the verdict that asks for a person.
        prompt = build_capability_prompt(repo)

        assert "spans two repos" in prompt
        assert "needs-human" in prompt


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
