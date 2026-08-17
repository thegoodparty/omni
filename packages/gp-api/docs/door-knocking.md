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
| `door_knocking_turf`             | The drawn area: name, color, geoPoly                                  | `voterFileFilterId` NOT unique (N turfs per filter). Locked (derived) iff its route exists                                                                                                                                                                                                                                                                                                                                                                 |
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
payload ships `stopTargetId` per target (the interaction write key), no
`navigate` block (phone builds deep links from lat/lng + a per-route
locale), and is snapshotted offline on the phone.

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
downloadable PDF walk list all show a skip instead of a logging form. Deliberately not gated on Pro: the pilot's
whole point is that a candidate can honor the request at the door.

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
Built per request from people_db, never stored: positions +
person→household→dot index arrays + one byte per person per dimension
(SoA). Dim buckets are derived by inverting `src/peopleDb`'s `VALUE_MAPPERS`,
so pack filtering can't drift from list-filter semantics. The
`canvassStatus` plane is encoded from the org-wide latest-per-person
statuses gp-api ships with the request (`(personId, status)` only — no
PII), so the proxy never patches bytes. Map-minimal SELECT: no
AddressLine, accuracy in WHERE only (v1 = `GeoMatchRooftop` only),
`registered` computed as `(StateVoterID IS NOT NULL)`.

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

## Access and eligibility

Two products live at `/dashboard/door-knocking`. `DoorKnockingPageGate` picks
between them: the native voter map when `native-door-knocking` is on, the
legacy eCanvasser dashboard when it is off or unsettled. The sidebar entry in
`DashboardMenu` mirrors that same branch, so the link and the landing page
always agree — flag on requires a resolvable district (every pack and turf read
resolves one server-side and 400s without it), flag off requires an eCanvasser
integration record, which is the only thing the legacy dashboard can render.

**Pre-GA: there is no Pro or subscription check on this feature.** Not on the
page, not on any route in `src/doorKnocking/`. Access is the flag plus
`candidateAccess()`, which only establishes that the caller is a candidate.
That is deliberate for a flag-gated pilot — the allowlist _is_ the entitlement,
and the waypoint quota caps vendor spend per org either way. It is wrong for
GA, because the flag would come off for everyone at once and the routing spend
is real money per knock. Deciding where that gate belongs (route guard vs.
page-level upgrade view, and whether a non-Pro candidate sees a locked preview
the way Know Your Opponent does) is a prerequisite for turning the flag on
broadly, not a follow-up to it.
