---
name: event-metadata
description: Write an analytics event's governance metadata (purpose, status, supersession lineage, product tag) into Amplitude — when adding a new client event, retiring or superseding one, or enriching/backfilling an existing event that is missing metadata. Called by instrument-analytics-event after it registers a new event, and runnable standalone for governance updates after an audit. Client (Amplitude) events only.
---

# Write event metadata to Amplitude

An analytics event is only legible later if it carries its metadata: the question it
answers, whether it is in use, and what it replaced. This skill writes that metadata
into Amplitude — as a structured block in the event **description** plus a `product:*`
**tag** — at the moment of change. It is the writer; it acts on a **named** event and
does not scan diffs.

Scope: **client (Amplitude) events only** — those in
`packages/gp-webapp/helpers/analyticsHelper.ts`. Backend `segment.types.ts` events are
out of scope (see ClickUp 86aj7bdkp).

Two ways it runs:

- **Called by `instrument-analytics-event`** (the change scanner) with a handoff payload
  — see "Handoff" below.
- **Standalone**, for post-audit governance updates and to enrich/backfill an existing
  event whose metadata is missing.

## Precondition: the Amplitude MCP must be authenticated

Same as the `amplitude-flag` skill. The real tools (`get_events`, `update_event`,
`create_events`) appear only after auth. If only `…Amplitude__authenticate` is
available, tell the user to run `/mcp`, complete the Amplitude OAuth login, and retry —
don't conclude the skill is broken. The first `get_events` call doubles as a live auth
check.

## Fixed facts

| Env  | Project name  | `projectId` |
| ---- | ------------- | ----------- |
| dev  | GoodParty Dev | `703396`    |
| prod | GoodParty.org | `694490`    |

Write to **both** projects (default branch — neither has branch protection). Use the
exact Amplitude event **name** (the Title Case event string, e.g.
`Onboarding V2 - Welcome Completed`), not the EVENTS-map key.

## The metadata block

Written inside an idempotent marker so re-runs replace it in place and any human prose
outside the marker survives:

```
<!-- gp-meta -->
<one line: the question this event answers>
supersession: original | supersedes <event> | superseded by <event> (reason)
in use: <YYYY-MM-DD> (#PR)    (or)   not in use: <YYYY-MM-DD> (reason, #PR)
change-set: <id or PRD link>         # optional
<!-- /gp-meta -->
```

Rules:

- **Purpose line** — drafted by you and confirmed/edited by the human at creation; then
  **immutable** (preserved verbatim on every later run, never regenerated).
- **`supersession:`** — always present with an explicit value, including `original` for
  a net-new standalone event. Never leave lineage to be inferred from a blank line.
- **Change reason** rides the line that records the change: the `superseded by` line, or
  the `not in use:` line for a pure retirement. Never the purpose line.
- **Date line** — use today's date. Exactly one of `in use:` / `not in use:` is present.
  Append the PR as `(#NNNN)` when one is detected (resolve once via
  `gh pr view --json number` on the current branch; omit if none).
- **Status is never inferred from supersession.** A superseded event can still fire from
  old/cached clients — always confirm `in use` vs `not in use` with the human.

Also write a **`product:win | product:serve | product:shared`** tag, derived from the
event name and confirmed by the human, plus any cross-cutting tag the human adds
(e.g. `capability:ai`). Do **not** write an `owner:` tag (owner is deferred). Do **not**
touch `isOfficial`, `is_active`, or visibility — the dated description line is the
status source of truth.

## Procedure

### Q1 — NEW event, or EXISTING event?

Ask which it is. If called by `instrument-analytics-event`, the payload's `mode`
answers this (skip the question). A code signal pre-selects when standalone: a new
literal → NEW; a removed literal → EXISTING (retire). Resolve the PR number once up
front.

### Mode: NEW (add)

1. Draft the one-line purpose from the event name + surrounding code; human confirms or
   edits.
2. Propose `product:*` from the event name; human confirms or edits. Optionally accept
   cross-cutting tags and a `change-set`.
3. Ask: net-new, or supersedes an existing event? **A removal elsewhere in the same PR
   does not auto-answer this** — the human must explicitly name a predecessor.
   - **Net-new** → `supersession: original`.
   - **Supersedes** → the human names the predecessor; also run the predecessor update
     below in this same run, behind one preview/confirm.
4. Write the event (see "Write mechanics"); stamp `supersession: original` (or
   `supersedes <pred>`) and `in use: <today> (#PR)`.

**Predecessor update on a supersession** (same run): require a one-line reason (block
without it); preserve its purpose line verbatim; write
`supersession: superseded by <new> (<reason>)`; then **explicitly confirm its status** —
`not in use: <today> (#PR)` (common) or still `in use` during transition (leave its
existing `in use:` line untouched, lineage only). Default the prompt to `not in use`.

### Mode: EXISTING (update)

For governance/backfill and retirements. Base action is to enrich; supersede-out and
retire are optional transitions on top.

1. Fetch the event via `get_events`; parse any existing `gp-meta` block.
2. **Enrich**: draft+confirm the purpose if absent (preserve it verbatim if already
   set); propose+confirm `product:*` if absent; fill missing fields.
3. Optional status transition:
   - **None** → stays `in use`; metadata just enriched.
   - **Superseded by another event** → name the successor; require a reason; write
     `superseded by <successor> (<reason>)`; confirm status.
   - **Retired** → confirm the removal; require a one-line reason (block without it);
     stamp `not in use: <today> (<reason>, #PR)`; keep the existing `supersession:`
     lineage.

### Preview and confirm

Render the **full resulting description** — the merged whole, not just the block — for
**every** event you will touch (one for add/update/retire, two for a supersession), so
the human can see that any existing/UI-entered content is preserved and only the
`gp-meta` block changed. Get confirmation, then write — to **both** dev and prod.

### Write mechanics

For each target project, independently (an event may exist in one project and not the
other — that is normal given different data volumes):

1. `get_events` for the event name to read current state and any existing description.
2. **Preserve existing content — never blind-overwrite.** Humans may edit metadata in the
   Amplitude UI, and that must not be lost. `update_event`'s `descriptions` map has only
   one primitive: it sets the **whole** description string to what you pass. So the skill
   does a **read-modify-write** to get append/merge semantics: read the current
   description, keep every bit of existing text, and change **only** the skill's own
   `<!-- gp-meta -->…<!-- /gp-meta -->` block (append the block if there is none yet).
   - Human prose **outside** the markers is preserved untouched.
   - An already-set **purpose line inside** the block is read and kept verbatim (it is
     immutable); only the status/supersession lines change.
   - Pass the full merged string — never just the block. Re-runs update the block in
     place (never duplicate it) and never drop human content.
3. Apply, branching on the event's `isInSchema`:
   - **Brand-new** (not ingested, not in plan) → `create_events` with the description,
     then `update_event` to set the `tags`.
   - **Ingested but unexpected** (`isInSchema:false`) → `create_events(isUnexpected:true)`
     to add it to the plan, then `update_event` for `descriptions` + `tags`.
   - **Already in the plan** (`isInSchema:true`) → `update_event` for `descriptions` +
     `tags` directly.

### Verify

Re-read each affected event via `get_events` in **both** projects; confirm the `gp-meta`
block, the `product:*` tag, and the status line are present and correct.

## Handoff (when called by instrument-analytics-event)

The caller passes a payload; honor it instead of re-asking:

- **ADD**: `mode=add`, `event`, `purposeDraft`, `productHint` (win|serve|shared), and
  `supersedes` **only** if the human explicitly named a predecessor (never inferred from
  a co-occurring removal). Skip Q1; prefill purpose and product tag (still confirm); ask
  net-new-vs-supersedes only if `supersedes` was not passed.
- **RETIRE**: `mode=retire`, `event`, `reason`. Go straight to the EXISTING/retire
  transition; stamp `not in use: <today> (<reason>, #PR)`.

Adds and removes are routed independently — the caller never pairs a removal with an add.

## Common mistakes

- Inferring `not in use` from a supersession — always confirm; old clients may still
  fire the predecessor.
- Auto-pairing an add and a removal in the same PR — supersession is only ever a human
  assertion.
- Regenerating the purpose line on a later run — it is immutable after creation.
- Blind-overwriting the description with just the `gp-meta` block — it wipes human edits
  made in the UI. Always read-modify-write: keep all existing text, change only the block.
- Appending a second `gp-meta` block instead of replacing the existing one in place.
- Writing to only one project — write dev and prod both.
- Writing `isOfficial`/`is_active`/visibility or an `owner:` tag — out of scope.
