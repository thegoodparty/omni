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

    # ENG-11152: the flag-cleanup ramp sweep parses this exact line back out
    # of the breakdown summary comment at epic close-out — a key only named
    # in prose can't be picked up automatically.
    assert "flag-key: <key>" in text, "must require the machine-readable `flag-key: <key>` line in the summary comment"

    assert "`feedback needed`" in text, "must move the card to feedback needed on handoff (breakdown review column)"
    assert "feedback notify" in text, (
        "must ping Slack on handoff via the notify primitive — the TDD promises every card "
        "arriving in feedback needed pings #autopilot, park and finished breakdown alike"
    )
    assert "--stage epic-create" in text.split("feedback notify", 1)[1], (
        "the notify command must be shown with its own stage, not left for the model to infer"
    )
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
    # The exact trigger form is load-bearing: a live PR stalled for hours on
    # "/delegate review" comments the reviewer never answered.
    assert "no leading slash" in text, "must pin the exact trigger form — slash-prefixed triggers are silently dead"
    assert "reviewDecision" in text, "must check reviewDecision before pushing more"
    assert "approved and auto-merge armed" in text, "exit condition is approved + armed, not merely opened"

    # ENG-11147: the run ends at approved+armed, verified directly rather than
    # assumed — it must never wait out the merge itself (that idle Fargate
    # time moved to the free conductor sweep).
    assert "gh pr view <n> --json autoMergeRequest,reviewDecision" in text, (
        "must quote the exact command that verifies the gate before parking"
    )
    assert "reviewDecision` must read `APPROVED`" in text, "must require reviewDecision APPROVED, not just armed"
    assert "never wait for the merge" in text.lower(), "must forbid waiting out the merge in this run"

    # The same run shipped past a verify that errored out before typechecking
    # (broken worktree install) — an unrunnable verify must read as red.
    assert "cannot run counts as red" in text, "a verify that cannot run must count as red, not as skipped"

    # A deadline-exceeded run must PARK (marker + status move + Slack ping),
    # not just end cleanly — an unparked run leaves nothing for `parked-stage`
    # to find and nothing to trigger a resume (a real cross-file bug a prior
    # review round caught: the earlier draft promised a bespoke `merge_pending`
    # metric outcome the park machinery does not produce).
    assert "--stage story" in text, "the deadline-exceeded path must park via the CLI, not just end the run"
    assert "merge pending" in text.lower(), "the parking comment's status note must say the merge is pending"
    assert "feedback_parked" in text, "must report the outcome the park primitive actually stamps, honestly"

    # The flag-wiring story must hand qa its override mechanism some other way
    # than the epic breakdown summary, which predates every story and so can
    # never carry it (a real cross-file bug a prior review round caught).
    assert "post a comment" in text.lower(), "the flag-wiring story must post its override mechanism to the epic"
    assert "cannot carry this" in text, "must explain why the breakdown summary can't carry the override mechanism"

    # EPIC_TASK_ID isn't always threaded through by the dispatcher yet (a
    # cross-file gap a prior review round caught) — the story must derive it
    # from the ticket's ClickUp parent rather than treat empty as "no epic."
    assert "derive it yourself" in text.lower(), (
        "must derive the epic from the ticket's parent when EPIC_TASK_ID is unset"
    )
    assert "`parent` field" in text, "must name the ClickUp `parent` field as the derivation source"


# ---------------------------------------------------------------------------
# qa (ENG-11101)
# ---------------------------------------------------------------------------


def test_qa_covers_its_load_bearing_directives():
    text = _read("qa")

    assert "wait and retry" in text.lower(), "must wait-and-retry rather than fail on a not-yet-deployed commit"

    # Same park-not-just-end fix as story.md's merge wait, and for the same
    # reason: a deadline-exceeded run needs a marker + status move + Slack
    # ping, not a bare exit, and must not promise an outcome the park
    # machinery doesn't produce.
    assert "--stage qa" in text, "the deadline-exceeded path must park via the CLI, not just end the run"
    assert "deploy pending" in text.lower(), "the parking comment's status note must say the deploy is pending"
    assert "feedback_parked" in text, "must report the outcome the park primitive actually stamps, honestly"

    # EPIC_TASK_ID isn't always threaded through by the dispatcher yet — qa
    # must derive it from the story ticket's ClickUp parent rather than treat
    # empty as "no epic" (same cross-file gap as story.md).
    assert "derive it yourself" in text.lower(), (
        "must derive the epic from the ticket's parent when EPIC_TASK_ID is unset"
    )
    assert "`parent` field" in text, "must name the ClickUp `parent` field as the derivation source"

    # The stage provisions its own fixture user; the container carries only a
    # Clerk machine secret, never the dev instance secret key, and Clerk caps
    # M2M token TTLs so the token must be minted per run, not stored.
    assert "AUTOPILOT_MACHINE_SECRET" in text, "must mint the M2M token from the machine secret env var"
    assert "test-fixtures/users" in text, "must provision the QA user via gp-api's test-fixtures API"
    assert "GP_API_DEV_BASE_URL" in text, "fixtures calls must target the wired dev API base URL"
    assert "signInToken" in text, "must log in by redeeming the fixture's single-use sign-in token"
    assert "userIds" in text, "must clean up its fixture users before ending the run"
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
    # A failing run parks (marker + feedback needed + Slack). It must NOT
    # move the story to `in progress`: no conductor route matches
    # qa -> in progress, so that status is a dead end only the stall alert
    # would ever notice — the first live QA fail sat there until the
    # stranded-run guard rescued it.
    # "QA failed" is unique to the fail-park block ("--stage qa" alone would
    # be satisfied by section 1's deploy-pending park).
    assert "QA failed" in text, "a failing run must park via the feedback primitive"
    assert "Never move the ticket to `in progress` yourself" in text, "must forbid the dead-end in-progress reopen"

    # The fail-park question promises the human that a reply OR a drag
    # re-verifies; resume.md's QA-failed carve-out must uphold both halves.
    resume_text = _read("resume")
    assert '"QA failed"' in resume_text, "resume must carve QA-failed parks out of the status-note shortcut"
    assert "never auto-resolve" in resume_text.lower(), "a QA-failed park must not be auto-resolved by the deploy check"
    assert "re-run the QA walk" in resume_text, (
        "a human-initiated resume of a QA-failed park re-verifies — the human was promised a drag suffices"
    )
    assert "move the ticket to `done`" in text, "a passing run must close the ticket"

    assert "never edits code" in text, "must stay read-only against the app"


# ---------------------------------------------------------------------------
# resume — the status-note park case (fixed alongside ENG-11100/11101)
# ---------------------------------------------------------------------------


def test_resume_handles_a_status_note_park_without_waiting_for_a_reply():
    text = _read("resume")

    assert "not a question to answer" in text.lower(), "must distinguish a status-note park from a real question"
    assert "merge pending" in text.lower(), "must name the merge-pending status note story.md parks with"
    assert "deploy pending" in text.lower(), "must name the deploy-pending status note qa.md parks with"
    assert "condition itself has resolved" in text.lower(), (
        "resume must check the real condition (merge landed / deploy landed), not wait for a reply"
    )
    assert "remaining handoff steps" in text.lower(), (
        "a resolved status-note park must continue the stage's handoff, not wait on the thread"
    )
