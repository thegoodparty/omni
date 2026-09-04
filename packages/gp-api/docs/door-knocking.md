# Door knocking

Native door knocking: cut a turf on a map, generate an optimized walking or
driving route once, walk it, record what happened at each door. This doc is
the implementation spec; the full research trail (vendor selection, prod
benchmarks, every dated decision) lives in the door-knocking-research repo,
and the interactive dataflow diagram is `data-flow-diagram.html` next to
this file.

## The one-sentence architecture

The **filter** (existing `voter_file_filter`, untouched) names the audience;
a **turf** (`door_knocking_turf`) is a named, colored polygon over it — one
filter can hold N turfs; a **route** (`door_knocking_route`) is the frozen,
immutable artifact bought from Geoapify when the turf is created; an
**outreach** (`outreach`) is the envelope that carries the list's lifecycle and
puts it in the campaign's history; and **interactions** (the CRM epic's
`contact_interaction_door_knock`) are the only mutable record — one row per
knock on a person.

### `outreach` → `turf` → `route` is 1:1:1

The three rows are born together in one transaction and there is no state in
which any of them exists without the others. This is the invariant everything
below leans on, and it replaces a two-step flow where a turf was saved first
and a **Knock** button bought its route later. Three things fell out of it:

- **No unrouted turf, so no `locked`.** `locked` was `route !== null`, and it
  gated update, delete and the rail's counts. It is always true, so it is gone
  from the response entirely.
- **No second purchase to guard against**, so the knock endpoint's idempotency
  probe and its per-turf advisory lock retire with it. Nothing serializes two
  creates: they make different turfs, and the daily campaign gate was never
  serialized across turfs anyway (see below).
- **Every turf has an envelope**, including a Serve org's, which is what let
  the list lifecycle move off the turf and onto it.

The chain is a `CHECK` rather than a convention:
`outreach_type <> 'nativeDoorKnocking' OR door_knocking_route_id IS NOT NULL`.
Route → turf is the route's `@unique doorKnockingTurfId`, so no column was
added in either direction.

## Tables (all in this package's Prisma schema)

| Table                            | Role                                                                  | Key invariants                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `door_knocking_turf`             | The drawn area: name, color, geoPoly                                  | `voterFileFilterId` NOT unique (N turfs per filter). Always has exactly one route and one envelope. `deletedAt` is its only lifecycle column, and it is always a tombstone — see below                                                                                                                                                                                                                                                                     |
| `door_knocking_route`            | Frozen route header                                                   | `doorKnockingTurfId` UNIQUE. Written in the create transaction and never mutated after                                                                                                                                                                                                                                                                                                                                                                     |
| `door_knocking_stop`             | One per unique lat/lng, in visit order                                | `(routeId, seq)` unique; `displayAddress` copied verbatim from `Residence_Addresses_AddressLine` at freeze                                                                                                                                                                                                                                                                                                                                                 |
| `door_knocking_stop_target`      | Bare-minimum person snapshot                                          | personId (people-db UUID — never raw LALVOTERIDs), name, addressKey. Redact-in-place on deletion requests                                                                                                                                                                                                                                                                                                                                                  |
| `contact_interaction_door_knock` | One row per knock on a person (CRM epic's model, extended additively) | Writes land here via `POST /v1/door-knocking/interactions`: `sourceId` = the phone's clientKey (replay-idempotent upsert; the latest sync of a clientKey wins, so a corrected answer replaces the row rather than duplicating it), `occurredAt` server-stamped. The vocabulary was extended additively for the question flow: `inaccessible` + `not_a_voter` outcomes, nullable `willVote` — `supportAnswer` stays the CRM's 3-way. CRM readers unaffected |

### `addressKey` — the unit key, and the format that came before it

`door_knocking_stop_target.addressKey` names the knockable door. It is
`ADDRESSLINE|APT|ZIP` (`DOOR_KNOCKING_UNIT_KEY_COLUMNS`), normalized
`UPPER(TRIM(COALESCE(col::text, '')))` per segment: the CRM household key plus
the one component that separates a unit from its building.

Routes frozen before that hold a seven-segment key composed from the file's
parsed components instead. Two of those components were the cardinal directions,
and the columns they came from are INTEGER in the mirror and so always NULL — see
peopleDb/AGENTS.md § _The two direction columns cannot hold a direction_ for the
mechanism. A legacy key therefore never captured an `S` or a `W`, and nothing can
recover them from one: **a list knocked before the fix keeps printing its
addresses without directions until it is re-knocked**, because the key is frozen
and re-freezing is what re-reads the file.

Both formats stay readable. `renderUnitAddress` tells them apart by segment count
and `residents()` looks a route up by whichever format it froze, so an in-flight
list keeps resolving to live phone numbers and household context. Door counts are
computed from the stored keys and so do not move for any existing route.

The route-created activity event (one per target at freeze) is deferred to
the interaction-write PR alongside the vocabulary resolution — it should
follow the `ContactInteraction*` convention (`occurredAt`, idempotency
unique, feed branch) rather than the shape this doc previously sketched.

Shared-table touches: `OutreachType.nativeDoorKnocking` (new value — legacy
`doorKnocking` rows are the old CSV/eCanvasser drafts, 1,076 eternally
`pending` in prod; never mix them) and `Outreach.doorKnockingRouteId`
(nullable unique pointer — the per-channel pointer idiom, like
`phoneListId`).

## The list lifecycle

`status` and `archivedAt` on the `Outreach` envelope, driven by
`POST turfs/:id/complete` and `POST turfs/:id/archive`
(`{ archived: boolean }`); `deletedAt` on the turf, driven by
`DELETE turfs/:id`. The two lifecycle routes take a **turf** id and write the
**envelope** it hangs off, which is the one place the addressing and the
storage differ — the client holds turfs, and the turf is one `@unique` hop from
the row that answers.

**Why the envelope and not the turf.** The envelope already has a `status` enum
spelling `in_progress` and `completed` and an `archivedAt` of its own, and the
outreach history reads them for every other channel. The lifecycle used to live
on the turf for exactly one reason: the envelope was skipped for a Serve org (a
plain `if (campaign)` in the knock transaction), so a lifecycle stored there
would have been invisible to an org the Pro gate deliberately admits. 3.0
writes an envelope for every turf — `campaignId: null` is the Serve scope, the
same dual-scope idiom every other channel uses — so that reason is gone and the
turf's two columns went with it.

**There is no mirror any more, and that is the point.** `complete` and
`setArchived` used to write the turf and then copy the answer onto the envelope
in the same transaction, and most of what this section used to say was about
keeping the two copies honest: the ordering rule that put the copy ahead of the
idempotence guard so a list archived before the mirror shipped could still be
repaired, the shared-timestamp rule that stopped a repeat press walking
"archived since" forward on one row only, and the restore symmetry. One row
cannot drift from itself, so all of it is deleted rather than reworded. The
migration copied the turf's answer over the envelope's unconditionally on the
way through, so no list carries the old drift into 3.0.

The idempotence guards themselves stay, because they are about the timestamp
and not about the second row: pressing Archive twice must not move
"archived since", and `complete` must not restamp a finished list.

**Delete is always a tombstone.** It used to branch on the lock, because the
two cases destroyed very different amounts: an unrouted turf was a drawing that
nothing had paid for and was hard-deleted, while a routed one was tombstoned.
Every turf is routed from creation now, so only the second case survives.
Hard-deleting one would cascade turf → route → stops → targets **and** the
`Outreach` envelope, throwing away a Geoapify route that was billed once and is
documented here as never re-bought, the frozen addresses, and the name
snapshots privacy deletion redacts in place. `deletedAt` instead: unreachable
from every read and write path, intact underneath.

`assertNotLocked` is gone from `delete` and from `update` both. Update kept it
because `geoPoly` was editable and the polygon is what the route was computed
from; the endpoint now accepts `name` and `color` only, so there is nothing
left for it to protect and a list stays renameable for its whole life.

`contact_interaction_door_knock` survives either way — it hangs off the
organization, not this chain. That independence is the premise the policy
rests on, so it is asserted directly in the routes suite rather than assumed.

**Reads.** `activeTurfScope()` (`utils/turfScope.util.ts`) is the shared
`where` fragment carrying both the org scope and `deletedAt: null`. It exists
as one value because the two halves fail differently when forgotten: a missing
org scope is a cross-tenant read that review catches, while a missing
`deletedAt` is invisible — every endpoint keeps working on every list anyone
actually has, and only misbehaves on a deleted one. Four call sites need it,
across three services.

**One path deliberately opts out**, and it reads like an oversight, so it is
pinned by a test. `doorKnockingInteraction.service.ts` resolves an
already-issued `stopTargetId` so a canvasser can record what happened at a
door, and it does _not_ require the turf to be alive. The phone snapshots the
route and syncs later, so a list deleted mid-walk would turn every queued write
into a 404 and discard work that was actually done — and these rows hang off
the organization rather than the turf, so they outlive the list by design. The
org scope still applies, so nothing resolves across a tenant. The rule is that
`activeTurfScope` guards anything that _hands out_ a turf or its route, not
anything that records against one already handed out.

**The rail also scopes by surface, and only the rail does.**
`railTurfScope()` is `activeTurfScope` plus
`route: { outreach: { campaignId } }` — non-null for Win, `null` for Serve.
Door knocking could not express this before 3.0: a turf carries no campaign,
only an org through its filter, so an org holding both a `Campaign` and an
`ElectedOffice` saw one shared rail on both surfaces, which is the ENG-10976
leak `OutreachService.findByScope` exists to prevent everywhere else. The
invariant is what fixed it — every turf has an envelope, and the envelope
carries the scope.

Every other turf route is reached by id and needs the org scope only: an id the
caller already holds cannot be made to cross a surface by asking for it on the
wrong one. So the Win/Serve pair is two routes wide —
`POST turfs` / `POST serve/turfs` and `GET turfs` / `GET serve/turfs` — and
both pairs derive the scope the same way, because a create and a list that
disagreed would write rows onto a rail that cannot show them.

**Archived rows are still returned by `GET turfs`.** They carry `archivedAt`
and the client sections them. Filtering them out server-side would leave
nothing to restore, and would silently degrade the print path:
`door-knocking/print/walkListData.ts` resolves a list's _name_ by scanning
that endpoint and falls back to "Walk list".

**Archive does not require completion.** The design only offers it after Done,
but a candidate who abandons a half-walked list still needs it off the rail,
and refusing that would leave delete as the only way out.

## The walk in the outreach history (`OutreachDetail.doorKnocking`)

`GET /v1/outreach/:id` returns a `doorKnocking` block for a `nativeDoorKnocking`
envelope — turf id, route id, the turf's live name, `doorCount` / `peopleCount`
/ `loggedCount`, and the lifecycle. It is the sibling of `phoneBanking` on the
same schema, and it exists so a walk reads like its peers in the shared history
drawer instead of as a row that knows only a route id.
`GET /v1/outreach/serve/:id` returns the same block: it is the same
`findDetail` with a Serve scope, so wiring door knocking for Serve needed
nothing here.

The lifecycle half of the block is read straight off the envelope being
described rather than from a second select on the turf. It used to read the
turf's `completedAt` / `archivedAt` on purpose, so the drawer showed the source
rather than a mirror that might not have followed; there is one row now, so the
block and the row it decorates cannot disagree.

**The reverse edge needed no column.** The envelope stores
`doorKnockingRouteId`; `door_knocking_route` already carries a `@unique`
`doorKnockingTurfId` back to the list it was frozen for. So turf → route →
envelope resolved all along and route → turf is one hop the other way — the
join was there, nothing had queried it. **No migration.** Notes elsewhere in
this repo describing the turf as unreachable from the envelope are describing
the read path, not the schema.

**The counts are the rail's, not a second set.** The block calls
`DoorKnockingTurfCountsService.forRoutes`, the same aggregate
`GET /v1/door-knocking/turfs` uses, so doors are addresses paired with their
stop, people exclude ADR 0007 / ADR 0008 residents, and logged is the subset of
those people with a recorded status. Deriving any of the three here instead
would put a second denominator on a second surface for one quantity, which is
the failure ADR 0010 wrote the standing rule against — and the counts service's
own header explains why its door key is a `(stopId, addressKey)` pair rather
than a `COUNT(DISTINCT address_key)`. Anything added to this block takes its
numbers from there.

To reach it, `OutreachModule` imports `DoorKnockingModule` (which now exports
that one service). Both that edge and `DoorKnockingModule`'s own
`ContactsModule` import are `forwardRef`: door knocking → contacts → campaigns
→ peerly → outreach loops back, so the import closes a module cycle.

**A tombstoned list yields no block.** The turf is read through
`activeTurfScope`, so a soft-deleted list — whose envelope and paid route both
survive by design, above — leaves the envelope reporting only what it always
did. The drawer says so rather than printing em-dashes.

**Archive from the history drawer still goes through the door-knocking route.**
The drawer offers Archive/Restore on a finished walk like every other channel,
and the button calls `POST /v1/door-knocking/turfs/:id/archive` rather than
`PATCH /v1/outreach/:id/archive`. Both now write the same column on the same
row, so this is no longer about avoiding drift — it is that the door-knocking
route is the one that runs door knocking's own guards (the timestamp
idempotence above, and the turf scope), and having two ways in would mean
remembering to keep them in step. What blocked the button originally was reach:
nothing in the drawer could name the turf until the detail block carried its
id.

## The canvassing totals rollup (Segment → HubSpot)

`DoorKnockingStatsService` emits one server-side Segment event,
**`Door Knocking - Canvassing Totals Updated`**, carrying nine running totals
for the organization. Campaign Success owns a HubSpot workflow that copies each
property onto the contact and then its associated company — see
[`HUBSPOT_INTEGRATION.md`](../src/vendors/segment/HUBSPOT_INTEGRATION.md) for
the property list and the workflow's shape.

**One rollup event, not one event per action, and every number is a running
total.** HubSpot workflows can copy a value onto a property; they cannot sum
across events. So a "doors knocked" event carrying `1` would leave the property
reading 1 forever. `Campaign Plan - Weekly Tasks Digest` already works this way
and is the precedent.

**Server-side rather than from the webapp**, for three reasons that each stand
alone: `AnalyticsService` already resolves and attaches the user's `email` and
`hubspotId`, the totals need SQL the browser does not have, and ad blockers
drop client events while the writes still land. The existing client-side
`EVENTS.DoorKnocking` events in gp-webapp are untouched — this is a parallel
event, not a move.

### The nine numbers

All org-scoped and all-time. The definitions are one SQL statement in
`doorKnockingStats.service.ts`, which is where the traps are commented; this
table is the plain-language version CS reads.

| Property                | Means                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `doorAttempts`          | Every knock recorded, including repeat visits to the same door. One row per attempt in `contact_interaction_door_knock`      |
| `uniqueDoorsKnocked`    | Distinct doors a knock was recorded at, whatever was learned there. A door is a `(stop, addressKey)` pair                    |
| `totalContactsMade`     | Knocks where somebody came to the door — outcome `answered` or `refused_to_engage`. Repeat conversations count separately    |
| `uniqueContactsMade`    | The same population counted once per person                                                                                  |
| `committedVoters`       | People whose latest door-knock support answer is `supporter` **and** whose latest door-knock GOTV answer is `will vote: yes` |
| `votersPersuaded`       | People who answered `non_supporter` at one door and `supporter` at a later one                                               |
| `uniqueTurfsCreated`    | Lists the organization has drawn and still has                                                                               |
| `uniqueTurfsCompleted`  | The subset of those whose envelope reached `completed` ("End knocking session")                                              |
| `lastCanvassActivityAt` | The newest `occurredAt` on any knock                                                                                         |

The edges worth knowing:

- **`uniqueDoorsKnocked` reuses the rail's door key and nothing else.** A door
  is knocked when a knock was recorded at it, whatever was learned there. The
  key stays a `(stopId, addressKey)` pair for the reason
  `DoorKnockingTurfCountsService`'s header gives — stops are grouped by
  coordinate, so one address key geocoded twice is two doors. The corollary is
  that **two turfs overlapping the same address count it twice**, which is a
  real (if unusual) overcount and the price of using one door key across the
  feature.
- **It deliberately does not reuse `deriveKnockStatus`, which the map and the
  progress rail run on.** That predicate asks "is there work left at this
  door?", so it treats an `answered` knock with an `unsure` answer as
  unresolved — right for a rail, wrong for a cumulative total, which asks how
  much work was done. An undecided voter who stood and talked is the
  persuadable conversation a candidate most wants credit for, and that knock
  already counts in `doorAttempts` and both contacts-made numbers, so excluding
  it from the doors number made the event contradict itself. For the same
  reason the rail's extra "doors with nobody knockable behind them" term is
  dropped: it exists there so a do-not-knock house cannot hold a progress bar
  below 100%, and a door nobody went to was not knocked.
- **A manual `support_status` override does not make a door knocked.** Unlike
  the map and Contacts, where an override wins over the interaction, a status
  somebody typed into the CRM is not a visit. Overrides do not enter this
  number in either direction — they cannot add a door, and they cannot retract
  one that was walked to.
- **`totalContactsMade` / `uniqueContactsMade` include `refused_to_engage`, and
  that is a judgement call awaiting CS sign-off.** The knock form's second step
  overwrites the first, so a door that physically opened and then refused
  persists as a single `refused_to_engage` row, indistinguishable from one that
  never opened. Excluding the outcome undercounts real conversations; including
  it overcounts doors that were slammed. Changing it is one constant in the
  service.
- **`committedVoters` is door-attributed on purpose.** It does not use
  `SupportStatusService.derivedStatusSql`, which unions phone banking — a
  phone-banked supporter is not canvassing work. The two answers are read from
  whichever visit gave each one, since a canvasser can capture support on one
  trip and the GOTV answer on the next.
- **`votersPersuaded` is history, not current state.** Someone who flips back
  to `non_supporter` afterwards stays counted, because the persuasion still
  happened. It is computed here rather than emitted at the door because the
  knock write never reads prior status and so cannot know a transition
  occurred.
- **Turf-derived numbers describe live lists; interaction-derived numbers
  describe recorded work.** The three turf numbers all exclude tombstoned
  lists, which are unreachable from every read path in the product. The
  interaction numbers cannot make that choice and do not: knock rows hang off
  the organization rather than the turf and outlive it by design. So a deleted
  list's knocks stay in `doorAttempts` while its doors leave
  `uniqueDoorsKnocked`.

`bad address count` from the source doc is **not** here. Nothing in the product
records it, and the `not_a_voter` reason (moved / deceased, ADR 0008) is a
different claim about a different thing.

### What else rides the payload

`email` and `hubspotContactId` (the user's), which `AnalyticsService` already
attaches as Segment context traits — they are on the payload as well because
the HubSpot workflow reads event properties rather than context.
`hubspotCompanyId` is `campaign.data.hubspotId`, looked up by
`organizationSlug`, alongside `campaignId` and `organizationSlug` for
attribution.

### When it fires

- **Turf create**, after the transaction commits (`doorKnockingCreate.service.ts`).
- **Turf complete**, behind the same idempotence guard as the write, so a
  second tap on a finished list emits nothing (`doorKnockingTurf.service.ts`).
- **A daily sweep** at 05:00 Eastern over every org that recorded a knock in
  the last 24 hours, behind `CronLockService` so two replicas emit once. The
  window is measured on `createdAt`, not `occurredAt`: it asks which rows
  _landed_ since the last sweep, which is what catches a phone syncing a walk
  it did offline and a manual log backdated to last week.

**Not fired per knock.** A canvasser logs dozens a session and each would
trigger an org-wide aggregate, for properties nobody reads in real time. The
sweep is what keeps the knock-driven numbers fresh between the two lifecycle
moments.

The two lifecycle firings are attributed to the user who pressed the button;
the sweep is attributed to the organization's owner, because a volunteer's
overnight sync should not move the candidate's numbers onto the volunteer's
HubSpot contact. Segment identifies by user while the totals are the
organization's, so on a team account the numbers are the org's either way.

### Serve orgs, and the two things that read zero

Nothing here crashes for an `eo-` org, and nothing here is built for one:
`hubspotCompanyId` and `campaignId` are null (a Serve org has no campaign row),
and `committedVoters` / `votersPersuaded` are support-answer-derived, so they
read zero for a product that is moving away from asking about support at all.
Making door knocking sensible for elected officials is separate in-flight work;
this event will need revisiting when it lands.

### The out-of-repo half

Segment reaches HubSpot through the existing firehose, so **nothing lands in
HubSpot until CS creates the workflow** keyed on the exact event name. The name
carries a `DO NOT MODIFY` comment in `segment.types.ts` and is pinned by
`segment-hubspot-events.test.ts` for that reason.

## Where the code lives

`src/doorKnocking/` (turf CRUD + the create transaction; controller routes
under `/v1/door-knocking`), `src/vendors/geoapify/` (Route Planner client —
requires `GEOAPIFY_API_KEY`, validated lazily at call time so environments
without it still boot), and the evaluation/residents contracts in
`@goodparty_org/contracts`, served in-process by
`src/peopleDb/services/voterDoorKnocking.service.ts`.

## The create transaction (the money path)

`DoorKnockingCreateService.create(organization, scope, input)` behind
`POST turfs` / `POST serve/turfs`. Creating a list is what buys its route, so
this is the only paid call in the feature and the only write the create flow
persists — everything before the last step of that flow is client state.

It runs as ONE interactive transaction, and it is the knock transaction plus
the turf insert. Two things it no longer has:

- **No advisory lock.** The old one existed so two knocks of the SAME turf
  could not both call the vendor. A create always makes a new turf, so there is
  no shared row to serialize on. Two creates racing each other were never
  serialized anyway — see the quota note at step 4, which is unchanged.
- **No idempotency probe.** There is no saved-but-unrouted turf for a second
  press to act on, so there is no second purchase to return `created: false`
  for.

The steps:

1. Insert the turf. It goes first so the spend ledger at step 7 can name the
   turf that caused the charge, exactly as it did when the turf already
   existed. The ledger holds a plain int and never joins, so a rollback below
   leaving it pointing at an id that no longer exists is intended: the money
   was still spent.
2. Resolve the turf's saved `VoterFileFilter` through
   `ContactsService.resolveSavedFilterForQuery` — the same three steps the CRM
   read path runs (convert → party gate → Voter Likelihood overrides, plus
   activity-condition/support-status and contacts-made id resolution).
   `convertVoterFileFilterToFilters` alone silently drops
   `activityConditions`, `supportStatus`, `contactsMade*` and the
   voter-likelihood overrides, so a list previewed in Contacts used to knock a
   different audience than it displayed. A filter resolving to nobody → 400,
   no people-db round trip.
3. Evaluate the turf fresh via `src/peopleDb/` (resolved filters + the
   `idOverrides`/`contactsMadeIdOverrides` clauses that travel beside them +
   bbox; exact point-in-polygon ray-cast in-process — see "Interim geo"
   below), dedupe to unique lat/lng stops, re-check the 150-stop cap. The
   org's suppressed people — do-not-knock plus not-a-voter — are read
   _before_ the transaction and passed as one deduped `excludePersonIds`
   (see "Do-not-knock" and "'Not a voter'").
4. Check the daily campaign budget, and check it here so it cannot reach the
   vendor. `campaignQuota.util.ts` allows 5 turfs per organization per rolling
   24 hours, counted off `door_knocking_turf` itself, or whatever
   `organization.override_door_knocking_campaign_limit` says instead (see
   § Raising one organization's allowance). Over budget → 429 and no vendor
   call. A 500-stop daily budget was checked here beside it and has been
   removed, so this is the only per-account limit a create has to clear — see
   § The daily campaign gate. Nothing serializes two creates in one org, so
   simultaneous ones can overshoot by one; that's deliberate, and the util
   says why.
5. One Geoapify Route Planner call (coords + opaque job ids only — no PII
   leaves; loop → start=end anchor at the first stop by address order;
   open → end-only anchor at the farthest-from-centroid stop; both
   deterministic, never random).
6. Record the spend (`recordWaypointSpend`, `waypointSpend.util.ts`)
   immediately, on the plain client and NOT the transaction. The vendor has
   been paid by this point, so the ledger row has to commit whether or not the
   freeze below it succeeds — reading spend off the frozen stop rows instead
   meant every rolled-back purchase spent real money no total ever saw. A
   failed ledger write is logged and swallowed: it must not turn billed work
   into a failed request. `route.credits` records what that individual route
   cost; the ledger is where the account's spend is summed across
   organizations, which is the one thing nothing else does (see § Spend
   visibility). The ledger was backfilled from the pre-existing routes when it
   was introduced (`20260813170000_backfill_...`), so the table describes every
   route the vendor has ever billed us for rather than only those since it
   landed.
7. Create route + stops + stop targets + the `Outreach` envelope. The envelope
   is unconditional (`campaignId: null` for Serve), status `in_progress`,
   never `pending` — payment flows gate on it. The scope is the caller's,
   chosen by which endpoint was hit and never derived from what the org holds.
   The per-target activity event is still deferred, as noted above.

A crash before commit leaves zero rows, and the flow that was submitting still
holds the polygon, the filters, the name, the colour, the mode and the loop —
none of it was ever persisted, so a retry is a second press rather than a
recovery. If Geoapify is down, this fails visibly — no fallback engine in v1.

**Two of the four failure modes cannot reach the paid press.** The draw step
runs `DoorKnockingPreviewService`, which is this evaluation minus the vendor
call, and blocks on an empty result or one over the 150-stop cap. The third,
the daily campaign limit, is pre-flighted the same way: `GET quota` reports
what the organization has left, so the client refuses to **open** the flow on
a spent day rather than letting a 429 land at the one press that costs money —
the remedy is waiting out a rolling 24-hour window, which the flow's in-memory
state cannot survive. The preview response used to carry the day's remaining
stop allowance beside its counts so the draw step could disable **Build route**
on the stop budget as well; that budget is gone, so the only thing that
disables Continue there now is the 150-stop cap — a per-list bound rather than
a daily allowance, and therefore fixable by drawing a smaller shape. A vendor
timeout is the fourth and stays a plain retry.

Non-negotiable tests: (a) crash-mid-freeze → zero rows; (b) interaction replay
with the same `clientKey` → one row; (c) a create that rolls back after the
vendor call still leaves its spend in the ledger; (d) a saved list's exclusions
shrink the stop set; (e) a Serve create writes its envelope with
`campaignId: null`; (f) a dual-role org's Win and Serve rails do not see each
other's turfs.

### The daily campaign gate

Step 4 is one limit: `DEFAULT_DAILY_CAMPAIGN_LIMIT` (5) turfs per organization
per rolling 24 hours, in `campaignQuota.util.ts`, counted off
`door_knocking_turf` rows and refused with a 429. The window rolls rather than
resetting at midnight because campaigns knock in every US time zone and
nothing on the organization says which one, so a calendar reset would land
mid-afternoon for some of them.

**A 500-stop daily budget used to sit beside it**, summed over the same
rolling window from the `door_knocking_route_planner_spend` ledger, with an
admin override of its own — and it is worth knowing it existed, because
`waypoints` is still recorded and still means stops. Two ceilings on one press
meant a candidate could be refused for either reason and the flow had to
explain both, and of the two, this is the one that describes the behaviour
worth pacing. Every turf is a paid Geoapify route and a list nobody has walked
yet, so an afternoon spent carving the map into lists is backlog being built
rather than doors being knocked, and a stop count cannot express that: five
two-stop turfs and one ten-stop turf spent the same stop allowance and are not
the same behaviour.

What replaced the stop budget is not another cap but visibility. Spend is still
recorded per route (`waypointSpend.util.ts`) and the account-wide total is
alerted on in tiers, so the shared credit pool is bounded by watching it rather
than by rationing each organization against a number nobody could set
correctly — see § Spend visibility and the budget tiers below it. **Nothing
caps stops per organization any longer.** The only bound on how large one list
can be is `MAX_STOPS` (150), which is a per-list hard cap enforced at the
freeze and by the `CHECK` on `stop.seq`, and which the draw step blocks on
before the paid press.

The 429's body is the design's own wording, because the create flow renders it
as a blocking dialog rather than a toast:

> You've created 5 door knocking campaigns today. Go knock the doors you've
> already mapped, and build more lists tomorrow.

The five in that sentence is the organization's own limit read back through
`dailyCampaignLimit()`, not the constant, so an org an admin has raised is
quoted the number that actually refused it.

**Deleted turfs still count.** `campaignsRemaining` deliberately omits the
`deletedAt: null` every other turf read carries. Every turf since 3.0 was
billed for a Geoapify route the moment it was created, and that route is
documented above as never re-bought, so the spend stands whether or not the
row was later shelved. A count that skipped tombstones would also make Delete
the way to buy unlimited routes: create, delete, repeat.

**The campaign gate counts rows; it does not read the remainder.** The create
transaction inserts its turf at step 1, before reaching step 4, so the count
inside the transaction already includes the campaign being created — the fifth
of a window sees five rows and is allowed, the sixth sees six and is not. Both
of those report zero remaining, so a gate written against `campaignsRemaining`
would quietly leave every organization with four.

**The five is where an organization starts, not where it has to stay.** An
admin can raise a single org, and the column that does it is the one the stop
budget used to own — see § Raising one organization's allowance. That is the
whole of the per-account story now: one number, resolved in one function, read
by the gate, the 429's wording and `GET quota` alike.

### Reading the allowance before the press

`GET /v1/door-knocking/quota`, Pro-gated with the rest:

```ts
type DoorKnockingQuotaResponse = {
  campaignsRemaining: number
  campaignLimit: number
}
```

It used to answer two allowances; the stop budget's remainder and its limit
went with the budget itself, and there is nothing left for a client to
pre-flight except this one.

The limit rides along with the remainder rather than being a constant the
client keeps a copy of, because it is genuinely per organization: a hardcoded 5
is wrong for exactly the orgs an admin raised.

Org-scoped, with no Serve sibling. The allowance belongs to the organization —
turfs reach it through `voter_file_filter.organization_slug` — so there is no
per-surface answer for a Win/Serve pair to keep apart the way the rail has.

Advisory, and that is the division of labour: `assertCampaignQuota` inside the
create transaction stays the authority, since a teammate's turf can spend the
allowance between this read and the press. This read exists so the flow can
refuse to open on a spent day rather than take a candidate through five steps
and 429 at the end.

## Spend visibility

The spend ledger is a record, not a guardrail. It used to be half of one: the
500-stop daily budget summed these rows over a rolling 24 hours to decide
whether an organization could route another turf. That budget is gone and the
write survives it, because **nothing else sums spend across organizations** —
the total bill scales with how many orgs hold the flag, and the campaign limit
cannot bound it even in principle, since five two-stop turfs and five 150-stop
turfs are the same five campaigns and differ by a factor of thirty in credits.
So the write is now purely for account-wide accounting rather than for a
per-org guardrail: the budget tiers below evaluate the `DoorKnockingSpend` log
line, and this table is where the same spend is summed in SQL when one of them
fires and someone has to say which organization caused it.

What a route costs is priced in `doorKnocking/utils/geoapifyCost.util.ts`, the
one transcription of [Geoapify's cost
calculator](https://www.geoapify.com/pricing-details/), and it is neither flat
nor linear. Every create makes **two** billed calls: the Route Planner
optimization, charged per location — every stop plus the agent's start and end
anchors, squared rather than multiplied when there are fewer than ten of them —
and `fetchPathGeometry`'s Routing request, charged one credit per pair of the
waypoints in the resulting plan. A stop therefore costs a little over ten
credits all in, and a small turf costs far less than that: two stops is about
five credits, 150 is about 1,650.

Both calls are in `credits` everywhere it appears — the route row, the log
line, the ledger, the counter. **`waypoints` is not credits divided by
anything**: it counts stops, and the two numbers do not convert into each other
in either direction, because the Route Planner's rate is quadratic under ten
locations, every route also pays for its agent's anchors, and a geometry fetch
that never completed is free. `waypoints` is now a measurement rather than an
allowance — nothing caps stops per organization — so read this line for money
through `credits` and for how much walking was bought through `waypoints`.

No surface here can carry the API key: the Route Planner SDK puts the key in
its request URL, so nothing sourced from a URL or a caught error is ever logged
or labelled. Every metric attribute is a closed set of literals.

| Signal                                         | Where                                                | Reads                                                                                                                                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event: 'DoorKnockingSpend'` log line          | `doorKnockingCreate.service.ts` spend path           | `organizationSlug`, `turfId`, `waypoints` (stops), `credits` (both calls) — emitted before the ledger write and regardless of its outcome, so a lost ledger row cannot hide money the vendor has already billed |
| `geoapify_credits_total{api}`                  | `vendors/geoapify/observability/geoapify.metrics.ts` | Credits billed, split `route_planner` / `routing`, no org label (Prometheus cardinality)                                                                                                                        |
| `geoapify_vendor_call_count_total{api,result}` | same                                                 | `api="route_planner"` and `api="routing"` — call counts and failures, including a geometry fetch that was billed and returned nothing usable                                                                    |

What pages: the global **route planner spend ceiling** alert (>10,000 credits /
6h across all orgs, `#dev-alerts`, `@win-bugs`), the **daily credit budget**
tiers below it, and the `≥ 500` route alerts on this controller — including the
502 for a missing `GEOAPIFY_API_KEY`. The per-org 429, the empty/oversized-turf
400s, and the `VOTER_DATA_UNAVAILABLE` 400 deliberately do not (see gp-api
`docs/observability.md` § Server-errors-only controllers).

Deliberately a chart-and-alert rather than an enforced global cap: a hard
ceiling across organizations would let one org's knocking fail another's, which
is worse than a page during a pilot.

### Raising one organization's allowance

The five is a default, not a ceiling.
`organization.override_door_knocking_campaign_limit` (nullable int, null = the
default) replaces it for exactly one org, and `dailyCampaignLimit()` in
`campaignQuota.util.ts` is the only place it is read — so the gate inside the
create transaction, the 429's wording and `GET quota`'s `campaignLimit` all
quote the same number.

The override used to move the stop budget, which was what "raising an
organization" meant while that budget existed: more doors per day, and the same
five turfs. It was repurposed rather than deleted when the budget went, because
the reason for having it did not go with it — a pilot org can legitimately need
more than five lists a day, and the campaign count is now the only thing
between it and the vendor.

- **Who can set it:** admins only, through
  `PATCH /v1/organizations/admin/:slug` behind
  `AdminOrM2MGuard`. It is deliberately absent from the self-service
  `PatchOrganizationDto`: a candidate raising their own spending limit is the
  whole risk, since every campaign it buys is a paid Geoapify route drawn from
  one daily pool shared with every other organization.
- **How to read the current value:** `GET /v1/organizations/admin/:slug`
  returns `overrideDoorKnockingCampaignLimit` (null when the org is on the
  default), so triaging a budget alert does not need a psql session. Readable
  exactly where it is writable — the candidate-facing `GET /organizations/` and
  `GET /organizations/:slug` do not carry it, and neither does the
  `/admin/list` search table.
- **How high:** capped at `MAX_DAILY_CAMPAIGN_LIMIT` (30 campaigns), which is
  derived rather than chosen. A campaign holds at most `MAX_STOPS` (150) stops
  and a stop draws about eleven credits — ten for its Route Planner location
  plus its share of the path-geometry Routing call — so a full-sized campaign
  is near 1,650 credits and thirty of them is about the account's assumed daily
  pool of 50,000. Most campaigns are far smaller, so in practice thirty sits
  well under the pool; the point is that no admin can hand one organization an
  allowance the account could not fund even in the worst case. Above it the
  number is unhonourable no matter which org asks, so the DTO rejects it with a
  400 rather than letting the vendor discover it.
- **How long:** per organization and permanent until someone sets it back to
  null. Nothing expires it and nothing reviews it.
- **What it costs everyone else:** the pool the budget tiers below watch is
  fixed and shared, so an override does not create headroom — it moves one
  org's share of the same 50,000 credits. An org raised to 30 campaigns can
  consume the whole account's day on its own, which is exactly why 30 is the
  ceiling and not a round number above it.

There is no audit table in gp-api, so the only record of a change is the
structured log line `event: 'DoorKnockingCampaignLimitOverride'`
(`organizationSlug`, `previousLimit`, `newLimit`, `actorEmail`), queryable in
Loki the same way `DoorKnockingSpend` is. `actorEmail` is frequently null:
gp-admin authenticates with an M2M token and authorizes the human in its own
server action, so gp-api never sees who pressed the button.

### The account-wide budget, and why it needs its own alerts

The ceiling above answers "is something running away?" — a rate. It cannot
answer "how close are we to the wall?", because nothing in gp-api knows what
the account can afford. That matters because the wall is hard and shared:
when Geoapify refuses, `planRoute` throws `BadGatewayException` and list
creation returns 502 for **every** organization at once, including ones that
spent nothing.

So `deploy/components/alerting/geoapify-budget-alerts.ts` generates four rules
at 60 / 80 / 90 / 95% of `GEOAPIFY_DAILY_CREDIT_POOL` over a rolling 24h,
escalating from "is this real growth?" to "pull the flag from the heaviest
orgs now". A runaway trips the 6h ceiling first and these later, which is the
intended ordering.

Three things to know before trusting a tier:

- **The denominator is hand-maintained.** The allowance lives in Geoapify's
  billing console; `GEOAPIFY_API_KEY` is an ECS secret and carries no plan
  information. The constant is 50,000 — the TDD-sized $179/month tier, and the
  same figure the 6h ceiling already reasons against. If we are still on a free
  key it is 3,000 (see § Procurement above), the constant is 16x too high, and
  no tier can fire before the vendor starts refusing. **If all four fire at
  once, suspect the constant before the spend.**
- **The tiers are per environment; the allowance may not be.** The stream
  selector pins `$ENV`, so dev and prod each measure only themselves. If they
  share a key they share a pool, and real headroom is smaller than any tier
  reports — part of why the first tier sits at 60%.
- **Rolling 24h, not calendar.** LogQL has no calendar alignment, so the window
  can span the tail of one metered day and the head of the next. That
  over-estimates, which is the safe direction here.

All four read the same `DoorKnockingSpend` expression, differing only in
threshold, so Loki's result cache serves tiers 2-4 from the work tier 1 does.
Keep it that way — a per-tier edit to the query forfeits it.

Credits per organization per day (Loki, no dashboard needed):

```logql
sum by (organizationSlug) (
  sum_over_time(
    {service_name="gp-api", deployment_environment_name="prod"}
      |= "DoorKnockingSpend" | json | event = "DoorKnockingSpend"
      | unwrap credits [24h]
  )
)
```

Same thing from the ledger, which is where the spend is recorded rather than
logged — and the only place it is summed in SQL:

```sql
select organization_slug,
       date_trunc('day', occurred_at) as day,
       sum(waypoints) as waypoints,
       sum(credits) as credits
from door_knocking_route_planner_spend
where occurred_at > now() - interval '7 days'
group by 1, 2
order by credits desc;
```

Both queries measure money, and `credits` is the same figure in either. There
is no per-organization spend cap to read a heavy org against any more, so the
yardstick is the campaign limit: a full-sized campaign is about 1,650 credits,
so an organization far above five of those (~8,000 in a rolling 24h) has either
been granted an override — check `override_door_knocking_campaign_limit` on the
org — or is looping. The `waypoints` sum beside it is stops, and it answers a
different question: how much walking the organization actually bought. It is
not a credit figure divided by anything, because credits are not proportional
to stops — a turf under ten locations is billed on its square, and every route
also pays for its anchors and its Routing call.

## Serving

`GET /v1/door-knocking/turfs/:id/route`. Every read of a route (later
opens, walk start) = frozen route + live enrichment: residents-by-address from people-db (only units
containing a target; targets get live age/party; otherResidents are
name-only) + each stop's **effective** knock status (org-wide; prior-route and
prior-campaign contact is deliberately visible). Effective means the CRM's rule,
`override ?? derived`: a manual `support_status` override in
`contact_current_status` wins, otherwise the latest ANSWER-bearing
`contact_interaction_door_knock` row wins — matching
`SupportStatusService.derivedStatusSql`, so a later "not home" reads as a failed
re-attempt rather than a retraction of support already given. Pure
last-write-wins made the door and Contacts disagree about the same person, and
made a hand correction invisible at the door. `undecided` has no map member and
reads as unknown (still worth knocking). The route
payload ships `stopTargetId` per target (the interaction write key), that
target's own recent outreach history and saved contact notes (see below), no
`navigate` block (phone builds deep links from lat/lng + a per-route
locale), and is snapshotted offline on the phone.

## Previous outreach, at the door

Each target carries `history`: its own recent outreach, newest first, capped
at five rows — see [ADR 0009](adr/0009-activity-feed-on-the-route-payload.md)
for why this rides the route payload instead of a per-person fetch. Short
version: the walk is frozen and fetched once so it survives bad signal, and a
round trip at the moment a canvasser is standing at a door fails exactly where
the product is most valuable. Capped at five, a 100-stop payload grows 24.4 KB
→ 42.9 KB gzip worst case (~29 KB at realistic coverage); uncapped it passes
7x, because text and robocall rows accrue one per recipient per launched
outreach.

The entries are the CRM's own `ConstituentActivity` variants — `DOOR_KNOCK`,
`TEXT`, `ROBOCALL`, `STATUS_CHANGE` — reused from contracts rather than
redeclared, so `do_not_knock` and `not_a_voter` read the same here as in the
Contacts person view. `POLL_INTERACTIONS` is elected-office only and door
knocking is Win-only; the legacy `OUTREACH` rows are keyed on `lalVoterId`,
which stop targets deliberately don't store.

**Keyed by `personId`, never by address.** Two registered voters behind one
front door often answered differently, and merging their histories would show
a canvasser a refusal belonging to the housemate who isn't standing there.
`DoorKnockingActivityService` applies the cap in SQL (`ROW_NUMBER()` per
person per source), because route serve runs on every walk and map open and
must not scale with how much outreach the campaign has ever run.

`PersonSheet` draws it as an `ActivityFeedCard` in the sheet's scrolling body,
beside Contact information and Household rather than in the footer with the
script and the log form. That placement is what keeps it visible for a resident
flagged do-not-knock or not-a-voter, whose footer is withheld: the feed carries
the flag's own `STATUS_CHANGE` row, so hiding it would hide who set the flag
and when from the one person positioned to notice it was set on the wrong
resident.

**A door logged mid-walk joins its own feed on the next serve, and `WalkView`
asks for one when a resident logged this session is opened again** — from the
stop list or the sheet's resident switcher. The refresh is what makes the feed
match the status the same knock already updated everywhere else in the panel;
without it the card reads as broken rather than as stale. It is asked for on
reopen rather than after every door because the serve is the feature's heaviest
read and a walk is meant to survive on the payload it opened with, so walking
the list forward pays nothing and only the canvasser checking "did that save?"
pays a serve. The row itself is always the server's — nothing reconstructs a
`DOOR_KNOCK` entry from the derived `knockStatus`. A refresh that fails is
silent: the knock is already saved, so the feed keeps showing what it was
served with.

**The `not_a_voter` door is refreshed on a delay rather than not at all**
(PR #1310, which closed the residual ADR 0009 recorded). Its sheet is held open
across its own knock so the ADR 0008 follow-up can be answered, so neither
trigger above ever fires for that resident — and refreshing on the knock is the
thing the ADR ruled out, because the arriving serve rebuilds `NotAVoterControl`
underneath the question. The refresh therefore waits for the follow-up to
_resolve_: `WalkView` asks for one when the answer lands (after the status patch,
which cancels in-flight serves) and, if the canvasser walks away from the
question instead, on sheet close — gated on a `not_a_voter` status with no reason
yet. That gate is load-bearing rather than tidy: an answered resident already
paid for a serve and an ordinary door pays none, so this stays one serve per
held-open sheet and does not become the per-door refetch ADR 0009 rejected the
per-person endpoint to avoid.

## Notes, at the door

Each target also carries `notes`: that resident's saved `ContactNote` rows,
newest first, capped at three, as `{ entries, total }` — see
[ADR 0011](adr/0011-contact-notes-on-the-route-payload.md). It rides the
payload for the reason `history` does, and this section is only the parts that
differ.

**The cap is three rather than five because free text is not priced like an
activity row.** On ADR 0009's own rig, one 140-character note per target costs
about what all five activity rows cost together (+14.3 KB gzip against
+24.1 KB), because an activity row is a handful of short fields gzip has
already seen 142 times and a note is prose nobody has written before. Five
notes per target would be +60 KB, more than double the feature ADR 0009 argued
was worth 18 KB. At three, the worst case is +37 KB and realistic 25% coverage
is +11 KB.

**`total` is the resident's real note count, and it is on the wire on
purpose.** A capped list that cannot say it is capped shows a subset as though
it were the record. Inferring truncation from `entries.length` gets the
three-note resident wrong forever; a boolean cannot tell three-of-four from
three-of-forty. The count rides the same window that applies the cap, so it
costs nothing. It is one object rather than sibling `notes`/`notesTotal` keys
because rows and count are only meaningful together and nothing parses this
payload at runtime to enforce that they both arrive.

**Note _bodies_ are not clipped**, and the row cap alone therefore does not
bound this the way it bounds the feed —
`ContactNoteInputSchema` allows 10,000 characters. That tail is accepted rather
than clipped because the two truncations fail differently: a missing note
announces itself through `total`, and a clipped note looks like a complete note
that ended oddly, with no way to fetch the rest from a porch.

`DoorKnockingNotesService` reads every target on the route in **one** statement
— `ROW_NUMBER()` for the cap, `COUNT(*) OVER` on the same partition for the
count — served by `contact_note`'s
`(organization_slug, person_id, created_at)` index. Ordering is
`created_at DESC, id DESC`, matching `ContactNoteService.listForPerson`: a note
sits where it was written, so editing a typo does not resurface a two-year-old
note at the top.

Keyed by `personId` like the feed, never rolled up to the address, and the
block is always sent — `{ entries: [], total: 0 }` for a resident nobody has
written about. An absent key means the payload predates the field, which is not
a claim about the resident.

**Neither paper surface carries notes** — not the printed walk sheet, not the
downloadable PDF — for the reason that already keeps phone numbers and the
demographic profile off them, and with more force: free text about a named
voter on a page that stops being access-controlled the moment it leaves the
building. `walkFacts.ts` already refuses to print the note on a `DOOR_KNOCK`
feed row under the same rule.

**Writes are not on this path.** The webapp posts to the CRM's own
`contacts/:personId/notes` routes, so a canvasser out of signal can read notes
and not add one. Deliberate: a failed write leaves the typed text in front of
the person who wrote it, while a failed read is a blank card that looks exactly
like a resident nobody has ever written about. Both halves are Pro-gated —
`GET /turfs/:id/route` and every note route call `assertProAccess` — so unlike
the two suppression writes below, this opens no ungated surface.

## Do-not-knock

`POST /v1/door-knocking/do-not-knock` — see
[ADR 0007](adr/0007-do-not-knock.md) for why this is its own
`ContactStatusField` (`do_not_knock`, values `active` / `cleared`) rather
than a `support_status` override: a refusal is an observation, an
instruction not to return is not, and the two would otherwise share one
override slot.

Its own endpoint rather than a field on the knock payload, because it's
recordable when there's no outcome worth logging and has to be reversible
on its own. No `sourceId`: that key is for replayed activity syncs, and
`changeStatus` already no-ops on an unchanged value, so a double-tap is
free while a genuine reversal earns its own row.

Suppression happens at evaluation (step 3 above), which a **frozen route
has already passed** — so the serve payload also carries a live
`doNotKnock` per target, and the walk view, the printed sheet and the
downloadable PDF walk list all show a skip instead of a logging form. Deliberately not gated on Pro — one of the two
exceptions in "The Pro gate" above, and it survived that gate landing: a
candidate who cannot honor "don't come back" is worse than one who never had the
button, so the instruction outlives the entitlement.

## "Not a voter" — the reason, captured

`POST /v1/door-knocking/not-a-voter` — see
[ADR 0008](adr/0008-not-a-voter-reason.md). The follow-up question behind a
`not_a_voter` outcome ("What happened?", answered **Moved** or **Deceased**)
lands as a fourth `ContactStatusField`, `not_a_voter`, values
`moved` / `deceased` / `cleared`. One field rather than two, because they
are mutually exclusive answers to one question and the projection is unique
per `(org, personId, field)`; not a column on the interaction, because the
outcome already ships without a reason and a correction made on a later
visit could never reach the replay-idempotent row it needs to change.

Ungated on Pro alongside do-not-knock — the second exception in "The Pro gate"
above. It suppresses future evaluation the same way a refusal does, and the
reason a door is wrong is worth capturing from whoever is standing at it.

**Nothing is removed.** The prototype's phrasing ("remove this address from
that person's voter record") is deliberately not implemented: no person is
deleted, no address is unlinked, and nothing is written back to the
L2-derived voter data — which the next file refresh would overwrite anyway.

Both reasons suppress, through the same `excludePersonIds` conjunct
do-not-knock uses (step 3 above), unioned and deduped. "Moved" suppresses
the person rather than the address because there is no address in the
status projection and, more to the point, no second door to preserve:
people_db carries one residence per voter, so excluding them removes
exactly the door they were reported to have left. Live enrichment is
untouched — a flagged person still resolves residents and phones, and
`mayHaveMoved` (the voter file catching up) stays an independent signal
from a canvasser's report, which is ahead of it.

Frozen routes carry `notAVoterReason` per target, read live like
`doNotKnock`, present only when there is a reason. Reversible: posting
`cleared` records the lift with an actor and a timestamp rather than
deleting the row, because a mis-tapped **Deceased** is exactly the mistake
whose correction someone will later want to trace.

## The pack (exploration map, step 2)

`GET /v1/door-knocking/pack` (gp-api), served in-process by `src/peopleDb/`.
Built per request from people_db, **still never stored** — see "Why it is
still built per request" below. It carries positions, the person→household→dot
index arrays, and one byte per person per dimension (SoA). Dim buckets are
derived by inverting `src/peopleDb`'s `VALUE_MAPPERS`, so pack filtering can't
drift from list-filter semantics. Map-minimal SELECT: no AddressLine, accuracy
in WHERE only (v1 = `GeoMatchRooftop` only), `registered` computed as
`(StateVoterID IS NOT NULL)`.

### Age is cut from the filter keys, not chosen

Every other dim inverts a `VALUE_MAPPERS` entry. Age can't: **ENG-10752 re-cut
the bands and both generations of key are live**, a list saved before it
carries `age18_25` and one saved after carries `age18_24`, and
`voterFileFilter.utils.ts` deliberately keeps each key's original bounds
because reinterpreting one would silently change an existing list's
membership. There is no single set of "the age bands" to invert.

Nor can the pack approximate. The map shades from these buckets while knock
time evaluates the real ranges, so a bucket that is a near-miss for a key gives
a map whose count disagrees with the list it is previewing — the
two-denominator failure [ADR 0010](adr/0010-draw-time-address-preview.md)
forbids. The old buckets did this twice: `age50_64` shaded `50_plus` (every 65+
door the list would skip) and `age65Plus` had nowhere to map at all, which is
what the disclosure sentence used to name.

So contracts' `PackAgeBuckets.ts` **cuts at every boundary either generation
uses**, and derives the buckets from `AGE_FILTER_KEY_RANGES` rather than
declaring them:

```
 18_24   25   26_34   35   36_49   50   51_64   65_plus
 |--------- age18_25 ---|
       |--------- age25_35 ---|
                   |--------- age35_50 ---|
                                |--------- age50Plus ------------|
 |18_24-|  |-age25_34--|  |-age35_49--|  |-age50_64--|  |age65Plus|
```

Nine keys produce eight intervals, three of them a single year wide, because
the retired keys share their inclusive edges (25 is in both `age18_25` and
`age25_35`) and the current keys do not. Every key is then an exact union, and
`voterFileFilter.utils.ts` builds its `ageInt` ranges from the same table — one
source, two derivations, with a test that walks every key against every age
from both sides.

**The cost is about twenty bytes, once.** The plane is one byte per person
either way and nine values is nowhere near the 256 a byte holds; only the
manifest's value list grew. **`PACK_FORMAT_REVISION` is now 2** because the
meaning of the shared district build changed, while the manifest's `version`
stays at 1 because its framing did not — see
[ADR 0014](adr/0014-the-voter-pack-has-two-versions.md) for why those are two
different numbers.

Single-year buckets are a **filtering** vocabulary. gp-webapp's
`groupAgeSlices` rolls them into the current generation's five bands before any
breakdown renders, so nobody is shown a "25" slice beside a "36–49" one, and
the frozen-route breakdown reads the same table so a list can't re-shape its
own age mix by being walked.

### Two planes are the campaign's, and the line matters

Every dim above describes a **voter**, and the scan that produces them is a
pure function of `districtId` and the voter mirror. Two are not:
`canvassStatus` and `contactsMade` describe what **this organization** has
done, and neither can be read from people_db at all.

Both follow one shape. `DoorKnockingPackService` (gp-api) reads the org's own
tables, ships `(personId, byte)` pairs with the request — no names, no
outcomes beyond the bucket, no PII — and `PackEncoder` joins them as the last
two planes while it walks the district. **The proxy never patches bytes**, and
the district scan never learns the organization's slug.

That ordering is not tidiness. The [headroom
profile](perf/voter-pack-headroom.md) found the expensive 22.5 s of a 23 s
build depends only on `districtId`; a per-district cache is the one change
that reaches "a few seconds", and it works by copying a shared build and
rewriting the tail. **A per-organization read that moved into
`VoterPackService` would delete that possibility.** Add a campaign-specific
dim by appending a plane here, never by joining anything org-scoped into the
scan.

|                | `canvassStatus`                                                   | `contactsMade`                                                     |
| -------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| Buckets        | `DOOR_KNOCK_STATUSES`                                             | `'0'`…`'5+'` (`CONTACTS_MADE_BUCKETS`)                             |
| Byte 0 means   | not knocked                                                       | never contacted                                                    |
| Source         | latest ANSWER-bearing `contact_interaction_door_knock` per person | `COUNT(*)` over all four `contact_interaction_*` tables per person |
| Always present | yes                                                               | **no** — see below                                                 |

**`contactsMade` counts interaction ROWS, from
`ContactsMadeResolutionService.contactsMadeBuckets`** — the same `UNION ALL`
and the same `GROUP BY person_id` the filter's own resolution runs, so a
person's bucket on the map is the bucket the filter will put them in. A second
count written here would be a second answer to one question. Three
consequences of that definition worth knowing before changing it: a
three-attempt door-knock sync counts as three, a text and a knock on one
person sum across channels, and outcome is irrelevant.

**Only contacted people are on the wire**, because bucket 0 is the plane's
default and everyone else is bucket 0. So the array is bounded by the
campaign's own outreach rather than by the district — usually a rounding error
against 611,000 rows.

**Past `PACK_CONTACTS_MADE_MAX` the plane is omitted, not truncated.** The cap
is `MAX_RESOLVED_ID_SET_SIZE` (100,000), deliberately the same number at which
resolving a contacts-made filter for a real query gives up: above it the
filter cannot be applied at knock time either. Truncating would read the
dropped people as "0 prior contacts", which is the bucket candidates select
most and the one answer that must never be invented. Absent, the dim never
reaches the manifest, and the webapp's existing unpreviewable-filter
disclosure names the filter it cannot shade — the same path any missing dim
takes. **An empty array is not the same thing**: it is an organization that
has contacted nobody, whose map genuinely can shade "0 prior contacts" as
everyone.

### The district is drained in overlapping CSV chunks

The pack is the one voter read that drains a whole district, so it does not
use the inline JSON path every other query takes:
`PeopleDbxStatementClient.query` accumulates every chunk before it returns,
which for 600k rows materializes the entire district in memory at once.
`DatabricksVoterPackService` instead opens an `EXTERNAL_LINKS` + CSV export and
parses one chunk into the SoA encoder at a time, dropping it before requesting
the next link.

Two things about that drain are load-bearing:

- **The next chunk is requested before the current one is parsed**, so the
  network and the CSV parse overlap instead of taking turns. Drained strictly
  in series, a 698,649-row district measured 22.6s of drain against 736ms of
  query — of which ~6.5s was link round trips waiting on nothing. The cost is
  two chunks in memory rather than one.
- **There is no `ORDER BY`, and nothing can see that.** The pack carries no
  person identity on the wire: the client walks person → household → dot
  positionally and aggregates (`filterEngine.ts`), saved turfs persist a
  polygon rather than pack indices, and no manifest field names a row. Sorting
  a district is not free, and nothing downstream would notice if it were.

### The response is also a stream, and that is a separate guarantee

Even at 2 seconds the encoder produces nothing until the last row, and the
route used to await the finished `Buffer` and hand it to `StreamableFile` — so
**the socket carried no bytes for the length of the build**, and the gateway
drops an idle connection at ~120s without writing a status. Two of thirteen
requests in the seven days to 2026-08-25 died exactly there, logging
`responseTimeMs: 119999, statusCode: null`. Nobody saw an error, because React
Query's retry eventually won; the candidate saw a spinner for 165 seconds.

Chunk overlap makes the build faster; it does not make it _bounded_. A slow
warehouse still produces a long quiet gap, and the streaming envelope is what
removes the cliff rather than moving it.

So the response now opens **before** the build starts and stays busy while it
runs (`doorKnocking/utils/packStream.util.ts`, framing in
`contracts/.../DoorKnockingPack.schema.ts`):

```
[8 bytes magic "GPPACKS1"]                     written before the first query
[u32 kind][u32 length][payload, padded to 8]   heartbeat every 15s
...
[u32 kind=pack][u32 length][the pack]          the payload, unchanged
```

The guarantee is the heartbeat, not the streaming: delivering the encoder's
output incrementally would still go quiet for however long one chunk takes,
while a timer bounds the idle gap at 15 seconds no matter what the warehouse
does.
**The pack's own bytes are untouched** — only its start offset moved, which is
why the frames are padded to 8 bytes (the manifest's 4-byte-aligned offsets
stay aligned, and the browser still mounts typed-array views without copying).

Three consequences worth knowing before changing this:

- **A failed build can no longer be an HTTP error.** The status line is 200
  before the build begins. A failure is an `error` frame plus a
  `DoorKnockingPackBuildFailed` log line, and that log line is what pages —
  the per-route status alert sees a 200. A response that ends with no pack
  frame makes the decoder throw rather than render an empty district.
- **The client's disconnect now cancels the build.** Destroying the response
  aborts the signal the drain checks between chunks, which relies on Fastify
  destroying the stream it is sending when the socket goes away. It does, and
  `aborts the build when the client hangs up` in `doorKnocking.routes.test.ts`
  pins that at the wire rather than trusting it. The webapp query is `retry: 0`
  with a 90s `AbortSignal.timeout` (under the gateway's ceiling, so the client
  fails first and visibly).

### Why it is still built per request

Caching the pack behind an ETag keyed on `(districtId, mirrorVersion)` would
turn a repeat load into a 304 instead of a rebuild. It is **not done here**, but
it is the largest single win available on this endpoint by an order of
magnitude: the rebuild it avoids is 23 s, and one user triggered 19 of them in
14 days. See [`docs/perf/voter-pack-headroom.md`](./perf/voter-pack-headroom.md)
for the measurements and the design.

The key invalidates on three inputs. Two are trivial: the org's knock history
(queryable) and `districtId`. The third — the voter data itself — is the open
question, because `mart_gp_api` is a set of pass-through views a dbt rebuild
replaces with `CREATE OR REPLACE VIEW`, and that rebuild publishes no signal
this service subscribes to. A design has to pick one up (a mart-level load
timestamp, or a version the data platform agrees to expose) before the key can
be trusted; a wall-clock staleness window would be a guess.

The `updated_at` columns on the voter rows are not the handle for this, despite
looking like one: they carry the L2 `loaded_at`, which makes them a per-load
constant rather than a per-row change feed.

Note also that `generatedAt` in the manifest changes on every build, so a
cache has to stabilize it or no two responses ever share an ETag.

### What is left on the table, and why

Two measured candidates that are **not** in the change that fixed the hang.

**Compressing the response beats bit-packing the planes, and neither is
done.** The profile recommends bit-packing the dim planes (37 bits per person
instead of 136) for a 49% smaller payload at zero encode cost, gated on
transfer being a real problem. Measured against the alternative on a 628k-row
pack:

|                   |     payload |                                          cost |
| ----------------- | ----------: | --------------------------------------------: |
| raw (today)       |    15.88 MB |                                             — |
| bit-packed planes |     8.09 MB | 3 files in lockstep, client decode unmeasured |
| gzip level 1      |     4.89 MB |                                         90 ms |
| brotli quality 4  | **4.00 MB** |                                         95 ms |

The planes are low-cardinality bytes, which is exactly what a general-purpose
compressor eats: **transport compression is a bigger win than bit-packing, for
none of the wire-format change**, and it makes bit-packing worth much less
than 49% afterwards because the redundancy it removes is the redundancy gzip
was already removing. This route sends no `Content-Encoding` today.

It is still not a one-liner, which is why it is not folded in here: a
compressor buffers, and the heartbeat frames above are load-bearing precisely
because they reach the socket promptly. Compressing the envelope means
flushing (`Z_SYNC_FLUSH`) on every heartbeat, and it needs a test that says so
— otherwise the first thing compression does is silently undo the guarantee
this endpoint just got. Worth doing next, on its own, with that test.

Since measured against production: **transport is 460 ms of a 23,027 ms
request**, so compression buys nothing on a desk connection — gzip-1 would
spend 177 ms of the task's single vCPU to save perhaps 300 ms of transfer. It
remains a large win on a canvasser's LTE link (25 s → 8 s at 5 Mbps), so it
should be argued as field usability rather than latency. See
[`docs/perf/voter-pack-headroom.md`](./perf/voter-pack-headroom.md).

**The encoder's remaining headroom is small.** Its dot index is now keyed on
the coordinates as numbers rather than on a `${lat}|${lng}` string, which was
261ms of a 628k-row build — the most expensive single thing it did. What is
left is a numeric _household_ key, which needs a real numeric household id
from Postgres. `hashtext` is 32-bit and at ~293k households that
is ~10 expected collisions per district — each one merging two unrelated
families into one door — so it is not shippable, and `hashtextextended` comes
back from the driver as a string, which reintroduces the allocation it was
meant to remove.

## The address preview (draw step)

`POST /v1/door-knocking/address-preview` answers "which houses are inside this
shape?" **before** anything is bought — see
[ADR 0010](adr/0010-draw-time-address-preview.md). The pack above carries no
address at all, so it cannot; this runs the knock's own evaluation instead.

`DoorKnockingPreviewService` repeats what
[`doorKnockingKnock.service.ts`](../src/doorKnocking/services/doorKnockingKnock.service.ts)
does right up to the vendor call and then stops:
`resolveEligibleDistrictId`, `resolveSavedFilterForQuery` on the **unsaved**
filter draft (so activity conditions, support status, contacts-made and the
voter-likelihood overrides are applied, exactly as they will be at knock time),
ADR 0007 + ADR 0008 exclusions deduped into one `excludePersonIds`, then
`evaluate` over the polygon's bbox with an in-process ray-cast. Nothing is
written, nothing is frozen and no Geoapify credit is spent.

Three things about it are load-bearing:

- **Its counts are the draw step's counts.** `stops`, `doors` and `people` come
  back on the response and the webapp shows them **instead of** the pack's
  estimate rather than beside it. The two count different audiences at different
  granularities — the pack's household key is `AddressLine`-level, this is
  unit-level like the freeze — so printing both is the two-denominator failure
  the feature has a standing rule against. ADR 0010 is the whole argument.
- **One request per explicit press.** The ring changes with every vertex, so
  nothing is fetched by drawing: the candidate asks, and a shape edited
  afterwards makes the answer _stale_ rather than triggering another scan. A
  debounce was rejected — it bills every shape passed through on the way to the
  intended one.
- **An empty shape returns zeros, not a 400.** The knock throws there because a
  turf is being committed; a shape still being drawn is allowed to enclose
  nobody.

`locations` is capped at `MAX_STOPS` (exported from the knock service, so one
constant blocks the save and bounds the listing) while `stops` reports the true
total — whole locations only, so a listed stop always shows every door behind it.
The rendered address comes from the shared `renderUnitAddress`
(`src/doorKnocking/utils/unitAddress.util.ts`), which the route serve also uses,
so one door cannot be spelled two ways. The payload is `{ address, people }` per
door and carries no names, ages, party or phones.

## Interim geo — and what changes when the data team delivers

people_db has no geometry column yet. Until it does: the people-db evaluation
takes a bbox (`NULLIF(lat,'')::float8 BETWEEN …` on the existing text
columns) and gp-api ray-casts the exact polygon in process. Every touch
point is tagged `TODO(geom-index)`; when the `geom` column + GiST index
land, `ST_Contains` replaces bbox+ray-cast inside the people-db query with **no
contract change**.

## "Don't knock the people who refused" is not expressible yet

Worth stating outright, because the pieces look like they add up and they don't.
`ActivityConditionAction` includes `refused_to_engage`, so a saved list appears
able to say "skip anyone who refused". It can't: `activityConditionSchema`
carries no negation (`outreachType`, `outreachId`, `actions` only) and
`ActivityConditionResolutionService` intersects condition matches into an `in`
set. A door-knocking condition on `refused_to_engage` therefore selects **only**
the people who refused — the exact opposite of the intent.

The one lever that excludes is `supportStatus`, whose `unknown` member resolves
to a `notIn` complement. But `SupportStatusRollup.refused` is override-only
(`DERIVED_SUPPORT_STATUS_VALUES` excludes it, and `SUPPORT_ANSWER_ROLLUP` maps
support answers, while refusal is an _outcome_), so a door-knock refusal never
lands in that bucket and the complement never excludes them.

So: resolving the filter correctly (step 3 above) is necessary but not
sufficient. `contactsMade0` covers the common intent — "only doors I haven't
been to" — and is now offered in the create flow because evaluate finally
applies it. Suppressing refusals specifically needs the do-not-knock field,
which is a separate instruction from an observed refusal and gets its own ADR.

## Scope guardrails (v1)

Out: precinct / top-issue / district filters, recommended lists, canvasser
identity (candidate-only), **voter record mutation** — `not_a_voter` now
captures a reason and suppresses the person from future evaluation
(ADR 0008), but no person, address, or L2-derived field is ever deleted or
edited — sharable URLs, tagging, arbitrary questions, UI turf-splitting
(the schema already supports N turfs). Feature flag: `native-door-knocking`
gates all FE surfaces; backend lands dark.

## Phones at the door

The residents join returns `cellPhone` / `landline` for **targets only** —
`VoterTelephones_CellPhoneFormatted` and `_LandlineFormatted`, the same two
columns the voter-file download already hands candidates as "Cell Phone" and
"Landline" behind the same district access check, so surfacing them here is not
new disclosure. `otherResidents` stays name-only: a non-target resident is
household context for the conversation, not someone the candidate asked to
contact.

They are live-only, which falls out of the join rather than being enforced
separately: `mayHaveMoved` is `!livePerson`, so a mover has no live row and
therefore no number — never one belonging to whoever lives there now. Blank and
NULL are not used consistently in the voter file, so both are normalized to
null.

The webapp renders them in `PersonSheet` and **not** on either paper surface —
the printed walk sheet or the downloadable PDF walk list; paper leaves the
building and stops being access-controlled when it does.

Voter **email** is absent data, not a decision: there is no email column on the
`Voter` model and no field on the `Person` contract.

## Turning it on in an environment

Everything below is configuration that lives outside this repo, so a green
deploy proves nothing about whether the feature works. Four things must be true
at once, and each fails differently.

**Two Geoapify keys, and they are not interchangeable.** `GEOAPIFY_API_KEY` is
server-side and buys route optimization, billed a little over 10 credits per
stop once the path-geometry call is counted (see § Spend visibility).
`NEXT_PUBLIC_GEOAPIFY_TILES_KEY` is inlined into the browser bundle and buys
map tiles at ~0.25 credits each. Because the second one ships to the client it
must be domain-restricted in the Geoapify console or anyone can spend our
credits: allow `app.goodparty.org` (the origin `/dashboard` is actually served
from — **not** `goodparty.org`, which is the marketing deployment; see
`APP_SHARE_BASE` in the webapp's `appEnv.ts`), the Vercel preview domains, and
`localhost` for local dev. Prefer the narrowest preview pattern the console
accepts over a bare `*.vercel.app`, which would let any site hosted on Vercel
draw on our tile budget.

Setting the tiles key requires a **rebuild**, not just a redeploy —
`NEXT_PUBLIC_` values are baked in at build time, so an env var added after the
last build is invisible until the next one. The server key needs no Pulumi
change: `deploy/index.ts` maps `Object.keys(secret)` into the task definition,
so any key added to the `GP_API_<ENV>` secret JSON is injected on the next
deploy. A missing server key is the gentlest failure of the four — the client
validates lazily, so the environment boots and only the knock endpoint 502s.

**The flag variant must be the literal string `on`.** `useFlagOn` tests
`v?.value === 'on'`, so a variant named anything else — `true`, `enabled`,
`treatment` — reads as off and silently serves the legacy eCanvasser dashboard
instead. That is the failure most likely to be mistaken for a broken deploy.

**Pro and a resolvable district.** Pilot campaigns need `isPro` (admin-settable)
or an elected-office org, per the Pro gate below, and the district must have
rooftop-geocoded voters — every pack and turf read resolves a district
server-side and 400s without one.

### Checking whether an environment already has the key

`GEOAPIFY_API_KEY` is already present in **both** `GP_API_DEV` and
`GP_API_PROD`, and has been in dev since at least the task definition registered
2026-07-21. Confirm that for any environment without fetching a secret value —
`deploy/index.ts` derives the task definition's secret references from the
secret's own keys, so the key _names_ are readable straight off the task
definition, which `ReadOnlyAccess` covers:

```sh
CLUSTER=gp-develop-fargateCluster SERVICE=gp-api-develop   # prod: gp-master-fargateCluster / gp-api-master
aws ecs describe-task-definition --output text \
  --task-definition "$(aws ecs describe-services --cluster "$CLUSTER" \
    --services "$SERVICE" --query 'services[0].taskDefinition' --output text)" \
  --query "taskDefinition.containerDefinitions[0].secrets[].name" | tr '\t' '\n'
```

Note that green CI is not evidence either way. The e2e suite deliberately never
builds a route — `POST turfs` is the only call in the feature that reaches a
billed vendor — so those specs pass whether or not a key exists.

### Procurement, as of this writing

What the key's presence does **not** establish is whose account it belongs to,
and that is the open question rather than provisioning. The POC under
`packages/runbooks/scripts/python/door_knocking_map_poc/` deliberately used each
developer's own free-tier key — its README tells you to sign up yourself and
warns that the generated HTML embeds your personal key — and the TDD still lists
purchasing as an open leadership ask, approved in principle only. So confirm the
account with whoever provisioned it before sizing a pilot on it.

The distinction has teeth, because the free tier is 3,000 credits/day: at the
~11 credits a stop really costs that is ~272 optimized stops/day across the
whole account, or fewer than two full-sized campaigns. A single organization's
default of five (`DEFAULT_DAILY_CAMPAIGN_LIMIT` in `campaignQuota.util.ts`) is
therefore more than a free key can fund on its own. On such a key the vendor's
ceiling binds long before ours does, our own 429 never fires, and one
enthusiastic pilot campaign can exhaust the account for everyone.
Free is fine for a gated QA pass — Geoapify permits commercial use on it
provided the map carries their attribution, which initializing MapLibre from
their `style.json` does automatically, as `VoterMapCanvas` does — but it is not
a pilot-sized plan.

The TDD sized the real plan at ~50k credits/day, which is the $179/month tier —
note that the TDD's separate "$299–609" figure prices the tiers above it, since
it was peak-day sized rather than sized to its own stated plan. The TDD also
flags a non-technical dependency worth closing at purchase time: get **written**
confirmation that we may cache and store results. Their ToS has no caching
clause and they advertise it, but storing the optimized stop order is
load-bearing for us, so it should be on file rather than inferred.

## Access and eligibility

Two products live at `/dashboard/door-knocking`. `DoorKnockingPageGate` picks
between them: the native voter map when `native-door-knocking` is on, the
legacy eCanvasser dashboard when it is off or unsettled. The sidebar entry in
`DashboardMenu` mirrors that same branch, so the link and the landing page
always agree — flag on requires a resolvable district (every pack and turf read
resolves one server-side and 400s without it) **and Pro**, flag off requires an
eCanvasser integration record, which is the only thing the legacy dashboard can
render.

Both sides read the CRM's `canUseProFeatures` (`isPro || electedOffice`), which
is the frontend spelling of the `assertProAccess` predicate below, so the nav is
never stricter than the API. A flag-on non-Pro candidate who reaches the URL
anyway — a stale tab, a bookmark — gets `DoorKnockingPageGate`'s locked upgrade
card rather than a map that draws and then 400s. Unlike Know Your Opponent,
whose nav entry is deliberately shown to non-Pro candidates as an upsell, this
entry is hidden: creating a list spends vendor routing credits, so the pitch
does not belong in a nav row. That makes the locked card a safety net rather than a
funnel step, which is why it is deliberately shorter than
`OpponentProLockedView` and fires no exposure event.

**Control is untouched.** The flag-off eCanvasser dashboard was never Pro-gated
and still isn't, on either the nav or the page.

## The Pro gate (ENG-10888)

**Every route in `src/doorKnocking/` is Pro-gated except the two suppression
writes.** The gate is `ContactsService.assertProAccess(organization)`, called at
the top of each controller method — the CRM's own predicate, reused rather than
reimplemented, so `hasElectedOfficeAccess` still short-circuits ahead of
`isPro` and an `eo-` (Serve) org stays license-equivalent to Pro here exactly as
it is across Contacts. Refusal is that method's `BadRequestException`, 400 with
`This feature is only available for pro campaigns`.

| Route                   | Gated  |
| ----------------------- | ------ |
| `POST /turfs`           | yes    |
| `POST /serve/turfs`     | yes    |
| `GET /turfs`            | yes    |
| `GET /serve/turfs`      | yes    |
| `GET /turfs/:id`        | yes    |
| `PUT /turfs/:id`        | yes    |
| `DELETE /turfs/:id`     | yes    |
| `GET /turfs/:id/route`  | yes    |
| `GET /pack`             | yes    |
| `GET /quota`            | yes    |
| `POST /address-preview` | yes    |
| `POST /interactions`    | yes    |
| `POST /do-not-knock`    | **no** |
| `POST /not-a-voter`     | **no** |

The two Serve siblings keep the call even though it cannot refuse them:
`@UseElectedOffice()` has already found the row that `hasElectedOfficeAccess`
short-circuits on. That looks like it contradicts constituent-outreach's
AGENTS.md, which says the `ElectedOffice` row is the entitlement, but both are
true at once — the row IS the entitlement, and the gate is the predicate that
says so. It stays for the same reason phone banking's serve sibling keeps its
own: the gate is applied per method rather than per module, so a route missing
the line is indistinguishable from one that forgot it.

Reads are gated alongside the writes on purpose: a map that opens and then
fails on the first turf is a worse answer than an upgrade prompt, and creating
a list spends real Geoapify credits.

The two holes are ADR 0007 and ADR 0008, and they are the point rather than an
oversight — see "Do-not-knock" and "'Not a voter'" below. If an org lapses
mid-pilot the walk it was on becomes unreachable, but a canvasser standing at a
door that asked not to be revisited can still record that, and a door reported
moved or deceased still suppresses. Both are instructions about a door rather
than work a subscription buys.

A guard was considered and rejected: `@UseOrganization()` resolves the org in
its own guard, so a second guard reading `request.organization` would depend on
method-decorator evaluation order (bottom-up, so the gate would have to sit
_above_ `@UseOrganization()` to run after it) — a silent break for anyone who
reorders the decorators. Resolving the slug a second time in the guard, the way
`CanDownloadVoterFile.guard.ts` does, buys a duplicate lookup per request. The
in-method call is also what `contactNotes.controller.ts` and
`contactInteractions.controller.ts` already do, and it keeps the gated and
ungated routes legible side by side in one file. The cost is that a route added
here is ungated until someone adds the call — the table above is the checklist.

Note the ordering: the `@Body` `ZodValidationPipe` runs before the method body,
so a malformed body on a gated route 400s as `Validation failed` rather than
with the Pro message. Both refuse; only the wording differs.

`@goodparty_org/contracts` is unchanged — this adds no field to any payload.
