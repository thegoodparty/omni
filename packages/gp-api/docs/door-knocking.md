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
immutable artifact generated the first time someone knocks a turf; and
**interactions** (the CRM epic's `contact_interaction_door_knock`) are the
only mutable record — one row per knock on a person.

## Tables (all in this package's Prisma schema)

| Table                            | Role                                                                  | Key invariants                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `door_knocking_turf`             | The drawn area: name, color, geoPoly                                  | `voterFileFilterId` NOT unique (N turfs per filter). Locked (derived) iff its route exists. `completedAt`/`archivedAt`/`deletedAt` carry the list lifecycle — see below                                                                                                                                                                                                                                                                                    |
| `door_knocking_route`            | Frozen route header                                                   | `doorKnockingTurfId` UNIQUE — locked/idempotent both mean "this row exists". Never mutated after creation                                                                                                                                                                                                                                                                                                                                                  |
| `door_knocking_stop`             | One per unique lat/lng, in visit order                                | `(routeId, seq)` unique; `displayAddress` copied verbatim from `Residence_Addresses_AddressLine` at freeze                                                                                                                                                                                                                                                                                                                                                 |
| `door_knocking_stop_target`      | Bare-minimum person snapshot                                          | personId (people-db UUID — never raw LALVOTERIDs), name, addressKey. Redact-in-place on deletion requests                                                                                                                                                                                                                                                                                                                                                  |
| `contact_interaction_door_knock` | One row per knock on a person (CRM epic's model, extended additively) | Writes land here via `POST /v1/door-knocking/interactions`: `sourceId` = the phone's clientKey (replay-idempotent upsert; the latest sync of a clientKey wins, so a corrected answer replaces the row rather than duplicating it), `occurredAt` server-stamped. The vocabulary was extended additively for the question flow: `inaccessible` + `not_a_voter` outcomes, nullable `willVote` — `supportAnswer` stays the CRM's 3-way. CRM readers unaffected |

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

Three nullable timestamps on `door_knocking_turf`, driven by
`POST turfs/:id/complete`, `POST turfs/:id/archive` (`{ archived: boolean }`),
and the existing `DELETE turfs/:id`. All three apply only to a knocked list.

**Why the turf and not the `Outreach` envelope.** The envelope already has a
`status` enum that spells `in_progress` and `completed`, and an `archivedAt` of
its own, so it looks like the obvious home. It isn't: the envelope requires a
`campaignId`, and a Serve org knocks without a campaign, so the knock
transaction skips creating one entirely. A lifecycle stored there would be
invisible to an org the Pro gate deliberately admits. The turf is the one row
every knocker has.

**The envelope is a mirror of it, written in the same transaction.** Both
lifecycle writers do this, and neither is optional: `complete` sets
`status: completed`, `setArchived` sets `archivedAt` to whatever the turf's
became. `updateMany` matched on `doorKnockingRouteId`, so the Serve case — no
envelope at all — is a no-op rather than an error. Doing it server-side rather
than in the caller is the point: it is one commit instead of two round trips a
phone can die between, and it holds for any caller, not just the webapp. The
webapp did carry a best-effort client mirror for archive (#1396) while gp-api
was frozen; that is gone.

Two details in `setArchived` that are easy to undo by accident:

- **The mirror runs ahead of the idempotence guard.** Lists archived before the
  mirror existed have an envelope that never followed, and the guard
  (`if (archived && locked.archivedAt) return locked`) would return early on
  exactly those, leaving the drift permanent — pressing Archive again is the
  only repair a candidate has.
- **Both rows get the same timestamp, and it is the turf's existing one when
  there is one.** That is what makes running the mirror unconditionally safe:
  the guard exists so a double-tap can't walk "archived since" forward, and
  writing `now` into the envelope on a repeat press would break that promise on
  the other row.

**Restore mirrors too.** `setArchived(false)` writes null to both. An archive
that mirrors and a restore that does not puts the two rows back out of step one
press later.

**Why delete is two different operations.** Delete is now offered at every
stage; the confirmation dialog is the guard, not the lock. Which delete runs
depends on the lock, because the two cases destroy very different amounts:

- **Unlocked** — a drawing. Nothing frozen, nothing billed. Hard delete.
- **Locked** — hard-deleting cascades turf → route → stops → targets **and**
  the `Outreach` envelope. That throws away a Geoapify route that was billed
  once and is documented here as never re-bought, the frozen addresses, and
  the name snapshots privacy deletion redacts in place. So it is tombstoned
  with `deletedAt` instead: unreachable from every read and write path, intact
  underneath.

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
door, and it does *not* require the turf to be alive. The phone snapshots the
route and syncs later, so a list deleted mid-walk would turn every queued write
into a 404 and discard work that was actually done — and these rows hang off
the organization rather than the turf, so they outlive the list by design. The
org scope still applies, so nothing resolves across a tenant. Contrast the
knock freeze, which does filter: that one bills a Geoapify route. The rule is
that `activeTurfScope` guards anything that *hands out* a turf or its route,
not anything that records against one already handed out.

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
/ `loggedCount`, and the turf's `completedAt` / `archivedAt`. It is the sibling
of `phoneBanking` on the same schema, and it exists so a walk reads like its
peers in the shared history drawer instead of as a row that knows only a route
id.

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

**Archive from the history drawer writes the TURF.** The drawer now offers
Archive/Restore on a finished walk like every other channel, and the button
calls `POST /v1/door-knocking/turfs/:id/archive` — never
`PATCH /v1/outreach/:id/archive`. What blocked it before was reach rather than
policy: nothing there could name the turf, and a writer that could only reach
the envelope is exactly how the two `archivedAt` columns drift apart.
`setArchived` is still the single writer of both rows. For the same reason the
drawer reads `doorKnocking.archivedAt` — the source — rather than the
envelope's mirror, so a list archived before the mirror shipped offers Restore
instead of a second Archive.

## Where the code lives

`src/doorKnocking/` (turf CRUD + the knock transaction; controller routes
under `/v1/door-knocking`), `src/vendors/geoapify/` (Route Planner client —
requires `GEOAPIFY_API_KEY`, validated lazily at call time so environments
without it still boot), and the evaluation/residents contracts in
`@goodparty_org/contracts`, served in-process by
`src/peopleDb/services/voterDoorKnocking.service.ts`.

## The knock transaction (the money path)

`knock(doorKnockingTurfId, mode, loop)` runs as ONE advisory-locked
interactive transaction:

1. `SELECT pg_advisory_xact_lock(<ns>, doorKnockingTurfId)` — serializes
   concurrent knocks per turf; auto-releases on commit/rollback/crash.
2. Existence probe (`SELECT id` only). Found → return the route,
   `created: false`, no vendor call.
3. Resolve the turf's saved `VoterFileFilter` through
   `ContactsService.resolveSavedFilterForQuery` — the same three steps the CRM
   read path runs (convert → party gate → Voter Likelihood overrides, plus
   activity-condition/support-status and contacts-made id resolution).
   `convertVoterFileFilterToFilters` alone silently drops
   `activityConditions`, `supportStatus`, `contactsMade*` and the
   voter-likelihood overrides, so a list previewed in Contacts used to knock a
   different audience than it displayed. A filter resolving to nobody → 400,
   no people-db round trip.
4. Evaluate the turf fresh via `src/peopleDb/` (resolved filters + the
   `idOverrides`/`contactsMadeIdOverrides` clauses that travel beside them +
   bbox; exact point-in-polygon ray-cast in-process — see "Interim geo"
   below), dedupe to unique lat/lng stops, re-check the 150-stop cap. The
   org's suppressed people — do-not-knock plus not-a-voter — are read
   _before_ the transaction and passed as one deduped `excludePersonIds`
   (see "Do-not-knock" and "'Not a voter'").
5. Check the daily waypoint budget (`waypointQuota.util.ts`): 500 stops per
   organization per rolling 24 hours, summed from the
   `door_knocking_route_planner_spend` ledger. Over budget → 429 and no vendor
   call. The turf lock doesn't serialize across turfs, so simultaneous knocks
   in one org can overshoot by up to a route; that's deliberate — see the util.
6. One Geoapify Route Planner call (coords + opaque job ids only — no PII
   leaves; loop → start=end anchor at the first stop by address order;
   open → end-only anchor at the farthest-from-centroid stop; both
   deterministic, never random).
7. Record the spend (`recordWaypointSpend`) immediately, on the plain client
   and NOT the transaction. The vendor has been paid by this point, so the
   ledger row has to commit whether or not the freeze below it succeeds —
   reading spend off the frozen stop rows instead meant every rolled-back
   knock spent real money the budget never saw and handed the same allowance
   out again. A failed ledger write is logged and swallowed: it must not turn
   billed work into a failed knock. `route.credits` still records what that
   individual route cost; the ledger is what the budget reads. The ledger was
   backfilled from the pre-existing routes when it was introduced
   (`20260813170000_backfill_...`) — starting it empty would have let every
   knock already billed inside the rolling window spend its allowance twice.
8. Atomically create route + stops + stop targets + the Outreach envelope
   row (skip envelope if the org has no campaign; status `in_progress`,
   never `pending` — payment flows gate on it). The per-target activity
   event is still deferred, as noted above.

A crash before commit leaves zero rows; the next knock regenerates. If
Geoapify is down, knock fails visibly — no fallback engine in v1.

Non-negotiable tests: (a) two concurrent knocks → exactly one Geoapify
call, loser returns `created: false`; (b) crash-mid-freeze → zero rows;
(c) interaction replay with the same `clientKey` → one row; (d) a knock that
rolls back after the vendor call still leaves its spend in the ledger; (e) a
saved list's exclusions shrink the stop set.

## Spend visibility

The waypoint quota is a per-organization guardrail, not a bill. Two things it
can't see: **nothing sums across organizations**, so the total bill scales with
how many orgs hold the flag; and the ledger records Route Planner waypoints
only, while every knock also makes a **second billed call** —
`fetchPathGeometry`'s Routing request for the path geometry.

Both are now visible, and no surface here can carry the API key: the Route
Planner SDK puts the key in its request URL, so nothing sourced from a URL or a
caught error is ever logged or labelled. Every metric attribute is a closed set
of literals.

| Signal                                         | Where                                                | Reads                                                                                                                                                                                      |
| ---------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `event: 'DoorKnockingSpend'` log line          | `doorKnockingKnock.service.ts` spend path            | `organizationSlug`, `turfId`, `waypoints`, `credits` — emitted before the ledger write and regardless of its outcome, so a lost ledger row under-counts the quota without hiding the money |
| `geoapify_route_planner_credits_total`         | `vendors/geoapify/observability/geoapify.metrics.ts` | Credits billed, no org label (Prometheus cardinality)                                                                                                                                      |
| `geoapify_vendor_call_count_total{api,result}` | same                                                 | `api="route_planner"` and `api="routing"` — this is the only place the second call is counted                                                                                              |

What pages: the global **route planner spend ceiling** alert (>10,000 credits /
6h across all orgs, `#dev-alerts`, `@win-bugs`), and the `≥ 500` route alerts
on this controller — including the 502 for a missing `GEOAPIFY_API_KEY`. The
per-org 429, the empty/oversized-turf 400s, and the `VOTER_DATA_UNAVAILABLE`
400 deliberately do not (see gp-api `docs/observability.md` §
Server-errors-only controllers).

Deliberately a chart-and-alert rather than an enforced global cap: a hard
ceiling across organizations would let one org's knocking fail another's, which
is worse than a page during a pilot.

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

Same thing from the ledger, when the question is about the quota rather than
the bill (the ledger is the only source `assertWaypointQuota` reads):

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

`sum by (organizationSlug)` above 5,000 credits (500 waypoints) in a rolling
24h is the `ENG-10901` overshoot — concurrent knocks in one org each passing the
quota check because the advisory lock is per turf — now measurable rather than
inferred. That trade-off stands: an org-wide lock would serialize every knock
behind a 30-second vendor call.

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
still built per request" below: positions + person→household→dot index arrays
+ one byte per person per dimension (SoA). Dim buckets are derived by
inverting `src/peopleDb`'s `VALUE_MAPPERS`, so pack filtering can't drift from
list-filter semantics. The `canvassStatus` plane is encoded from the org-wide
latest-per-person statuses gp-api ships with the request (`(personId, status)`
only — no PII), so the proxy never patches bytes. Map-minimal SELECT: no
AddressLine, accuracy in WHERE only (v1 = `GeoMatchRooftop` only),
`registered` computed as `(StateVoterID IS NOT NULL)`.

### It was slow because the pagination was quadratic

The build used to keyset-paginate the district in 50,000-row pages. Every page
re-ran the whole joined statement, and `v."id" > cursor` reached the `Voter`
side of the merge join and **not** the `DistrictVoter` side — so nothing
restricted the inner scan and each page re-walked the district from the start
to reach its merge position. 58k DV rows scanned on page 0; 407k on page 6.
The pass was quadratic in district size, which is why widening the flag to a
bigger district made it worse than proportionally worse.

Measured (`docs/perf/voter-pack-profile.md`, 628k-row dataset reproducing the
production pack size to within 0.9%):

| | keyset, 13 statements | one statement, one cursor |
| --- | ---: | ---: |
| blocks touched | 14,058,235 | 120,976 |
| read from storage | **11.5 GB** | 945 MB |
| Postgres execution | 5,389 ms | 2,072 ms |

**11.5 GB of storage reads to return a 16 MB response**, and 72% of the
request's wall clock was the Node process sitting idle on the people-db socket.
That also explains the 12.7-43.5s spread better than anything else: a warm
buffer pool put you at the fast end and an evicted one put you through the
gateway's ceiling.

So the scan is now **one unordered statement read through a server-side
cursor** (`peopleDb/utils/cursorScan.util.ts`), measured 2.4-2.8x end to end.
The cursor is what keeps the memory bound that pagination was there for —
without it, 628k row objects are live at once (416 MB of JS heap).

Three things about that are load-bearing:

- **`ORDER BY v."id"` is gone, and nothing can see it.** The pack carries no
  person identity on the wire: the client walks person → household → dot
  positionally and aggregates (`filterEngine.ts`), saved turfs persist a
  polygon rather than pack indices, and no manifest field names a row. Sorting
  a district existed only to make a keyset cursor work.
- **`cursor_tuple_fraction = 1`.** A cursor normally means "show me a page", so
  the planner optimises for a fast first row — which is how it would justify
  the merge-join shape this change exists to escape. The scan always drains, so
  it must be costed whole.
- **The per-fetch statement timeout is 45s, not the usual 25s.** The clock is
  armed per `FETCH`, and the first one pays for the whole plan's startup where
  a keyset page only paid for its own slice. See `peopleDb/AGENTS.md`.

The local plan is a hash join over sequential scans. Production's `Voter` is a
218M-row partitioned table with different statistics, so **`EXPLAIN` this
against production before trusting the 116x** — and `pg_stat_statements`'s
`shared_blks_read` for this query text is the one number that confirms the
model held.

### The response is also a stream, and that is a separate guarantee

Even at 2 seconds the encoder produces nothing until the last row, and the
route used to await the finished `Buffer` and hand it to `StreamableFile` — so
**the socket carried no bytes for the length of the build**, and the gateway
drops an idle connection at ~120s without writing a status. Two of thirteen
requests in the seven days to 2026-08-25 died exactly there, logging
`responseTimeMs: 119999, statusCode: null`. Nobody saw an error, because React
Query's retry eventually won; the candidate saw a spinner for 165 seconds.

The cursor makes the build faster; it does not make it *bounded*. A slow
people-db still produces a long quiet gap, and the streaming envelope is what
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
while a timer bounds the idle gap at 15 seconds no matter what people_db does.
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
  aborts the signal the scan checks between chunks, which relies on Fastify
  destroying the stream it is sending when the socket goes away. It does, and
  `aborts the build when the client hangs up` in `doorKnocking.routes.test.ts`
  pins that at the wire rather than trusting it. Killing the connection never
  cancelled the Postgres scan, so a retry used to contend with a build still
  running for nobody — which is also why the webapp query is `retry: 0` with a
  90s `AbortSignal.timeout` (under the gateway's ceiling, so the client fails
  first and visibly).
- **Every fetch runs under a statement timeout** like every other people-db
  query (`peopleDb/AGENTS.md`). This query was the last one that didn't.

### Why it is still built per request

Caching the pack behind an ETag keyed on `(districtId, mirrorVersion)` would
turn a repeat load into a 304 instead of a rebuild. It is **not done here**, but
it is the largest single win available on this endpoint by an order of
magnitude: the rebuild it avoids is 23 s, and one user triggered 19 of them in
14 days. See [`docs/perf/voter-pack-headroom.md`](./perf/voter-pack-headroom.md)
for the measurements and the design.

The key invalidates on three inputs, and all three are in reach: the org's knock
history (queryable), `districtId` (trivial), and the voter data itself. The
third is not a staleness window somebody has to choose, because **peopleDB is a
monthly, full-rebuild mirror of Databricks rather than a source of truth**. The
dbt mart builds it, `people-api-loader` COPYs it into a **brand-new Aurora
cluster** on an `@monthly` schedule, and the swap is published as an SSM
parameter update that `PeopleDbUrlProvider` already polls and reports through
`onChange()` (`PeopleDbService` and `VoterDownloadService` are already
subscribers). The data is immutable between rebuilds, so the key is `districtId`
plus the resolved cluster identity, and invalidation is wholesale on that event.

The `updated_at` columns on `green."Voter"` and `green."DistrictVoter"` are not
the handle for this, despite looking like one: the mart header records that they
carry the L2 `loaded_at`, which makes them a per-load constant rather than a
per-row change feed.

Note also that `generatedAt` in the manifest changes on every build, so a
cache has to stabilize it or no two responses ever share an ETag.

### What is left on the table, and why

Three measured candidates that are **not** in the change that fixed the hang.

**The household key costs ~550ms of people-db CPU per request.**
`buildHouseholdKeySql`'s `CONCAT_WS`/`UPPER`/`TRIM` is 38% of the single-pass
execution — more than the `DistrictVoter` join — and it recomputes, on every
request, a value that never changes. A stored generated column would remove it.

It is not done here because it only pays inside a live build, which caching
largely removes — not because it is expensive to land. The mirror is rebuilt
from scratch each month into a fresh cluster, and the loader **already** adds a
`STORED GENERATED` column absent from the mart — `Voter."geom"`, registered in
`schema_spec.LOADER_ADDED_COLUMNS`. A precomputed household key is one more
entry in that list, or one more column in `m_people_api__voter.sql`: no lock, no
rollout, landing on the next monthly build. The `peopleDb/AGENTS.md` warning
about expression indexes still applies to anything added to a *running* cluster,
but not to a column the loader builds.

**Compressing the response beats bit-packing the planes, and neither is
done.** The profile recommends bit-packing the dim planes (37 bits per person
instead of 136) for a 49% smaller payload at zero encode cost, gated on
transfer being a real problem. Measured against the alternative on a 628k-row
pack:

| | payload | cost |
| --- | ---: | ---: |
| raw (today) | 15.88 MB | — |
| bit-packed planes | 8.09 MB | 3 files in lockstep, client decode unmeasured |
| gzip level 1 | 4.89 MB | 90 ms |
| brotli quality 4 | **4.00 MB** | 95 ms |

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
left is a numeric *household* key, which needs a real numeric household id
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
server-side and buys route optimization, billed ~10 credits per stop.
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
builds a route — `POST turfs/:id/knock` is the only call in the feature that
reaches a billed vendor — so those specs pass whether or not a key exists.

### Procurement, as of this writing

What the key's presence does **not** establish is whose account it belongs to,
and that is the open question rather than provisioning. The POC under
`packages/runbooks/scripts/python/door_knocking_map_poc/` deliberately used each
developer's own free-tier key — its README tells you to sign up yourself and
warns that the generated HTML embeds your personal key — and the TDD still lists
purchasing as an open leadership ask, approved in principle only. So confirm the
account with whoever provisioned it before sizing a pilot on it.

The distinction has teeth, because the free tier is 3,000 credits/day: at 10
credits per stop that is ~300 optimized stops/day across the whole account,
_below_ `DAILY_WAYPOINT_LIMIT` (500) in `waypointQuota.util.ts`. On a free key
the vendor's ceiling binds before ours does, our own quota error never fires,
and one enthusiastic pilot campaign can exhaust the account for everyone. Free
is fine for a gated QA pass — Geoapify permits commercial use on it provided the
map carries their attribution, which initializing MapLibre from their
`style.json` does automatically, as `VoterMapCanvas` does — but it is not a
pilot-sized plan.

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
entry is hidden: every knock spends vendor routing credits, so the pitch does
not belong in a nav row. That makes the locked card a safety net rather than a
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
| `GET /turfs`            | yes    |
| `GET /turfs/:id`        | yes    |
| `PUT /turfs/:id`        | yes    |
| `DELETE /turfs/:id`     | yes    |
| `GET /turfs/:id/route`  | yes    |
| `GET /pack`             | yes    |
| `POST /address-preview` | yes    |
| `POST /interactions`    | yes    |
| `POST /turfs/:id/knock` | yes    |
| `POST /do-not-knock`    | **no** |
| `POST /not-a-voter`     | **no** |

Reads are gated alongside the writes on purpose: a map that opens and then
fails on the first turf is a worse answer than an upgrade prompt, and routing
spends real Geoapify credits per knock.

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
