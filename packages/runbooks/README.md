# Runbooks

Operational runbooks and scripts for the GoodParty.org platform, written for AI agents.

## How It Works

AI agents read `CLAUDE.md` (or `agent.md` for non-Claude agents) for project rules, then consult `books/INDEX.md` to find the right book for their task.

Books come in two types:
- **Procedures** — step-by-step workflows (e.g., querying voter data)
- **References** — informational lookup docs (e.g., platform architecture)

Scripts in `scripts/` are reusable code that books reference.

## Setup

```bash
# Clone
git clone git@github.com-goodparty:thegoodparty/runbooks.git
cd runbooks

# Configure books (non-sensitive — paths, regions, profiles)
cp books/.env.example books/.env
# Edit books/.env

# Configure scripts (secrets — API keys, tokens)
cp scripts/.env.example scripts/.env
# Edit scripts/.env

# Install Python script dependencies
cd scripts/python && uv sync
```

## Structure

```
books/           Procedures and reference docs (markdown)
books/INDEX.md   Start here — routing table to find the right procedure (covers books/ and commands/)
scripts/         Reusable code that books and commands reference
commands/        Procedures that also register as Claude Code slash commands via install.sh (see "Slash commands" below)
install.sh       Installer that symlinks commands into Claude Code's commands dir
CLAUDE.md        Rules and conventions for AI agents
```

`books/` and `commands/` both hold markdown procedures with the same shape. The split is invocation surface, not content: anything in `commands/` is *also* invokable as `/<name>` after running `install.sh`. Anything in `books/` is read-only-when-asked.

## Slash commands

The `commands/` directory holds procedures that double as Claude Code slash commands. Each file is the full procedure — the same content the agent reads either way; the slash-command install just makes it invokable as `/<name>` from any project.

### Available

| Slash command           | File                                    | What it does                                                                            |
| ----------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| `/prd-to-tech-design`   | `commands/prd-to-tech-design.md`        | PRD → blessed tech design doc + drawio data flow + ClickUp page under the PRD           |
| `/clickup-epic-create`  | `commands/clickup-epic-create.md`       | Tech design + repo → ClickUp Epic with agent-ready subtasks                             |
| `/clickup-epic-edit`    | `commands/clickup-epic-edit.md`         | Snapshot / diff / apply edits to an existing Epic; default-archive on removals          |
| `/work-on-clickup`      | `commands/work-on-clickup.md`           | Pick up a task, scope-confirm, implement against AC, verify, optionally update ClickUp  |

### Install

```bash
# From this repo:
./install.sh                                  # symlink into ~/.claude/commands (honors $CLAUDE_CONFIG_DIR)
./install.sh copy                             # copy instead of symlink
./install.sh symlink project                  # ./.claude/commands (current project only)
CLAUDE_CONFIG_DIR=~/.claude-gp ./install.sh   # for setups that run multiple Claude profiles
```

After install, restart your Claude Code session for the commands to register.

### Configure once

Slash commands run from arbitrary working directories, so they need to know where this repo lives. Add to your shell profile:

```bash
export RUNBOOKS_DIR="$HOME/Documents/gp/dev/runbooks"   # or wherever you cloned it
```

Without this, the commands fall back to checking common locations (`~/Documents/gp/dev/runbooks`, `~/code/runbooks`, `~/runbooks`) and prompt if none match.

### Skipping the slash commands

You don't have to install. Each `commands/*.md` file is also readable as a procedure — just ask the agent "use `commands/clickup-epic-create.md` to break this design into an Epic." Same content; only the invocation surface differs.

## Contributing

Read `CLAUDE.md` for all conventions. Key points:

- Every book starts with a one-line summary and lists prerequisites
- When adding a book, add a row to `books/INDEX.md`
- When adding a script, add a row to `scripts/INDEX.md`
- Never commit `.env` files — only `.env.example`
- Write for AI agents first, humans second
