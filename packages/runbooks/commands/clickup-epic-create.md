<!-- v1 — 2026-05-01 -->

# /clickup-epic-create

Take a design doc plus the relevant repo, scan the codebase, and break the work into a coherent **ClickUp Epic with N well-scoped subtasks**. Each subtask ships with its own context, implementation details, acceptance criteria, and test plan — so any single one can be handed straight to an AI coding agent and produce high-quality code without further excavation.

This is deliberately an **Epic-orchestration** procedure, not a single-ticket flow. The whole point is the breakdown: turning a design doc into a structured set of agent-ready tasks with explicit dependencies. For one-off tickets, just use ClickUp directly.

<!-- BEGIN: resolve-runbooks-dir (keep in sync across commands/*.md) -->

> **Where this runs:** All paths below (`scripts/python/...`, `books/.env`, `scripts/.env`) are relative to the runbooks repo root. When invoked from any directory, first resolve and `cd` into the repo:
>
> 1. If `$RUNBOOKS_DIR` is set, use it.
> 2. Else first that exists: `$HOME/Documents/gp/dev/runbooks`, `$HOME/code/runbooks`, `$HOME/runbooks`.
> 3. Else ask the user where the runbooks repo is; suggest `export RUNBOOKS_DIR=<path>` in their shell profile.

<!-- END: resolve-runbooks-dir -->

## Prerequisites

**books/.env variables**: `$CLICKUP_TEAM_ID`, `$CLICKUP_LIST_ID`, `$CLICKUP_DRAFTS_DIR`, `$CLICKUP_PLANS_DIR`, `$CLICKUP_REPOS_DIR`, `$CLICKUP_EDITOR`
**scripts/.env variables**: `CLICKUP_API_KEY`
**Tools**: `uv` (for Python scripts), `git`, `ripgrep` (`rg`), the user's editor of choice

Defaults if a `books/.env` value is unset: `$CLICKUP_DRAFTS_DIR=$HOME/.claude/drafts/clickup`, `$CLICKUP_PLANS_DIR=$HOME/.claude/plans`, `$CLICKUP_REPOS_DIR=$HOME/.claude/repos`, `$CLICKUP_EDITOR=code`. If `$CLICKUP_TEAM_ID` or `$CLICKUP_LIST_ID` is unset, prompt the user — see Phase 1 step 4.

**Never** echo, log, or write `CLICKUP_API_KEY` into any draft, plan, or output file. It lives only in `scripts/.env` and is loaded by `scripts/python/clickup_api.py` at runtime.

## Steps

User input may be passed as free-text initial context (e.g., `~/docs/auth-redesign.md https://github.com/acme/api`), `resume` to list staged drafts, or `resume <slug>` to resume a specific draft (partial match OK). Treat that input as `$ARGUMENTS` below.

### Phase 0: Check for staged drafts

1. **If `$ARGUMENTS` starts with `resume`:**
   - List directories under `$CLICKUP_DRAFTS_DIR` that contain an `epic.md`.
   - If a slug was given, match it against directory names (partial match OK).
   - If multiple matches or no slug, show the user a table of available drafts (slug, epic title, target list, staged date — pulled from each `epic.md` frontmatter) and ask which to load.
   - Read the chosen draft directory: `epic.md`, every `tasks/*.md`, and `plan.md`.
   - **Skip to Phase 5 (review loop)** with the loaded content.
   - If no staged drafts exist, say so and proceed to Phase 1.

### Phase 1: Gather inputs

2. **Get the design doc, then classify it.** From `$ARGUMENTS` or by asking. Accept any of:
   - **Local file path** → read it.
   - **URL** → fetch it via web fetch tools, or `curl` for Confluence/Notion exports the user has access to.
   - **Pasted text** → use as-is.

   Confirm you have it by summarizing in 2–3 sentences and asking "Did I understand the design correctly?". Don't proceed until the user confirms.

   Then classify what you actually have — this command assumes a **tech design** as input, not a PRD. Picking the wrong starting point is the single biggest cause of bad ticket breakdowns:
   - **PRD / product spec** — describes the user problem, goals, success metrics, mockups; does _not_ prescribe architecture, data model, components, or specific files. **Stop here.** Tell the user: "This reads like a PRD, not a tech design. The architecture choices belong upstream of ticket creation — run `/prd-to-tech-design` first to bless the technical approach, then come back here with the tech design as input." Offer to switch into `/prd-to-tech-design` inline.
   - **Tech design** — names architecture, components, data model, libraries, file paths; tradeoffs are already considered. Proceed.
   - **Hybrid** — has some architectural specifics but is silent on others. Surface the gaps to the user: "The doc covers X technically but doesn't address Y, Z. Want me to run `/prd-to-tech-design` for the gaps first, or proceed and make calls during recon?". Let the user choose; default to running the design command first when the gaps are load-bearing (data model, auth, sync vs. async).
   - **Trivial / small** — a one-paragraph description of a small change (typo fix, copy update, single-component refactor). Proceed without forcing a tech design — the ceremony isn't worth it for tasks that don't have meaningful architecture decisions.

   Don't paraphrase the input back as a "tech design" yourself — if it's actually a PRD, the value is in the team-blessed architecture review, not in the agent silently inventing it during Phase 2.

3. **Get the GitHub repo.** From `$ARGUMENTS` or by asking. Accept either:
   - **Local checkout path** (e.g., `~/code/api`) → use directly.
   - **Public repo URL** → clone shallowly into `$CLICKUP_REPOS_DIR/<repo-name>`:
     ```bash
     mkdir -p "$CLICKUP_REPOS_DIR"
     [ -d "$CLICKUP_REPOS_DIR/<repo-name>" ] \
       && (cd "$CLICKUP_REPOS_DIR/<repo-name>" && git pull --ff-only) \
       || git clone --depth 50 <url> "$CLICKUP_REPOS_DIR/<repo-name>"
     ```
     Remember the resolved local path as `$REPO_PATH` for the rest of the procedure.

4. **Resolve ClickUp targets.** All API calls go through `scripts/python/clickup_api.py`, which reads `CLICKUP_API_KEY` from `scripts/.env`.
   - If `$CLICKUP_TEAM_ID` is unset, list teams and ask the user to pick one:
     ```bash
     cd scripts/python && uv run clickup_api.py GET team
     ```
   - If `$CLICKUP_LIST_ID` is unset, ask for the target List ID, or help the user navigate Spaces → Folders → Lists:
     ```bash
     cd scripts/python && uv run clickup_api.py GET team/$CLICKUP_TEAM_ID/space archived=false
     # then for a chosen space:
     cd scripts/python && uv run clickup_api.py GET space/<space_id>/list archived=false
     # and for folders:
     cd scripts/python && uv run clickup_api.py GET space/<space_id>/folder archived=false
     ```
   - **Detect Epic task type.** Some workspaces have a custom task type called "Epic":
     ```bash
     cd scripts/python && uv run clickup_api.py GET team/$CLICKUP_TEAM_ID/custom_item
     ```
     If a "Epic" custom item exists, capture its `id` as `$EPIC_CUSTOM_ITEM_ID` for use later. If not, the Epic will be a regular parent task.

### Phase 2: Codebase reconnaissance

5. **Map the design doc to the codebase.** Don't draft tickets blind — spend a few tool calls building a mental model. From the design doc, extract concepts (entities, endpoints, components, flows) and find where they live in `$REPO_PATH`:

   ```bash
   # Lay of the land
   ls "$REPO_PATH"
   cat "$REPO_PATH/README.md" 2>/dev/null | head -100

   # Detect language/framework signals
   ls "$REPO_PATH" | grep -E '^(package\.json|pyproject\.toml|go\.mod|Cargo\.toml|Gemfile|composer\.json|build\.gradle)$'

   # Test framework signals
   rg -n --no-heading -g '!node_modules' '(jest|vitest|pytest|rspec|go test|cargo test)' "$REPO_PATH" | head -20

   # Find each concept from the design doc
   rg -n --no-heading -g '!node_modules' '<concept>' "$REPO_PATH" | head -30
   ```

   Build a short internal map: which files/modules will the work touch? What patterns does the existing code follow (e.g., handler structure, DB access pattern, how new endpoints are wired)? Skim 1–2 representative files per area.

6. **Briefly summarize what you learned to the user** — language, framework, testing setup, where the work will land. This catches misunderstandings early.

### Phase 3: Question round

7. **Ask focused questions** to fill the gaps the design doc and codebase don't cover. Ask only what you genuinely need — don't interrogate. Typical gaps:
   - **Granularity preference**: "Roughly how many tasks should this break into? (e.g., 3–5 chunky, or 8–15 atomic)"
   - **Sequencing**: "Strict serial dependencies, or parallelizable where possible?"
   - **Out of scope**: "Anything explicitly _not_ in scope for this Epic?"
   - **Conventions to honor**: "Any patterns in this codebase I should mimic, or any to avoid?"
   - **Testing expectations**: "What level of test coverage per task — unit only, or integration too? Anything currently untested I shouldn't bother adding tests for?"
   - **Priority/timeline**: "Target completion? Any tasks more urgent than others?"

   Skip any question already answered by the design doc, `$ARGUMENTS`, or the codebase scan. Batch the rest into one message.

8. **Confirm the Epic title, then generate a slug.** Don't silently invent a title from the design doc — propose one and let the user correct.

   > Proposed Epic title: **<title>**. OK, or what would you prefer?

   Once confirmed, derive the slug:
   - Lowercase, hyphenate, strip non-alphanumerics, truncate to 50 chars.
   - Example: "User authentication redesign" → `user-authentication-redesign`.

9. **Check for similar existing drafts** in `$CLICKUP_DRAFTS_DIR`:
   - Read the frontmatter of every `*/epic.md`.
   - If any look related (similar title, same target list), ask the user before proceeding: "I found a staged draft that looks related: `<slug>` — '<title>' (staged <date>). Same Epic, or new one?"
   - If same: load it and skip to Phase 5. If new: pick a more specific slug.

### Phase 4: Draft the Epic and tasks

10. **Create the draft directory:**

    ```bash
    mkdir -p "$CLICKUP_DRAFTS_DIR/<slug>/tasks"
    ```

11. **Draft `epic.md`** at `$CLICKUP_DRAFTS_DIR/<slug>/epic.md`. The Epic ticket itself is for humans planning and tracking — it should be readable by a PM. Keep implementation specifics in the task tickets, not the Epic.

    ```markdown
    ---
    type: epic
    slug: <slug>
    title: <Epic title>
    clickupTeamId: <team id>
    clickupListId: <list id>
    epicCustomItemId: <id or empty>
    designDoc: <path or URL>
    githubRepo: <url or path>
    staged: <YYYY-MM-DD>
    ---

    # <Epic title>

    ## Summary

    One paragraph: what this Epic delivers and why.

    ## Goals

    - Concrete, testable outcomes.

    ## Non-Goals

    - Things explicitly out of scope.

    ## Success Metrics

    - How we'll know this worked.

    ## Task Breakdown

    1. **<task title>** — one-line summary
    2. **<task title>** — one-line summary
       ...

    ## Links

    - Design doc: <link>
    - Repo: <link>
    ```

12. **Draft each task** as `$CLICKUP_DRAFTS_DIR/<slug>/tasks/<NN>-<task-slug>.md`, where `NN` is a zero-padded order number (`01`, `02`, ...).

    Every task **must** include all six sections below. This is the bar for "agent-ready":

    ```markdown
    ---
    type: task
    order: <NN>
    title: <Task title>
    priority: <urgent|high|normal|low>
    estimateHours: <number or empty>
    dependencies: [<order numbers of tasks this depends on>]
    tags: [<tag>, <tag>]
    assignee: <username or empty>
    ---

    # <Task title>

    ## Context

    Why this task exists. One short paragraph linking back to the Epic goal it serves. If the design doc has a section that motivates this task, quote the gist (in your own words).

    ## Implementation Details

    The technical _how_. Be specific enough that a competent engineer (or AI agent) can execute without re-deriving design decisions.

    **Files to touch:**

    - `path/to/file.ext` — what changes here
    - `path/to/another.ext` — what changes here

    **Approach:**

    1. Step-by-step plan, in order.
    2. Reference existing patterns in the repo where applicable (e.g., "follow the pattern in `auth/middleware.go`").
    3. Note specific function signatures, schema changes, API shapes where they're decided.

    **Dependencies / data flow:**

    - New libraries, env vars, config keys.
    - Migration ordering, if any.

    ## Acceptance Criteria

    Checkable, behavioral conditions. Use `- [ ]` checkboxes.

    - [ ] Specific observable outcome 1
    - [ ] Specific observable outcome 2
    - [ ] Edge case X is handled (describe behavior)

    ## Test Plan

    **Unit tests** (in `<test dir>` following `<framework>`):

    - Test case: <what it asserts>
    - Test case: <what it asserts>

    **Integration tests** (if applicable):

    - Scenario: <setup → action → expected result>

    **Manual verification:**

    - Step: <what to do, what to look for>

    ## Notes / Gotchas

    - Edge cases, perf considerations, things easy to get wrong.
    - Open questions (flag explicitly; don't hide them).
    ```

    Quality bar — before moving on, self-check each task:
    - Could a competent engineer who hasn't read the design doc execute this in one sitting? If no, add detail or split it.
    - Are file paths real (verified against the repo scan)? Don't fabricate.
    - Are acceptance criteria observable, not internal? "Feature works" is not acceptance criteria.
    - Is the test plan specific to the project's actual framework, not generic?
    - Does it depend on tasks that will exist? Reference them by `order` number.

13. **Draft `plan.md`** at `$CLICKUP_DRAFTS_DIR/<slug>/plan.md` — the Epic-level technical plan. This is for local reference, not posted to ClickUp:

    ```markdown
    ---
    epic: <slug>
    designDoc: <path or URL>
    githubRepo: <url or path>
    ---

    # Implementation Plan: <Epic title>

    ## Architecture Notes

    Cross-cutting decisions that span multiple tasks. Why we chose X over Y.

    ## Dependency Graph

    Text or ASCII showing task ordering and parallelization opportunities.

    ## Migration / Rollout

    If applicable: backfills, feature flags, deploy ordering.

    ## Open Questions

    Things still unresolved. Flag the task(s) they affect.

    ## Risks

    Things that could go wrong, mitigations.
    ```

### Phase 5: Review loop

14. **Open the draft directory in the editor:**

    ```bash
    "$CLICKUP_EDITOR" "$CLICKUP_DRAFTS_DIR/<slug>"
    ```

15. **Tell the user what's open and present options:**

    > Drafted **1 Epic + N tasks** at `$CLICKUP_DRAFTS_DIR/<slug>/`. Edit the files directly in your editor if you'd like. When ready:
    >
    > - **`good`** — create the Epic and all tasks in ClickUp
    > - **`edit`** — tell me what to change (I'll update the files)
    > - **`investigate`** — I should dig deeper before finalizing (re-scan the repo, fetch related ClickUp tasks, etc.)
    > - **`stage`** — save and resume later via `resume <slug>`

16. **If `edit`:** apply the requested changes to whichever files are affected. Re-open the directory if helpful. Loop back to step 15.

17. **If `investigate`:** ask what to dig into. Common useful moves:
    - Re-scan specific files in the repo for missed details.
    - Pull existing ClickUp tasks in the target list to learn naming/format conventions:
      ```bash
      cd scripts/python && uv run clickup_api.py GET list/$CLICKUP_LIST_ID/task archived=false page=0
      ```
    - Fetch related design docs the user mentions.
    - Search the repo's PR history if `gh` is available: `gh pr list --search "<query>" --repo <owner/repo>`.

    Update drafts based on findings, then loop back to step 15.

18. **If `stage`:** confirm "Staged as `<slug>`. Resume with `resume <slug>`." and **stop**. Don't create anything in ClickUp.

19. **If `good`:** **re-read every file from disk** before submitting — the user may have edited them in the editor. Parse:
    - `epic.md` frontmatter and body
    - Every `tasks/*.md` in numeric order, frontmatter and body
    - `plan.md` body

### Phase 6: Create in ClickUp

> **JSON safety.** Build payloads in Python (a temp file or a small inline script) — never template untrusted strings into a JSON literal. Bodies will contain quotes, newlines, and backticks. The simplest safe path: write the payload dict to a temp `.json` file, then pass it via `@payload.json` to `clickup_api.py`.

20. **Create the Epic.** POST to the target list. If `epicCustomItemId` is set in the frontmatter, include it; otherwise create a regular task.

    ```bash
    # Example: build payload safely with python -c
    python3 -c '
    import json, sys, pathlib
    body = pathlib.Path("'"$CLICKUP_DRAFTS_DIR/<slug>/epic.md"'").read_text()
    # Strip the YAML frontmatter (everything between the first two --- lines)
    if body.startswith("---"):
        body = body.split("---", 2)[2].lstrip("\n")
    payload = {"name": "<epic title>", "markdown_description": body}
    # Add custom_item_id if applicable:
    # payload["custom_item_id"] = <id>
    print(json.dumps(payload))
    ' > /tmp/clickup-epic-payload.json

    cd scripts/python && uv run clickup_api.py POST list/$CLICKUP_LIST_ID/task @/tmp/clickup-epic-payload.json
    ```

    Capture the returned `id` as `$EPIC_TASK_ID`. If the call fails, surface the error to the user and stop — don't create orphan subtasks.

21. **Create each Task** as a subtask of the Epic, in `order` order. Map priority strings to ClickUp's 1–4 scale: `urgent=1`, `high=2`, `normal=3`, `low=4`. Build each payload the same way (Python → temp JSON file → POST):

    ```python
    # Inside the python -c invocation, per task:
    payload = {
        "name": task_title,
        "markdown_description": task_body_without_frontmatter,
        "parent": EPIC_TASK_ID,
        "tags": tags_list,
    }
    # Only set `priority` if the task explicitly chose one. ClickUp rejects
    # `priority: null` and treats missing-key as "no priority" — which is what we want.
    pri = {"urgent": 1, "high": 2, "normal": 3, "low": 4}.get(priority_str)
    if pri is not None:
        payload["priority"] = pri
    # Same rule for any other optional field (time_estimate, due_date, assignees):
    # build the dict, then conditionally add the key. Never include `null` or "".
    ```

    Then `POST list/$CLICKUP_LIST_ID/task @<temp.json>` and capture each returned `id`, keyed by `order` number, so dependencies can reference real IDs in the next step.

22. **Wire up dependencies.** For each task with a non-empty `dependencies` list in its frontmatter:

    ```bash
    cd scripts/python && uv run clickup_api.py POST task/<task_id>/dependency @/tmp/dep.json
    # where /tmp/dep.json is: {"depends_on": "<dependency_task_id>"}
    ```

    A failure here is non-fatal — log it, keep going, surface in the final report.

### Phase 7: Save plan, clean up, report

23. **Save the Epic-level plan** to `$CLICKUP_PLANS_DIR/<EPIC_TASK_ID>-plan.md`:

    ```bash
    mkdir -p "$CLICKUP_PLANS_DIR"
    ```

    Add frontmatter on top of the `plan.md` body:

    ```markdown
    ---
    epic: <EPIC_TASK_ID>
    epicTitle: <epic title>
    listId: <list id>
    teamId: <team id>
    tasks:
      - { id: <task_id>, order: 01, title: "<...>" }
      - { id: <task_id>, order: 02, title: "<...>" }
    designDoc: <path or URL>
    githubRepo: <url or path>
    created: <YYYY-MM-DD>
    ---
    ```

24. **Clean up the staged draft directory:**

    ```bash
    rm -rf "$CLICKUP_DRAFTS_DIR/<slug>"
    ```

25. **Report to the user:**
    - Epic: `<title>` — `<EPIC_TASK_ID>` — `https://app.clickup.com/t/<EPIC_TASK_ID>`
    - Tasks: bulleted list with `<id>`, title, and link
    - Any dependency-wire failures
    - Plan saved at `$CLICKUP_PLANS_DIR/<EPIC_TASK_ID>-plan.md`
    - Suggest next step: "Pick up a task with `/work-on-clickup <task_id>`."

## Quality Bar

Tasks created via this procedure must clear all of:

1. **Self-contained.** A reader who hasn't seen the design doc or the repo can execute the task from the ticket alone.
2. **Real, not invented.** Every file path, function name, and pattern reference must come from the actual repo scan, not pattern-matched from training data.
3. **Atomic.** A task does one coherent thing. If "and then" appears in the title, split it.
4. **Testable.** Acceptance criteria describe externally observable behavior. The test plan names the actual framework and points at the test directory that exists in this repo.
5. **Honest about uncertainty.** Open questions go in `Notes / Gotchas` explicitly — never papered over.

If any drafted task fails this bar, fix it before opening the editor for the user. Burning a review cycle on obvious gaps is a worse experience than taking one more pass.

## Important Notes

- **Always** use `markdown_description` (not `description`) in the ClickUp API payload — `description` ignores formatting.
- **Always** re-read the draft files from disk before posting to ClickUp; the user may have edited them in their editor.
- The Epic-level plan (`plan.md`) is for local use only and is **not** posted to ClickUp. Implementation details that _do_ belong in ClickUp go inside each task ticket.
- Staged draft directories persist under `$CLICKUP_DRAFTS_DIR` until the Epic is created (then cleaned up) or manually removed.
- If the repo is large, prefer targeted `rg` queries over reading whole directories. Spend agent context on the files that matter.
- If the design doc references endpoints/screens/entities that **don't** exist in the repo, surface that finding to the user before drafting tasks for them.

## Troubleshooting

| Failure                                                    | Fix                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `CLICKUP_API_KEY not set` from `clickup_api.py`            | Add the token to `scripts/.env`; never to `books/.env`.                                                       |
| `401 Unauthorized`                                         | Token revoked or copied with extra whitespace — regenerate from ClickUp Settings → Apps.                      |
| `403 Forbidden` on `list/<id>/task` POST                   | Token belongs to a user without write access on that List.                                                    |
| Epic creates fine but subtasks land in the wrong List      | Pass the same `list_id` for both POSTs (Epic's parent List). ClickUp doesn't auto-inherit.                    |
| `markdown_description` shows raw `**asterisks**` in the UI | You sent it under `description` instead of `markdown_description`.                                            |
| Dependency POST returns 400                                | Verify `depends_on` is a _task ID_, not the task's `custom_id`. Both fields exist; only `id` works here.      |
| Long design doc context overruns memory mid-procedure      | Stage early (`stage` verb), summarize the doc into `plan.md` Architecture Notes, resume with `resume <slug>`. |
