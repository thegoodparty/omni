# The GoodParty CRM (contacts)

One CRM for the whole product: typeahead search for any person, a person
record with notes and a unified activity feed, dynamic saved filters that
drive outreach, per-recipient write-back from sends, and an AI assistant
that builds filters from plain language. Shared by Win (candidates,
"voters") and Serve (elected officials, "constituents").

This file is the system-level doc for the whole feature — the flows span
gp-webapp, gp-api, and people-api, but every flow passes through this
module, so the map lives here. Webapp UI detail stays in
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

- **There is no Contact table.** A "contact" is a people-api `Voter` row
  (200M+ L2 records, partitioned Postgres, read-mostly), served live
  through this module over S2S. `personId` everywhere is people-api
  `Voter.id` — a stable hash of `LALVOTERID` (~97% month-over-month
  stability; orphaned enhancement rows from L2 churn are accepted).
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
- **Support status is derived, never stored.** Latest interaction carrying
  a non-null `supportAnswer` wins; `unsure` and no-data both roll up to
  `unknown`. Single-sourced in `SupportStatusService` (display, filter
  resolution, and aggregates compile from the same
  `SUPPORT_ANSWER_ROLLUP` constant in
  `src/contactInteraction/contactInteraction.types.ts`).
- **Filter semantics: OR within a category, AND across categories.**
  Activity conditions likewise: selected outcomes OR within one
  condition, conditions AND across. Empty `actions` = membership in that
  outreach ("everyone it reached").
- **Win vs Serve is the `eo-` org-slug prefix**, nothing else. Serve never
  receives `politicalParty` (server-stripped) and party filters 400.
- **Interactions are an interface, not a generic table.** One Prisma
  model per channel; the convention (core fields, source FK, idempotency
  unique, feed index, SQL resolvability) is documented and
  compile-checked in `src/contactInteraction/contactInteraction.types.ts`
  — read it before adding a channel.
- **Collect-forward, no backfill.** Per-recipient truth starts at the
  feature-5 release. Outcome filters (responded / opted out / …) match
  nothing for older sends by design.

## Module map

| Code                                         | Owns                                                                                                                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/contacts/` (here)                       | Contacts surface: list/search/typeahead, person detail, stats, live count, list-detail, CSV download, notes + manual-interaction routes, people-api proxy, Pro/mode gates, filter-dimensions catalog |
| `src/contactInteraction/`                    | Per-channel interaction services, activity-condition → person-id-set resolution, derived support status                                                                                              |
| `src/contactNote/`                           | `ContactNoteService` (CRUD; routes live here in contacts)                                                                                                                                            |
| `src/contactEngagement/`                     | Per-person unified activity feed (`GET /v1/contact-engagement/:id/activities`)                                                                                                                       |
| `src/voters/voterFile/`                      | Saved-filter CRUD (`/v1/voters/voter-file/filter*`), lock-on-outreach. See `src/voters/CLAUDE.md`                                                                                                    |
| `src/outreach/`                              | Outreach CRUD + the CRM write paths: materialization, Peerly completion sweep, Peerly inbound sweep                                                                                                  |
| `src/vendors/peerly/`                        | Peerly client, phone-list upload + capture (`PeerlyPhoneList[Recipient]`)                                                                                                                            |
| `src/chats/general/crm-tools/`               | The AI assistant's in-code tools (`count_contacts`, `describe_filter_dimensions`, `crud_saved_filters`)                                                                                              |
| `packages/people-api`                        | The voter engine: filter pipeline, `id in/notIn`, trigram search, stats/aggregates                                                                                                                   |
| `packages/gp-webapp/app/dashboard/contacts/` | All UI (own CLAUDE.md)                                                                                                                                                                               |

Not this feature: `src/crm/` is the HubSpot **company** sync. `WebsiteContact`
and `EcanvasserContact` are unrelated models.

## HTTP surface

All person-facing routes resolve the org via `@UseOrganization()` +
`X-Organization-Slug`; ownership and org-scoping come from that, Pro
gating is per-action inside the services (see Access control).

| Route                                                                              | What                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/contacts`                                                                 | List/search. Small page doubles as the typeahead backend (trigram-backed in people-api)                                                                    |
| `GET /v1/contacts/:id`                                                             | Person detail (+ derived `supportStatus`, `optedOutAt`)                                                                                                    |
| `GET /v1/contacts/stats`                                                           | District aggregates (stat cards; open to non-Pro)                                                                                                          |
| `POST /v1/contacts/count`                                                          | Live count for an unsaved filter (wizard running total; assistant `count_contacts` parity)                                                                 |
| `GET /v1/contacts/list-detail`                                                     | Saved-segment detail: demographics, reachable-by-channel, outreach history (`email`/`metaAds` are always `null` — no data source)                          |
| `GET /v1/contacts/download`                                                        | CSV COPY stream from people-api. Serve downloads drop the party **column** via projection (`PARTY_DOWNLOAD_COLUMN`) since a stream can't be post-processed |
| `GET/POST /v1/contacts/:personId/notes`, `PATCH/DELETE /v1/contacts/notes/:noteId` | Notes CRUD, org-scoped (cross-org id = 404)                                                                                                                |
| `POST /v1/contacts/:personId/interactions`                                         | Manual interaction log. **No webapp caller** (UI removed in ENG-10711); the API stays                                                                      |
| `GET /v1/contact-engagement/:id/activities`                                        | Unified feed: interactions + polls + notes + legacy outreach rows                                                                                          |
| `POST /v1/voters/voter-file/filter`, `GET /filters`, `GET/PUT/DELETE /filter/:id`  | Saved-filter CRUD; PUT/DELETE 409 once locked                                                                                                              |
| `POST /v1/outreach`                                                                | Outreach create (draft-first); launch triggers materialization                                                                                             |

people-api (S2S only, JWT `iss: gp-api` / `aud: people-api`, minted in
`contacts.service.ts`): `POST /v1/people` (list/count), `GET /v1/people/:id`,
`POST /v1/people/download`, `GET /v1/people/stats`, `POST /v1/people/aggregates`,
sample routes. people-api has no user-facing routes and enforces district
scoping via its district join — the id-list filter can't enumerate outside
the org's district.

## Data model

| Model (table)                                  | Role / key facts                                                                                                                                                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VoterFileFilter`                              | The saved filter (UI "list"). ~60 demographic columns, `search`, `supportStatus`, `firstUsedForOutreachAt` (the lock), org FK cascade                                                                          |
| `VoterFileFilterActivityCondition`             | Owned condition rows: `outreachType` + `outreachId?` (null = any campaign of that channel) + `actions[]` (`ActivityConditionAction` enum; per-channel validity is Zod-enforced at the boundary, 400 otherwise) |
| `ContactInteractionText`                       | Per-recipient send truth: `outreachId` FK, `respondedAt`, `optedOutAt`, `sourceEventId`, `manual`. Unique `[outreachId, personId]`                                                                             |
| `ContactInteractionRobocall`                   | Same shape for robocall (`answeredAt` / `voicemailLeftAt`)                                                                                                                                                     |
| `ContactInteractionDoorKnock`                  | `outcome`, three-way `supportAnswer`, `note`, `manual`, `sourceId`. Unique `[organizationSlug, sourceId]`. Written by the in-house door-knocking tool, never by outreach launch                                |
| `ContactNote`                                  | Org-authored per-person notes (body ≤ 10k)                                                                                                                                                                     |
| `PeerlyPhoneList` / `PeerlyPhoneListRecipient` | Capture tables: which people (and which phone per person) actually landed on a Peerly phone list. The phone↔person mapping the inbound sweep depends on                                                        |
| `Outreach`                                     | Carries `organizationSlug` on new writes (legacy rows resolve org via campaign join), `voterFileFilterId?`, `phoneListId?`, `status`                                                                           |
| `VoterOutreachActivity`                        | **Deprecated.** Read-only legacy feed rows; only remaining writer is the eCanvasser door-knock path (own removal workstream). No new writes                                                                    |

Outcome→column mapping used by filter resolution: SMS `responded` =
`respondedAt` not null, `no_response` = null, `opted_out` = `optedOutAt`
not null; robocall `answered`/`voicemail_left` from their timestamps,
`no_answer` = both null; door knock from `outcome` and `supportAnswer`.

## The flows

### Read path (list, typeahead, detail, count, download)

webapp → `GET /v1/contacts` → `ContactsService.findContacts` → resolve
filters (`convertVoterFileFilterToFilters` in
`utils/voterFileFilter.utils.ts` + activity/support resolution below) →
people-api `POST /v1/people` → join/strip (party choke point
`stripPartyIfElectedOffice`) → respond. Typeahead is the same endpoint
with a small page; person detail adds derived `supportStatus` and
`optedOutAt` (`ContactInteractionTextService.latestOptOutAt`). The count
endpoint runs the identical translation with `resultsPerPage: 1` and
returns only `pagination.totalResults`.

### Activity-condition + support-status resolution

`ActivityConditionResolutionService` (contactInteraction) resolves each
condition to a `personId` set with plain SQL over the channel's
`contact_interaction_*` table (scoped to `outreachId` when named,
restricted to selected outcomes when `actions` is non-empty); sets
AND-compose. `SupportStatusService` resolves the support buckets the same
way. Both travel to people-api as `id: { in | notIn }` on the Voter PK —
a `::uuid[]` SQL builder in people-api's filter pipeline
(`filters.schema.ts` → `transformFilters` → `buildVoterFiltersSql`),
**capped at 100k ids** (400 beyond; the trigger to revisit the projection
fallback). A condition naming a specific `outreachId` only accepts
**completed** outreaches.

### Saved-filter lifecycle

Create/edit via the wizard (or the assistant's `crud_saved_filters`) →
`voters/voter-file` CRUD. At first outreach launch
`stampFirstUsedForOutreach` claims the lock atomically
(`updateMany WHERE first_used_for_outreach_at IS NULL`) — after that,
PUT/DELETE 409 ("duplicate to edit"; the webapp reposts criteria as a
copy). The stamp happens **before** the channel guard in materialization,
so channels without an interaction model still lock the filter.

### Outreach launch → materialization (the "list")

`OutreachMaterializationService.materializeOutreach`:

1. Stamp the filter lock (if a filter is attached — p2p can carry a phone
   list without one).
2. Only `text | p2p | robocall` materialize. `doorKnocking` is permanently
   excluded (the door-knock tool writes its own rows);
   `phoneBanking`/`socialMedia` have no model yet.
3. p2p/text with a captured Peerly phone list: rows come from
   `PeerlyPhoneListRecipient` — the actual SMS-reachable recipients — one
   `ContactInteractionText` per person (`createMany` +
   `skipDuplicates`, idempotent under retry). Fallback when an outreach
   has a `phoneListId` but no capture rows (pre-epic list or failed
   capture write): re-resolve the filter fresh, which can overstate.
   Robocall always resolves the filter.
4. `occurredAt` = launch time, not send-completion time.
5. Pages through the segment (`SEGMENT_PAGE_SIZE` 1000, cap
   `MAX_MATERIALIZED_VOTERS` 100k).

Phone-list generation for saved-filter sends goes through the contacts
pipeline (`findContactsForFilter`), so activity/support conditions are
honored — the list matches what the wizard's count promised
(`src/vendors/peerly/services/p2pPhoneListUpload.service.ts` +
`peerlyPhoneListCapture.service.ts`).

### Write-back (collect-forward)

Two `@Cron` sweeps in `src/outreach/services/` (scheduled fetch — Peerly
has no signed webhook):

- `outreachCompletion.service.ts` — flips Peerly job status
  `pending → in_progress → completed`. Completion gates "specific
  campaign" activity conditions. Watch: it infers from `end_date` (the
  scheduled end), not delivery truth — refinement via CDR ingestion is
  ENG-10740 (open).
- `outreachInboundSweep.service.ts` — fetches per-lead results for
  active/recently-completed jobs, maps phone → person through the capture
  rows, writes `respondedAt` / `optedOutAt` idempotently on the vendor
  event id. Opt-outs drive the record's Opted In/Out chip.

### The AI assistant

Tools are **in-code functions with Zod schemas** (foreground CAP agent
pattern — explicitly not MCP): `crm-tools/` builders registered in the
campaign-manager handler (Win, gated `win-crm`) and chief-of-staff
handler (Serve, gated `serve-crm`). Each tool calls the same services as
the UI routes in the user's org context, so mode rules, Pro gates, and
free-tier rules are inherited, never re-implemented. **No tool returns an
individual voter row** — aggregates, dimension metadata, and filter
ids/names only. `describe_filter_dimensions` reads
`filterDimensions.catalog.ts`, the single mode-aware vocabulary source.
The TDD's `GET /v1/contacts/filter-dimensions` route was deliberately
skipped (tools call services in-process). The webapp assistant bar rides
the existing `campaign_assistant` / `chief_of_staff` chat scopes — no new
scope.

## Access control and mode rules

| Rule                              | Enforcement                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Win contacts access is default-on | The `win-voter-data` flag gate was removed 2026-07-20 (PRs #885–#887); `assertContactsAccess` is gone. Any Win campaign reaches the page                                                                                                                                                                                                                                                       |
| Pro is per-action, not page-level | Non-Pro Win: real district aggregates + a **synthetic** preview (`utils/previewContacts.utils.ts` — fabricated rows, never real PII; `totalResults` is set to the real count so the stat card doesn't regress). `findContacts` rejects search/named segments; `findPerson`, `countContacts`, `downloadContacts`, notes, and interactions all reject non-Pro (`PRO_FILTERING_REQUIRED_MESSAGE`) |
| Serve = `eo-` slug prefix         | `hasElectedOfficeAccess`; Serve orgs are license-equivalent to Pro                                                                                                                                                                                                                                                                                                                             |
| Party never reaches Serve         | `stripPartyIfElectedOffice` (list + detail + typeahead), download drops the column via projection, party **filters** 400 (`assertNoPartyFilterForElectedOffice`), and the dimensions catalog hides party. A party value in any `eo-` response is a bug — there's a party-leak test suite                                                                                                       |
| CRM UI flags                      | `win-crm` / `serve-crm` (Amplitude) gate the CRM page (`useCrmEnabled`, mode-aware: serve-crm decides for Serve, win-crm for Win) and the assistant tools. Independent ramp cadences                                                                                                                                                                                                           |
| Free tier / AI                    | District stats stay open to non-Pro; counts are Pro-gated like search (the assistant's `count_contacts` recognizes `PRO_FILTERING_REQUIRED_MESSAGE` and suggests the upgrade); assistant tools are aggregate-only by construction                                                                                                                                                              |

## Debugging playbook

First stop for prod issues: Grafana Loki
`{service_name="gp-api", deployment_environment_name="prod"}` (people-api
under its own `service_name`). Frontend errors: Sentry org `goodparty`.

| Symptom                                                      | Where to look                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Count ≠ what outreach reached                                | Count is dynamic (filter re-resolved now); the send used the phone-list capture at launch. Compare `PeerlyPhoneListRecipient` rows vs a fresh `findContactsForFilter`. Also: channel reachability (SMS needs a cell phone) trims at phone-list build, not in the count |
| Outcome filter matches nothing                               | Expected for pre-feature-5 sends (collect-forward, no backfill). Check the outreach's `ContactInteractionText` rows exist and sweeps ran                                                                                                                               |
| responded/opted-out never appears                            | Inbound sweep: is the job in the sweep window (anchored on scheduled send date)? Do capture rows exist for the phone list (phone→person mapping)? Check `sourceEventId` idempotency collisions and Loki for sweep errors                                               |
| "Specific campaign" missing from the wizard's campaign chips | Only **completed** outreaches qualify; the completion sweep infers from Peerly `end_date` — a stale/never-run job can sit `in_progress` (ENG-10739 fixed the predicate; ENG-10740 tracks CDR truth)                                                                    |
| 409 on filter edit/delete                                    | `firstUsedForOutreachAt` is stamped — by design (duplicate to edit). A filter `updatedAt` newer than its stamp would be a real bug                                                                                                                                     |
| Party visible to a Serve org                                 | The choke points are `stripPartyIfElectedOffice` + the download projection. Treat as a sev bug (license)                                                                                                                                                               |
| Non-Pro sees real voter rows                                 | Must be impossible — `previewContacts.utils.ts` fabricates rows. Check nothing bypasses `findContacts`'s pro branch                                                                                                                                                    |
| Empty contacts page on dev                                   | Dev people-api genuinely lacks person rows for many districts (district-specific, not dev-wide). Stats can exist while rows don't — people-api warns on this since ENG-10745. Cheyenne WY 82001 has dev rows                                                           |
| Typeahead empty / slow                                       | pg_trgm GIN indexes on `lower(FirstName)`/`lower(LastName)` per state partition. They are rebuilt by the data platform's cluster-rebuild loader — a manual index not registered with the loader vanishes at the next ETL rebuild (see people-api docs)                 |
| Filter 400 "too many ids"                                    | The 100k id-set cap in people-api — an activity/support condition resolved to more people than the transport allows. Logged; the projection fallback is the designed escape                                                                                            |
| Assistant refuses / weird tool behavior                      | Flags `win-crm`/`serve-crm` for the user (server-evaluated); locked-filter 409 surfaces as an explanation. Note gp-api-dev evaluates flags against the PROD Amplitude project                                                                                          |
| Feed missing legacy Win outreach rows                        | Legacy `VoterOutreachActivity` rows render only during the sunset and only for Win; new channels need a feed-mapping branch in `ContactEngagementService` + a `ConstituentActivity` variant                                                                            |

Useful SQL truths: derived support status =
`DISTINCT ON (organization_slug, person_id) … ORDER BY occurred_at DESC`
over interaction rows with a non-null `support_answer`; a "list" =
`SELECT person_id FROM contact_interaction_text WHERE outreach_id = X`.

## Gotchas

- `Outreach.organizationSlug` is null on legacy rows (org via campaign
  join); never assume it's set.
- `ContactInteractionText.unsubscribedAt` was dropped before anything
  wrote it (SMS "unsubscribed" folded into `opted_out`, 2026-07-16).
- Support answers are captured by door knocking only (for now); the
  filter buckets exist in **both** modes.
- No paginated member browsing anywhere, by locked design — the list
  detail never shows people; individuals are reached via typeahead only.
  Don't add a member table.
- `email` / `metaAds` reachability are `null` (no data source), rendered
  "Unavailable" — never coerce to 0.
- Age filter ranges are mutually exclusive since ENG-10752/10753; the
  catalog + `voterFilterBase.schema.ts` own the vocabulary.
- Download does not re-apply a stored `search` (people-api `/download`
  has no search param) — long-standing quirk, don't "fix" casually.
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
  `tests/contactsAgeFilters.routes.test.ts`, `contacts.e2e.ts`.
  Assistant/UI parity: `chats/general/crm-tools/countContactsParity.routes.test.ts`.
- Resolution + derivation: `src/contactInteraction/tests/`.
- people-api SQL builders: `filters.sql.utils.test.ts` pattern (assert
  SQL string + params).
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
