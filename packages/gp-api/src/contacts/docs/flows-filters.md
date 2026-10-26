# Flows: filters and overrides

<!-- Moved verbatim from contacts/AGENTS.md so the auto-loaded AGENTS.md stays small. Edit here. -->

### Override-aware Voter Likelihood filtering (ENG-10838)

The wizard's Voter Likelihood filter (the `audience*` booleans /
`AUDIENCE_VOTER_STATUS_VALUES`) respects per-person `voter_likelihood`
overrides (`ContactStatusService`, ENG-10833) rather than only the seed
`Voter_Status` column. `ContactsService.resolveVoterLikelihoodFilter` runs
after `convertVoterFileFilterToFilters` on every read-path consumer (list,
count, overlap-count's current selection, `findContactsForFilter`, list-detail
aggregates, download): it maps the selected override-vocabulary values back to
their seed value (one-to-one since `Unreliable` gained its own member — see
the propensity vocabulary section above), then resolves `include` (overridden
TO one of the selected values) and `exclude`
(overridden to something else) person-id sets via two
`ContactStatusService.personIdsByFieldValue` calls. Both travel to the people-db query layer
as a new top-level `idOverrides: { include?, exclude? }` sibling of `filters`
(NOT a `PeopleFilters` field — `IdOverridesSchema` in
`@goodparty_org/contracts`), which `buildVoterFiltersSql` composes as an OR
scoped to ONLY the voterStatus clause: `(<other filters>) AND ((<voterStatus>
AND id != ALL(excl)) OR id = ANY(incl))` — an override-included person still
has to pass every other selected filter. A no-op or 400 for `eo-` orgs
(`hasElectedOfficeAccess`): Serve never writes `voter_likelihood` overrides, so
the two lookups would always come back empty — skipped rather than paid for
nothing. `idOverrides` is omitted entirely when no likelihood filter is
selected or the org has zero overrides, so the SQL is byte-identical to
before this ticket in that case.

**Saved-list overlap count's saved sets DO honour a drawn boundary** (ENG follow-up to the boundary work): `resolveSavedFilterSets` composes each saved list's frozen `VoterFileFilterGeoMember` rows into that set's id resolution, alongside its activity conditions and its follow-up flag. Without it a boundaried list joined the union at its pre-boundary size — every person its criteria matched anywhere in the district — and the wizard's strip told the holder a new list was already covered by an audience that list does not hold (measured: 5,356 contributed where the list held 339). A shape enclosing nobody drops the set entirely rather than contributing its unbounded criteria, the same way an activity condition resolving to nobody already does.

**Saved-list overlap count's saved sets are NOT override-aware** (a
deliberate, scoped-out gap): `resolveSavedFilterSets` converts each saved
`VoterFileFilter` straight through `convertVoterFileFilterToFilters` with no
call into `resolveVoterLikelihoodFilter`, and `buildOverlapCountSql` builds
each saved set via plain `buildVoterFiltersSql` with no per-set `idOverrides`.
So a saved list's own membership in the overlap union still reflects seed
`Voter_Status` only. The "current selection" side of the overlap (the
in-progress wizard filter) IS override-aware. Extending saved sets needs a
per-set `idOverrides` on the wire (`PeopleOverlapCountRequestSchema`'s
`savedFilterSets` would need to become `{ filters, idOverrides }[]`) — a real
follow-up, not a one-line change.

### Contacts-made filter (ENG-10839)

The wizard's "Prior contacts made" pill row (0/1/2/3/4/5+, Win-only — hidden for
Serve like Political Party) counts every logged interaction ROW across
`contact_interaction_text`/`_robocall`/`_door_knock`/`_phone_banking`,
regardless of outcome — a 3-attempt door-knock sync that logs 3 rows counts
as 3. Six booleans on `VoterFileFilter` (`contactsMade0`…`contactsMade4`,
`contactsMade5Plus`, 5Plus meaning ≥5), added additively (migration
`20260729042120_add_contacts_made_filter_columns`) and excluded from
`convertVoterFileFilterToFilters`'s generic loop (`fieldsHandledSeparately`,
same treatment as the `audience*` booleans) since they resolve through
`ContactsMadeResolutionService.resolveContactsMade`, not a
`PeopleFilters` key.

Resolution (`ContactsMadeResolutionService`, contactInteraction) runs one
grouped SQL query per request — `SELECT person_id, COUNT(*) FROM (UNION ALL
of the four tables) GROUP BY person_id HAVING <bucket predicate>` — never
six per-bucket queries. Selection `S ⊆ {0,1,2,3,4,5}` maps to one of three
shapes:

- **`S` excludes 0**: `{ kind: 'filter', idFilter: { in: <union of the
selected buckets' ids> } }` — the ordinary `buildIdFilter` path.
- **`S = {0}`**: `{ kind: 'filter', idFilter: { notIn: <everyone ever
contacted> } }` — enumerating "everyone NOT contacted" directly isn't
  tractable (could be the whole district), so `notIn` expresses it without
  enumeration.
- **`S = {0, …non-zero}`**: `{ kind: 'override', idOverrides: { include:
<bucket ids>, exclude: <everyone contacted> } }` — bucket ids are a
  subset of the contacted set, so this can't collapse to a single
  in/notIn operator. It reuses `src/peopleDb`'s `composeIdOverridesClause`
  (ENG-10838) with an **absent base clause** (`composeIdOverridesClause(null,
…)` already falls back to `TRUE`), traveling as a second, independent
  top-level sibling `contactsMadeIdOverrides: { include?, exclude? }` —
  same `IdOverridesSchema` shape as ENG-10838's `idOverrides`, but a
  **separate wire field** composed unconditionally in
  `buildVoterFiltersSql` (AND-ed with everything else, never scoped to a
  single filter key) rather than sharing the voterStatus-scoped
  `idOverrides` channel, since a request can select both a Voter
  Likelihood override AND a contacts-made mixed bucket at once and the two
  id sets must not conflate.

`ContactsService.resolveIdFilterWithContactsMade` composes this with the
existing `ActivityConditionResolutionService.resolveIdFilter` call: both can
produce a plain `id` in/notIn constraint destined for the same `PeopleFilters`
`id` key, so the two are AND-intersected first via the exported
`intersectIdFilterResolutions` (activityConditionResolution.service.ts) —
two `notIn` sets union their exclusions, an `in`/`notIn` pair subtracts, two
`in` sets intersect. The mixed-case `contactsMadeIdOverrides` never goes
through this intersection — it AND-composes at the SQL level instead. Every
read-path consumer that already calls activity/support resolution also calls
this (list, count, overlap-count's current selection, `findContactsForFilter`,
list-detail aggregates, download) — capped at the same
`MAX_RESOLVED_ID_SET_SIZE` (200k) as activity-condition resolution, thrown
as a `BadRequestException` rather than silently truncated.

Win-only enforcement mirrors party: `assertNoContactsMadeFilterForElectedOffice`
(same shape as `assertNoPartyFilterForElectedOffice`, but checked on the raw
pre-conversion `VoterFileFilter`/DTO booleans since contactsMade fields never
reach the converted `FilterObject`) 400s at `resolveBaseFilters` and
`segmentToFilters` — the same choke points party is asserted at, minus the
two legacy voter-file endpoints (`countVoterFilePeople`,
`downloadVoterFilePeople`) which skip activity/support resolution entirely
and so skip contacts-made too, by the same existing precedent.

### Recommended-list filter dimensions

Three dimensions added as groundwork for recommended lists. All resolve
against `mart_gp_api.gp_api_voters`, the same table every other voter filter
hits, and all four are persisted `VoterFileFilter` columns
(`20260903190310_add_affinity_ideology_address_phone_filters`) so a saved
list can express them.

| Dimension            | Persisted columns                                                                   | Mart column                  | Wire filter key                      |
| -------------------- | ----------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------ |
| Independent affinity | `independentAffinity`                                                               | `Voter_Independent_Affinity` | `independentAffinity: { eq: 'Yes' }` |
| Ideology             | `ideologyConservative` / `ideologyLiberal` / `ideologyModerate` / `ideologyUnknown` | `hf_ideology_general`        | `ideology: { in \| eq }`             |
| Any phone            | `hasAnyPhone`                                                                       | the two `VoterTelephones_*`  | `hasAnyPhone: true`                  |

`hasAnyPhone` already existed as a people-db filter key and SQL case, and
also backs the phone-banking reachability tile and the `phoneBanking`
built-in segment. What it lacked was a persisted column, so
`voterFilterBaseSchema` silently stripped it on save and a list built with it
lost the filter. `CountContactsDTO` no longer extends the base schema with
`hasAnyPhone`; it is a real column now.

**There is deliberately no has-address filter.** A sizing eval found
`Residence_Addresses_AddressLine` 100% populated — zero null or empty across
30.6M voters in CA, MD and LA — so the filter would match every voter and
could never narrow a list. A column was added by
`20260903190310` and dropped again by `20260903200114_drop_has_address_filter`
rather than edited out of the first, which had already been applied to the
PR's preview database. `hasAddress` survives as a people-db **wire** filter
and SQL case. Both pre-date this work and are untouched by it; only the
persisted column and the user-facing dimension are gone. What they back is
the **`doorKnocking` reachability tile** — `buildListDetailAggregatesSql`
emits `COUNT_IF(addressPresentSql()) AS doorKnocking` — NOT the
`doorKnocking` built-in segment, which carries `filters: []` and has never
filtered on address. Since the column is 100% populated, that tile always
equals the list's total count; it predates this change and is a separate
ticket, not a bug introduced here.

**`independentAffinity` is an enum on the wire, not a boolean.**
`Voter_Independent_Affinity` is a BOOLEAN set on every voter (no Unknown
bucket exists — the voter file classifies everyone), so the presence-check
path every other has-\* filter takes would compile to `IS NOT NULL` and match
all 219M voters, silently un-filtering the request. It is NULL on the
consumer-only rows of `gp_api_constituents`; the filter is Win-only, and Win
never reads that table. `buildIndependentAffinityFilter`
compares against `TRUE`/`FALSE` instead, and selecting both values is no
constraint at all so it emits nothing.

**Ideology's Unknown bucket is ~40% of the file.** It resolves through
`VALUE_MAPPERS.ideology` (identity for the three real values, `null` for
Unknown), so `buildMappedFieldFilter` turns it into `IS NULL` on its own and
`OR`s the null branch when Unknown is mixed with real values — the same
mechanism education/marital/gender use. Dropping it would return the
complement of what was asked for. The mart column's third value is
`Liberal`; the product labels it **Progressive**. The persisted key, wire
value, and `VALUE_MAPPERS` entry all follow the data; only the label differs
(`filterDimensions.catalog.ts` and the wizard both show Progressive).

**Win/Serve.** `independentAffinity` **and `ideology`** are Win-only like
party: `assertNoRecommendedListFilterForElectedOffice` 400s either at all
five choke points the party gate covers, and both carry `modes: 'win'` in
the catalog. Unlike party this is not a licensing rule but a product one —
both describe how someone votes in a contested election, which has no
meaning for an office holder who serves everyone in the district.
`hasAnyPhone` stays `both`: plain contactability, and Serve runs phone
banking and robocall too.

This Win gate and the webapp's own visibility prop are **two independent
mechanisms** and both apply. The prop decides whether a surface renders the
groups; the Win gate decides who may filter on them at all, permanently, and
holds regardless of what any surface renders.

**Phone interaction.** Three phone booleans now exist and they AND together.
`hasAnyPhone` is the OR of the other two, so it cannot be expressed by
combining them — hence its own option. Every phone value is presence-only,
so a combination is **redundant, never contradictory** (`hasAnyPhone AND
hasCellPhone` is just `hasCellPhone`): the resolver keeps plain AND
semantics rather than 400ing or dropping a key, and the wizard is what makes
the three mutually exclusive of the "any" option. A saved row carrying both
still resolves the obvious way.

**Visibility is a webapp concern only.** Which surfaces render the three
groups is decided there (`VoterFileStep`'s `showRecommendedListFilters`); the
columns, contract, translation, SQL and the dimensions catalog all ship
unconditionally, so a saved list resolves whatever rendered it. The AI
assistant therefore advertises these dimensions wherever the catalog reaches,
independent of any UI.

### Voted early or by mail filter

Win only. The pill (`early_absentee_voted` in `filters.config.ts`) saves
two booleans, `earlyAbsenteeVotedYes` and `earlyAbsenteeVotedNo`, which
`convertVoterFileFilterToFilters` turns into
`earlyAbsenteeVoted: { eq | in: ['Yes' | 'No'] }`. Both, or neither, is no
constraint. The SQL is membership in L2's daily early and absentee voter
table, not a column on the voter row; see `src/peopleDb/AGENTS.md`. Off by
default, so no list changes until a user picks it. Separate from
`votedStatus` ("Voted in election"), which reads this org's own will-vote
answers, and from `earlyVote` (a modeled likelihood); recommended lists and
`NOT_YET_VOTED` do not read it.

### Door-knock willVote writes a voter_likelihood override (ENG-10841)

The door-knocking tool's `willVote` answer (yes/no/unsure) is the one
activity signal (besides manual overrides) that writes a `voter_likelihood`
`ContactStatusService.changeStatus` event today — PO-confirmed mapping:
`yes` → `likely`, `no` → `unlikely`, `unsure` → no event at all.
`ContactInteractionDoorKnockService.create`/`recordIdempotent` (both
`ContactInteractionDoorKnock` write paths — manual/CRM and the door-knocking
tool's sync) call a shared private hook after persisting the interaction row,
keyed off the row's `willVote` column; manual logs never carry `willVote`
(`LogDoorKnockInteractionSchema` has no such field), so the hook is a no-op
there without a separate manual/sync branch. `source: door_knock`,
`actorUserId: null` (a canvass answer isn't attributed to a staff user),
`sourceId` is the interaction's own `sourceId` (the sync's `clientKey`) or its
row `id` for manual writes. `fallbackFromValue` is `null` — no cheap local
seed value is available at knock-sync time (unlike the manual status PATCH
endpoint, which already has a fresh people-db read), and the field is
advisory-only (decorates the very first override's feed "before" label,
non-null for every write after the first since the row-locked current-state
read then supplies the real fromValue).

**Idempotency (re-sync no double-write).** The event table's unique
`(organizationSlug, field, sourceId)` (ENG-10833) is a different constraint
from the interaction row's own `(organizationSlug, sourceId)` upsert key.
`ContactStatusService.attemptChangeStatus` catches a unique-constraint
violation on the event insert and resolves it to a silent no-op (`null`,
not a thrown error) whenever `sourceId` is set — a re-synced/replayed
door-knock must not fail the interaction write. This constraint can only
fire when `sourceId` is non-null (Postgres treats NULLs as distinct, so
manual edits never collide on it). One accepted limitation: `sourceId` is
keyed to the physical knock, not the value, so a _corrected_ `willVote` on
a re-synced clientKey still no-ops rather than recording a second event —
tested explicitly in `doorKnocking.routes.test.ts`.

**Win-only.** The door-knocking module has no Win/Serve gate of its own
(no endpoint in `DoorKnockingController` checks `hasElectedOfficeAccess`),
so an `eo-` org can technically reach these write paths. The hook checks
`organizationSlug.startsWith('eo-')` and skips itself, mirroring the
system-wide invariant that Serve never carries `voter_likelihood`
overrides — a real (if currently UI-unreachable) gap in the shared module,
not a speculative guard.
