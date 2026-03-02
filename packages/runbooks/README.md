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
books/INDEX.md   Start here — routing table to find the right book
scripts/         Reusable code that books reference
CLAUDE.md        Rules and conventions for AI agents
```

## Contributing

Read `CLAUDE.md` for all conventions. Key points:

- Every book starts with a one-line summary and lists prerequisites
- When adding a book, add a row to `books/INDEX.md`
- When adding a script, add a row to `scripts/INDEX.md`
- Never commit `.env` files — only `.env.example`
- Write for AI agents first, humans second
