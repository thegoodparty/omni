# 0011 — Contact notes ride the route payload, capped and counted

Status: accepted

## Context

[ADR 0009](0009-activity-feed-on-the-route-payload.md) put the per-resident
activity feed on the route payload and explicitly left notes out of scope: "the
CRM excludes `ContactNote` rows from its feed (ENG-10780) and keeps them in a
dedicated section. The door inherits that and does not relitigate it." That
settled where notes do _not_ go. It did not answer whether they reach the door
at all.

Product now wants them to: a resident's saved notes, visible and manageable
from the at-the-door sheet — timestamped, editable, deletable, and all of them
listed.

The write half already exists.
[contactNotes.controller.ts](../../src/contacts/contactNotes.controller.ts) and
[contactNote.service.ts](../../src/contactNote/services/contactNote.service.ts)
give full CRUD over `ContactNote`, and the webapp calls those directly. **Only
the offline read is missing**, and it is missing in the way that matters: the
sheet is deliberately fetch-free, so anything not on the payload is not there
when the canvasser is out of signal.

So this ADR applies ADR 0009's decision rather than reopening it. It exists
because applying it turns out to change the numbers underneath, and the cap ADR
0009 chose does not survive the change.

## Decision

**Notes ship on `RoutePayloadTarget.notes` as `{ entries, total }` — newest
first, capped server-side at three rows per resident, with the resident's true
note count beside them.**

`ROUTE_TARGET_NOTE_LIMIT` lives in `@goodparty_org/contracts` next to
`ROUTE_TARGET_ACTIVITY_LIMIT`, so the cap the server applies and the cap the UI
assumes cannot drift.

### Why the payload, in one line

Unchanged from ADR 0009 and not re-argued here: the walk is frozen and fetched
once so it survives bad signal, and a round trip at the moment a canvasser is
standing at a door fails exactly where the product is most valuable. A note
that only loads with four bars is a note the porch never sees.

### Reads ride the payload; writes do not

The write half stays a direct call to the CRM's own endpoints, so a canvasser
in a dead zone can read notes and cannot add one. That asymmetry is deliberate
rather than an omission, and it is not the same failure in both directions.

A failed write is visible to the person who caused it: they typed something,
the save failed, they still have the text and can retry when signal returns. A
failed read is invisible in the way that matters — a blank card, during the
conversation, that looks exactly like a resident nobody has written about. The
canvasser acts on the absence without knowing it is an absence.

Making writes survive offline is a queue with its own idempotency and conflict
story, which is what `sourceId` on the knock path already cost us. It is worth
building if notes get written at the door often; it is not a prerequisite for
reading them there.

### The measurement, and why the cap is not five

ADR 0009's rig, rebuilt: a 100-stop route with 143 targets and realistic string
lengths, sized over gzip because that is what the wire carries. Every row
varies — names, ages, statuses, note bodies — because repeating one note body
across 143 targets lets gzip crush it and would understate free text by an
order of magnitude, which is the exact thing being measured.

The rebuild lands about 8% above ADR 0009's published baseline (26.3 KB vs
24.4 KB gzip with no history) and about 17% above its history=5 figure
(50.4 KB vs 42.9 KB), so **the deltas below are the comparable numbers**, not
the absolutes. Notes are measured on top of history=5.

| per-target notes (140-char bodies) | raw      | gzip     | Δ gzip |
| ---------------------------------- | -------- | -------- | ------ |
| none (history=5 baseline)          | 276.5 KB | 50.4 KB  | —      |
| 1                                  | 326.3 KB | 64.6 KB  | +14.3  |
| 2                                  | 371.6 KB | 76.7 KB  | +26.3  |
| 3                                  | 416.7 KB | 87.6 KB  | +37.2  |
| 5                                  | 506.3 KB | 110.6 KB | +60.2  |
| 10                                 | 733.6 KB | 164.0 KB | +113.6 |

**One short note per target costs about what all five activity rows cost
together** (+14.3 KB against ADR 0009's +24.1 KB on the same rig). That is the
finding, and it is why the cap is not five. An activity row is a fixed handful
of short fields — an enum, two timestamps, an id — and gzip has seen all of
them 142 times already. A note is prose nobody has written before, which is
close to the worst thing you can hand a compressor. Five notes per target is
+60.2 KB, more than double the entire feature ADR 0009 argued was worth 18 KB.

Three is where the product answer and the cost answer meet. It keeps the
worst case (+37.2 KB, every target with three notes) in the same order as the
feed already on the payload, and it costs almost nobody anything real: notes
accumulate slowly and a resident with three or fewer — nearly all of them —
loses nothing at all. Realistic pilot coverage is far below the worst case:

| notes=3 at coverage | gzip    | Δ gzip |
| ------------------- | ------- | ------ |
| 50% of targets      | 70.5 KB | +20.1  |
| 25% of targets      | 61.3 KB | +10.9  |
| 10% of targets      | 55.6 KB | +5.3   |

### Body length is a second axis, and it is deliberately not capped

The row cap alone does not bound this payload the way it bounds the feed.
`ContactNoteInputSchema` allows 10,000 characters, so three notes per target
spans three orders of magnitude:

| notes=3, every target | raw       | gzip      | Δ gzip  |
| --------------------- | --------- | --------- | ------- |
| 140-char bodies       | 416.7 KB  | 87.6 KB   | +37.2   |
| 400-char bodies       | 525.6 KB  | 120.6 KB  | +70.2   |
| 1,000-char bodies     | 777.0 KB  | 189.1 KB  | +138.7  |
| 10,000-char bodies    | 4547.3 KB | 1127.9 KB | +1077.5 |

Clipping bodies was the obvious way to close that and is the wrong one,
because the two truncations fail differently. **A missing note is legible and a
clipped note is not.** `total` tells the canvasser three of nine are shown and
sends them to the CRM for the rest; a body cut at 200 characters looks like a
complete note that happens to end oddly, and the part that says "do not ring
the bell, dog" may be the part that was cut. Offline, neither is recoverable at
the door — but only one of them announces itself.

So the tail is accepted rather than clipped, and it is accepted because it
needs a whole route of pathological rows to bite. The 1 MB row above requires
143 consecutive targets each carrying three ~10,000-character notes. What
drives real payloads is note _count_, which is capped. If telemetry ever shows
long bodies in the wild, the lever is a body cap with an explicit "truncated,
open in Contacts" marker — the same legibility rule applied one level down —
not a silent clip.

### Truncation is on the wire, not inferred

`notes` is `{ entries, total }`, and `total` is the resident's full note count
rather than a boolean.

A renderer could infer truncation from
`entries.length === ROUTE_TARGET_NOTE_LIMIT`, and it would be wrong for exactly
the resident who has precisely three notes — the common case, rendered as
permanently truncated. A boolean fixes that and still leaves the canvasser
unable to tell three-of-four from three-of-forty, which is the difference
between "you have the gist" and "go read the file". The count comes back free
from the query that applies the cap (see below), so there is nothing to trade.

**One object rather than sibling `notes` and `notesTotal` keys**, because the
two halves are only meaningful together. Siblings make "rows with no count" a
representable state, and a renderer that reads the rows and forgets the count
drops the truncation silently — which is precisely the failure ADR 0009
described when it rejected `.default([])`: a shape that promises something no
runtime enforces. Nothing parses this schema at either end, so the shape is the
only thing that can make them arrive as a pair.

### Its own block, not a fifth feed variant

Notes stay out of `history`, which is ADR 0009's ENG-10780 inheritance and also
falls out of what the two things are. A feed entry is an immutable event: it
happened, it has a date, nothing edits it. A note is a mutable record with an
id you edit and delete — which is the whole point of putting it at the door.
Merging them would put editable rows inside a list of events and make every
affordance on that list switch on variant.

Reusing `ContactNoteSchema` rather than narrowing it is the same argument ADR
0009 made for reusing the CRM's `ConstituentActivity` members: one note cannot
be worded two ways, and the webapp can drop the response of its own
create/edit straight into `entries` without a translation step that would
become a second idea of what a note is. `personId` is redundant under a target
that already has one; carrying it is what makes that splice free.

### Scoped to the resident, never the household

`notes` hangs off `RoutePayloadTarget`, keyed by `personId`, for ADR 0009's
reason with worse material. Two registered voters behind one front door are two
records, and a note about one of them read against the housemate who opened the
door is a mistake made out loud, in free text somebody typed about a named
person. `otherResidents` stays name-only, as it does for phones and the
demographic profile.

### One query for the route, cap applied in SQL

`DoorKnockingNotesService.notesByPersonId` takes the top N per person with a
`ROW_NUMBER()` window and the person's count with a `COUNT(*) OVER` on the
identical partition — one statement for every target on the route, grouped in
memory, joining the three status reads and four activity queries already in
`serve`'s `Promise.all`.

Both halves of that matter. A query per target would put ~150 round trips
behind a single GET on the read that runs at every walk open and every map
open. Fetching uncapped and slicing in Node would make that read scale with how
many notes the campaign has ever written, which is the thing the cap exists to
prevent. Sharing one partition with the count is what makes the count exact
rather than "3+", at no extra query. The whole branch is served by
`contact_note`'s existing `(organization_slug, person_id, created_at)` index.

Ordering is `created_at DESC, id DESC`: newest by when the note was written,
never by when it was last edited, so fixing a typo in a two-year-old note does
not resurface it at the top of the door's list. That matches
`ContactNoteService.listForPerson`, which the CRM's own section uses. The `id`
tiebreak is what `created_at` alone leaves to Postgres; `ContactNote` ids are
`uuid(7)` and therefore time-ordered, so it agrees with `created_at` rather
than cutting across it.

### Optional, and not `.default([])`

The reasoning is ADR 0009's, unchanged, and it is the reason to read that entry
before touching this field. Nothing parses this schema at runtime in either
direction — `ZodResponseInterceptor` is not registered globally and
`DoorKnockingController` does not apply it, so `serveRoute`'s `@ResponseSchema`
is inert, and the webapp's `clientRequest` casts ofetch's JSON without parsing
it. A default therefore fills in nothing anywhere; it only widens the inferred
type to a non-optional value, which is the guarantee no code is left to make. A
route the service worker snapshotted before this shipped has no `notes` key, so
on a phone that is offline and cannot refetch, the non-optional type would hand
a consumer `undefined` while telling the compiler it had a block.

**Absent and empty are different claims**, and keeping them apart is what the
optionality buys. The server always sends the block, `{ entries: [], total: 0 }`
included: "nobody has written anything about this person" is a thing the sheet
says out loud. An absent key means the payload predates the field and is not a
claim about the resident at all.

### Screen only

Both paper surfaces — the printed walk sheet and the downloadable PDF — omit
notes, for the reason they already omit phone numbers and the demographic
profile, and with more force again. Paper leaves the building and stops being
access-controlled when it does, and a page of free text about a named voter is
a larger disclosure than either. `walkFacts.ts` already refuses to print the
note attached to a `DOOR_KNOCK` feed row on exactly this rule; this is the same
rule and the same surfaces.

Neither renderer can pick the field up by accident: `walkListRows` builds an
explicit `WalkListRow` field by field and `WalkSheet` reads named helpers, so
nothing spreads a target onto paper.

## Consequences

- The 100-stop payload grows by roughly +11 KB gzip at 25% note coverage and
  +37 KB in the worst realistic case, on top of ADR 0009's history. Route serve
  costs one more index-served query, in the `Promise.all` already there.
- A resident with more than three notes shows three and says so. The full,
  ordered record stays in the CRM person view, which is a desk with a scrollbar
  and nobody waiting at a door.
- **Notes written at the door reach the payload on the next serve**, like the
  feed. They are written through the CRM endpoints rather than the route, so
  the walk's own copy is stale until `WalkView` asks for a route again — the
  same triggers ADR 0009 describes, unchanged by this.
- **A note can be read at the door and not written there.** Offline note
  creation is a queue this does not build.
- Notes at the door are behind the same Pro gate as notes in the CRM:
  `GET /turfs/:id/route` and every `contacts/:personId/notes` route call
  `assertProAccess`. Unlike ADR 0007's and ADR 0008's deliberate holes, this
  adds no ungated surface — nothing here is an instruction about a door that
  has to outlive an entitlement.
- The payload's cost now depends on something a human types, not only on row
  counts. The cap bounds the count; nothing bounds a body below
  `ContactNoteInputSchema`'s 10,000 characters.

## Not decided here

- **A body-length cap.** The lever if long notes ever show up in real payloads,
  with a visible truncation marker rather than a silent clip. Not built on
  speculation.
- **Writing notes offline.** A queued write with its own idempotency story,
  worth doing if notes get written at the door often, and a different question
  from reading them there.
- **Paging the door's list.** As with the feed, the cap is not a page-1 cursor
  and nothing about this contract promises the fourth note is reachable from
  here. A "see all in Contacts" affordance is a UI decision on its own surface.
- **Notes in the activity feed.** Still no, still ENG-10780, and now for a
  structural reason as well — see "Its own block" above.
