<!-- v1 — 2026-05-01 -->
# /clickup-epic-edit

Make structured changes to an existing ClickUp Epic and its child tasks: edit content, add or remove tasks, change priorities or dependencies. Same drafts-then-apply pattern as `/clickup-epic-create` so you can review the full diff before anything hits ClickUp.

<!-- BEGIN: resolve-runbooks-dir (keep in sync across commands/*.md) -->
> **Where this runs:** All paths below (`scripts/python/...`, `books/.env`, `scripts/.env`) are relative to the runbooks repo root. When invoked from any directory, first resolve and `cd` into the repo:
>
> 1. If `$RUNBOOKS_DIR` is set, use it.
> 2. Else first that exists: `$HOME/Documents/gp/dev/runbooks`, `$HOME/code/runbooks`, `$HOME/runbooks`.
> 3. Else ask the user where the runbooks repo is; suggest `export RUNBOOKS_DIR=<path>` in their shell profile.
<!-- END: resolve-runbooks-dir -->

## Prerequisites

**books/.env variables**: `$CLICKUP_DRAFTS_DIR`, `$CLICKUP_PLANS_DIR`, `$CLICKUP_EDITOR`
**scripts/.env variables**: `CLICKUP_API_KEY`
**Tools**: `uv` (for Python scripts), the user's editor of choice

Defaults if a `books/.env` value is unset: `$CLICKUP_DRAFTS_DIR=$HOME/.claude/drafts/clickup`, `$CLICKUP_PLANS_DIR=$HOME/.claude/plans`, `$CLICKUP_EDITOR=code`.

**Never** echo, log, or write `CLICKUP_API_KEY` into any draft, plan, or output file.

## Steps

User input may be passed as a ClickUp task ID or URL (e.g., `abc123` or `https://app.clickup.com/t/abc123`) to load that Epic, or `resume` / `resume <slug>` to continue an in-progress edit. Treat that input as `$ARGUMENTS` below.

### Phase 0: Resume or load

1. **If `$ARGUMENTS` starts with `resume`:** find matching `*/epic.md` under `$CLICKUP_DRAFTS_DIR` whose frontmatter has `mode: edit`. Load it (epic.md, tasks/*.md, plan.md, plus the snapshot dir described in step 4). **Skip to Phase 3 (review loop).**

2. **Otherwise**, parse `$ARGUMENTS` for a task ID. Accept raw IDs and full ClickUp URLs (`https://app.clickup.com/t/<id>` → `<id>`). If missing, ask.

### Phase 1: Fetch current state

3. **Fetch the Epic with subtasks.** Use `include_subtasks=true` and `include_markdown_description=true` so we get the markdown source, not the rendered HTML:

   ```bash
   cd scripts/python && uv run clickup_api.py GET task/$EPIC_TASK_ID \
     include_subtasks=true include_markdown_description=true
   ```

   Verify the response is actually an Epic (or at minimum a parent task with children). If `parent` is non-null, warn the user — they may have given you a child task ID by mistake — and offer to switch to its parent.

4. **Stage current state as a snapshot + working drafts.** The snapshot lets us diff later; the working drafts are what the user edits.

   ```bash
   slug="<derived from epic title>"
   # Brace expansion does NOT happen inside quotes — keep braces unquoted.
   mkdir -p "$CLICKUP_DRAFTS_DIR/$slug-edit"/{snapshot/tasks,tasks}
   ```

   Write **both** versions (identical at first):
   - `snapshot/epic.md`, `snapshot/tasks/<NN>-<task-slug>.md` — frozen baseline, do not edit
   - `epic.md`, `tasks/<NN>-<task-slug>.md` — the user's working copy

   The Epic frontmatter must include the live ClickUp `id` so we can match files to server records during apply:

   ```markdown
   ---
   type: epic
   mode: edit
   slug: <slug>
   clickupId: <epic id>
   clickupListId: <list id>
   originalName: <name as fetched>
   loadedAt: <ISO timestamp>
   ---
   ```

   For each subtask, frontmatter mirrors `/clickup-epic-create`'s task format **plus** `clickupId: <task id>` and `originalOrder: <position from server>`.

   Bodies are the `markdown_description` returned by the API. If a body doesn't have the standard sections (`## Context`, `## Implementation Details`, etc.), preserve whatever's there — don't fabricate sections to match the template. Just note in the user-facing summary that the existing tasks use a different format.

5. **Load the local plan if it exists.** Look for `$CLICKUP_PLANS_DIR/<EPIC_TASK_ID>-plan.md` and copy it to `plan.md` in the draft directory. If absent, create a stub from what we know.

6. **Show the user the loaded state:** Epic title, child task count, list/space, link to ClickUp, and one-line summary per task. Then explain the options in Phase 2.

### Phase 2: Edit

7. **Open the draft directory in the editor:**
   ```bash
   "$CLICKUP_EDITOR" "$CLICKUP_DRAFTS_DIR/<slug>-edit"
   ```

8. **Ask the user what to do.** Common operations — pick or combine:
   - **Edit existing task content** → user edits `tasks/<NN>-*.md` directly (or asks you to)
   - **Edit Epic body** → user edits `epic.md`
   - **Add a new task** → create a new file `tasks/<NN>-<slug>.md` with frontmatter `clickupId:` empty (it's a new record). Use the next free order number.
   - **Remove a task** → delete the file from `tasks/`. Don't touch the snapshot.
   - **Reorder tasks** → only changes display order in the local plan; ClickUp doesn't have a reliable subtask order field, so we won't try to reorder server-side. Mention this if the user asks.
   - **Change priority/tags/dependencies** → edit the frontmatter
   - **Bulk operation** → e.g., "raise all priorities one level," "add tag `auth-redesign` to every task" — apply to all working files and confirm

   For substantive content changes, follow the same Quality Bar from `/clickup-epic-create` (self-contained, real-not-invented, atomic, testable, honest).

### Phase 3: Review loop

9. **Present options:**

   > Edited Epic `<id>` — '<title>'. Working drafts at `$CLICKUP_DRAFTS_DIR/<slug>-edit/`. When ready:
   >
   > - **`good`** — apply the diff to ClickUp
   > - **`edit`** — keep editing
   > - **`investigate`** — fetch more context (related tasks, design doc, repo)
   > - **`stage`** — save and resume later via `resume <slug>`
   > - **`abandon`** — discard all changes and remove the draft directory

10. **If `edit` / `investigate` / `stage` / `abandon`:** behave the same way as in `/clickup-epic-create`. For `abandon`, `rm -rf` the draft dir after explicit user confirmation.

11. **If `good`:** **re-read every working file from disk.**

### Phase 4: Compute the diff

12. **Diff snapshot vs. working files** to produce three lists:
    - **Updated**: files present in both snapshot and working dir, but with content (body or relevant frontmatter fields) changed
    - **Created**: files in working dir with empty `clickupId` (new tasks)
    - **Deleted**: files in snapshot/tasks/ that don't have a matching `clickupId` in any working file

    Also flag the Epic itself if `epic.md` body or name changed vs. snapshot.

13. **Show the user the diff plan** as a numbered list, e.g.:
    ```
    Apply plan:
      1. UPDATE Epic abc123 (name + description)
      2. UPDATE task abc456 (description)
      3. UPDATE task abc789 (priority normal → high)
      4. CREATE new task "Add rate limiting middleware" (no deps)
      5. ARCHIVE task abc999 (default for removals; confirm before destructive delete)
    ```

    For any removal, ask explicitly: "Remove `<id>` — '<title>'? (`archive` (default) / `delete` / `keep`)". **Default to `archive`** (`{archived: true}` PUT) if the user is unsure or just says yes — archived tasks are trivially restorable; deleted ones aren't.

### Phase 5: Apply

> **JSON safety.** Same rule as `/clickup-epic-create`: build payloads via `python3 -c '...'` writing to a temp `.json` file, then pass it to `clickup_api.py` with `@payload.json`. Never template untrusted strings into a JSON literal — bodies will contain quotes, newlines, and backticks.

14. **Update the Epic** if changed:
    ```bash
    # Build payload (strip frontmatter from epic.md body), then:
    cd scripts/python && uv run clickup_api.py PUT task/$EPIC_TASK_ID @/tmp/epic-update.json
    # where /tmp/epic-update.json is: {"name": "<new>", "markdown_description": "<body>"}
    ```

15. **Update each changed task:**
    ```bash
    # Per-task payload includes only changed fields, e.g.:
    # {"name": "<new>", "markdown_description": "<body>", "priority": 2}
    cd scripts/python && uv run clickup_api.py PUT task/<task_id> @/tmp/task-update.json
    ```

    Priority semantics on PUT (different from POST):
    - **Setting/changing**: `"priority": 1|2|3|4` (urgent/high/normal/low).
    - **Clearing an existing priority**: `"priority": null` is accepted on PUT — that's how you remove it.
    - **Leaving unchanged**: omit the key entirely. Don't set to `null` unless you actually want to clear.

    Build the payload by diffing the working file's frontmatter against the snapshot's, and only add the keys whose values changed.

    Tags require separate calls per tag (no bulk endpoint):
    ```bash
    # Add a tag (no body needed):
    cd scripts/python && uv run clickup_api.py POST task/<task_id>/tag/<tag_name> @/tmp/empty.json
    # Remove a tag:
    cd scripts/python && uv run clickup_api.py DELETE task/<task_id>/tag/<tag_name>
    ```
    Diff old vs. new tags and call accordingly. (`/tmp/empty.json` should contain `{}`.)

16. **Create each new task** as a subtask of the Epic (same payload shape as `/clickup-epic-create` Phase 6 step 21). Capture the new `id` — write it back into the working file's frontmatter so a re-run picks up the new state.

17. **Archive or delete removed tasks:**
    ```bash
    # Archive (default — recoverable):
    cd scripts/python && uv run clickup_api.py PUT task/<task_id> @/tmp/archive.json
    # /tmp/archive.json: {"archived": true}

    # Delete (destructive — only if user explicitly chose `delete`):
    cd scripts/python && uv run clickup_api.py DELETE task/<task_id>
    ```

18. **Reconcile dependencies.** For each task whose `dependencies` frontmatter changed: fetch current dependencies from the API response, add new ones, remove dropped ones.
    ```bash
    # Add:
    cd scripts/python && uv run clickup_api.py POST task/<id>/dependency @/tmp/dep.json
    # /tmp/dep.json: {"depends_on": "<dep_task_id>"}

    # Remove:
    cd scripts/python && uv run clickup_api.py DELETE task/<id>/dependency depends_on=<dep_task_id>
    ```

19. **Track partial failures.** If any call fails, keep going for non-fatal cases (dependency wiring) but stop for fatal cases (Epic update failed) and report what was applied vs. pending.

### Phase 6: Update local plan and clean up

20. **Update the local plan** at `$CLICKUP_PLANS_DIR/<EPIC_TASK_ID>-plan.md`:
    - Refresh the `tasks:` list in frontmatter to reflect current state
    - Update the body if `plan.md` in the draft was edited
    - Bump a `lastEdited: <YYYY-MM-DD>` field

21. **Clean up the draft directory:**
    ```bash
    rm -rf "$CLICKUP_DRAFTS_DIR/<slug>-edit"
    ```

22. **Report.** Print the apply plan again with status per item (✓ applied / ✗ failed / — skipped), the Epic URL, and any follow-up needed. If new tasks were created or substantive task descriptions changed, remind the user: "Pick one up with `/work-on-clickup <task_id>`." For deleted/archived tasks, note that any local work in flight on those tasks should stop.

## Important Notes

- **Always work via the snapshot/working diff.** Never compute "changed?" by re-fetching from ClickUp during apply — that races with concurrent edits and may overwrite someone else's changes silently. The snapshot is the contract.
- **Default to archive over delete** for removed tasks unless the user explicitly chose `delete`. Closed/archived tasks are easy to restore; deleted ones aren't.
- **Use `include_markdown_description=true`** on the GET. The non-markdown `description` field returns HTML, which is lossy if the user roundtrips through this procedure.
- **`markdown_description`** is also the field to write on PUT/POST.
- The repo path / design doc may have changed since the Epic was created. If the user wants a re-scan during edit (e.g., "we renamed the auth module"), do it via `investigate` and update file path references in tasks before applying.

## Troubleshooting

| Failure | Fix |
|---------|-----|
| `include_subtasks=true` returns Epic but no children | The Epic might have been created without subtasks parented to it. Check `parent` field on what you expected to be subtasks. |
| `archived: true` PUT silently doesn't archive | The List or Space may have archive disabled. Fall back to status `closed` or move to a dedicated archive List. |
| Dependency DELETE 404s | The dependency was already removed (e.g., the depending task was deleted) — safe to ignore. |
| Working file's `clickupId` matches multiple snapshot files | Two snapshots accidentally got the same id — clean the draft dir and re-load from ClickUp. |
| Mid-apply failure leaves Epic + some tasks updated | Re-running with the same draft dir is safe: snapshot still represents pre-edit state, so the diff recomputes correctly. |
