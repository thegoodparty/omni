# Runbooks

Reusable runbooks, slash commands, and PMF experiment manifests for AI agents.
Lives in omni as `packages/runbooks`. `books/` and `commands/` are still written
to be portable (clone-anywhere, no paths outside this package); `experiments/` is
coupled to omni — its `manifest.json` schemas drive TS codegen in `gp-api` and
`gp-webapp` (`scripts/generate-agent-job-types.ts`).

## Project Structure

```
runbooks/
├── books/               # Procedures and reference docs (markdown) — read-only-when-asked
│   ├── INDEX.md         # Routing table — read this first to find the right procedure (covers books/ AND commands/)
│   ├── .env.example     # Non-sensitive config (paths, regions, org names)
│   └── .env             # AI agents MAY read this
├── commands/            # Procedures that ALSO register as Claude Code slash commands via install.sh
│                        # Same shape as books/; difference is invocation surface, not content
├── agents/              # Claude Code subagent definitions dispatched BY commands (installed via install.sh)
│                        # e.g. /work-on-clickup's gp-reviewer + gp-ui-tester
├── scripts/
│   ├── INDEX.md         # Script inventory — what each script does and which procedure uses it
│   ├── .env.example     # Secrets and credentials for script execution
│   ├── .env             # AI agents MUST NOT read this
│   ├── python/          # Python scripts — managed by uv (pyproject.toml)
│   └── shell/           # Shell scripts — no runtime manager
├── install.sh           # Symlinks (or copies) commands/*.md AND agents/*.md into a Claude Code config dir
└── CLAUDE.md
```

When given a task, start by reading `books/INDEX.md` to find the relevant procedure. The index routes to both `books/` and `commands/` — the agent should treat both the same way when reading.

## CAP agent skills (authoring + cost)

Two top-level Claude Code skills (auto-discovered, in `.claude/skills/`) own the CAP experiment workflows that used to be books. Reach for these, not `books/INDEX.md`, for:

- **`build-cap-agent`** — author or port a runbook into a deployed experiment (`experiments/<id>/{manifest.json, instruction.md}`): the instruction skeleton, the broker-quirk CRITICAL RULES, manifest/schema discipline, cloud Databricks querying, and publish + SQS dispatch testing in dev.
- **`analyze-cap-agent-costs`** — cohort cost analysis of deployed experiment runs: a scope resolver over `experiment_run`, the invoice-validated `costUsd`, per-turn cost curves and a population heatmap, hot-region detection, and per-job profiles.

## Used by the delegate worker

The `ops/delegate/worker` (in the separate `ops` repo) clones omni at boot via the GitHub App token with a partial + sparse checkout of just this package, and sets `RUNBOOKS_DIR=/app/omni/packages/runbooks` in the agent environment. Updates to `commands/*.md` propagate to the bot on the next agent run with no `ops` redeploy — the clone is fresh each boot. See `ops/delegate/worker/entrypoint.ts` for the clone step and `ops/delegate/README.md` for the operator runbook.

This is the only first-party consumer that pins specific paths into this package's content. Keep individual `books/`/`commands/` procedures portable — don't reference paths outside this package.

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

Commands are markdown procedures in `commands/` that _also_ register as Claude Code slash commands via `install.sh`. Same shape as books — the difference is invocation surface, not content.

- A `commands/<name>.md` file is invokable as `/<name>` after the user runs `./install.sh`
- Without install, agents read `commands/<name>.md` directly the same way they read books
- All **shared rules for books** above apply to commands as well — one-line summary, kebab-case naming, self-explanatory, no deep reference chains
- Commands are usually procedures (`proc`); they should not be references (`ref`)
- Commands run from arbitrary working directories (the user invoked `/<name>` from some other project), so each command must include a "Where this runs" block at the top that resolves the runbooks repo path via `$RUNBOOKS_DIR` (with fallbacks)
- Add a row to `books/INDEX.md` under `Procedure: commands/<name>.md` with trigger keywords, same as for books
- When adding a new command, no `install.sh` change is required — it picks up `commands/*.md` automatically
- Commands header convention: start the file with `<!-- v<N> — <YYYY-MM-DD> -->` so reviewers can spot major revisions in the file itself
- The "Where this runs" / `$RUNBOOKS_DIR` resolution block is duplicated by design (slash commands run with only their own file in context, so a shared helper file would create a chicken-and-egg dependency). Each copy is wrapped in `<!-- BEGIN: resolve-runbooks-dir -->` … `<!-- END: resolve-runbooks-dir -->` markers so future bulk-edits across `commands/*.md` are mechanical — keep them in sync
- Commands that operate on the release repo (`release-prep.md`, `release.md`) additionally include a second resolution block, wrapped in `<!-- BEGIN: resolve-release-repos -->` … `<!-- END: resolve-release-repos -->`, that resolves gp-ai-projects (via `$RELEASE_AI_DIR`, production tip `prod`), with fallbacks. (omni now releases automatically via promote-on-green off `main`, so it is no longer a manual release repo.) Duplicated by design for the same reason — keep it in sync across any command that operates on the release repo

### Agents

Subagent definitions in `agents/` are Claude Code `.md` files (YAML frontmatter — `name`, `description`, `tools` — plus a system-prompt body) that **commands dispatch by name**. They are not invoked directly by users; a command (e.g. `commands/work-on-clickup.md`) spawns them via the subagent mechanism.

- One agent per file, kebab-case, named for its role (`gp-reviewer.md`, `gp-ui-tester.md`). Prefix shared GoodParty agents with `gp-` so they don't collide with generic agents in a user's config dir.
- `install.sh` installs `agents/*.md` into `$CLAUDE_CONFIG_DIR/agents` (or `./.claude/agents` for `project` scope) the same way it installs commands. **Subagents only resolve after a session restart** — say so wherever a command depends on one.
- Keep the `tools:` allowlist tight and intentional. It gates **MCP tools too** — a UI agent that needs Playwright must name the `mcp__playwright__*` tools explicitly; omitting them silently denies access. "Read-only" reviewers omit `Edit`/`Write`.
- A command that dispatches an agent must **degrade gracefully** when it isn't installed (skip it with a note, or fall back to inline) — don't assume the user ran `install.sh`.
- Same portability rules as books/commands: self-contained, no paths outside this repo. Pass repo-specific paths (convention files, diffs, output files) in at dispatch time rather than hardcoding them.

### Scripts

- Reusable code that books reference
- If a runbook needs inline code longer than a few lines, extract it to `scripts/` instead
- Scripts should be runnable independently where possible
- Scripts should be safe to run multiple times (idempotent) where possible
- Note clearly if a script is destructive or non-reversible
- When adding or removing scripts, update `scripts/INDEX.md`
- Scripts are organized by language, each with its own runtime and dependency management:
  - `scripts/python/` — use `uv` (`uv sync` to install, `uv run` to execute)
  - `scripts/shell/` — plain bash, list required tools at the top of each script
- Add new Python dependencies to `scripts/python/pyproject.toml`
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
