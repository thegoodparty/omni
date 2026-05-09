# Meeting Briefing + QA Spine

## What this project is

Two deliverables, built together inside the existing `runbooks` repo:

1. **Meeting briefing runbook** — a procedure that ingests raw agenda packet PDFs (sourced from Legistar or equivalent) and emits a structured `GovernorBriefing` JSON object shaped to match the Lovable UI spec.

2. **QA spine** (`books/qa-spine.md` or `commands/qa-spine.md`) — a reusable QA harness that any runbook can call. The meeting briefing runbook demonstrates its use, but the spine is a first-class standalone artifact designed to generalize across all runbook projects.

These are research-led deliverables. The intended handoff is to engineering for integration. Prefer clarity and correctness over polish. Surface assumptions explicitly rather than resolving them silently.

---

## Read this before touching anything

This project lives inside the existing `runbooks` repo. Before writing any file:

1. Read `CLAUDE.md` at the repo root — it governs how books, commands, scripts, and env vars work.
2. Read through this repo to understand how Runbooks work.
3. Find and read prior Briefing specs, code, etc. It might require navigating locally or online, pay attention to relevant github branches as changes might be necessary to facilitate this learning expedition. Sources are referenced later, ask for more if you need them.  
4. See the Lovable UI spec before designing output structure

---

### What to bring forward from prior work

Read the committed QA addendum before designing any new checks. Preserve what is still valid. Replace only what is specific to the old pipeline's architecture and does not apply to the runbook-based version. Note explicitly what was carried forward and what was changed.

---

## Repo integration

Follow all conventions from the root `CLAUDE.md`:

- New procedures go in `books/` (read-when-asked) or `commands/` (also slash-command invokable). Make the books-vs-commands call after reading the existing structure and understanding how each is used.
- Supporting scripts go in `scripts/python/` (preferred) with `uv` for dependency management.
- New env vars go in the appropriate `.env.example` file only — never hardcode values.
- Add rows to `books/INDEX.md` and `scripts/INDEX.md` for every new file.
- If the meeting briefing runbook is a command, prepend the version header and include the `$RUNBOOKS_DIR` resolution block per the commands convention.

---

## Flags and assumptions

When context is missing, do not silently infer. Document with `# TODO: verify` and continue. This applies especially to:

- The exact `GovernorBriefing` JSON schema (if no authoritative definition exists locally)
- Legistar API access patterns and available fields
- Haystaq/L2 data format and availability
- How the output routes to the UI
- Which checks from the prior QA addendum are still valid vs. architecture-specific to the old pipeline

## Reference materials
- A naive attempt to build a runbook QA spine exists on the runbook_qa branch, you can check it out to see
- A previous iteration of meeting briefings https://github.com/thegoodparty/gp-ai-projects/tree/meeting-pipeline/meeting_pipeline and briefing qa https://github.com/thegoodparty/gp-ai-projects/tree/meeting-pipeline/meeting_qa  exist locally and on github 
- QA by design spec https://goodparty.clickup.com/90132012119/docs/2ky4jq2q-90733/2ky4jq2q-70173 https://goodparty.clickup.com/90132012119/docs/2ky4jq2q-90733/2ky4jq2q-74653 