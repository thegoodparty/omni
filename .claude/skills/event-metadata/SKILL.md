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

The CSV provenance artifact in omni
(`packages/runbooks/scripts/python/instrumentation_data/amplitude_event_provenance.csv`) is
the **code-provenance** sibling of this Amplitude `gp-meta` block: it records when a literal
appeared/vanished in code (written by `instrument-analytics-event`), a different question
from this block's human-asserted governance status. They are allowed to disagree; DATA-1952
reconciles them.

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
literal → NEW; a removed literal → EXISTING (retire); **both in the same diff → treat
them as two independent operations (handle NEW first, then EXISTING/retire) — never
merge them or infer a supersession from co-occurrence.** Resolve the PR number once up
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
3. Apply, branching on the event's `isInSchema` flag in the `get_events` response (the
   MCP returns it camelCase as `isInSchema` — verified against a live response):
   - **Brand-new** (the event is not returned by `get_events` at all — never ingested,
     not in the plan) → `create_events` with the description, then `update_event` to set
     the `tags`.
   - **Ingested but unexpected** (returned with `isInSchema: false`) →
     `create_events(isUnexpected:true)` to add it to the plan, then `update_event` for
     `descriptions` + `tags`.
   - **Already in the plan** (`isInSchema: true`) → `update_event` for `descriptions` +
     `tags` directly.

### Verify

Re-read each affected event via `get_events` in **both** projects; confirm the `gp-meta`
block, the `product:*` tag, and the status line are present and correct.

### Refresh the consumer surface (independent, non-fatal)

After the writes are verified, refresh the event-state Google Sheet so the change shows
without waiting for the daily Databricks sync. This is a **separate step that must fail
separately** — the Amplitude write above has already succeeded and must never be rolled
back or blocked by a refresh problem.

1. From the **prod** (`694490`) `get_events` re-read in Verify, build an override JSON in
   the scratchpad, one entry per event you touched (a supersession touches two). Key each
   entry on the **`event_type`** — the raw Amplitude event name as fired in code (e.g.
   `Onboarding V2 - Welcome Completed`) — **not** the Govern display name, even if it
   differs. The refresh matches overrides to catalog rows by `event_type`; keying on a
   divergent display name would silently inject a phantom row and leave the real one stale.

   ```json
   { "<event_type — raw event name as fired in code>": {
       "govern_display_name": "<name>",
       "govern_description": "<the full merged description you just wrote>",
       "govern_tags": ["product:win", "..."] } }
   ```

2. Run the wrapper with that file (resolve the runbooks path the same way other steps do —
   `$RUNBOOKS_DIR` or the repo checkout):

   `"$RUNBOOKS_DIR"/scripts/shell/refresh-event-state.sh --override <file>`

3. **On a clean skip:** the wrapper exits 0 with `…not configured on this host…; skipping`
   when the machine lacks the shared Sheets credentials (no cached token, no sheet id). This
   is expected on most engineers' machines — report `surface refresh — skipped (host not
   configured)` and move on. It is not an error, and it does not trigger op or a browser. (To
   configure a host, mint the token once with `scripts/shell/mint-sheets-token.sh`; it caches
   outside the checkout so it persists across worktrees — DATA-2061.)
4. **On failure:** do not fail the skill. Report the two outcomes separately —
   `metadata written ✓; surface refresh ⚠ (<reason>) — re-run refresh-event-state.sh`.
   The surface is eventually-consistent; the next trigger or a run on a configured host
   (currently the data owner's) recovers it.

### Announce in Slack (independent, non-fatal)

After the writes are verified, push a real-time notice of the change to the analytics
event-lifecycle Slack channel (DATA-2057, Source A). Like the surface refresh, this is a
**separate step that must fail separately** — the Amplitude write has already succeeded and
must never be blocked or rolled back by a Slack problem. Post **one notice per event you
touched** (a supersession touches two — the new event as `created`/`superseded` and the
predecessor as `retired`/`superseded`).

1. Run the wrapper with the fields already in scope (resolve the runbooks path the same way
   the other steps do — `$RUNBOOKS_DIR` or the repo checkout). `--change` is
   `created` for a net-new add, `superseded` for a supersession, `retired` for a
   retirement, `updated` for a pure metadata enrich/backfill. `--source` is the PR (`PR
   #NNNN`) when one was detected, else `manual (dev feedback)`:

   ```bash
   "$RUNBOOKS_DIR"/scripts/shell/notify-event-slack.sh \
     --event "<event name>" --change created --status "<in use|not in use status>" \
     --product product:win --family "<family>" --purpose "<the one-line purpose>" \
     --source "PR #NNNN" --author "<handle>" --supersession "<lineage line, if any>"
   ```

   For `--change updated`, add `--changed "purpose, tags"` (the fields that changed).

2. **On a clean skip** (`…not configured on this host…; skipping`), the machine lacks the
   shared Slack credentials. This repo is agent-driven, so self-heal once before giving up:
   if `op` is signed in and the shared vault is reachable, provision the credentials into
   `scripts/.env` from 1Password (never printing the token), then re-run the wrapper:

   ```bash
   cd "$RUNBOOKS_DIR"/scripts
   tok=$(op read 'op://Product-Analytics/Slack analytics-event-bot OAuth/notesPlain' 2>/dev/null)
   if [[ "$tok" == xoxb-* ]]; then
     grep -q '^SLACK_APP_BOT_TOKEN=' .env || printf 'SLACK_APP_BOT_TOKEN=%s\n' "$tok" >> .env
     grep -q '^SLACK_EVENT_LIFECYCLE_CHANNEL_ID=' .env || printf 'SLACK_EVENT_LIFECYCLE_CHANNEL_ID=%s\n' 'C0BECEK0603' >> .env
   fi
   ```

   Then re-run the `notify-event-slack.sh` command above. If `op` is unavailable or the
   `Product-Analytics` vault is not shared with this user, the token stays absent — report
   `Slack notification — skipped (host not configured)` and move on. Not an error.
3. **On failure:** do not fail the skill. Report all three outcomes separately —
   `metadata written ✓; surface refresh ✓/⚠; Slack notification ⚠ (<reason>)`.

## Handoff (when called by instrument-analytics-event)

The caller passes a payload; honor it instead of re-asking:

- **ADD**: `mode=add`, `event`, `purposeDraft`, `productHint` (`win|serve|shared` —
  prefix it with `product:` to form the tag, e.g. `win` → `product:win`), and
  `supersedes` **only** if the human explicitly named a predecessor (never inferred from
  a co-occurring removal). Skip Q1; prefill purpose and product tag (still confirm); ask
  net-new-vs-supersedes only if `supersedes` was not passed.
- **RETIRE**: `mode=retire`, `event`, `reason`. This is the no-successor case by
  definition — a removal that *replaces* an event comes through the ADD path's
  `supersedes` instead, so there is never a successor to name here. Fetch the event and
  parse any existing `gp-meta` block: preserve its `supersession:` line if present,
  otherwise set `supersession: original` (so the block is never left without explicit
  lineage). Then stamp `not in use: <today> (<reason>, #PR)`.

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
- Letting a surface-refresh failure fail the skill or roll back the Amplitude write — the
  refresh is a separate, non-fatal step that runs only after the confirmed write.
