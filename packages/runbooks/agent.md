# Runbooks

A standalone collection of reusable runbooks and scripts for AI agents.

## Project Structure

```
runbooks/
├── books/               # Procedures and reference docs (markdown)
│   ├── INDEX.md         # Routing table — read this first to find the right book
│   ├── .env.example     # Non-sensitive config (paths, regions, org names)
│   └── .env             # AI agents MAY read this
├── scripts/
│   ├── INDEX.md         # Script inventory — what each script does and which book uses it
│   ├── .env.example     # Secrets and credentials for script execution
│   ├── .env             # AI agents MUST NOT read this
│   ├── python/          # Python scripts — managed by uv (pyproject.toml)
│   ├── node/            # Node scripts — managed by nvm + npm (package.json, .nvmrc)
│   └── shell/           # Shell scripts — no runtime manager
└── CLAUDE.md
```

When given a task, start by reading `books/INDEX.md` to find the relevant runbook.

## Rules

### Standalone Project
This repo is self-contained. Do not reference or link to external repositories, file paths outside this repo, or project-specific directories. Users clone this repo wherever they want — never assume a specific path.

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

### Adding a New Book

1. Create the markdown file in `books/` following the appropriate template below
2. Add a row to `books/INDEX.md` with type, trigger keywords, path, and description
3. If the book references a new script, create it in the appropriate `scripts/` subdirectory and add it to `scripts/INDEX.md`
4. If the book or script needs new env vars, add them to the appropriate `.env.example`

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
