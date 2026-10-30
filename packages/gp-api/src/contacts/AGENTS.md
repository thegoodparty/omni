# The GoodParty CRM (contacts)

One CRM for the whole product: typeahead search for any person, a person
record with notes and a unified activity feed, dynamic saved filters that
drive outreach, per-recipient write-back from sends, and an AI assistant
that builds filters from plain language. Shared by Win (candidates,
"voters") and Serve (elected officials, "constituents").

This file is the system-level doc for the whole feature — the flows span
gp-webapp and gp-api, but every flow passes through this module, so the map
lives here. Webapp UI detail stays in
`packages/gp-webapp/app/dashboard/contacts/CLAUDE.md`; don't duplicate it.

Design source of truth: the CRM tech design
(https://app.clickup.com/90132012119/v/dc/2ky4jq2q-20493/2ky4jq2q-98973)
and its implementation-notes child page (…/2ky4jq2q-98993). Built as seven
epics, all shipped 2026-07: ENG-10676 (interaction foundation), ENG-10683
(search/typeahead), ENG-10691 (contact record), ENG-10699 (saved filters
and lists), ENG-10726 (outreach write-back), ENG-10733 (AI list
assistant), ENG-10721/10725 (locked-prototype UI parity). Launch-feedback
fixes track under ENG-10744.

## The mental model — read this before touching anything

- **There is no Contact table.** A "contact" is a voter row (hundreds of
  millions of L2 records, read-mostly), served live through
  `PeopleQueryModule` (`src/peopleDb/`) from the `mart_gp_api` schema in
  Databricks. `personId` everywhere is that voter row's `id` — a stable hash
  of `LALVOTERID` (~97% month-over-month stability; orphaned enhancement
  rows from L2 churn are accepted), or a gp-api-minted uuid for a person
  only an import added (next point).
- **Imported contacts join the read; nothing here stores them.** For an org
  (Serve, or Win) with `serve-import-contacts` on, `PeopleDatasetService` puts the org
  on the dataset and every people read joins the org's uploaded rows in
  (`src/peopleDb/AGENTS.md`, "Imported contacts join the read"). Uploaded
  phone, address and email win; `Person.email` and `Person.isNewContact`
  carry the result. Uploads themselves live in `src/contactUploads/`.
- **On Win, a person only an import added is a "new contact added", never a
  voter.** For a Win campaign with the overlay (`ContactsService.splitsNewContacts`),
  `GET /v1/contacts/stats` and both list-detail routes count voters only
  (`totalConstituents`, `demographics.people`, every `reachability` channel)
  and return `newContactsCount` (and `newContactsReachable` per channel)
  beside them, from the same statement. Serve, and Win without imports, omit
  both and count as before. `POST /v1/contacts/count` still counts everyone
  a filter matches. The `source` filter (`voterFile` / `imported`, a
  `VoterFileFilter` column and a Win-only catalog dimension offered only
  with the overlay) picks one side; Serve 400s on it like party.
  `docs/adr/2026-10-30-win-new-contacts-counted-next-to-voters.md`.
- **Enhancements live in gp-api Postgres**, keyed
  `(organizationSlug, personId)`: `ContactNote` plus the per-channel
  `ContactInteraction*` models. Orgs are legally isolated — outreach data
  never crosses org boundaries (a win creates a fresh Serve org and
  carries nothing over).
- **A saved filter is a dynamic query; a list is a static snapshot.** The
  UI says "list" but persists a `VoterFileFilter` (org-scoped, ~60
  demographic columns + `search` + owned
  `VoterFileFilterActivityCondition` rows). Membership changes as data
  changes. The static list only comes into existence at outreach launch,
  materialized as one interaction row per person — those rows are the
  audit truth. There is no `ContactList` model.
- **Support status is derived, with an optional manual override.** The
  FIRMEST interaction wins, not the latest: `supporter` and `non_supporter`
  outrank `unsure`, which outranks a row with no answer, and recency only
  settles ties between equally firm answers — so a re-canvass that captured
  "unsure" cannot erase a supporter recorded last month. `unsure` rolls up to
  `undecided`, and `unknown` means no support answer was ever captured (never
  contacted, or contacted with no answer recorded) — both the rollup and the
  ranking are single-sourced, via the `SUPPORT_ANSWER_ROLLUP` and
  `SUPPORT_ANSWER_FIRMNESS` constants in
  `src/contactInteraction/contactInteraction.types.ts`. A person can also
  carry a manual `support_status` override (`ContactStatusService`,
  `contact_current_status` table) to any of the five `SupportStatusRollup`
  values — `refused` exists _only_ as an override, nothing derives it.
  Effective status = override ?? derived everywhere: display
  (`ContactsService.effectiveStatus`) and filter resolution/counts
  (`SupportStatusService.personIdsByEffectiveStatus`, ENG-10837) both compose
  the two sources the same way, so a manual change is never masked by a
  stale derived value.
- **Filter semantics: OR within a category, AND across categories.**
  Activity conditions likewise: selected outcomes OR within one
  condition, conditions AND across. Empty `actions` = membership in that
  outreach ("everyone it reached").
- **Party is a registration in some states and an L2 estimate in others.**
  `src/peopleDb/partySource.ts` is the one place that says which (from L2's
  own state-by-state account): `getFilterDimensions` re-marks the party
  dimension `modeled` with a note for a Win org in a state with no party
  registration, the CSV export's party headers follow the district's state,
  and the Campaign Manager's constituent-data tools word the column the same
  way. Add a party label anywhere else and read it from there.
- **Win vs Serve is the `eo-` org-slug prefix**, nothing else. Serve never
  receives `politicalParty` (server-stripped) and party filters 400. The
  person activity feed strips the same way and for the same reason
  (`contactEngagement.service.ts`): a door-knock or phone-banking row's
  `supportAnswer`/`willVote` are Win facts about a person, so both read null
  for an `eo-` org. Stripped server-side rather than hidden per reader,
  because that feed has two — the walk's person sheet and the Constituents
  overlay — and one null fixes both plus whatever reads it next. Precinct
  is NOT in that set — it is offered to both, because a precinct is an
  administrative subdivision of the district an official already serves.
- **Precinct is the one filter with no fixed vocabulary, and the assistant reaches it through a tool rather than the catalog.** `list_precincts` (crm-tools, registered beside `count_contacts` on both handlers) reads `GET /v1/contacts/precincts` and returns the ENCODED `county|precinct` values to pass straight into the `precincts` filter field. It exists because the catalog publishes each dimension's complete vocabulary and precinct's is per-district, so precinct stays absent from `filterDimensions.catalog.ts` and the tool's own description is what tells the model the dimension exists — the two must stay registered together. Before it, the assistant told holders their own precinct was not a dimension it could filter on while the wizard beside it offered exactly that filter; the filter plumbing was always there (`voterFilterBaseSchema.precincts`, which both `count_contacts` and `crud_saved_filters` inherit), only the discovery was missing.
- **Precinct is the one filter with no fixed vocabulary.** Every other
  dimension declares its values in `filterDimensions.catalog.ts`; precinct's
  are enumerated per district, so it is deliberately absent from that catalog
  (the assistant would otherwise invent precinct names). The identity is the
  `(county, precinct)` PAIR — a bare precinct number repeats across counties
  (one Texas string appears in 72 of them) — encoded as one `county|precinct`
  scalar by `encodePrecinctPair` in contracts, which is also what
  `VoterFileFilter.precincts` persists. An empty precinct side is the real
  "no precinct on file" bucket and must resolve to `IS NULL`, never to a
  comparison against `''`.
- **Interactions are an interface, not a generic table.** One Prisma
  model per channel; the convention (core fields, source FK, idempotency
  unique, feed index, SQL resolvability) is documented and
  compile-checked in `src/contactInteraction/contactInteraction.types.ts`
  — read it before adding a channel.
- **Collect-forward, no backfill.** Per-recipient truth starts at the
  feature-5 release. Outcome filters (responded / opted out / …) match
  nothing for older sends by design.

## Module map

| Code                                         | Owns                                                                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/contacts/` (here)                       | Contacts surface: list/search/typeahead, person detail, stats, live count, list-detail, CSV download, notes + manual-interaction routes, Pro/mode gates, filter-dimensions catalog |
| `src/contactInteraction/`                    | Per-channel interaction services, activity-condition → person-id-set resolution, derived support status                                                                            |
| `src/contactNote/`                           | `ContactNoteService` (CRUD; routes live here in contacts)                                                                                                                          |
| `src/contactEngagement/`                     | Per-person unified activity feed (`GET /v1/contact-engagement/:id/activities`)                                                                                                     |
| `src/voters/voterFile/`                      | Saved-filter CRUD (`/v1/voters/voter-file/filter*`), lock-on-outreach. See `src/voters/CLAUDE.md`                                                                                  |
| `src/outreach/`                              | Outreach CRUD + the CRM write paths: materialization, Peerly completion sweep, Peerly inbound sweep                                                                                |
| `src/vendors/peerly/`                        | Peerly client, phone-list upload + capture (`PeerlyPhoneList[Recipient]`)                                                                                                          |
| `src/chats/general/crm-tools/`               | The AI assistant's in-code tools (`count_contacts`, `describe_filter_dimensions`, `crud_saved_filters`)                                                                            |
| `src/peopleDb/`                              | The voter engine: filter pipeline, `id in/notIn`, name search, stats/aggregates, read from Databricks. See `src/peopleDb/CLAUDE.md`                                                |
| `src/contactUploads/`                        | Import contacts (Serve, and Win Pro): CSV upload, matching to people, review, per-field "Came from". See `src/contactUploads/AGENTS.md`                                            |
| `packages/gp-webapp/app/dashboard/contacts/` | All UI (own CLAUDE.md)                                                                                                                                                             |

Not this feature: `src/crm/` is the HubSpot **company** sync. `WebsiteContact`
is an unrelated model.

## HTTP surface

Moved to [`docs/http-surface.md`](docs/http-surface.md) (~24 KB). Grep it for the file, class, or route you are working on; do not read it whole.

## Data model

Moved to [`docs/data-model.md`](docs/data-model.md) (~23 KB). Grep it for the file, class, or route you are working on; do not read it whole.

## The flows

### Read path (list, typeahead, detail, count, download)

Moved to [`docs/flows-read-and-vocabulary.md`](docs/flows-read-and-vocabulary.md) (~5 KB). Grep it for the file, class, or route you are working on; do not read it whole.

### Activity-condition + support-status resolution

Moved to [`docs/flows-read-and-vocabulary.md`](docs/flows-read-and-vocabulary.md) (~5 KB). Grep it for the file, class, or route you are working on; do not read it whole.

### The Voter_Status propensity vocabulary

Moved to [`docs/flows-read-and-vocabulary.md`](docs/flows-read-and-vocabulary.md) (~5 KB). Grep it for the file, class, or route you are working on; do not read it whole.

### The Early_Vote_Status vocabulary

Moved to [`docs/flows-read-and-vocabulary.md`](docs/flows-read-and-vocabulary.md) (~5 KB). Grep it for the file, class, or route you are working on; do not read it whole.

### Override-aware Voter Likelihood filtering (ENG-10838)

Moved to [`docs/flows-filters.md`](docs/flows-filters.md) (~15 KB). Grep it for the file, class, or route you are working on; do not read it whole.

### Contacts-made filter (ENG-10839)

Moved to [`docs/flows-filters.md`](docs/flows-filters.md) (~15 KB). Grep it for the file, class, or route you are working on; do not read it whole.

### Recommended-list filter dimensions

Moved to [`docs/flows-filters.md`](docs/flows-filters.md) (~15 KB). Grep it for the file, class, or route you are working on; do not read it whole.

### Door-knock willVote writes a voter_likelihood override (ENG-10841)

Moved to [`docs/flows-filters.md`](docs/flows-filters.md) (~15 KB). Grep it for the file, class, or route you are working on; do not read it whole.

### Serve's follow-up flag

Moved to [`docs/flows-civic-panel.md`](docs/flows-civic-panel.md) (~27 KB). Grep it for the file, class, or route you are working on; do not read it whole.

### Serve's civic panel

Moved to [`docs/flows-civic-panel.md`](docs/flows-civic-panel.md) (~27 KB). Grep it for the file, class, or route you are working on; do not read it whole.

### Sizing and steering the panel

Moved to [`docs/flows-civic-panel.md`](docs/flows-civic-panel.md) (~27 KB). Grep it for the file, class, or route you are working on; do not read it whole.

### Managed civic panel

Moved to [`docs/flows-managed-civic-panel.md`](docs/flows-managed-civic-panel.md) (~11 KB). Grep it for the file, class, or route you are working on; do not read it whole.

### Saved-filter lifecycle

Moved to [`docs/flows-lists-and-assistant.md`](docs/flows-lists-and-assistant.md) (~13 KB). Grep it for the file, class, or route you are working on; do not read it whole.

### Outreach launch → materialization (the "list")

Moved to [`docs/flows-lists-and-assistant.md`](docs/flows-lists-and-assistant.md) (~13 KB). Grep it for the file, class, or route you are working on; do not read it whole.

### Write-back (collect-forward)

Moved to [`docs/flows-lists-and-assistant.md`](docs/flows-lists-and-assistant.md) (~13 KB). Grep it for the file, class, or route you are working on; do not read it whole.

### The AI assistant

Moved to [`docs/flows-lists-and-assistant.md`](docs/flows-lists-and-assistant.md) (~13 KB). Grep it for the file, class, or route you are working on; do not read it whole.

## Access control and mode rules

Moved to [`docs/access-control.md`](docs/access-control.md) (~16 KB). Grep it for the file, class, or route you are working on; do not read it whole.

## Debugging playbook

Moved to [`docs/debugging-playbook.md`](docs/debugging-playbook.md) (~10 KB). Grep it for the file, class, or route you are working on; do not read it whole.

## Gotchas

- `Outreach.organizationSlug` is null on legacy rows (org via campaign
  join); never assume it's set.
- `ContactInteractionText.unsubscribedAt` was dropped before anything
  wrote it (SMS "unsubscribed" folded into `opted_out`, 2026-07-16).
- Support answers are captured by door knocking and phone banking
  (`SupportStatusService.derivedStatusSql` UNIONs both
  `contact_interaction_door_knock` and `contact_interaction_phone_banking`,
  ENG-10915); the filter buckets exist in **both** modes.
- No paginated member browsing anywhere, by locked design — the list
  detail never shows people; individuals are reached via typeahead only.
  Don't add a member table.
- Reachability has five channels: sms, robocall, phoneBanking, doorKnocking,
  polls. `email`/`metaAds` were removed (ENG-10783, no data source ever
  existed for them); `polls` mirrors the sms (has-cell-phone) count 1:1.
  `phoneBanking` is reachable-by-any-phone (cell OR landline non-null,
  ENG-10914) — it used to mirror `robocall`'s landline-only count, but the
  list builder freezes any phone (cell first), so the tile now agrees with
  the built list. `robocall` stays landline-only. The `hasAnyPhone`
  filter key (`src/peopleDb/databricks/databricksVoterSql.util.ts`) backs
  the tile, the `phoneBanking` entry in `segmentsToFiltersMap.const.ts`
  (the built-in CRM segment/CSV export), AND the persisted filter column of
  the same name — one predicate, so a tile and a list built from it agree.
- `fetchListDetailAggregates` makes ONE people-db call
  (`VoterQueryService.getListDetailAggregates`) and the whole payload is
  all-or-nothing: the demographics and every channel come from a single
  conditional-aggregate statement, so a failure 502s the route rather than
  degrading a tile. Five statements per request was itself the problem — it
  was ~half of prod's Databricks statement volume and pushed a serverless
  X-Small warehouse past the ~10-in-flight point where it provisions new
  compute and bills a flat 3-5s wait. `ListDetailReachabilitySchema`'s
  channels stay nullable for the webapp's "Unavailable" tile, but nothing
  emits null any more.
- Age filter ranges are mutually exclusive since ENG-10752/10753; the
  catalog + `voterFilterBase.schema.ts` own the vocabulary.
- Download does not re-apply a stored `search` (the download path has no
  search param) — long-standing quirk, don't "fix" casually.
- The wizard blocks zero-filter lists and Serve drops outreach
  affordances (ENG-10749–10751).
- New interaction writes must be DB-level idempotent (upsert on the
  unique / `createMany skipDuplicates`), never read-then-write — retries
  are normal.

## Testing

- Route-level tests with `useTestService()` (real Postgres):
  `tests/contactNotes.routes.test.ts`,
  `tests/contactInteractions.routes.test.ts`,
  `tests/contactsOptedOutChip.routes.test.ts`,
  `tests/contactsAgeFilters.routes.test.ts`,
  `tests/contactsVoterLikelihoodOverride.routes.test.ts`,
  `tests/contactsMade.routes.test.ts`,
  `tests/contactsAffinityIdeologyFilters.routes.test.ts`.
  Assistant/UI parity: `chats/general/crm-tools/countContactsParity.routes.test.ts`.
- Resolution + derivation: `src/contactInteraction/tests/`, including
  `contactsMadeResolution.service.test.ts` (the bucket SQL + the
  in/notIn/override decision table) and `contactStatus.service.test.ts`
  (the atomic decide-and-write, the sourceId no-op).
- Door-knock willVote → voter_likelihood: the `willVote ->
voter_likelihood override events` describe block in
  `src/doorKnocking/tests/doorKnocking.routes.test.ts` (mapping,
  re-sync/correction no-op, eo- skip); the feed rendering in
  `src/contactEngagement/tests/contactEngagement.routes.test.ts`.
- `src/peopleDb` SQL builders: `databricksVoterSql.util.test.ts` pattern
  (assert SQL string + params; mock-based, no live warehouse — see
  `src/peopleDb/CLAUDE.md`).
- Webapp e2e (hard merge gate): `e2e-tests/tests/app/contacts/*.spec.ts`
  — flags forced via the override cookie; the assistant spec stubs the
  whole chat round trip (and blocks service workers so stubs intercept).

## Related docs

- `packages/gp-webapp/app/dashboard/contacts/CLAUDE.md` — all UI detail +
  the analytics event catalog (mode-specific event naming rules).
- `src/contactInteraction/contactInteraction.types.ts` — the
  add-a-channel convention (authoritative checklist).
- `src/voters/CLAUDE.md` — voter-file filter persistence layer.
- `src/queue/CLAUDE.md` — only if you move write-back onto SQS (it is
  synchronous + cron today).
- `docs/cap-interactive-agents.md` — the chat stack the assistant rides.
