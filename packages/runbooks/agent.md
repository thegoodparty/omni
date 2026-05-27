# Runbooks

A standalone collection of reusable runbooks and scripts for AI agents.

## Project Structure

```
runbooks/
├── books/               # Procedures and reference docs (markdown) — read-only-when-asked
│   ├── INDEX.md         # Routing table — read this first to find the right procedure (covers books/ AND commands/)
│   ├── .env.example     # Non-sensitive config (paths, regions, org names)
│   └── .env             # AI agents MAY read this
├── commands/            # Procedures that ALSO register as Claude Code slash commands via install.sh
│                        # Same shape as books/; difference is invocation surface, not content
├── scripts/
│   ├── INDEX.md         # Script inventory — what each script does and which procedure uses it
│   ├── .env.example     # Secrets and credentials for script execution
│   ├── .env             # AI agents MUST NOT read this
│   ├── python/          # Python scripts — managed by uv (pyproject.toml)
│   ├── node/            # Node scripts — managed by nvm + npm (package.json, .nvmrc)
│   └── shell/           # Shell scripts — no runtime manager
├── install.sh           # Symlinks (or copies) commands/*.md into a Claude Code commands dir
└── CLAUDE.md
```

When given a task, start by reading `books/INDEX.md` to find the relevant procedure. The index routes to both `books/` and `commands/` — the agent should treat both the same way when reading.

## Used by the delegate worker

The `ops/delegate/worker` clones this repo at boot via the GitHub App token and sets `RUNBOOKS_DIR=/app/runbooks` in the agent environment. Updates to `commands/*.md` propagate to the bot on the next agent run with no `ops` redeploy. See `ops/delegate/worker/entrypoint.ts` for the clone step and `ops/delegate/README.md` for the operator runbook.

This is the only first-party consumer that pins specific paths into this repo's content. Other consumers should treat the repo as cloneable to anywhere.

## Rules

### Standalone Project
Procedures and references in `books/` and `commands/` are self-contained. Do not reference or link to external repositories, file paths outside this repo, or project-specific directories from those documents. Users clone this repo wherever they want — never assume a specific path.

Exception: the top-level `CLAUDE.md` may include a dedicated "Used by" section that names first-party consumers (e.g., bots and services that clone this repo at boot), so maintainers know where the runbooks are read from. Keep individual procedures clean.

### Books

Books are markdown files in `books/`. There are two types:

**Procedures** (`proc`) — step-by-step workflows for accomplishing a task:
- Keep focused — one procedure per workflow or concern
- Name by the action, not the topic (`query-voter-data.md` not `voter-data.md`)
- List prerequisites (tools, access, permissions) before the steps
- Should be concise and actionable — prefer examples over lengthy explanations

**References** (`ref`) — informational docs for lookup and context:
- Name by the topic (`platform-overview.md`)
- Can be broad — covering an entire system or domain is fine
- May reference external codebases, file paths, and infrastructure (that's the point)
- Keep accurate — stale reference docs are worse than none

**Shared rules for both types:**
- Every book starts with a one-line summary of what it does
- May reference scripts in `scripts/` by relative path (e.g., `scripts/example.py`)
- Should be self-explanatory without requiring external context
- Books can reference other books (`see books/vpn.md`) but should still work standalone
- Avoid deep reference chains — if book A requires B which requires C, something's wrong

### Commands

Commands are markdown procedures in `commands/` that *also* register as Claude Code slash commands via `install.sh`. Same shape as books — the difference is invocation surface, not content.

- A `commands/<name>.md` file is invokable as `/<name>` after the user runs `./install.sh`
- Without install, agents read `commands/<name>.md` directly the same way they read books
- All **shared rules for books** above apply to commands as well — one-line summary, kebab-case naming, self-explanatory, no deep reference chains
- Commands are usually procedures (`proc`); they should not be references (`ref`)
- Commands run from arbitrary working directories (the user invoked `/<name>` from some other project), so each command must include a "Where this runs" block at the top that resolves the runbooks repo path via `$RUNBOOKS_DIR` (with fallbacks)
- Add a row to `books/INDEX.md` under `Procedure: commands/<name>.md` with trigger keywords, same as for books
- When adding a new command, no `install.sh` change is required — it picks up `commands/*.md` automatically
- Commands header convention: start the file with `<!-- v<N> — <YYYY-MM-DD> -->` so reviewers can spot major revisions in the file itself
- The "Where this runs" / `$RUNBOOKS_DIR` resolution block is duplicated by design (slash commands run with only their own file in context, so a shared helper file would create a chicken-and-egg dependency). Each copy is wrapped in `<!-- BEGIN: resolve-runbooks-dir -->` … `<!-- END: resolve-runbooks-dir -->` markers so future bulk-edits across `commands/*.md` are mechanical — keep them in sync

### Scripts
- Reusable code that books reference
- If a runbook needs inline code longer than a few lines, extract it to `scripts/` instead
- Scripts should be runnable independently where possible
- Scripts should be safe to run multiple times (idempotent) where possible
- Note clearly if a script is destructive or non-reversible
- When adding or removing scripts, update `scripts/INDEX.md`
- Scripts are organized by language, each with its own runtime and dependency management:
  - `scripts/python/` — use `uv` (`uv sync` to install, `uv run` to execute)
  - `scripts/node/` — use `nvm` for Node version (`.nvmrc`), `npm` for packages
  - `scripts/shell/` — plain bash, list required tools at the top of each script
- Add new dependencies to the appropriate `pyproject.toml` or `package.json`
- Never install packages globally — always use the language-specific manager

### Environment Variables
- This repo has two `.env` files with different trust levels:
  - `books/.env` — non-sensitive config (paths, regions, org names). AI agents MAY read this to resolve `$VARIABLES` in books.
  - `scripts/.env` — secrets and credentials for script execution. AI agents MUST NEVER read this.
- When a book references `$VARIABLES`, resolve them from `books/.env`
- When a script needs secrets, it reads from `scripts/.env` at runtime
- Each book should list which `books/.env` vars it requires in its prerequisites

### Security
- Never commit `.env` files — only `.env.example`
- Never hardcode sensitive information in books or scripts
- Use `$VARIABLE` placeholders when referencing any user-specific values
- If a runbook requires credentials, document which env vars are needed without including values
- This repo is private as an extra safeguard, but write as if it were public

### Portability
- No hardcoded usernames, machine names, or OS-specific absolute paths
- Use `$HOME`, relative paths, or clearly marked placeholders
- Procedures must not assume a specific directory structure outside this repo
- References may reference external paths when documenting external systems

### Naming
- Use kebab-case for filenames (`deploy-ecs.md`, not `Deploy ECS.md`)
- Procedures: name by the action (`query-voter-data.md`, `debug-peerly-errors.md`)
- References: name by the topic (`platform-overview.md`, `aws-infrastructure.md`)

### Adding a New Book or Command

1. Create the markdown file in `books/` (read-when-asked) **or** `commands/` (also `/<name>`-invokable) following the appropriate template below
2. Add a row to `books/INDEX.md` with type, trigger keywords, path (`books/...` or `commands/...`), and description
3. If it references a new script, create it in the appropriate `scripts/` subdirectory and add it to `scripts/INDEX.md`
4. If it needs new env vars, add them to the appropriate `.env.example`
5. Commands only: prepend the `<!-- v1 — <YYYY-MM-DD> -->` header and include the "Where this runs" block that resolves `$RUNBOOKS_DIR`

**Procedure template:**

```markdown
One-line summary of what this procedure accomplishes.

## Prerequisites

**books/.env variables**: `$VAR1`, `$VAR2`
**scripts/.env variables**: `SECRET_1`, `SECRET_2`
**Tools**: list any required CLIs or access

## Steps

1. First step
2. Second step

## Troubleshooting

Common failure → fix
```

**Reference template:**

```markdown
# Topic Name

One-line summary of what this reference covers.

## Prerequisites

**books/.env variables**: `$VAR1`, `$VAR2`

## Section

Tables, code blocks, and structured content for quick lookup.
```

### Maintenance
- Delete stale runbooks rather than marking them deprecated — git history preserves them
- Don't commit dated snapshots — that's what git history is for

### Audience
- Write for AI agents as the primary reader, humans as secondary
- Be explicit — don't assume the reader has context about your infrastructure

### Writing Style
- Procedures should be concise and actionable — prefer examples over lengthy explanations
- References should be scannable — use tables, headers, and code blocks for quick lookup

---

## Active workstream: meeting_briefing + qa-spine

Last updated 2026-05-26. **Read this section before working on either workstream.**

### Branch state

| Branch | Worktree | What's there |
|---|---|---|
| `qa-spine` | `$HOME/Research/runbooks-qa-spine/` | Develop-merged + structured-exec_summary-adapted QA. Tip `026f80e`. Pushed. The unified working branch going forward. |
| `develop` | (no dedicated worktree) | Production-bound. Latest tip `cee3c21`. Includes the structured exec_summary via merged PR #35. |
| `briefing-tone-style-content` | (none active) | 2 commits ahead of origin. Holds `dispatch_meeting_briefing.sh`, `watch_meeting_briefing.sh`, `books/dispatch-meeting-briefing.md`, plus `scripts/python/render_briefing.py`. None of these merged upstream yet. |
| `briefing-exec-summary-overviews` | (none active) | Merged to develop via PR #35. Safe to `git branch -d` when ready. |

Other worktrees on disk (older test runs, prune when convenient): `runbooks-fresh-run`, `runbooks-kemah-r5`, `runbooks-port`, `runbooks-orange-slater` (latter has staged Orange PDFs from a stalled local agent — see below).

### Structured `executive_summary` (live on develop, manifest v4)

Shape: `{lead_in, items[]: {item_id, title, overview}}`. Each entry's `item_id` resolves to a top-level `items[]` entry with `tier: "featured"`; `title` must verbatim equal `items[item_id].title`; `overview` is a one-sentence distillation of `items[item_id].display.summary`. Written after Steps 9–16 deep-dive so each entry reflects what the deep dive actually says.

For `awaiting_agenda` / `no_meeting_found` / `error` placeholder artifacts: `items: []` and `lead_in` carries the check-back message.

Caps (enforced by schema): `lead_in` 300 chars, `title` 100 chars, `overview` 300 chars, `maxItems` 5.

### QA pipeline architecture (lives on `qa-spine`)

`scripts/python/qa_validate.py` reads a unified meeting_briefing artifact and runs:

1. **Deterministic checks (13, no LLM):** artifact present, identity fields, priority count, high-weight claims have extracts, **all claims have provenance**, citation IDs resolve, **`executive_summary_items_resolve`** (new — item_id resolution + tier=featured + title verbatim + ordering match), source snapshots present, **prohibited phrases** (now scans `executive_summary.lead_in` + `executive_summary.items[].overview` + `items[].display.summary`), **extracts appear in cited source** (bounded substring + rapidfuzz fallback), **summary-source coherence** (TF-IDF + containment), **completeness floor** (measures `executive_summary` chars as `lead_in` + sum of `items[].overview`), **polish_grammar** (yields `$.executive_summary.lead_in` and `$.executive_summary.items[i].overview` separately).
2. **Phase 1 LLM** (Anthropic default): per-claim triage into 8 accuracy categories.
3. **Phase 2 LLM** (Anthropic Opus by default with adversarial system prompt): escalation for high-weight Phase-1-not-OK only.
4. Writes `qa_bundle.json` with `release_verdict` ∈ {ok, warn, block}. Default exit 0 (non-blocking trial mode); `--enforce-verdict` opts into exit-1/2.

**All product-specific values live in `scripts/python/meeting_briefing_product_spec.json`** (`spec_version: 1.2`). Different product → write a new spec, zero Python changes. Spec controls: identity fields, priority filter, prohibited phrases + paths, claim types + blockable routing, accuracy categories, completeness thresholds, polish patterns, judge names → providers/models.

**Pluggable LLM judges via `QA_JUDGES` env var** (set in `scripts/.env`):
```
QA_JUDGES=claude:anthropic:claude-sonnet-4-6,opus:anthropic:claude-opus-4-7
```
Spec's `judges.phase1` and `judges.phase2` reference the names. Same-family Anthropic (Sonnet Phase 1 + Opus Phase 2 with adversarial prompt) is the in-Fargate production path because the broker proxies Anthropic only.

**Test coverage:** `scripts/python/test_qa_validate_deterministic.py` — 12 tests for the new exec_summary handling + the resolve check. Full qa-spine pytest suite at 90 pass.

### Test run conventions

**LOCAL (cheap, but stalls on full briefing_ready):**

Two recipes per the prior playbook:

(A) **Quick test against develop-ish state** — `Agent` with `isolation: worktree`, `subagent_type: general-purpose`, `model: opus`. Spawned worktree forks from `origin/HEAD` (= `origin/develop`).

(B) **Test against a specific local commit** — manually create a worktree at the commit, then spawn `Agent` WITHOUT `isolation`, instructing the subagent to operate via absolute paths under that worktree path. Always pass scripts/.env symlink: `ln -sf "$HOME/Research/.env" <worktree>/scripts/.env`.

**Local subagent stall pattern (observed 2026-05-26):** the Orange Slater run stalled at the artifact-write step (~600s no-output watchdog). Agent had gathered all materials successfully (agenda + 11 staff reports) but its final move was to "write the artifact generation script with all the data inlined" — a meta-pattern not asked for in the prompt. Recovery: re-spawn in same worktree, instruct to skip discovery and use staged PDFs. **Better:** dispatch to Fargate for full `briefing_ready` runs. The placeholder path completes fine locally (Durham took ~7.5 min).

**FARGATE (production runtime):**

1. Publish: `cd /Users/melecia/Research/runbooks-qa-spine/scripts/python && AWS_PROFILE=goodparty uv run python publish_experiments.py --env=dev`. Confirm `meeting_briefing v4`.
2. Dispatch via `dispatch_meeting_briefing.sh` (only on `briefing-tone-style-content`, extract with `git show`). Critical: `experiment_type` not `experiment_id` in the body; `--position` not `--position-name`.
3. Tail: `watch_meeting_briefing.sh <RUN_ID> --mode tail --env dev --profile goodparty` then `--mode poll` to wait for artifact.
4. Fetch: `aws s3 cp s3://gp-agent-artifacts-dev/meeting_briefing/<RUN_ID>/artifact.json <local-path>`.
5. Validate: `cd /Users/melecia/Research/runbooks-qa-spine/scripts/python && uv run python qa_validate.py <artifact-path> --no-llm` (or drop `--no-llm` for the full spine; never yet exercised with real tokens).

Log groups: `/aws/lambda/pmf-engine-dispatch-dev`, `/ecs/broker-dev`, `/ecs/pmf-engine-dev`. DLQ: `agent-dispatch-dlq-dev.fifo`.

### Preserved test artifacts (in `.reference_docs/`)

- `meeting_briefings_experiment_20260515_1831_toffel/` — original Toffel run (string exec_summary, sparse extracts, no news, no sentiment)
- `meeting_briefings_experiment_20260518_toffel_regen/` — Toffel after Round 4 prompt edits (string exec_summary, richer extracts)
- `meeting_briefings_experiment_20260526_durham_williams/` — **first run with structured exec_summary** (placeholder path). artifact.json + qa_bundle.json + prompt_snapshot. `briefing_status: "awaiting_agenda"`, June 1 agenda not yet published. qa_validate.py output: 11/12 deterministic checks pass; `completeness_floor` warns correctly for thin placeholder content.

### Open / in-flight (2026-05-26)

- **Orange Slater Fargate dispatch (stalled mid-diagnosis).** Run_id `dan-slater-20260526-2226`. SQS empty + DLQ empty + dispatch Lambda log group silent on our run, despite the Lambda being correctly wired. Leading hypothesis: FIFO `message-group-id` contention (script uses `"meeting_briefing"` for every dispatch; concurrent dashboard dispatches may be parking our message behind theirs). Next steps documented in memory `project_orange_fargate_investigation.md`.
- **Featured-path coverage gap on `executive_summary_items_resolve`.** Five branches (unknown id / not-featured / title mismatch / ordering mismatch / clean pass) covered by 12 unit tests but no live artifact. Orange Fargate is meant to close this.
- **Phase 1 + Phase 2 LLM stages** never run end-to-end with real API tokens (~$0.10–0.50 per run estimated).
- **Haystaq sentiment presentation format** — raw 0-100 vs tiered vs support/oppose pair. Needs PM input.
- **Constituent quote source pipeline** — schema slot exists, data source doesn't.
- **Renderer EO-mode vs audit-mode toggle** — `render_briefing.py` exists on `briefing-tone-style-content`, hasn't been ported.
- **Cherry-pick or merge** the dispatch scripts onto qa-spine so they're not stranded on `briefing-tone-style-content`.

### Surprises worth knowing (don't relearn)

- The `gemini-qa-agent` env var name is **lowercase-hyphenated literal**, not `GEMINI_API_KEY`. `qa_validate.py`'s `_resolve_api_key('google')` handles this.
- `scripts/.env` is a **symlink** to `~/Research/.env` (not a copy). Don't replace with a literal file or you'll lose updates. Recreate with `ln -sf "$HOME/Research/.env" scripts/.env`.
- `databricks_query.py` reads `DATABRICKS_TOKEN`, NOT `DATABRICKS_API_KEY`.
- `briefing_type` enum (`city_council_meeting` | `county_legislature_meeting` | `school_board_meeting`) does NOT include `town_meeting`. Brookline Town Meeting maps to `city_council_meeting` as closest fit with `briefing_type_closest_fit` run_decision.
- **Fargate runtime is single-agent.** Phase 2 same-family adversarial (different Anthropic model + adversarial Phase 2 system prompt) is the in-Fargate production path. Cross-family Phase 2 deferred until/if multi-provider Fargate exists.
- AWS profile is `goodparty` (NOT `work` as some older notes say).
- Dispatch script flag is `--position` (singular), NOT `--position-name`.
- Dispatch SQS body must use `experiment_type`, NOT `experiment_id` — Lambda rejects the latter.
- All `meeting_briefing` dispatches share `message-group-id "meeting_briefing"` in FIFO; suspected cause of head-of-line blocking under concurrent dispatch.
