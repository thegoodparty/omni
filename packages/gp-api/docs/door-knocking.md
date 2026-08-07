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

| Table                            | Role                                                                  | Key invariants                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `door_knocking_turf`             | The drawn area: name, color, geoPoly                                  | `voterFileFilterId` NOT unique (N turfs per filter). Locked (derived) iff its route exists                                                                                                                                                                                                                                                                           |
| `door_knocking_route`            | Frozen route header                                                   | `doorKnockingTurfId` UNIQUE — locked/idempotent both mean "this row exists". Never mutated after creation                                                                                                                                                                                                                                                            |
| `door_knocking_stop`             | One per unique lat/lng, in visit order                                | `(routeId, seq)` unique; `displayAddress` copied verbatim from `Residence_Addresses_AddressLine` at freeze                                                                                                                                                                                                                                                           |
| `door_knocking_stop_target`      | Bare-minimum person snapshot                                          | personId (people-db UUID — never raw LALVOTERIDs), name, addressKey. Redact-in-place on deletion requests                                                                                                                                                                                                                                                            |
| `contact_interaction_door_knock` | One row per knock on a person (CRM epic's model, extended additively) | Writes land here via `POST /v1/door-knocking/interactions`: `sourceId` = the phone's clientKey (replay-idempotent upsert, first write wins), `occurredAt` server-stamped. The vocabulary was extended additively for the question flow: `inaccessible` + `not_a_voter` outcomes, nullable `willVote` — `supportAnswer` stays the CRM's 3-way. CRM readers unaffected |

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
3. Evaluate the turf fresh via `src/peopleDb/` (filter flags + bbox; exact
   point-in-polygon ray-cast in-process — see "Interim geo" below), dedupe
   to unique lat/lng stops, re-check the 150-stop cap.
4. One Geoapify Route Planner call (coords + opaque job ids only — no PII
   leaves; loop → start=end anchor at the first stop by address order;
   open → end-only anchor at the farthest-from-centroid stop; both
   deterministic, never random).
5. Atomically create route + stops + stop targets + one RouteCreated event
   per target + the Outreach envelope row (skip envelope if the org has no
   campaign; status `in_progress`, never `pending` — payment flows gate on
   it).

A crash before commit leaves zero rows; the next knock regenerates. If
Geoapify is down, knock fails visibly — no fallback engine in v1.

Non-negotiable tests: (a) two concurrent knocks → exactly one Geoapify
call, loser returns `created: false`; (b) crash-mid-freeze → zero rows;
(c) interaction replay with the same `clientKey` → one row.

## Serving

`GET /v1/door-knocking/turfs/:id/route`. Every read of a route (later
opens, walk start) = frozen route + live enrichment: residents-by-address from people-db (only units
containing a target; targets get live age/party; otherResidents are
name-only) + each stop's knock status derived from
`contact_interaction_door_knock` (org-wide, latest row per person —
prior-route and prior-campaign contact is deliberately visible). The route
payload ships `stopTargetId` per target (the interaction write key), no
`navigate` block (phone builds deep links from lat/lng + a per-route
locale), and is snapshotted offline on the phone.

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

## Scope guardrails (v1)

Out: precinct / top-issue / district filters, recommended lists, canvasser
identity (candidate-only), voter removal (`not_a_voter` is stored, not
acted on), sharable URLs, tagging, arbitrary questions, UI turf-splitting
(the schema already supports N turfs). Feature flag: `native-door-knocking`
gates all FE surfaces; backend lands dark.
