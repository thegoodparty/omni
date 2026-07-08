<!-- v3 — 2026-06-28 -->
# /work-on-clickup

Pull a ClickUp task (typically one created by `/clickup-epic-create`), load its Epic-level plan, set up a focused working context, then implement it yourself while two read-only subagents give it the review the implementer can't give itself: `gp-reviewer` (an independent senior review of the diff that **mirrors the `delegate-reviewer` bot's blocker bar** — across correctness, security, tests, conventions, ai-rules, cross-file, and thematic — so its blockers are the ones delegate would post and delegate passes on the first try) and, for UI work, `gp-ui-tester` (drives a real browser via the Playwright MCP). You implement and fix in your own context; the reviewers critique the cumulative diff in parallel; you loop on their blocking findings until the work converges or hits a small iteration cap. Same safety nets as before — scope confirmation, todo list seeded from acceptance criteria, AC walk before "done".

<!-- BEGIN: resolve-runbooks-dir (keep in sync across commands/*.md) -->
> **Where this runs:** Runbooks lives in the `omni` monorepo at `packages/runbooks`. All paths below (`scripts/python/...`, `books/.env`, `scripts/.env`) are relative to that package root. When invoked from any directory, first resolve and `cd` into it:
>
> 1. If `$RUNBOOKS_DIR` is set, use it.
> 2. Else first that exists: `$HOME/Documents/gp/dev/omni/packages/runbooks`, `$HOME/code/omni/packages/runbooks`, `$HOME/omni/packages/runbooks`.
> 3. Else ask the user where the omni repo is (the runbooks package is at `<omni>/packages/runbooks`); suggest `export RUNBOOKS_DIR=<omni>/packages/runbooks` in their shell profile.
<!-- END: resolve-runbooks-dir -->

## Prerequisites

**books/.env variables**: `$CLICKUP_PLANS_DIR`
**scripts/.env variables**: `CLICKUP_API_KEY`
**Tools**: `uv` (for Python scripts), `git` (for baseline + diff capture between review rounds)
**Subagents**: `gp-reviewer`, `gp-ui-tester` — defined in this repo under `agents/` and installed into your Claude Code agents dir by `./install.sh` (it installs `agents/` alongside `commands/`). If you added these for the first time, **re-run `./install.sh` and restart the session** so the subagents resolve by name. Both degrade gracefully: if `gp-reviewer` isn't installed, do the review inline and note it; if `gp-ui-tester` isn't installed, fall back to manual UI steps. You (the orchestrator) always do the implementation yourself — there is no separate coder subagent.
**MCP**: the Playwright MCP server must be connected for `gp-ui-tester` to verify UI tasks (its allowlist already names the `mcp__playwright__*` tools). If it isn't connected, UI verification falls back to "manual steps for the user to run", flagged in the report.

Defaults if a `books/.env` value is unset: `$CLICKUP_PLANS_DIR=$HOME/.claude/plans`.

**Knobs** (overridable in `$ARGUMENTS`, e.g. `abc123 --max-iter=1 --no-ui`):
- `--max-iter=N` — review/fix loop cap. Default **2**.
- `--no-loop` — one review round, no fix iterations (review findings are surfaced, not auto-looped). Good for trivial tasks.
- `--no-ui` / `--ui` — force the UI tester off / on instead of auto-detecting.

**Never** echo, log, or write `CLICKUP_API_KEY` into any output file. The reviewer findings files and diffs are written under `$CLICKUP_PLANS_DIR/` — keep secrets out of them.

---

## Architecture

```
            ┌──────────────────────────────────────────────┐
            │   ORCHESTRATOR  (this command — main agent)   │
            │   • implements the task (the ONLY writer)     │
            │   • runs the touched tests + AC walk          │
            │   • dispatches reviewers on the diff          │
            │   • fixes blocking findings in its own context│
            │   • gates on severity, enforces iteration cap │
            └───────────────┬──────────────────────────────┘
                            │  implement → capture cumulative diff
                            ▼
            ┌──────────── parallel fan-out (read-only) ────────────┐
            ▼                                                       ▼
   ┌──────────────────┐                              ┌──────────────────────┐
   │   gp-reviewer    │  delegate-bar review of diff │     gp-ui-tester     │  (UI tasks only)
   │   read-only      │  correctness/security/design │  read-only + PW MCP  │  drives the browser
   └────────┬─────────┘  /conventions/tests          └──────────┬───────────┘  against the running app
            │                                                    │
            ▼                                                    ▼
   findings-review.json                                   findings-ui.json
            └──────────────────────┬─────────────────────────────┘
                                   ▼
                    orchestrator reads findings, fixes
                    open blocker/major in-context, re-diffs
                                   │
            ┌──────── if open blocker/major & iter < cap ─────────┘
            ▼  (else: converged / capped → Phase 4)
```

**Core invariants** — do not violate these even under time pressure:

1. **One writer — you.** The orchestrator implements and is the only thing that edits source. The two subagents are read-only: if a reviewer wants a change, it files a finding with a `suggested_fix`; you make the edit.
2. **Diff is the unit of review.** Each round you capture the **cumulative** `git diff` since the baseline and hand *that* to the reviewers — not "go read the repo." They may read surrounding files for context but anchor on the diff. (Cumulative, not incremental: nothing is committed mid-loop, and the reviewer/security pass needs whole-change context.)
3. **Independent eyes are the point.** The value of the subagents is a fresh, skeptical read your own context can't give — don't pre-explain your reasoning to them or coach them toward "looks good." Give them the diff, the AC, and the conventions; let them judge.
4. **Severity gates the loop.** Fix only `blocker`/`major` findings in the loop. `minor`/`nit` are logged to Notes, never looped on. **Environment gaps** (dev server won't start, Playwright MCP missing) route to manual verification — never loop-driving, since they aren't a code problem.
5. **Cap and move on.** After `--max-iter` rounds with blockers still open, stop and surface them to the user — don't loop unbounded. The delegate-reviewer bot is still the hard merge gate at PR time; this loop front-loads what it can, it doesn't replace it.
6. **Human owns the boundaries.** Scope is confirmed before the loop (Phase 2); ClickUp/plan writes happen after, with the user's say-so (Phase 4).

---

## Steps

User input may be a ClickUp task ID, a full URL (`https://app.clickup.com/t/abc123`), or empty (will prompt), plus optional knobs. Treat that input as `$ARGUMENTS`.

### Phase 1: Load the task

1. **Parse the task ID** from `$ARGUMENTS`. Accept raw IDs (`abc123`) and full URLs. Strip knob flags before parsing the ID. If the ID is missing, ask: "Which ClickUp task? (paste an ID or URL)".

2. **Fetch the task** with markdown body and parent context:
   ```bash
   cd scripts/python && uv run clickup_api.py GET task/$TASK_ID include_markdown_description=true
   ```
   Capture: `name`, `status`, `priority`, `markdown_description`, `parent`, `list.id`, `assignees`, `tags`, `url`, `dependencies`.

3. **If `parent` is non-null**, fetch the Epic too (same endpoint, parent's ID) for a one-line "this lives under '<epic title>'" context.

4. **Load the local plan**, if present, at `$CLICKUP_PLANS_DIR/<parent_id>-plan.md` (or `<task_id>-plan.md` if the task is itself the Epic). The plan often holds architecture notes and a dependency graph absent from the ticket. If none exists, proceed without it but say so.

### Phase 2: Orient

5. **Print a focused brief** to the user:
   ```
   Task: <task title>  (<priority>, <status>)
   Epic: <epic title>  (if applicable)
   List: <list name>
   URL:  https://app.clickup.com/t/<task_id>

   Acceptance criteria:
     [ ] ...
   Test plan:
     - <one-line summary>
   Implementation snapshot:
     Files to touch: <files from task body>
     Dependencies on other tasks: <ids if listed>

   Plan loaded? <yes from ...-plan.md | no — task body alone>
   ```
   Pull from `markdown_description` if it follows the standard format. If it predates `/clickup-epic-create`, summarize what *is* there and say "this ticket doesn't follow our standard sections — working from what's available."

6. **Verify the working repo.** Find the repo references in the plan/task body. Confirm it exists locally and that `pwd` matches; if not, offer to `cd` there before continuing. Don't edit files in the wrong place.

7. **Load repo conventions** — every one that exists, before any code:
   ```bash
   [ -d ".cursor/rules" ] && echo "Found .cursor/rules/" && ls .cursor/rules/
   [ -f ".cursorrules" ] && echo "Found .cursorrules"
   [ -f "CLAUDE.md" ]    && echo "Found CLAUDE.md"
   [ -d "ai-rules" ]     && echo "Found ai-rules/" && ls ai-rules/
   ```
   Read each (recursively for the dirs). These bind your implementation *and* the reviewer — pass their paths into the reviewer invocation so it judges against the same rules you followed. If a convention conflicts with the task body, surface it and ask which wins. If none exist, say so.

8. **Check task dependencies.** Source of truth is the API response's `.dependencies[].depends_on` (frontmatter is stripped before POST, so the ClickUp body won't carry a `dependencies:` block). For each, fetch `.status.status`. If any isn't `closed`/`done`-type, warn the user — they may want to clear blockers first.

9. **Establish the baseline and confirm scope.** Diffs are only meaningful against a clean starting point, so capture a baseline ref before any edits:
   ```bash
   git rev-parse HEAD > "$CLICKUP_PLANS_DIR/<task_id>-baseline.txt"
   git status --porcelain   # check for a dirty tree
   ```
   If the tree is **dirty** with changes unrelated to this task, the cumulative diff will be polluted with them. Tell the user and offer to either stash the unrelated changes or run this command in a dedicated worktree/clean branch. If they accept proceeding anyway, note that the reviewer will see the pre-existing changes too. (A worktree per ticket is the clean default — `/work-on-epic` already does this.)

   Then present the brief plus the menu — explicit options, not "anything to adjust?":

   > Going to:
   > - Implement: <one-line summary>
   > - Touching: <files>
   > - Reviewing with: gp-reviewer<, + gp-ui-tester (UI task)> (loop cap: <max-iter>)
   > - Verifying via: <test plan summary>
   >
   > How would you like to proceed?
   > - **`go`** — implement, then run the review loop as scoped
   > - **`plan`** — review/update the approach first (iterate before any code)
   > - **`focus <part>`** — implement just one slice (e.g. `focus tests`, `focus migration`)
   > - **`split`** — too big; help break it down (no ClickUp changes — just the breakdown)

   Wait for an explicit choice.
   - **`go`** → Phase 3.
   - **`plan`** → walk the implementation, edit the loaded plan in memory, re-confirm.
   - **`focus <part>`** → restrict the AC slice; note the deferred remainder in the final report.
   - **`split`** → propose a breakdown (titles + one-line scope each) and offer to feed it to `/clickup-epic-edit`. **Do not** create tickets here.

### Phase 3: Implement, then review-loop

10. **Decide whether the UI tester runs.** Auto-detect UI work from task tags, file paths (`gp-webapp`, `*.tsx/*.jsx`, `components/`, `pages/`, `app/`), or AC describing user-facing behavior. `--ui`/`--no-ui` overrides. `gp-reviewer` always runs (unless uninstalled → inline review). State the panel before starting.

11. **Implement the task** (you do this directly — there is no coder subagent). Seed a todo list from the AC (prep todos front, verification todos back) and keep it live as you go. Read the referenced files first and confirm the pattern the ticket says to follow actually exists. Implement the AC, nothing more — new ideas / nice-to-haves go to `Notes / Gotchas`, not into the code. If a ticket file path is wrong, fix it as you go and flag it. If the task body contradicts a loaded convention, or the implementation details are insufficient, **stop and surface it** rather than guessing. Run the fast/local tests for the code you touched and keep the actual output — don't claim passing tests you didn't run.

12. **Capture the cumulative diff** (always against the baseline — nothing is committed mid-loop):
    ```bash
    git --no-pager diff "$(cat "$CLICKUP_PLANS_DIR/<task_id>-baseline.txt")" \
      > "$CLICKUP_PLANS_DIR/<task_id>-iter<N>.diff"
    ```
    If the diff is empty, you wrote nothing (or wrote outside the repo) — re-check `pwd` before dispatching the reviewer.

13. **Fan out the reviewers — in parallel.** In a single message, dispatch `gp-reviewer` (and `gp-ui-tester` if UI). Each gets: the diff path, the AC, the convention paths, and its own `<task_id>-findings-<agent>.json` output path (under `$CLICKUP_PLANS_DIR/`). Each reads the diff (and surrounding files as needed), writes findings using the shared schema below, and returns a short summary (counts by severity + headline issues). Don't coach them toward approval — hand over the diff and let them judge.

    Finding schema (one object per finding):
    ```json
    { "id": "review-1", "agent": "review|ui",
      "severity": "blocker|major|minor|nit",
      "location": "path/to/file.ts:42",
      "summary": "one line", "detail": "why it matters / repro / exploit",
      "suggested_fix": "concrete change", "status": "open", "iteration_found": <N> }
    ```

    `gp-ui-tester` additionally needs the app running. Before dispatching it, bring up the dev server in the background and pass the URL:
    ```bash
    # adapt per repo — read CLAUDE.md / package.json scripts for the dev command + port
    (cd <repo> && <dev-server-cmd>) & echo $! > /tmp/<task_id>-server.pid
    # health-check the URL, then pass BASE_URL=http://localhost:<port> to gp-ui-tester
    ```
    Tear the server down after it returns (`kill "$(cat /tmp/<task_id>-server.pid)"`), **even on failure**. If the server won't come up or Playwright MCP is unavailable, **skip** `gp-ui-tester` and record an **environment** gap with manual repro steps (not loop-driving — it isn't a code problem). Note it prominently in the report.

14. **Read findings and gate.** Collect both findings files. Dedup overlaps (same `location`+`summary`; keep the highest severity). Then:
    - **Open set** = findings with severity `blocker` or `major` (exclude environment gaps).
    - If **open set is empty** → converged. Move `minor`/`nit`/environment items to the report's deferred/manual list and go to Phase 4.
    - If **open set non-empty** and `iteration < max-iter` (and not `--no-loop`) → **fix them in your own context** (you have the full reasoning that produced the code — that's the point of being the coder). For each open finding, either fix it, or `wontfix` it with a concrete reason (e.g. "the suggested validation breaks AC #2"), or `defer` it as out of scope with a note. Then go back to step 12 (re-capture the diff and re-review). Stay inside the AC — downgrade a reviewer's nice-to-have to `minor` rather than expanding scope.
    - If **iteration ≥ max-iter** (or `--no-loop`) with blockers/majors still open → **stop and surface**: print the open findings, summarize what's stuck and why (include your `wontfix` reasoning), and ask the user how to proceed (accept-with-risk and let the delegate bot gate it at PR time, fix together, split a follow-up). Don't keep looping.

### Phase 4: Verify and wrap

15. **AC walk — the final gate** (yours, independent of the reviewer). For each `[ ]`, demonstrate it's met: test output, a manual run, or the diff itself. If any AC can't be met as written, stop and ask the user — revise the AC, split a follow-up, or rethink. Don't silently downgrade.

16. **Log the deferred findings.** Write the `minor`/`nit`/`wontfix`/`deferred`/environment items into the task's **Notes / Gotchas** (and the plan's, if loaded) so they're not lost — these were intentionally not looped on, not forgotten.

17. **Offer to update ClickUp** (never silently):
    > Want me to:
    > - Post a comment summarizing the work? (links PR/commit, lists what was done, notes deferred findings)
    > - Move the task to `<next status>`? (e.g. `in review`, `done`)
    > - Tick AC checkboxes in the description?

    Build payloads via `python3 -c '...'` into a temp `.json` (comment text + status names are user content — never template into a JSON literal):
    ```bash
    cd scripts/python && uv run clickup_api.py POST task/$TASK_ID/comment @/tmp/comment.json
    cd scripts/python && uv run clickup_api.py PUT  task/$TASK_ID @/tmp/status.json
    ```

18. **Offer to update the local Epic plan** (living document). If a plan was loaded: mark this task's AC done, note deviations honestly (did X instead of Y because Z), refresh Open Questions, bump `lastEdited:`. If no plan was loaded, skip.

19. **Final report.**
    - Files changed (one line each)
    - Loop summary: rounds run, panel used (gp-reviewer; gp-ui-tester or "manual"), findings by severity (found / fixed / deferred)
    - Tests run + result
    - AC status (✓ all met, or list unmet)
    - Conventions check: adherence to the rules loaded in step 7, or "none found"
    - UI verification: Playwright result + key screenshots, or "manual steps required" if it fell back
    - ClickUp updates applied / plan updates applied (if any)
    - Findings files (`$CLICKUP_PLANS_DIR/<task_id>-findings-*.json`) for the audit trail
    - Suggested next step — pick what's actually applicable: "Open a PR?" / "Next in dep graph: `<id>`?" / "`/clickup-epic-edit` if scope shifted."

## Important Notes

- **One writer — you.** If you find yourself wanting a reviewer to hand-edit a file, stop — the reviewers are read-only; you make every edit. They report; you act.
- **Don't coach the reviewers.** Their value is independence. Hand them the diff, the AC, and the conventions — not a narrative arguing the code is fine.
- **Evidence before assertions.** No "tests pass" / "AC met" without the actual command output or run.
- **This front-loads, it doesn't replace.** The delegate-reviewer bot is still the hard merge gate. The loop catches what it can before the PR; it's fine to surface a stuck blocker to the user rather than spin.
- **Don't loop on taste.** `minor`/`nit` go to Notes. Only `blocker`/`major` drive iterations.
- **Don't commit or push** unless the user explicitly asks.
- **Don't expand scope** mid-loop. A wrong/incomplete ticket is a signal to surface, not to silently grow the PR.
- **Always tear down** the dev server and any background processes, even on failure.
- **Use `include_markdown_description=true`** when reading the task body. Plain `description` returns HTML.

## Troubleshooting

| Failure | Fix |
|---------|-----|
| `gp-reviewer` isn't installed | Do the review inline (you read your own diff against the AC + conventions with a skeptical eye), note "review: inline" in the report. To get the subagent: re-run `./install.sh` and restart the session. |
| Reviewer returns vague prose instead of structured findings | Re-dispatch once with an explicit reminder of the schema + output path. If still malformed, treat its summary as a single `major` finding and address it. |
| Loop won't converge (same blocker reappears each round) | Your fix is fighting a constraint you can't see. Stop at the cap, surface the specific finding + your `wontfix` reasoning. Usually means the AC or an upstream dependency is wrong. |
| Playwright MCP unavailable / dev server won't start | Skip `gp-ui-tester`, record an **environment** gap with manual repro steps (not loop-driving), continue. Note it prominently in the report. |
| `git diff` empty after implementing | You wrote nothing, or wrote outside the repo. Re-check `pwd` before dispatching the reviewer. |
| Cumulative diff polluted with unrelated changes | The tree was dirty at baseline. Stash the unrelated work or restart in a clean worktree (step 9). |
| `markdown_description` empty but ClickUp shows content | Body was created via UI rich text, never re-saved as markdown. Ask the user to paste it. |
| `parent` links to a closed/archived Epic | Treat the task as standalone; mention the dead-Epic state. |
| Status name doesn't exist on the List | Statuses are List-scoped. `GET list/<list_id>`, pick the closest, retry. |
| Comment POST 400s on long bodies | Soft length limit — split into two comments or trim. |
