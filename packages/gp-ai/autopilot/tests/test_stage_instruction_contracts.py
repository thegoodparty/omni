"""Grep-style presence checks for the epic-create/story/qa stage instructions.

A stage instruction is a prompt, not code — there is no behavior here for a
unit test to exercise the way `test_scope_is_mirrored.py` exercises two copies
of the same scope rule. What CAN be pinned is that every load-bearing
directive from the ticket contracts actually made it into the file the agent
reads at runtime (see `agent/main.py::load_stage_instruction`), so a future
edit that drops one is caught here instead of on the next headless run.

Distinctive substrings, not full-sentence matches: pinning exact prose would
make this suite fail on every copyedit. Each assertion names, in its failure
message, the directive it is standing in for.
"""

from pathlib import Path

STAGES_DIR = Path(__file__).resolve().parent.parent / "agent" / "stages"


def _read(stage: str) -> str:
    """The stage file's text, whitespace-normalized (newlines collapsed to
    single spaces, same as feedback._normalize_question). Markdown prose wraps
    at the author's discretion, so a two-word phrase this suite pins can
    legitimately straddle a line break after the next copyedit; matching
    against raw text would make that copyedit fail a presence test for a
    change that didn't touch the directive at all.
    """
    return " ".join((STAGES_DIR / f"{stage}.md").read_text().split())


# ---------------------------------------------------------------------------
# epic-create (ENG-11099)
# ---------------------------------------------------------------------------


def test_epic_create_covers_its_load_bearing_directives():
    text = _read("epic-create")

    assert "TDD" in text, "must discuss the approved TDD as the design source"
    assert "--stage epic-create" in text, "must show the literal park command for a missing TDD link"
    assert "never invent" in text.lower(), "must forbid inventing design the TDD doesn't state"

    assert "AmplitudeFlagClient" in text or "create_feature_flag" in text, "must create the feature flag"
    assert "idempotent" in text.lower(), "must note the flag create is idempotent (never a second flag)"
    assert "flag-wiring story" in text, "must require the first story to be the flag-wiring story"
    assert "no runtime surface" in text, "must state the no-runtime-surface exception to the flag rule"

    assert "subtask" in text.lower(), "must break the TDD into subtasks of the feature card"
    assert "dependency" in text.lower(), "must wire ClickUp dependency links between stories"
    assert "/clickup-epic-create" in text, "must hold stories to the /clickup-epic-create quality bar"

    assert "feedback loop" in text.lower() or "park" in text.lower(), "questions must go through the park primitive"

    assert "breakdown review" in text, "must move the card to breakdown review on handoff"
    assert "never" in text and "executing" in text, "must forbid advancing the card to executing"
    assert "never another card" in text, "ClickUp writes must be scoped to the feature card and its subtasks"


# ---------------------------------------------------------------------------
# story (ENG-11100)
# ---------------------------------------------------------------------------


def test_story_covers_its_load_bearing_directives():
    text = _read("story")

    assert "never touch another ticket" in text, "must scope the run to exactly one ticket"

    assert "fresh branch" in text, "must cut a fresh branch per story"
    assert "AGENTS.md" in text, "must follow the nearest AGENTS.md convention"
    assert "@goodparty_org/contracts" in text, "must route cross-service shapes through contracts"
    assert "*.test.ts" in text and "Vitest" in text, "must name new tests *.test.ts under Vitest"
    assert "gated behind" in text.lower(), "every new runtime path must be gated behind the epic flag"

    assert "verify" in text.lower(), "must run the affected package's verify"
    assert "Never open a PR on a red verify" in text or "never open a pr on a red verify" in text.lower(), (
        "must never open a PR on red"
    )

    # The literal auto-merge commands — gotten wrong repeatedly, so pinned verbatim.
    assert "gh pr merge <n> --auto --merge" in text, "must quote the exact auto-merge command"
    assert "never `--squash`" in text, "must forbid --squash"
    assert "bare `--auto`" in text, "must forbid a bare --auto"
    assert "gh pr view <n> --json autoMergeRequest -q .autoMergeRequest.mergeMethod" in text, (
        "must quote the exact confirmation command"
    )
    assert "MERGE" in text, "must require the confirmation command to print MERGE"

    assert "delegate review" in text, "must re-trigger delegate after every push"
    assert "reviewDecision" in text, "must check reviewDecision before pushing more"
    assert "approved and auto-merge armed" in text, "exit condition is approved + armed, not merely opened"

    assert "wait for the merge" in text.lower(), "must wait for the merge, not the dev deploy"
    assert "move" in text.lower() and "`qa`" in text, "must move the ticket to qa once merged"
    assert "merge_pending" in text, "must end cleanly with a merge_pending outcome on deadline"

    # The flag-wiring story must hand qa its override mechanism some other way
    # than the epic breakdown summary, which predates every story and so can
    # never carry it (a real cross-file bug a prior review round caught).
    assert "post a comment" in text.lower(), "the flag-wiring story must post its override mechanism to the epic"
    assert "cannot carry this" in text, "must explain why the breakdown summary can't carry the override mechanism"


# ---------------------------------------------------------------------------
# qa (ENG-11101)
# ---------------------------------------------------------------------------


def test_qa_covers_its_load_bearing_directives():
    text = _read("qa")

    assert "wait and retry" in text.lower(), "must wait-and-retry rather than fail on a not-yet-deployed commit"
    assert "deploy_pending" in text, "must end cleanly with a deploy_pending outcome if the deploy wait times out"

    assert "Clerk sign-in ticket" in text, "must log in via a redeemed Clerk sign-in ticket"
    assert "Never put credentials" in text or "never put credentials" in text.lower(), (
        "must forbid credentials in prompts"
    )

    assert "Playwright MCP" in text, "flag-on validation must use the Playwright MCP browser"
    assert "one screenshot" in text.lower(), "must take one screenshot per acceptance criterion"

    assert "Flag-off" in text or "flag-off" in text.lower(), "must run the flag-off parity smoke"
    assert "don't assume" in text.lower(), "must read the flag override mechanism rather than assume one"
    assert "follow-up comment" in text.lower(), (
        "must read the flag-wiring story's own follow-up comment, not just the breakdown summary"
    )

    assert "numbered findings comment" in text.lower(), "failures must file a numbered findings comment"
    assert "attach" in text.lower() and "ClickUp attachment API" in text, "screenshots must attach via the ClickUp API"
    assert "move the ticket back to `in progress`" in text, "a failing run must reopen the ticket"
    assert "move the ticket to `done`" in text, "a passing run must close the ticket"

    assert "never edits code" in text, "must stay read-only against the app"
