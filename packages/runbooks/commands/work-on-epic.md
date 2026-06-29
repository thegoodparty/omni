<!-- v2 — 2026-06-17 -->
# /work-on-epic

Take a ClickUp Epic, derive a dependency-aware execution plan across its subtasks,
then drive each ticket through implement → PR → merge → done — in parallel where
it's safe and phased where it isn't — looping until the whole Epic is closed, and
finishing with a Playwright pass over the behavior the Epic delivered.

Runs in one of two modes, chosen up front (Phase 0): **controlled** (recommended —
checks in with you per ticket and lets you merge each PR) or **automated** (one
plan approval, then unattended with auto-merge). See "## Run modes".

This is the Epic-level counterpart to `commands/work-on-clickup.md`. That command
works **one** ticket interactively; this one orchestrates the **whole** Epic,
reusing the work-on-clickup flow per ticket (auto-`go` in automated mode) and the
repo's PR-shipping flow per branch. For a single ticket, use `/work-on-clickup`
directly.

<!-- BEGIN: resolve-runbooks-dir (keep in sync across commands/*.md) -->
> **Where this runs:** All paths below (`scripts/python/...`, `books/.env`, `scripts/.env`) are relative to the runbooks repo root. When invoked from any directory, first resolve and `cd` into the repo:
>
> 1. If `$RUNBOOKS_DIR` is set, use it.
> 2. Else first that exists: `$HOME/Documents/gp/dev/runbooks`, `$HOME/code/runbooks`, `$HOME/runbooks`.
> 3. Else ask the user where the runbooks repo is; suggest `export RUNBOOKS_DIR=<path>` in their shell profile.
<!-- END: resolve-runbooks-dir -->

## Prerequisites

**books/.env variables**: `$CLICKUP_PLANS_DIR`
**scripts/.env variables**: `CLICKUP_API_KEY`
**Tools**: `uv` (for Python scripts), `git` (worktrees), `gh` (PR + auto-merge), the Playwright MCP server (for Phase 4)

Defaults if a `books/.env` value is unset: `$CLICKUP_PLANS_DIR=$HOME/.claude/plans`.

**Never** echo, log, or write `CLICKUP_API_KEY` into any output file.

This command operates on a working repo (the codebase the Epic's tickets touch).
It assumes that repo uses the standard GoodParty flow: a per-package "Verify"
section in its `CLAUDE.md`, a PR-shipping skill (`ship-pr` in omni — drives the
delegate-reviewer bot to `Approved.` and the E2E check to green), and PRs that
target the repo's integration branch (`develop` in omni). Outside that setup, the
PR step degrades to `gh pr create` + the repo's normal review process.

## Run modes

The mode is chosen before any work starts (Phase 0, step 0) and governs how often
the loop pauses for the user and whether merges are automatic. Recommend
**controlled**.

- **Controlled (recommended).** The loop stays in a dialog with the user. Both
  modes share the Phase 2 plan-approval gate; on top of that, controlled mode
  checks in per ticket — it surfaces the recommended implementation approach and
  waits for the user to reply **`go`** before implementing, rather than
  auto-picking the recommended path. PRs are driven to green (delegate `Approved.`
  + E2E) but **not merged by the bot** — the user merges each PR themselves, and
  the loop resumes after each merge. Use this when tickets are loosely specified,
  exploratory, or high-stakes, so a human stays in the decision loop.

- **Automated.** What the loop does today: a single plan-approval gate (Phase 2),
  then it runs unattended — subagents take the recommended implementation without
  pausing, and each PR merges itself via GitHub auto-merge the moment delegate +
  E2E are green. Only genuine blockers stop it.

  > ⚠️ **Automated mode only works well when every ticket is very well defined.**
  > The loop picks the recommended implementation and merges without any human
  > review of the approach. If a ticket's acceptance criteria, scope, or
  > "Files to touch" are vague, the loop can implement the wrong thing and
  > auto-merge it. Use automated mode only for an Epic whose tickets are crisp and
  > self-contained; otherwise choose controlled.

## Operating principles

- **Confirmation gates depend on the mode (see "## Run modes").** Both modes share
  the single Phase 2 plan-approval gate. In **automated** mode that is the only
  gate — after `go` the loop runs unattended; go with the recommended plan when
  it's clearly better and don't re-ask per ticket. In **controlled** mode the loop
  additionally asks for `go` before implementing each ticket (step 11) and the
  user merges each PR by hand (step 12). Name the ticket at every gate.
- **Always name the ticket.** Every status line, question, or blocker you surface
  to the user must lead with the ticket's `name` + ID — the user is tracking many
  tickets at once and has no context otherwise.
- **Blockers isolate, they don't stall.** A ticket that can't proceed (failed
  verify the subagent can't fix, an escalated delegate finding, a stuck PR) pauses
  **that** branch and surfaces to the user by name. Other in-flight tickets keep
  going.
- **Follow the repo's rules.** Each subagent loads and obeys the working repo's
  conventions (`.cursor/rules/`, `CLAUDE.md`, `ai-rules/`) exactly as
  `work-on-clickup` step 7 does. No scope creep — new ideas go in a ticket's
  `Notes / Gotchas`, not into the PR.

## Steps

User input may be passed as a ClickUp **Epic** task ID, a full URL
(`https://app.clickup.com/t/abc123`), or empty (will prompt). Treat that input as
`$ARGUMENTS` below.

### Phase 0: Choose the run mode

0. **Ask the user which run mode to use — before doing anything else.** Present
   the two modes from "## Run modes" and recommend **controlled**:

   > How should I run this Epic?
   > • **`controlled`** (recommended) — I check in with you per ticket: I'll
   >   surface the recommended approach and wait for your `go` before
   >   implementing, and you merge each PR yourself.
   > • **`automated`** — one plan approval, then I run unattended and auto-merge
   >   each PR on green. ⚠️ Only works well if every ticket is very well defined;
   >   a vague ticket can get the wrong implementation shipped and auto-merged.

   Wait for the user to choose; default to **controlled** if they don't specify.
   Record the chosen mode — it governs the approval prompt in Phase 2, the
   per-ticket check-in in Phase 3 (step 11), and the merge policy (step 12).

### Phase 1: Load and map the Epic

1. **Parse the Epic ID** from `$ARGUMENTS` (raw ID or full URL). If missing, ask:
   "Which ClickUp Epic? (paste an ID or URL)".

2. **Fetch the Epic** and confirm it really is an Epic (a parent task with
   subtasks), not a leaf ticket:
   ```bash
   cd scripts/python && uv run clickup_api.py GET task/$EPIC_ID include_markdown_description=true subtasks=true
   ```
   If the task has a `parent` and no subtasks, it's a leaf — tell the user and
   suggest `/work-on-clickup <id>` instead. Capture the Epic `name`, `list.id`,
   and `subtasks`.

3. **Fetch every subtask in full**, with its dependencies and status. For each
   subtask ID from step 2:
   ```bash
   cd scripts/python && uv run clickup_api.py GET task/<subtask_id> include_markdown_description=true
   ```
   Capture per subtask: `name`, `status.status`, `priority`, `markdown_description`,
   `.dependencies` (the array of `{ depends_on, type }`), and `tags`.

   **Skip milestone-marker tasks** (`name` begins `Milestone:` and/or the task is
   only a roll-up depending on the real work). They are tracking objects, not work.

4. **Load the local Epic plan**, if present, at
   `$CLICKUP_PLANS_DIR/<EPIC_ID>-plan.md`. Its `## Dependency Graph` and
   `## Architecture Notes` sections often hold ordering and parallelization the
   individual tickets don't. If no plan exists, proceed without it but note that to
   the user — the dependency graph will be derived in Phase 2.

5. **Print an Epic brief** to the user:
   ```
   Epic: <epic name>  (<EPIC_ID>)
   List: <list name>
   Plan loaded? <yes from $CLICKUP_PLANS_DIR/<EPIC_ID>-plan.md | no — will derive>

   Subtasks (<N> work tickets, excluding milestones):
     <id>  <status>  <name>   deps: [<dep ids or none>]
     ...
   Already done: <count of subtasks in a closed/done status — these are skipped>
   ```

### Phase 2: Build the execution plan (the plan-approval gate)

6. **Determine the dependency graph.** Source of truth, in order:
   - The API `.dependencies[].depends_on` edges captured in step 3 (authoritative —
     frontmatter is stripped before tasks are POSTed, so the ClickUp body won't show
     a `dependencies:` block).
   - The loaded plan's `## Dependency Graph`, as corroboration.

   **If explicit dependencies exist, use them.** Topologically order the tickets
   into phases: phase 1 is everything with no open (not-yet-done) dependency; each
   later phase unlocks once its prerequisites close. Within a phase, all tickets are
   parallel-safe by definition.

7. **If no dependencies exist**, derive a plan. Read each ticket's
   `## Implementation Details` (the "Files to touch" list especially) and group:
   - **Parallel-safe** — tickets touching disjoint files/modules with no
     producer→consumer relationship.
   - **Sequential** — tickets that share files, or where one defines a contract
     (schema, endpoint, type in a shared module) another consumes. The consumer
     waits for the producer.

   Default heuristics: shared migration files, a shared contract/type, or the same
   service file edited two ways ⇒ sequence them; otherwise parallelize. When the
   call is genuinely ambiguous, prefer the safer (sequential) ordering and say why.

8. **Present the execution plan for the single approval.** Label every ticket by
   name + ID:
   ```
   Execution plan for "<epic name>":

   Phase 1 (parallel — N tickets):
     - <id>  <name>
     - <id>  <name>
   Phase 2 (after Phase 1; parallel — M tickets):
     - <id>  <name>   (waits on: <id> <name>)
   ...

   Source: <explicit ClickUp dependencies | derived from file overlap — see notes>
   Mode: <controlled | automated>
   Merge policy: <controlled: drive each PR to green, then you merge it |
     automated: GitHub auto-merge once delegate=Approved + E2E green, then poll>
   ```

   Ask for one approval:

   > Approve this plan? Reply **`go`**, or tell me what to reorder / re-group.
   > In **automated** mode, after `go` I run the whole Epic unattended and only
   > stop for genuine blockers (always named by ticket). In **controlled** mode,
   > after `go` I start Phase 1 but check in with you per ticket before
   > implementing and let you merge each PR.

   Wait for `go` (or edits → revise and re-present). Do not start work before
   approval. If the user edits, apply and re-show the plan.

9. **Persist the approved plan** into the local Epic plan file (create it from the
   `clickup-epic-create` plan shape if it didn't exist). Record the phase grouping
   and a per-ticket status table the loop will update as it runs. Bump
   `lastEdited:`.

### Phase 3: Run the loop

Process the plan phase by phase. **Within a phase, work tickets in parallel; do not
advance to the next phase until the current phase's tickets are all merged + done.**

For each ticket in the current phase (skip any already in a closed/done status):

10. **Create an isolated git worktree** for the ticket, off the repo's integration
    branch, on a fresh branch named from the ticket (e.g.
    `eng-<id>-<short-slug>`):
    ```bash
    git -C "<repo path>" worktree add "<worktrees dir>/<branch>" -b "<branch>" origin/<integration-branch>
    ```
    Then run that package's worktree setup as documented in its `CLAUDE.md` (e.g.
    in omni: `npm run generate` + a contracts build for gp-api; a `node_modules`
    symlink for gp-webapp). A fresh worktree that skips this fails to resolve types
    or parse tests. Work **inside the worktree path** for everything below — editing
    via the original repo's absolute paths writes outside the worktree and tests the
    wrong tree.

11. **Controlled mode — check in before implementing.** Before dispatching the
    phase's subagents, post the recommended implementation approach for each ticket
    in the phase (named by ticket + ID: the files it will touch and the approach it
    will take) and wait for the user's **`go`**. If the user redirects, fold that
    into the subagent's instructions. In **automated** mode, skip this gate and
    dispatch straight away with the recommended approach.

    **Dispatch a subagent per ticket** (one per parallel ticket in the phase) to do
    the implementation. Give each subagent:
    - The ticket ID, name, and full body.
    - The worktree path it must work in.
    - The instruction: **run the `work-on-clickup` flow in auto-`go` mode** —
      load repo conventions (its step 7), seed todos from the AC, implement, run the
      package's Verify, then run its review loop (`gp-reviewer` over the diff, fixing
      `blocker`/`major` findings) and walk the AC as a checklist. Skip the interactive
      scope-confirm gate (the user already approved the Epic plan). Stay in scope.
    - **Pass `--no-ui`.** `work-on-clickup` auto-starts a dev server for its
      `gp-ui-tester` pass, and parallel tickets on the same host would bind the same
      port and clash. Epic-level UI coverage is already handled once by Phase 4's
      Playwright pass over the delivered behavior, so per-ticket UI testing is both
      redundant and unsafe here. (Other `work-on-clickup` knobs — `--max-iter=N`,
      `--no-loop` — can be tuned per Epic if a phase warrants it.)
    - On a gap the ticket body doesn't cover, or a Verify failure it can't resolve,
      the subagent **returns the blocker** (with evidence) rather than guessing —
      the loop surfaces it to the user named by ticket.

    Dispatch the phase's subagents concurrently (in one batch) so they run in
    parallel. Each subagent's worktree isolates its file changes.

12. **When a subagent reports its ticket implemented + Verify green**, open and
    drive its PR via the repo's **PR-shipping flow** (the `ship-pr` skill in omni:
    open the PR, drive `delegate-reviewer[bot]` to `Approved.`, and the `E2E` check
    to green). Then merge per the chosen mode:
    - **Automated:** **enable GitHub auto-merge** so the PR merges itself the
      moment both gates pass:
      ```bash
      gh pr merge <pr-number> --squash --auto
      ```
    - **Controlled:** do **not** auto-merge. Once both gates are green, hand the PR
      to the user named by ticket ("<id> <name>: PR <link> is Approved + E2E green
      and ready to merge") and wait for them to merge it themselves. Do not run
      `gh pr merge`. The loop resumes (step 13) once the user has merged.

    Post a progress comment on the ticket linking the PR (build the comment payload
    via a Python temp `.json` file — never template text into a JSON literal):
    ```bash
    cd scripts/python && uv run clickup_api.py POST task/<ticket_id>/comment @/tmp/comment.json
    # /tmp/comment.json: {"comment_text": "<text incl. PR link>", "notify_all": false}
    ```
    Mark the ticket **in-flight** in the local Epic plan.

13. **Poll the in-flight PRs** until each merges. In **automated** mode auto-merge
    fires once delegate + E2E are green at the same HEAD; in **controlled** mode the
    PR merges when the user merges it (after the hand-off in step 12). Use
    `gh pr view <n> --json state,mergedAt` / `gh pr checks <n>`. Polling cadence
    ~60–90s; budget generously — E2E waits on a deploy. As **each** PR reaches
    `MERGED`:
    - **Move its ticket to `done`** (status names are List-scoped; if `done` is
      rejected, `GET list/<list_id>` and pick the closest closed status):
      ```bash
      cd scripts/python && uv run clickup_api.py PUT task/<ticket_id> @/tmp/status.json
      # /tmp/status.json: {"status": "done"}
      ```
    - **Tick the AC** in the ticket description if it tracks them, and post a short
      completion comment.
    - **Update the local Epic plan**: mark the ticket complete, note any deviation
      from plan honestly ("did X instead of Y because Z"), resolve/adjust the plan's
      Open Questions, bump `lastEdited:`.
    - **Pull the integration branch into the still-open worktrees** (both modes).
      A merge advances `develop`; refresh it locally and merge it into every
      still-in-flight ticket's branch so later PRs build on the latest and
      conflicts surface early instead of at merge time:
      ```bash
      git -C "<repo path>" fetch origin <integration-branch>
      # for each still-in-flight worktree:
      git -C "<that worktree path>" merge origin/<integration-branch>
      ```
      If a merge hits conflicts the subagent can't cleanly resolve, surface that
      branch as a blocker named by ticket; other branches keep going.
    - **Remove the worktree and branch** now that it's merged:
      ```bash
      git -C "<repo path>" worktree remove "<worktrees dir>/<branch>" && \
        git -C "<repo path>" branch -D "<branch>" 2>/dev/null || true
      ```

14. **Advance phases.** Once every ticket in the current phase is `done`,
    recompute which tickets are now unblocked (all their dependencies closed) and
    start the next phase at step 10. A ticket left **blocked** in a phase doesn't
    block unrelated later tickets, but anything that depends on it waits; surface
    the chain to the user by name.

15. **Loop until the Epic is complete** — every non-milestone subtask is in a
    closed/done status. Then close out any milestone-marker tasks whose work tickets
    are all done (their roll-up dependencies are satisfied), and proceed to Phase 4.

### Phase 4: Epic-level Playwright pass

16. **Exercise the delivered behavior against the local dev app.** Bring up the
    local web app (omni: gp-webapp on `localhost:4000`, plus the APIs it needs per
    `docs/development.md`). Confirm it's serving before driving the browser.

17. **Derive the test path from the Epic's AC.** Collect the acceptance criteria
    across the merged subtasks into the end-to-end user journey the Epic delivers.
    Drive it via the **Playwright MCP** (`browser_navigate`, `browser_snapshot`,
    `browser_click`, `browser_fill_form`, `browser_wait_for`, etc.). **Register test
    users as needed** — create a fresh account through the real signup flow rather
    than assuming seeded state.

18. **Report Playwright results**: each AC-derived scenario with pass/fail and
    evidence (a snapshot or the asserted state). For any failure, capture the
    repro + console/network detail and surface it named by the ticket whose AC it
    maps to — don't silently pass over a red flow.

### Phase 5: Final report

19. **Summarize the run:**
    - Epic: `<name>` — `<EPIC_ID>` — link, and final state (all done / partial).
    - Per ticket: `<id>` `<name>` → PR link, merged ✓/blocked, final status.
    - Local Epic plan: path, updated.
    - Worktrees: confirmed removed (list any left behind on purpose for a blocked
      ticket).
    - Playwright: scenarios run + pass/fail with evidence.
    - **Blocked / needs you**: each open item named by ticket, with the specific
      decision or fix required.

## Important Notes

- **Pick the mode first.** Phase 0 (step 0) asks the user for controlled vs
  automated before any work. Default to controlled; only run automated when the
  user confirms the Epic's tickets are all very well defined.
- **Gates depend on the mode.** In **automated** mode the Phase 2 plan approval is
  the single interactive checkpoint — after `go`, don't re-ask per ticket; surface
  only genuine blockers, each named by ticket. In **controlled** mode you also
  check in for `go` before implementing each ticket (step 11) and the user merges
  each PR by hand (step 12).
- **Merging is mode-specific.** In **automated** mode use GitHub auto-merge
  (step 12) and let it fire on green; the loop polls for the `MERGED` state. Don't
  merge by hand in automated mode — it races the checks. In **controlled** mode the
  bot never merges: it drives the PR to delegate `Approved.` + E2E green, hands it
  to the user, and continues once the user has merged.
- **Pull the integration branch after every merge** (both modes). Once a PR merges,
  refresh local `develop` and merge it into the still-open worktree branches
  (step 13) so later tickets build on the latest and conflicts surface early.
- **Move to `done` only after merge.** A PR being approved is not done — the ticket
  moves to `done` only once its branch has actually merged (step 13).
- **Clear worktrees only after merge.** Removing a worktree before merge throws away
  unmerged work. Keep a blocked ticket's worktree until it's resolved.
- **Use `include_markdown_description=true`** when reading task bodies; plain
  `description` returns HTML.
- **JSON safety.** Build every ClickUp payload (comments, status) via a Python temp
  `.json` file passed as `@file.json`. Never template user-supplied text into a JSON
  literal — bodies contain quotes, newlines, and backticks.
- **Secrets.** Never read `scripts/.env`; never echo, log, or write `CLICKUP_API_KEY`
  into any file.
- **Portability.** This command references the sibling `work-on-clickup` flow and the
  repo's PR-shipping skill by role, not by hardcoded path, so it works wherever the
  runbooks repo is cloned. The Verify/worktree-setup specifics come from the working
  repo's own `CLAUDE.md`, not from here.

## Troubleshooting

| Failure | Fix |
|---------|-----|
| The task passed in is a leaf, not an Epic | It has a `parent` and no subtasks. Run `/work-on-clickup <id>` for a single ticket instead. |
| Two "parallel" tickets keep producing merge conflicts | They share files — the derived graph was wrong. Re-sequence them into separate phases (consumer after producer) and continue. |
| A subagent's Verify fails on something pre-existing on the integration branch | Not caused by this ticket. Surface it named by ticket; let the user decide to fix-now or proceed, same as the PR-shipping pre-flight escape hatch. |
| Auto-merge never fires (automated mode) | Delegate isn't `Approved.` or E2E isn't green at HEAD. Drive the PR-shipping flow to converge both gates; auto-merge fires only when both are green at the same commit. |
| Controlled mode: a PR is green but the loop is waiting | By design — in controlled mode you merge each PR yourself. Merge it; the loop resumes at step 13 once it sees `MERGED`. |
| `merge origin/<integration-branch>` into an open worktree conflicts | Expected when two in-flight branches touched the same files. Resolve in that worktree (or let its subagent), then continue; surface as a blocker named by ticket only if it can't be cleanly resolved. |
| `done` status rejected on the ticket's List | Status names are List-scoped. `GET list/<list_id>`, pick the closest closed status, retry. |
| Worktree `add` fails: branch already exists | A prior run left it. `git worktree list` / `git branch`, remove the stale worktree + branch, retry. |
| Playwright can't reach `localhost:4000` | The local web app isn't up. Start it (and the APIs it needs) per the working repo's `docs/development.md` before Phase 4. |
| Loop runs very long | Expected — it waits on real merges and deploys (E2E waits on a gp-api deploy). It's not stuck unless a PR's gates have stalled; check `gh pr checks <n>`. |
