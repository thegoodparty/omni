# 0013 — Robocall delivery outcomes are an unbuilt phase, not a dropped feed

Status: accepted

## Context

[ADR 0012](0012-outreach-done-footer-has-nothing-to-show.md) recorded, from a
read of the code, that robocall captures no delivery outcome: `answeredAt` and
`voicemailLeftAt` exist as columns, the only writer is the manual per-person
log, and every row a robocall campaign materializes has both timestamps null
forever. It listed the fix as "the robocall twin of `OutreachInboundSweep`,
writing `answeredAt` / `voicemailLeftAt` onto the already-materialized rows
from Peerly's call records."

This is the audit of that claim. **The claim holds.** The proposed fix does
not: there are no Peerly call records to sweep, because robocall does not go
through Peerly, and because no robocall vendor is integrated at all.

## Every writer of the two columns

Two, and only two, code paths write a `ContactInteractionRobocall` row.

| Writer                                                                             | Sets the outcome columns?      | `outreachId` | `manual` |
| ---------------------------------------------------------------------------------- | ------------------------------ | ------------ | -------- |
| `ContactInteractionsController.logInteraction` (`POST /contacts/:id/interactions`) | yes, one or neither            | `null`       | `true`   |
| `OutreachMaterializationService.writeBatch` (campaign launch)                      | **never** — not in the payload | the campaign | `false`  |

`ContactInteractionRobocallService` exposes `create` and
`createManyIdempotent` and **no update method at all**, so a
campaign-materialized row is not merely un-updated, it is unreachable by any
write in the codebase. `OutreachInboundSweep` is scoped to
`OutreachType.text` and `OutreachType.p2p`. No webhook route anywhere accepts
call events. No raw SQL touches the table outside the read-only resolvers.

The manual log's `outreachId: null` is deliberate and the reasoning is
recorded in the schema itself — _"Null for manual logs; Postgres treats NULLs
as distinct so the unique index never collides those rows"_ — so a hand-logged
call cannot be attributed to a send and cannot collide with the
`(outreachId, personId)` row that a send materializes.

### The columns are not droppable, and that is the actual problem

It is tempting to read "these are always null" as "delete them". That is
wrong, and getting it wrong is the point of this ADR.

The columns are genuinely populated — on manual rows. What is broken is that
**the same two columns mean different things depending on which writer made
the row, and nothing in the schema, the resolver, or the docs says so.** On a
`manual = true` row, `answeredAt IS NULL` means _a human logged this call and
told us it was not answered_. On a campaign row, it means _nobody has ever
observed anything about this call_. Those are opposite claims, stored
identically.

An absent column would be a compile error. A column with two silently
different meanings is worse than either an absent one or a permanently null
one, because every reader gets a plausible answer.

## The consequence ADR 0012 understated

0012 framed the cost as future reporting joining against nulls. The cost is
already live, in a shipped user-facing filter.

`ActivityConditionResolutionService.resolveRobocall` queries
`contact_interaction_robocall` with no `manual` predicate, against these:

```
answered:       answered_at IS NOT NULL
voicemail_left: voicemail_left_at IS NOT NULL
no_answer:      answered_at IS NULL AND voicemail_left_at IS NULL
```

`robocall: ['answered', 'voicemail_left', 'no_answer']` is a first-class
audience dimension — validated in `activityCondition.schema.ts`, labelled for
the wizard in `filterDimensions.catalog.ts` ("Answered", "Voicemail Left", "No
Answer"). A candidate can build a list from it today. What they get:

- **Pinned to a campaign** (`outreachId` set): "Answered" and "Voicemail Left"
  match **zero people, always** — the campaign's rows can never have those
  timestamps. "No Answer" matches **every single recipient of that campaign**,
  unconditionally.
- **Unpinned** ("any robocall campaign"): manual rows blend in with campaign
  rows org-wide, so the three actions silently mix hand-logged observations
  with never-observed sends. `resolveText` scopes its equivalent case through a
  `LEFT JOIN outreach` precisely to stop that kind of blending; `resolveRobocall`
  has no such distinction to draw on, because `manual` is the only signal and it
  is not consulted.

None of these error. All three look like working filters. "Re-contact
everyone my robocall didn't reach" returns the entire list, which is a
plausible enough number that nobody would question it.

This exact hazard is already named one file over, for a different dimension:
`filterDimensions.catalog.ts` explains that support-status values are safe to
advertise now because resolution handles them, so listing them "no longer
risks a filter that silently matches zero people" (ENG-10833/ENG-10837).
Robocall's three actions carry the identical hazard, unmitigated.

## Does the vendor report dispositions at all?

**There is no robocall vendor integration to report anything.** This is the
finding that decides everything below.

- **CallHub** — the vendor the product names — appears in exactly three places
  in the repo, all prose: a Storybook `subCopy="Powered by CallHub"`, and two
  code comments explaining that the compliance disclaimer is left out of the
  generated script because the caller-ID number is "not known until CallHub".
  No client, no config, no env var, no module, no schema, no route.
- **Peerly** is really integrated, but only its P2P texting product:
  `/1to1/jobs*` and `/v2/p2p/{jobId}/cdrs`. That CDR report is SMS-shaped —
  its columns are `Content`, `Chunk`, `MMS`, `Media Url`, `Unicode`. There is
  no voice endpoint, no call-disposition report, and no per-call row of any
  kind in the integration.
- Robocall outreaches never receive a `projectId`, so they are structurally
  invisible to both existing Peerly sweeps. `OutreachCompletionService` says so
  outright: robocall is out of scope _"until their own completion lifecycle
  exists"_.
- The channel has no send step at all. The flow stops after compose —
  `RobocallFlow` renders "The rest of the robocall flow (compliance review and
  payment) is still being built." The only way a robocall `Outreach` row exists
  is the legacy `POST /outreach`, which Slacks CAS (`shouldNotifyCAS` includes
  `robocall`) for out-of-band manual fulfillment.

So the honest answer to "are we dropping dispositions the vendor already
reports" is: we are not receiving them because we never asked, from a vendor
we have not integrated, for calls we do not place ourselves.

### The vendor is not even settled, and the schema records the wrong guess

`sourceCallId` was added by ENG-10677 ([74ac9b00a]) explicitly so that "a
duplicate **Peerly call-event delivery** had nothing to dedupe on", with the
note that "re-dials update the same row's timestamps". That ingestion was never
built, so `sourceCallId` is a third permanently-null column on campaign rows,
carrying a unique index that has never had a non-null value to enforce.

That commit assumed Peerly. The product surface and the compose service assume
CallHub. ADR 0012 repeated the Peerly assumption. **Nothing in the repo settles
which vendor delivers a robocall**, which is exactly why the ingestion cannot
be specified yet: the disposition vocabulary, the transport (webhook vs CDR
pull vs batch report), and the idempotency key are all vendor-shaped.

## Decision

**No sweep is built, no column is dropped, and no migration is written. The
schema is made to say what is true instead.**

A partial sweep is the one outcome to avoid. Half-populating these columns
would convert "we never looked" into "we looked and it wasn't answered", which
is the failure mode the columns already have and the reason this ADR exists.
Nulls that are honestly absent beat nulls that look like dispositions.

Dropping the columns is also wrong: manual logs populate them for real, and
`ContactActivity.schema.ts` and the CRM person overlay render them. The defect
is the missing distinction between row classes, not the columns.

What ships instead:

- Schema comments on `answeredAt`, `voicemailLeftAt` and `sourceCallId` naming
  the row-class split and pointing here, so the next reader hits it at the
  definition rather than deriving it from two services.
- The same correction in `src/contacts/AGENTS.md` (whose data-model table
  described the robocall model as the "same shape" as text, and whose
  outcome→column mapping presented `no_answer` as a working predicate) and in
  `src/outreach/AGENTS.md`.
- This ADR, as the costed statement of what building the sweep requires.

### What building it would actually take

In order, and the first item is not an engineering task:

1. **Settle the vendor and get a robocall placed through it.** Until sends go
   through an integration we control, there is no per-call identity to key a
   disposition to. This is the whole blocker; everything below is ordinary once
   it is answered.
2. **A delivery lifecycle for the channel** — robocall outreaches need the
   equivalent of `projectId`, or the sweep has nothing to enumerate.
3. **The sweep itself**, following `OutreachInboundSweep`'s shape rather than
   inventing a second one: an hourly `@Cron` on a minute offset from the
   existing two (:00 completion, :30 inbound), a bounded lookback window
   anchored on `date ?? createdAt`, per-job `try/catch` so one vendor failure
   neither aborts the sweep nor pages, `Promise.allSettled` across independent
   reports, dedupe to the earliest event per key, a pre-screen against already
   recorded `sourceCallId`s with the unique index as backstop, and — the
   invariant to preserve above all — **never create a row**, only update
   already-materialized ones, with a counter and a warn when an event matches
   no row.
4. **Only then, UI.** Same conclusion 0012 reached for text: the aggregate and
   the drawer section are days, and they must not precede a validated feed.

Note that step 3 must also decide what an ingested disposition means for the
`manual` flag and for `no_answer`, since a swept row and a hand-logged row
would then both carry real outcomes — the row-class ambiguity this ADR
documents becomes a genuine merge question at that point, not just a
documentation one.

## The related assumption, stated precisely

ADR 0012 flagged that `OutreachInboundSweep` documents its own ingestion as
unverified. That cannot be settled without production data, so it is not
guessed at here. What is assumed, and what would settle it:

| Assumed                                                                                                                                                              | Evidence that would settle it                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **The inbound CDR `Direction` literal.** Only `'sent'` was ever observed (dev has no inbound traffic), so any non-`'sent'` row is treated as a reply.                | One CDR export from a prod job that received a real reply: the distinct values of `Direction`, and whether `From`/`To` orient as assumed.      |
| **The opt-out vocabulary.** `optout` is treated as opted-out unless it is one of `'' 0 false no n`. A `'no'`-encoded column would otherwise mass-write `optedOutAt`. | The distinct values of `optout` across a prod `questionresponses` export. The sweep already logs each raw value under "opt-out row observed".  |
| **Report timestamp timezone.** `'YYYY-MM-DD HH:MM:SS'` with no offset, parsed as server-local.                                                                       | One row whose true send time is known independently, compared against the parsed value — or a statement from Peerly of the account's timezone. |

The sweep already emits the alarm for the first of these: when jobs older than
a day produce zero inbound rows it warns "possible ingestion gap (unverified
CDR Direction literal...)". **Anyone with prod log access can check that one
warning to learn whether reply ingestion has ever worked**, without touching
the database. That is the cheapest available next step and it is tracked as
ENG-10740.

## Consequences

- The three robocall activity-condition actions remain shipped and remain
  misleading. Removing them from `ACTIVITY_CONDITION_CHANNEL_ACTIONS` is a
  defensible follow-up and deliberately not taken here: it is a user-visible
  change to a filter vocabulary that door-knocking and phone-banking share, it
  wants product sign-off, and this PR's remit is to stop the schema from lying,
  not to change what the wizard offers. It is the first thing to reconsider if
  anyone reports a robocall list behaving strangely.
- `sourceCallId`'s unique index stays, unexercised. It costs one index on a
  column that is null on every row a campaign writes, and it is the right shape
  for the sweep whenever the vendor question is answered.
- Anyone building robocall reporting now hits the row-class split at the schema
  definition, at the data-model table, and here — rather than shipping a
  response rate derived from `no_answer`.

## Not decided here

- **Which vendor delivers a robocall.** The prerequisite for all of it, and a
  commercial decision rather than an engineering one.
- **Whether the robocall activity-condition actions should be withdrawn**
  pending that work, per the consequence above.
- **Whether `manual` should be consulted by the activity resolvers generally.**
  The same blending exists for text (a manual text log with `outreachId: null`
  counts toward both `text` and `p2p` conditions, which `resolveText`'s comment
  defends as intentional). Robocall makes the cost visible, but the question
  spans every channel and should be answered once.
