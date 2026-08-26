<!-- v1 — 2026-08-26 -->
# /validate-feature

Validate a shipped (or nearly shipped) feature against its spec and designs: pull the ClickUp epic/PRD (+ optional TDD and Claude Design canvas), provision test users in the right product state via gp-api's test-fixtures API, drive the deployed app in a real browser through the `gp-feature-validator` subagent, produce a validation report, and — **only after the user approves** — file bug tickets under the same epic and post the report as an epic comment. Cleans up its fixture users at the end.

<!-- BEGIN: resolve-runbooks-dir (keep in sync across commands/*.md) -->
> **Where this runs:** Runbooks lives in the `omni` monorepo at `packages/runbooks`. All paths below (`scripts/python/...`, `books/.env`, `scripts/.env`) are relative to that package root. When invoked from any directory, first resolve and `cd` into it:
>
> 1. If `$RUNBOOKS_DIR` is set, use it.
> 2. Else first that exists: `$HOME/Documents/gp/dev/omni/packages/runbooks`, `$HOME/code/omni/packages/runbooks`, `$HOME/omni/packages/runbooks`.
> 3. Else ask the user where the omni repo is (the runbooks package is at `<omni>/packages/runbooks`); suggest `export RUNBOOKS_DIR=<omni>/packages/runbooks` in their shell profile.
<!-- END: resolve-runbooks-dir -->

## Prerequisites

**books/.env variables**: `$CLICKUP_PLANS_DIR`
**scripts/.env variables**: `CLICKUP_API_KEY`, `CLERK_SECRET_KEY_DEV` (the dev Clerk secret key; used only to mint the caller's own 1h API token via `scripts/python/mint_dev_api_token.py`)
**Tools**: `uv` (Python scripts), `curl`
**Subagents**: `gp-feature-validator` — installed by `./install.sh` (restart the session after first install). Degrades gracefully: if it isn't installed, run the validation inline with your own Playwright MCP access and note "validator: inline" in the report.
**MCP**: the Playwright MCP server must be connected (the validator's allowlist names the `mcp__playwright__*` tools). Without it, validation falls back to a manual checklist for the user, flagged in the report.
**Access**: the caller's dev account must have the admin role (the test-fixtures endpoints are `AdminOrM2MGuard`-protected and only exist on dev/preview deploys).

Defaults if a `books/.env` value is unset: `$CLICKUP_PLANS_DIR=$HOME/.claude/plans`.

**Knobs** (in `$ARGUMENTS`, e.g. `abc123 --design <url> --base-url https://...`):
- `--design <url>` — a Claude Design canvas URL to compare against. Without it, design comparison is skipped (functional validation still runs).
- `--base-url <url>` — target deploy. Default `https://dev.goodparty.org`.
- `--state <s>` — force the fixture state (`free-win` | `pro-win` | `serve` | `serve-won-race`) instead of inferring it from the spec.
- `--creds <email>:<password>` — skip provisioning and validate as an existing user (login happens through the real sign-in UI; flakier than fixtures).
- `--no-file` — report only; never offer to file tickets.

**Never** echo, log, or write `CLICKUP_API_KEY`, `CLERK_SECRET_KEY_DEV`, minted tokens, or fixture passwords into any output file. The report and findings files under `$CLICKUP_PLANS_DIR/` must carry user *emails* at most.

---

## Architecture

```
        ┌────────────────────────────────────────────────────┐
        │  ORCHESTRATOR (this command — main agent)           │
        │  • collects spec context (epic + TDD + canvas)      │
        │  • builds the traced validation checklist           │
        │  • provisions fixture users (gp-api test-fixtures)  │
        │  • dispatches the validator on the deployed app     │
        │  • drafts report + bug tickets → USER APPROVES      │
        │  • files approved bugs under the epic, cleans up    │
        └───────────────────────┬────────────────────────────┘
                                ▼
                   ┌──────────────────────────┐
                   │   gp-feature-validator    │  read-only + Playwright MCP
                   │   cookie-injected login   │  against --base-url
                   │   checklist + design pass │
                   └────────────┬─────────────┘
                                ▼
                    <run_id>-findings-validate.json
```

Invariants:

1. **Spec-anchored.** The unit of validation is the checklist derived from the epic AC + TDD + canvas — not a diff. Every checklist item carries its source (ticket id or artboard name), and every finding traces back to one.
2. **Human owns the bug filing.** Findings become *drafted* tickets; nothing is created in ClickUp until the user explicitly approves each one. `--no-file` skips the offer entirely.
3. **Environment gaps are not feature bugs.** App down, login failure, MCP missing → manual-verification items in the report, never tickets.
4. **Always clean up.** Fixture users are deleted at the end, even on failure (the 24h server-side sweep is the safety net, not the plan).
5. **Credentials stay out of artifacts.** Tokens and passwords live in memory for the run and in nothing that gets written or posted.

## Steps

Treat user input as `$ARGUMENTS`: a ClickUp epic/task ID or URL (required), plus knobs.

### Phase 1: Collect context

1. **Parse `$ARGUMENTS`.** Accept raw IDs and full URLs; strip knobs before parsing. If the ID is missing, ask: "Which epic or ticket? (paste an ID or URL)".

2. **Fetch the epic and its subtasks**:
   ```bash
   cd scripts/python && uv run clickup_api.py GET task/$TASK_ID include_markdown_description=true
   cd scripts/python && uv run clickup_api.py GET list/$LIST_ID/task subtasks=true include_closed=true
   ```
   For the given task and each subtask, capture title, status, and `markdown_description`. If the given task has a `parent`, fetch the parent too and treat *it* as the epic.

3. **Fetch the TDD**, if the epic links a ClickUp doc (v3 API):
   ```bash
   cd scripts/python && uv run clickup_api.py --api-version=v3 GET workspaces/$TEAM_ID/docs/$DOC_ID/pages
   ```
   (Team and doc IDs come from the linked URL: `.../v/dc/<team>-<doc>/<page>`.)

4. **Pull the Claude Design canvas** (orchestrator-side; the subagent never touches claude.ai). If `--design` was given:
   - Read the canvas artifact (your Artifact tool, `action: "read"` with the URL) and save the HTML locally under your scratch space.
   - Serve it locally (`python3 -m http.server <port>` in the saved directory) and screenshot each artboard relevant to the feature via your own Playwright MCP access, one PNG per artboard, named by artboard title.
   - Extract spec notes per artboard: visible copy, states shown, layout intent.
   - If the canvas can't be read, say so, skip design comparison, and continue.

5. **Build the validation checklist.** Merge three sources into one numbered list, each item carrying `source:`:
   - Functional scenarios from every subtask's acceptance criteria (`- [ ]` items) that describe user-visible behavior.
   - Behavioral claims from the TDD that a browser can observe.
   - Design expectations, one per artboard screenshot.
   Then determine what the checklist *needs*: which fixture state(s) (Serve features → `serve` or `serve-won-race`; Pro-gated features → `pro-win`; default `free-win`), and which feature flags must be forced (grep the tickets/TDD for flag keys).

6. **Print the brief and confirm scope** — the checklist, the fixture state(s), the flags, the target URL, and whether design comparison will run. Wait for `go` (or an adjustment) before touching anything.

### Phase 2: Provision test users

7. **Mint your caller token** (needed for the fixtures API):
   ```bash
   cd scripts/python && API_TOKEN=$(uv run mint_dev_api_token.py "$YOUR_DEV_EMAIL")
   ```
   Ask the user for their dev-account email if you don't have it. Never print the token.

8. **Create one fixture user per required state**:
   ```bash
   curl -sf -X POST "$BASE_URL/api/v1/test-fixtures/users" \
     -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
     -d '{"state": "<state>"}'
   ```
   The response carries `userId`, `email`, `password`, `orgSlug`, `sessionToken`, the ready-to-set `cookies` triple, and `expiresAt`. Record every created `userId` in a cleanup list. A 404 means the deploy isn't dev/preview or the route isn't live yet; a 403 means the caller isn't admin — in either case fall back to `--creds` (ask the user for a test login) and note the fallback in the report.
   For runs longer than ~50 minutes, re-mint the user's session with `POST /api/v1/test-fixtures/users/<id>/session` rather than re-creating the fixture.

### Phase 3: Validate

9. **Dispatch `gp-feature-validator`** with: `TARGET_URL`, the login bundle(s) (cookie triples + email/password fallback), the validation checklist, the artboard screenshot paths + spec notes, the flag-override keys, and the output path `$CLICKUP_PLANS_DIR/<task_id>-findings-validate.json`. Don't coach it toward a pass — hand over the checklist and let it judge. If the subagent isn't installed, run the same procedure inline (its definition is `agents/gp-feature-validator.md`).

10. **Read the findings.** Partition into feature findings (`functional|design|console|network`) and `environment` gaps. Environment gaps become manual-verification items with repro steps.

### Phase 4: Report, approve, file

11. **Write the validation report** to `$CLICKUP_PLANS_DIR/<task_id>-validation-report.md`:
    - Per checklist item: pass/fail + evidence (screenshot path).
    - Design comparison per artboard: matches / differs (bucketed: needs a fix / deliberate-and-arguably-right / needs a product answer / not built).
    - Console/network sweep result.
    - Environment gaps + manual steps.
    - Fixture users used (emails only).

12. **Draft bug tickets** from `blocker` and `major` findings (one ticket per distinct defect, dedup by route + summary):
    ```markdown
    # <one-line defect>
    ## Context
    Found by /validate-feature against <epic id> on <base-url>.
    ## Repro steps
    1. ...
    ## Expected
    <what the AC / artboard says> (source: <AC id or artboard>)
    ## Actual
    <what happens> (screenshot: attached)
    ## Notes / Gotchas
    Severity: <blocker|major>. Finding id: <id>.
    ```

13. **Show the user the report + drafted tickets and stop.** For each draft: file / edit / drop. Only on explicit approval (and never with `--no-file`):
    - Create each approved bug as a **subtask of the epic**, tagged `qa-bot`, via `python3 -c '...' > /tmp/bug.json` then
      `cd scripts/python && uv run clickup_api.py POST list/$LIST_ID/task @/tmp/bug.json` with `"parent": "$EPIC_ID"` (JSON-safety: build payloads in Python, never template strings into JSON).
    - Attach the evidence screenshot(s) to each ticket via the ClickUp MCP (`clickup_attach_task_file`) when connected; otherwise note the local screenshot path in the ticket body's Notes.
    - Post the report as a comment on the epic (same payload discipline).

### Phase 5: Clean up

14. **Delete every fixture user you created** — always, even after a failed run:
    ```bash
    curl -sf -X DELETE "$BASE_URL/api/v1/test-fixtures/users" \
      -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
      -d '{"userIds": [<ids>]}'
    ```
    If cleanup fails, say so explicitly — the server sweeps `@test.goodparty.org` users after ~24h, but don't silently rely on it.

15. **Final summary**: checklist pass/fail counts, design verdict, tickets filed (with links) or drafted-only, environment gaps, fixtures cleaned up, findings/report file paths.

## Important Notes

- **Don't expand scope.** Validate the checklist; new feature ideas observed along the way go in the report's notes, not into tickets.
- **Evidence before assertions.** Every pass/fail needs a screenshot or asserted state; no "works fine" without proof.
- **Design bar is "would a designer flag this"** — structural/copy/state drift, not pixel-perfection.
- **Use `include_markdown_description=true`** on every ClickUp task read; plain `description` returns HTML.
- **Statuses and lists are List-scoped** — discover valid statuses via `GET list/<list_id>` before setting any.

## Troubleshooting

| Failure | Fix |
|---------|-----|
| Fixtures API 404s on dev | The gp-api deploy predates the endpoint, or you're pointing at prod. Check `--base-url`; fall back to `--creds`. |
| Fixtures API 403s | Your dev account lacks the admin role. Ask an admin to grant it, or use `--creds`. |
| Cookie injection lands on the login page | Token expired (1h TTL) — re-mint via `POST .../users/<id>/session`. Or the cookies were set on the wrong origin — navigate to `TARGET_URL` before setting them. |
| Flags won't turn on | Overrides only apply to *authenticated* users and only off-prod. Set the `e2e-flag-overrides` cookie after login, then reload. |
| `gp-feature-validator` not found | Re-run `./install.sh` and restart the session, or run the validation inline per `agents/gp-feature-validator.md`. |
| Canvas URL won't read | It may not be shared with you. Ask the owner for access, or run without design comparison. |
| Playwright MCP missing | Produce the checklist as manual steps for the user; flag prominently in the report. |
| Bug POST 400s | Priority `null` is rejected on POST — omit unset priority. Long bodies: split the comment. |
