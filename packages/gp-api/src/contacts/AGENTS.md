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
  rows from L2 churn are accepted).
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
| `packages/gp-webapp/app/dashboard/contacts/` | All UI (own CLAUDE.md)                                                                                                                                                             |

Not this feature: `src/crm/` is the HubSpot **company** sync. `WebsiteContact`
is an unrelated model.

## HTTP surface

All person-facing routes resolve the org via `@UseOrganization()` +
`X-Organization-Slug`; ownership and org-scoping come from that, Pro
gating is per-action inside the services (see Access control).

| Route                                                                                                                                          | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/contacts`                                                                                                                             | List/search. Small page doubles as the typeahead backend                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `GET /v1/contacts/:id`                                                                                                                         | Person detail (+ derived `supportStatus`, `optedOutAt`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `GET /v1/contacts/stats`                                                                                                                       | District aggregates (stat cards; open to non-Pro)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `POST /v1/contacts/count`                                                                                                                      | Live count for an unsaved filter (wizard running total; assistant `count_contacts` parity). Takes an optional `boundaryFromSegmentId`: the saved list being EDITED, whose drawn boundary is then intersected with the inline criteria. Only the boundary is read from it — every filter field still comes from the body, because those are what the holder is editing. Without it the edit wizard counted a boundaried list at its pre-boundary size (an inline filter carries neither `id` nor `geoPoly`, so `resolveGeoIdFilter` saw no boundary), so a list reading 339 on its detail sheet offered "Save changes (5,356)". Resolved through the org-scoped segment lookup, so a client-supplied id 404s unless this org owns it. Open to a free Win campaign (outreach-pro-gating-v2): the outreach build path prices a list before the upgrade, and a count is a number about the district, not a voter record |
| `GET /v1/contacts/precincts`                                                                                                                   | The Precinct filter's option list: distinct `(County, Precinct)` in the org's district with a voter count each, capped at 5,000 with a `truncated` flag. Pro-gated, served to Win and Serve alike, and deliberately UNFILTERED — the list is the dimension's vocabulary, so it must not shrink as other filters narrow and strand an already-picked precinct                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `POST /v1/contacts/overlap-count`                                                                                                              | Saved-list overlap for the wizard's "N (P%) voters already exist in lists you've saved" strip (ENG-10840): the in-progress selection AND'd with the union of the org's saved lists (capped at the 25 most recent, truncation logged). Same in-progress payload as `count`, and open to a free campaign the same way                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `POST /v1/contacts/polygon-preview`                                                                                                            | Live count for a boundary drawn over an in-progress list: same unsaved-draft payload and gates as `count`, narrowed by a bbox prefilter plus an in-process ray-cast (people_db has no geometry column, so there is no ST_Contains to run). A boundary can have several parts (`GeoJsonShape` — one `Polygon`, or a `MultiPolygon`), and each part is scanned against its OWN bbox and unioned by person id, so the count is unique across parts and one box around scattered parts never drags most of the district through the cap. Returns `{ count, audienceEmpty }` — `audienceEmpty` separates "your filters match nobody" from "this shape holds none of your audience", which are the same zero on the wire and different problems. Over the query's cap it 400s rather than truncating                                                                                                                      |
| `POST /v1/contacts/points`                                                                                                                     | The dots the Serve wizard's draw step draws on: everyone the in-progress filters match across the whole district, as bare `{ id, lat, lng }`. Sibling of `polygon-preview` — same unsaved-draft payload and gates, minus the shape, because the map has to show the list before there is a shape to narrow it with. Names and addresses are deliberately absent (the step has no person overlay behind its dots, and this is the widest read in the CRM). Unlike its sibling it **truncates rather than 400s** past its cap (`MAX_RESULTS_PER_PAGE`, matching the saved-list map) and says so with `truncated` — a map that declines to draw teaches the holder less than a partial one                                                                                                                                                                                                                             |
| `GET /v1/campaigns/mine/recommended-lists/:variant/download` (recommendedLists module)                                                         | The saved-list CSV for a recommendation not saved yet: resolves the variant's global universe, then `ContactsService.downloadFilter` — `downloadContacts` fed an inline filter, always individual voters (`docs/features/recommended-lists.md`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `POST /v1/contacts/list-detail`                                                                                                                | The same demographics + reachability for an UNSAVED filter — the body is the count endpoint's inline filter (`CountContactsDTO`), run through the same resolution. `outreachHistory` is always `[]`: nothing has been sent to a list that does not exist. Backs the voter data page's recommended-list detail sheet (`docs/features/recommended-lists.md`). Aggregates only, so open to a free campaign like `count`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `GET /v1/contacts/list-detail`                                                                                                                 | Saved-segment detail (`segment` param): demographics, reachable-by-channel (sms/robocall/phoneBanking/doorKnocking/polls), outreach history. Aggregates only, so open to a free campaign like `count` (the outreach audience step prices a saved list off it before the upgrade). Omitting `segment` returns the universe row's detail instead — the whole unfiltered district, `outreachHistory` always `[]` (ENG-10778). `segment=civicPanel` is Serve's built-in panel list: the `civicPanelMember` filter's figures (so the same 400 for a non-`eo-` org), and as `outreachHistory` the office's sent outreaches that reached a current member (see "The panel as a whole"). History excludes `doorKnocking` rows (the door-knock tool writes its own interaction rows) and orders null `date`s last with `createdAt` fallback fields (ENG-10776)                                                               |
| `GET /v1/contacts/download`                                                                                                                    | Streaming CSV export: a curated ~76-column subset with friendly headers (`DOWNLOAD_COLUMNS`, ENG-10766, widened in DATA-2281), not the raw L2 columns. Serve downloads drop the party, turnout propensity, vote history, ethnicity, and L2 voter id **columns** entirely via projection (`SERVE_EXCLUDED_DOWNLOAD_COLUMNS`, which is `EXCLUDABLE_VOTER_COLUMNS` verbatim, ENG-10830 + #1933) since a stream can't be post-processed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `GET/POST /v1/contacts/:personId/notes`, `PATCH/DELETE /v1/contacts/notes/:noteId`                                                             | Notes CRUD, org-scoped (cross-org id = 404). `@AllowVolunteer()` (ENG-11057) — a volunteer gets full CRUD, but only on people reachable through an assigned outreach envelope; see Access control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `PATCH /v1/contacts/:personId/follow-up`                                                                                                       | Serve's standing follow-up flag (`{ value: 'requested' \| 'cleared' }` → `{ followUp }`). 400s for a non-`eo-` org, the mirror of the status route's Serve rejection. Its own route rather than a third `field` on that one, whose response promises both of Win's editable statuses and which a Serve write can honestly supply neither of                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `PATCH /v1/contacts/:personId/civic-panel`                                                                                                     | Serve's civic panel membership (`{ value: 'member' \| 'left' }` → `{ civicPanel }`). Same gates and reasoning as the follow-up route: 400s for a non-`eo-` org, its own route so Win's two-status response is untouched. 404s with `serve-citizen-panels` off                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GET /v1/contacts/civic-panel` · `GET /v1/contacts/civic-panel/representation`                                                                 | Serve's civic panel as a whole (`CivicPanelSummaryService`): `{ members, reachedRecently, askableNow, lastOutreachAt }`, and the members compared with the district (`{ representation }`, the priority results' shape). 400 for a non-`eo-` org, 404 with `serve-citizen-panels` off                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GET/POST/PATCH /v1/contacts/civic-panel/plan` · `POST …/plan/steps/:id/prepare` · `POST …/plan/steps/:id/skip` · `POST …/plan/steps/:id/mark` | Serve's plan to build the panel across texts, calls and doors (`CivicPanelBuildPlanService`). 404 with the flag off, 400 for a non-`eo-` org. See "Building the panel across channels"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /v1/contacts/:personId/interactions`                                                                                                     | Manual interaction log. **No webapp caller** (UI removed in ENG-10711); the API stays                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GET /v1/contact-engagement/:id/activities`                                                                                                    | Unified feed: interactions + polls + legacy outreach rows. Notes are deliberately excluded (ENG-10780) — they live only in the dedicated Notes section, never the feed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /v1/voters/voter-file/filter`, `GET /filters`, `GET/PUT/DELETE /filter/:id`                                                              | Saved-filter CRUD; PUT/DELETE 409 once locked. Create is not Pro-gated (outreach-pro-gating-v2, a free candidate can save a list before upgrading); PUT/DELETE still call `filterAccessCheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `POST /v1/outreach`                                                                                                                            | Outreach create (draft-first); launch triggers materialization                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Underlying people data access in `ContactsService` routes list/count/overlap-count,
person detail, download, stats, aggregates, and sample lookups directly to
`PeopleQueryModule` services in-process (`src/peopleDb/`) — this is the sole
path; the flag that used to gate it (`USE_LOCAL_PEOPLE_DB`) and the legacy
people-api HTTP/S2S client it fell back to are gone. `PeopleQueryModule` has
no user-facing routes and enforces district scoping via a district join — the
id-list filter can't enumerate outside the org's district.

## Data model

| Model (table)                                  | Role / key facts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VoterFileFilter`                              | The saved filter (UI "list"). ~60 demographic columns, `search`, `supportStatus`, `firstUsedForOutreachAt` (the lock), org FK cascade, plus `recommendedVariant` / `recommendedChannel` / `recommendedIntent` / `recommendedModified` — provenance stamped at create when the list came from a recommended-list card, never a filter criterion (`docs/features/recommended-lists.md`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `VoterFileFilterActivityCondition`             | Owned condition rows: `outreachType` + `outreachId?` (null = any campaign of that channel) + `actions[]` (`ActivityConditionAction` enum; per-channel validity is Zod-enforced at the boundary, 400 otherwise)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `VoterFileFilterGeoMember`                     | The person-id set a drawn boundary resolved to, frozen at draw time. The GEOGRAPHIC half of a list, not its membership. `geoPoly` set with zero rows means the shape enclosed nobody and must resolve to empty, never to "no constraint". A boundary of several parts resolves to ONE set — a person standing where two parts overlap is one member, which is why the parts may overlap at all. What each part is called and drawn in rides beside `geoPoly` as `VoterFileFilter.geoPolyLabels` (`GeoShapeLabelsSchema` in contracts) — display only, joined to the parts by index, so a write that reshapes `geoPoly` without restating them clears them, and `convertVoterFileFilterToFilters` skips it (the generic array branch would otherwise turn it into a filter)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `VoterFileFilterSampleMember`                  | Who a list saved as a sample drew (`POST /v1/voters/voter-file/filter` with `sample`), frozen at save. Keyed like the geo members: `VoterFileFilter.sampleSize` set means a sample exists, and zero rows resolve to nobody, never to the whole audience. `resolveSampleIdFilter` intersects it everywhere `resolveGeoIdFilter` is (list, count, the edit wizard's `boundaryFromSegmentId`, overlap's saved sets), so the criteria still apply and the list can only shrink. Drawn by `ContactsService.drawListSample`, which resolves the criteria exactly as a count does, saves an audience no bigger than the sample whole, and leaves out whoever the lists behind `excludeOutreachIds` already drew. A sample with `panelSize` (Serve only, 400 for a campaign) is two draws within the criteria, `panelSize` from civic panel members and the rest from everyone else, frozen as one list and never saved whole. A sample with `recipientsOfOutreachId` (Serve only, 400 for a campaign) is a report back's audience: everyone that send's `OutreachTextRecipient` rows name who has not opted out of the org's texts since (`VoterFileFilterSampleService.personIdsReachedBy`), frozen whole when it fits in `size`, another org's send reaching nobody. A list drawn on the map cannot also be sampled (400): an unsaved draft's boundary has no members yet to draw within. The exception is a list kept to a priority's parts not reached yet (`unreachedAreaOfPriorityId`, Serve): gp-api draws that boundary itself, resolves its members first, and draws the sample within them (`withinPersonIds`) |
| `ContactInteractionText`                       | Per-recipient send truth: `outreachId` FK, `respondedAt`, `optedOutAt`, `sourceEventId`, `manual`. Unique `[outreachId, personId]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ContactInteractionRobocall`                   | Same shape for robocall (`answeredAt` / `voicemailLeftAt`, `sourceCallId`) — but **the outcome columns are only ever written by the manual log**; campaign-materialized rows have them null forever                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ContactInteractionDoorKnock`                  | `outcome`, three-way `supportAnswer`, `note`, `manual`, `sourceId`, `actorUserId`. Unique `[organizationSlug, sourceId]`. Written by the in-house door-knocking tool, never by outreach launch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `ContactNote`                                  | Org-authored per-person notes (body ≤ 10k)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `PeerlyPhoneList` / `PeerlyPhoneListRecipient` | Capture tables: which people (and which phone per person) actually landed on a Peerly phone list. The phone↔person mapping the inbound sweep depends on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Outreach`                                     | Carries `organizationSlug` on new writes (legacy rows resolve org via campaign join), `voterFileFilterId?`, `phoneListId?`, `status`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `VoterOutreachActivity`                        | **Deprecated.** Read-only legacy feed rows; no write path targets it any more. No new writes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Outcome→column mapping used by filter resolution: SMS `responded` =
`respondedAt` not null, `no_response` = null, `opted_out` = `optedOutAt`
not null; robocall `answered`/`voicemail_left` from their timestamps,
`no_answer` = both null; door knock from `outcome` and `supportAnswer`.

**The three robocall actions do not mean what they read as.** No
robocall vendor is integrated, so campaign-materialized rows never get either
timestamp: pinned to a campaign, `answered`/`voicemail_left` match zero people
always and `no_answer` matches every recipient of that campaign. Only manual
(`manual = true`, `outreachId` null) rows carry a real robocall outcome, and
`resolveRobocall` does not consult `manual` — so unpinned conditions blend
hand-logged observations with never-observed sends. Do not build reporting or
a follow-up audience on these until a robocall inbound sweep (the robocall
twin of `OutreachInboundSweep`) exists.

**Actor stamping (who-logged-it).** `ContactInteractionPhoneBanking`,
`ContactNote`, `ContactStatus`, and `ContactInteractionDoorKnock` (ENG-10824)
all carry the same `actorUserId Int? @map("actor_user_id")` +
`actor User? @relation(..., onDelete: SetNull)` shape: nullable so existing
rows render authorless (no backfill), and `SetNull` because attribution
history must survive user deletion — unlike `Organization.owner`, which
cascades. The manual/CRM write path stamps `request.user.id` via `@ReqUser()`
(the pattern `phoneBanking.controller.ts` `recordCall` and
`contactNotes.controller.ts` `createNote` set first); under impersonation
`request.user` **is** the impersonated member, so attribution lands on the
member, not the impersonating admin (`request.actorUser`). Door knock's
second write path — the door-knocking tool's `recordIdempotent` sync — stamps
the canvasser's id on `create` only; the `update` branch deliberately omits
`actorUserId` so a re-sync of the same `sourceId` never clears or overwrites
an existing stamp. The one exception: `emitLikelihoodEvent`'s derived
`voter_likelihood` `ContactStatusEvent` always writes `actorUserId: null` — a
canvass answer isn't attributed to a staff user, only the interaction row
that produced it is. The activity feed surfaces the stamp as
`actorName`/`actorUserId` (`ContactEngagementService`, `*_ACTOR_INCLUDE`
constants), nullable in the contract so a legacy null row renders without
an author instead of 500ing the feed.

## The flows

### Read path (list, typeahead, detail, count, download)

webapp → `GET /v1/contacts` → `ContactsService.findContacts` → resolve
filters (`convertVoterFileFilterToFilters` in
`utils/voterFileFilter.utils.ts` + activity/support resolution below) →
`VoterQueryService.findPeople` → join/strip (party choke point
`stripWinOnlyFieldsIfElectedOffice`) → respond. Typeahead is the same endpoint
with a small page; person detail adds derived `supportStatus` and
`optedOutAt` (`ContactInteractionTextService.latestOptOutAt`). The count
endpoint runs the identical translation with `resultsPerPage: 1` and
returns `{ count }`. A voter read that exceeds the warehouse's timeout fails
loudly as a `GatewayTimeoutException` (504) rather than degrading into a
floored or partial count — see `src/peopleDb/CLAUDE.md`.

A `segment` is either a built-in name (`segmentsToFiltersMap.const.ts`), Serve's
`civicPanel` (`CIVIC_PANEL_SEGMENT` in contracts: resolved as a saved list holding
only `civicPanelMember`, so the same 400 for a non-`eo-` org and the same empty
result for an empty panel), or a `VoterFileFilter` id this org owns. Anything else — malformed, deleted,
cross-org — is a **404** (`resolveCustomSegment`), never "no filter". Widening
an unresolvable segment to the whole district is the most expensive possible
default: it served, and let `GET /v1/contacts/download` stream, every voter in
the district with a 200.

### Activity-condition + support-status resolution

`ActivityConditionResolutionService` (contactInteraction) resolves each
condition to a `personId` set with plain SQL over the channel's
`contact_interaction_*` table (scoped to `outreachId` when named,
restricted to selected outcomes when `actions` is non-empty); sets
AND-compose. `SupportStatusService` resolves the support buckets the same
way. Both travel to the voter engine as `id: { in | notIn }` on the Voter
PK — a `::uuid[]` SQL builder in `src/peopleDb`'s filter pipeline
(`filters.schema.ts` → `transformFilters` → `buildVoterFiltersSql`),
**capped at 100k ids** (400 beyond; the trigger to revisit the projection
fallback). A condition naming a specific `outreachId` only accepts
**completed** outreaches.

### The Voter_Status propensity vocabulary

`Voter_Status` is a turnout-propensity bucket for the 2026 General, derived
from the in-house model probability: `Unlikely` (<0.25), `Unreliable` (<0.50),
`Likely` (<0.75), `Super` (>=0.75), `Unknown` (no score). All five are real,
populated values. A selection that includes `Unknown` also matches a NULL
`Voter_Status` (`buildVoterFiltersSql`), which every consumer-only row of
`gp_api_constituents` carries; the door-knocking pack shades NULL as
`Unknown` too.

This replaced an older participation-count CASE on 2026-07-31 (gp-data-platform
#725 / DATA-2209), which reached production on 2026-08-04. The old vocabulary
had a `First Time` value and no `Unreliable`; both facts are now false, and
the `expandUnreliableVoterStatus` workaround that compensated for them has
been removed. `First Time` matches zero rows and is no longer offered
anywhere.

The model is scoped to a specific election cycle and will be re-cut. If
`Voter_Status` stops matching the five values above, every likelihood filter in
the product is silently wrong — check the live vocabulary against the
`mart_gp_api` voter mart in Databricks before trusting any filter-related bug
report.

### The Early_Vote_Status vocabulary

`Early_Vote_Status` is the likelihood of voting before Election Day, early in
person or by mail: the higher of Haystaq's `hs_likely_ev` and `hs_likely_vbm`
(0-100), bucketed `Very unlikely` (<25), `Unlikely` (<55), `Likely` (<80),
`Very likely` (>=80), `Unknown` (no score), in the mart's sentence case.
The product speaks Title Case (`Very Likely`, `Very Unlikely`) like its other
multi-word person values; `peopleDb/earlyVoteStatus.ts` translates both ways,
for the Person payload and for filter values going into SQL. The CSV copies
the column raw, so it still says `Very likely`. Both scores are within-state
percentiles, so the buckets are relative to the state, not probabilities; the
max skews high, which is why the cuts sit above `Voter_Status`'s. It reaches the
filter as the `earlyVote*` booleans → `earlyVoteStatus`, with the same
`Unknown`-also-matches-NULL rule as `voterStatus`, but none of the
per-person override handling below: there is no editable early-vote status.
It is Win-only everywhere: hidden in the UI and dropped from Serve downloads
like Voter Likelihood, and also `modes: 'win'` in the filter catalog, which
Voter Likelihood (`audience`) is not, so the assistant never offers it to an
`eo-` org.

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
`MAX_RESOLVED_ID_SET_SIZE` (100k) as activity-condition resolution, thrown
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

### Serve's follow-up flag

`ContactStatusField.follow_up` is the layered status model's fifth field and
the only one Serve writes. It is deliberately not a column on the interaction
tables: `contact_interaction_phone_banking.follow_up` and
`contact_interaction_door_knock.follow_up` answer "did this ONE call or knock
end owing this person something", which is immutable history, while this field
answers "is anything still owed", which an official toggles as they work
through people. Vocabulary is `FollowUpStatus { requested, cleared }`, with
`cleared` a real value rather than a deleted row so a reversal is recorded,
same as `do_not_knock` —
"who followed up, and when" is the question the feature exists to answer.

Three writers, all through `ContactStatusService.changeStatus`:
`ContactsService.updateFollowUp` (`source: manual`, `actorUserId` from
`@ReqUser()`, no Pro gate — an `eo-` org clears `hasElectedOfficeAccess`
outright), `PhoneBankingCallService.emitFollowUpEvents`
(`source: phone_banking`, `sourceId` minted per save from
`(interactionId, updatedAt)` so a corrected answer records a new event), and
`ContactInteractionDoorKnockService.emitFollowUpEvent` (`source: door_knock`,
`sourceId` stable per synced knock so a replay no-ops, same accepted
correction limitation as the `willVote` twin above). Each carries the inverse
of the likelihood writers' guard — `startsWith('eo-')` must be true — and
`fallbackFromValue: FollowUpStatus.cleared`, since nothing derives this field
and nobody is born flagged.

**Latest answer wins**, including a caller's "no" clearing a flag set by hand
on the contact card. Only-ever-raising was rejected: the flag's job is to say
what is STILL owed, and a flag that only accumulates is one nobody trusts. The
clear is its own event with its own actor.

**No backfill** from the follow-up answers already on interaction rows —
replaying history would raise flags on people whose request may long since
have been met, and an official cannot tell a stale flag from a live one.

**The audience side.** `voter_file_filter.follow_up_requested` is the saved-
filter dimension that turns the flag into people you can act on. It is not a
voter-file column: it resolves through
`ContactStatusService.personIdsByFieldValue(follow_up, [requested])` into an
`id: { in }` constraint, AND-composed via `intersectIdFilterResolutions` the
same way `contactsMade` is, and it sits in `fieldsHandledSeparately` so the
generic loop never tries to map it. Serve-only and the exact mirror of
`contactsMade`: `resolveIdFilterWithContactsMade` takes one branch or the
other, and `assertNoFollowUpFilterForCampaign` 400s a Win org rather than
ignoring the key, because a silently-dropped dimension returns a WIDER
audience than asked for and a phone list built from it calls people nobody
selected. Nobody flagged resolves to an EMPTY audience, never an absent
filter, for the same reason.

AND-ed with an activity condition pinned to one outreach, it expresses "who
from that closed campaign still needs calling back" — which is what the
results drawer's follow-up block saves, and what phone banking then builds a
call sheet from. Because it reads the standing flag, that list shrinks as the
official works it down, while the campaign's own `byFollowUp.yes` count is
frozen history and can only grow; the two are supposed to disagree.

`ContactEngagementService` filters the feed's `contact_status_event` read by
field rather than skipping it for Serve: `field: follow_up` for an `eo-` org,
`field: { not: follow_up }` otherwise, so neither surface can read back the
answer to a question its own canvassers never asked. `findPerson` includes
`followUp` on the person payload for `eo-` orgs only, the exact mirror of
`voterLikelihood`'s Win-only inclusion.

### Serve's civic panel

User-facing it is the "civic panel". Every surface that offers it is behind
the `serve-citizen-panels` Amplitude flag (`SERVE_CITIZEN_PANELS_FLAG`): the
`PATCH /civic-panel` route 404s with it off, and the webapp hides the record
toggle, the list-builder groups, the door and call question, the SMS ask and
the printed panel column. The data paths below stay live, so nothing is
written with it off except by a flag-on surface.

`ContactStatusField.civic_panel` is the layered status model's sixth field:
the constituents who said yes to being asked for feedback. Each office has one
panel, so the people at `member` are the panel. Vocabulary is
`CivicPanelStatus { member, left }`, with `left` a real value so a reversal is
recorded, same as `do_not_knock` (who joined and who left, and how, is the
history an official will be asked to account for). It is built exactly like
`follow_up`: written through `ContactStatusService.changeStatus`, Serve-only
in both directions, seeded `left` because nobody is a member until they say
yes, on the person payload for `eo-` orgs only, and read back in the Serve
half of the activity feed's field filter. The contact card writes it
(`updateCivicPanel`, `source: manual`).

The Serve door and call flows close with "Do they want to join your civic
panel?", stored as `join_civic_panel` (`FollowUpAnswer`) on
`contact_interaction_door_knock` and `contact_interaction_phone_banking` as
history for that one knock or call. Two writers turn a yes into
`civic_panel = member`: `ContactInteractionDoorKnockService.emitCivicPanelEvent`
(`source: door_knock`, `sourceId` stable per synced knock so a replay no-ops)
and `PhoneBankingCallService.emitCivicPanelEvents` (`source: phone_banking`,
`sourceId` stable per call and answer, so re-saving a yes never re-enrolls
someone who left). Both carry the `eo-` guard
and `fallbackFromValue: left`. Unlike follow-up, **only a yes writes**: a no at
one door is not leaving the panel, so it never demotes a member.

**Panel-only outreach asks to stay instead.** A saved list that can only hold
current members is "panel-only" (contracts' `isCivicPanelOnlyList`:
`civicPanelMember` without `civicPanelLeft` or `civicPanelNeverInvited`, which
OR with it, or any joined-by / joined-when criterion, which matches members
only; other criteria only narrow, and a panel-plus-fresh sample never asks for
membership in its criteria). On a panel-only turf or call list the closing
question is "Do they want to stay on your civic panel?", stored as
`stay_on_civic_panel` (`FollowUpAnswer`) beside `join_civic_panel`, never both
(the contracts refuse the pair). A no writes `left` (`source: door_knock` /
`phone_banking`, `sourceId` `<knock or call>:stay:no`); a yes writes nothing,
so it never re-enrolls someone who left since. The server decides panel-only
from the turf's or list's own `VoterFileFilter` (`CIVIC_PANEL_ONLY_SELECT` in
`src/voters/util/`) and drops a stay answer from any other list, so a no on a
non-panel list still never demotes. The route payload and the phone banking
list carry `civicPanelOnly` so the walk, the caller page and both paper
formats ask the right question. Leaving otherwise is the contact card, a
texted LEAVE, or a texted STOP.

A Serve text asks with a fixed, locked sentence (`CIVIC_PANEL_JOIN_LINE` in
contracts: "Reply JOIN to join my civic panel. My office will text you
about once a month to ask what you think before I decide. Empowered by
GoodParty.org.", in its own paragraph above the opt-out), and the create
stamps `Outreach.asksToJoinCivicPanel` from the stored message. The create
and the composer's lock recognize every wording in `CIVIC_PANEL_JOIN_LINES`
(`findCivicPanelJoinLine`), because sends written before the line was
rewritten carry the first one; the composer only writes the current line. The reply ingest
(`OutreachTextIngestService.applyCivicPanelEvents`, `source: sms`, `sourceId`
the reply's message id) writes `member` for a JOIN reply
(`util/civicPanelJoin.util.ts`: the whole reply or a sentence of its own) on
a send that asked, and `left` for any STOP on any Serve send, because panel
membership is not consent to text. A LEAVE reply
(`util/civicPanelLeave.util.ts`, same matcher style) also writes `left` on any
Serve send, whether or not it offered LEAVE, and is not an opt-out: the person
keeps getting the office's texts. From someone not on the panel it writes
nothing (`left -> left` is a no-op), and a reply saying both JOIN and LEAVE
reads as LEAVE. Replies apply in sent order, and a JOIN
from anyone who has opted out on any send is skipped, so a STOP stays the
last word across uploads.

A text to a panel-only list carries `CIVIC_PANEL_LEAVE_LINE` ("Reply LEAVE to
leave my civic panel.") instead of the JOIN line, appended and locked by the
composer the same way, and the create stamps `Outreach.offersCivicPanelLeave`
from the stored message. The create 400s a message carrying both lines, and
the LEAVE line on a list that is not panel-only; the controller refuses it
with `serve-citizen-panels` off, like the JOIN line.

**The audience side.** `voter_file_filter.civic_panel_member` is the saved-
filter dimension for the panel, built exactly like `follow_up_requested`:
`ContactStatusService.personIdsByFieldValue(civic_panel, [member])` into an
`id: { in }` constraint, AND-composed after the follow-up resolution in the
Serve branch of `resolveIdFilterWithContactsMade` and in
`resolveSavedFilterSets`, listed in `fieldsHandledSeparately`, and 400'd for
a Win org by the same gate as follow-up. An empty panel resolves to an empty
audience, never the district. Because it reads the standing status, someone
who left drops out of a saved panel list on its next read. The catalog entry
(`civicPanel`, `modes: 'serve'`) is what lets the Chief of Staff and the
priority agent count and propose to the panel. It is not flag-filtered:
with nobody on a panel it resolves to an empty audience.

**The panel's history as filters.** The rest of the panel status group sits
beside `civic_panel_member`, and the three OR together:
`civic_panel_left` is a standing `left` row, and `civic_panel_never_invited`
is everyone outside `CivicPanelHistoryService.invitedPersonIds` (any
`civic_panel` status row, any recipient of a send with
`asksToJoinCivicPanel` in `outreach_text_recipient` or
`contact_interaction_text`, and anyone with a non-null `join_civic_panel`
answer at a door or on a call). A status row only exists once an event wrote
one, and `changeStatus` no-ops `left -> left`, so someone seeded `left` who
never joined counts as never invited, never as left. Never invited resolves to
a `notIn` (minus whichever of member/left is also picked). The joined group,
`civic_panel_joined_by_{text,door,phone,hand}` (source `sms`, `door_knock`,
`phone_banking`, `manual`, OR-ed) and `civic_panel_joined_from`/`_to`, reads
the event that most recently set a person to `member`
(`memberIdsByLatestJoin`, `DISTINCT ON` over `contact_status_event`) and
matches current members only, so it never selects someone who left.
`last_reached_from`/`_to` ("Last asked" in the webapp) is when the office last
reached the person on any channel, `MAX(occurred_at)` over the four
interaction tables (`ContactsMadeResolutionService.personIdsLastReachedBetween`),
the same rule as `not_contacted_recently` and `reachedRecently`, so "not asked
in 30 days" is that existing key. Days are inclusive `YYYY-MM-DD` text read in
UTC. All resolve in `resolveCivicPanelMember` (status, then joined, then last
reached, each AND-ed), every one is in `CIVIC_PANEL_FILTER_KEYS` for the Win
400, and the catalog carries them as `civicPanel`, `civicPanelJoinedBy`, and
two `date-range` dimensions (`civicPanelJoinedWhen`, `lastAsked`), all in
`CITIZEN_PANEL_DIMENSION_KEYS`. `findPerson` adds `civicPanelActivity` for
`eo-` orgs: the latest `civic_panel` event (`value`, `source`, `at`) and
`lastReachedAt`, the line under the record's toggle.

**Building the panel starts on the Chief of Staff home.** With the flag on,
`GET /v1/dashboard/cards` runs `DashboardCardsService.syncCivicPanelCards`
before it lists (with it off, it lists no `civic_panel` card at all). The
office's one build card (`sourceExternalId` from contracts'
`civicPanelBuildCardSourceId`, `build:<electedOfficeId>`) links to
contracts' `CIVIC_PANEL_BUILD_CARD_HREF`, the panel page
(`CIVIC_PANEL_PAGE_HREF`), which asks the weekly time question or shows the
plan already made (see "Building the panel across channels"). The Chief of
Staff chat runs that same plan (`chats/general/chief-of-staff`,
`civicPanelPlan.tools.ts` and `civicPanelBuildBlock`). Asked to build the
panel (the hidden `BUILD_CITIZENS_PANEL_MESSAGE` from the intro's Build your
civic panel or the explainer's Build my panel, or in their own words) with no
plan, it explains the panel in a line or two and calls
`ask_panel_weekly_time`, which the webapp draws as the page's own question
and answers (1, 2, 3, or 4 or more hours a week). The answer goes to
`save_panel_weekly_time`, which calls `CivicPanelBuildPlanService.create`
(4 for "4 or more", a written number as given, 1 to 20); then
`present_panel_next_step` shows the plan's next step as a card that reads the
plan itself (`GET …/plan`): the Next line, members of the goal, the
panel page's status and its line naming who to invite next (`balance`), the
page's button for that step (it opens the step's own text, call or door flow
the way the page does, not `next.href`), and See your plan. The tools return
that status and group in the page's words (`panelStatus`,
`inviteMoreNext`); the agent may repeat them, but never promises the panel
will match the district, never mentions weights, quotas or targets, and never
says or guesses one person's race (`CIVIC_PANEL_CLAIM_RULE`). The group may be a
race group, such as Black residents. With a plan, it shows that
card and never asks again (`ask_panel_weekly_time` refuses), and "I can give
2 hours now" goes to the same save, which then calls `updateHours` (PATCH's
path). A 409 it cannot settle (nobody left to reach, the goal already met)
comes back as `planMade: false` with the API's words, and the agent says so
and links the panel page. A 409 because the page made a plan meanwhile
updates that plan instead. The chat never proposes an invite text of its
own: every invite comes from the plan. The card's quiet What's a civic
panel? opens the Chief of Staff chat with the hidden turn
`EXPLAIN_CIVIC_PANEL_MESSAGE`: the agent explains the panel and builds
nothing unless the official says yes (`civicPanelExplainLines`).
Once the office has an active plan, the open card follows it: the sync
reads the plan first (`CivicPanelBuildPlanService.read`, looked up through
`ModuleRef` because importing the contacts module closes a module cycle, and
before the lock, since the read is what moves the plan), and the card's
title is the plan's `next.line`, its summary where the panel stands
(`civicPanelStandingLine`: "62 members so far, from 9 of 12 groups in your
district.", without the groups when the census could not be read), its button the panel page's own words for that step ("Start the
text", "Start the calls", "Start door knocking"; "Keep calling", "Keep
knocking"; "See your plan" while waiting) and its link `next.href` (the
panel page on that step, or the page itself with no link). With no plan, an
ended plan or nothing next, it reads "Start with the people you represent"
and Build my panel, as before. A plan read that fails leaves the words as
they are. Once the build card is done, the plan's ready step gets a card of
its own (`syncCivicPanelStepCard`, `sourceExternalId` from contracts'
`civicPanelStepCardSourceId`, `panel-step:<stepId>`), so the calls, doors and
later rounds still reach the home: the same words as the build card would
show, opening that step. It exists only while the plan is active, the build
card is done, and `next` has a link (waiting on replies is not a step to
take); one at a time, so a card whose step is no longer next is deleted and
the new step gets its own. Keyed by the step, a skipped one stays skipped
while its step is next. A dismissed (not done) build card gets none, and
like the build card it has no Mark done and does not lapse. The priority
cards' clean-up leaves these alone. Old words or the old outreach link on a card are rewritten on the
next read. The card is done once any `text` row of the org with
`asksToJoinCivicPanel` is past checkout (not `pending_payment`, `draft`,
`canceled`, `denied` or `failed`): the purpose is not stored on the row, and
the ask is what recruits. It is also done once the plan reaches its goal
(`completed`). A done card keeps the start words in the archive. While it is
open its due date rolls forward so it never lapses into missed. A skipped
card stays skipped while its words follow the plan. The webapp offers it no
Mark done, and `complete` leaves it untouched. It takes `dismiss` (Not for me, undone by
`restore`, Bring it back in the archive) and `snooze` (Show in 3 days:
`snoozedUntil` keeps it off the active list for `DASHBOARD_CARD_SNOOZE_DAYS`).
Alongside it, whatever its state, the sync makes a `civic_panel` next-step
card per open priority with a step left (`currentStepOf` not null), which
opens the priority. Its summary is what the Priorities page shows:
`nextAction`, or with none, the current step's `PRIORITY_STEP_LABELS` label
(an unknown step id reads as the first step). It has no Mark done
(`complete` ignores every `civic_panel` card; one already done stays done);
it takes `dismiss`, `snooze` and `restore`. While open its due date rolls
forward. It is deleted, skipped or not, once its priority is archived, and
recreated if it is unarchived; a ready plan (null step) deletes it too,
unless it is done, and it is recreated when a step comes open again.
The webapp leads with the Chief of Staff's `meet` get-started card while it
is active, then the build card (or the plan step card in its place, under
the same People first headline), then the `priorities` get-started card, then
the rest. `meet` is done only once its button opens the intro
(`PUT /v1/dashboard/onboarding-cards/meet/complete`, an
`OnboardingCardCompletion` row), never by any Chief of Staff conversation:
the build card's own chat would otherwise hide it from a new official. One
advisory lock per office serializes the sync, because
the build card's null `sourceItemId` leaves the unique key unable to stop a
second insert. The Chief of Staff's single invite text is
`panelSeedSampleSize(goalMembers)`: `ceil(goalMembers /
PANEL_SEED_ASSUMED_JOIN_RATE)` under `MAX_LIST_SAMPLE_SIZE` (8,334 at 250
members and 3%), with the district's goal (see "Sized in answers" below).
The outreach page's own invite has no district mix at hand and uses
`PANEL_SEED_SAMPLE_SIZE`, the same for the largest goal, 250.

**Reporting back is a card too.** The same read runs
`DashboardCardsService.syncReportBackCards`: one `report_back` card per
priority text whose replies are in (`OutreachReportBackService.repliesInWhere`
in `src/outreach/`), `sourceExternalId` the send's id, due
`REPORT_BACK_DUE_DAYS` (14) after the read that made it, opening
`/dashboard/priorities/<id>?reportBack=<outreachId>`. Its words follow the
current copy in every state, rewritten on read like the build card's. It is
done once a text
with `reportBackForOutreachId` set to that send is past checkout, and takes the
same Mark done, Show in 3 days, Not for me and Bring it back. Flag off, no
`report_back` card is made or listed.

**The rest window.** `voter_file_filter.not_contacted_recently` (both
products) leaves out anyone the org reached on any channel in the last
`CONTACT_REST_DAYS` (30): `ContactsMadeResolutionService.personIdsContactedSince`
unions the four interaction tables on `occurred_at` into an `id: { notIn }`
constraint, applied before the Win/Serve split in
`resolveIdFilterWithContactsMade` and in `resolveSavedFilterSets`. It is read
when the list is read, so people come back in as their window passes.

**The panel as a whole.** `CivicPanelSummaryService` backs the Serve
Contacts page's "Your civic panel" section and its page. Members are
the standing `member` set; `reachedRecently` is
`countContactedSinceAmong(CONTACT_REST_DAYS, members)`, the rest window's
rule counted in SQL over the member ids (so a busy office never hits the
contacted-set cap), and `askableNow` is exactly who a panel list with "Not
contacted in the last 30 days" holds. The representation reuses the
priority results' math (`representationFrom`, `computeRepresentation`,
`MIN_RESPONDENTS_FOR_REPRESENTATION`) and the one `CENSUS_COMPOSITION_SOURCE`
binding in `CensusCompositionModule`, with members in place of respondents:
every member id goes to the census read, which places each in their block
group (`peopleDb` `findCensusComposition`), and `respondentCount` is how
many it placed. Fewer placed than the minimum is `representation: null`;
census figures that cannot be read (no district row, a warehouse failure)
are a representation with empty `groups`, never a non-200.

The built-in panel list's outreach history
(`ContactsService.civicPanelOutreachHistory`) is every send of the org that
reached at least one current member, read off the same four interaction
tables as `reachedRecently` and "Last asked"
(`ContactsMadeResolutionService.outreachIdsReachingAmong`: a text, robocall
or knock row names its send, a call row names its list, whose envelope is the
send; manual logs name none). Only sends past checkout count
(`UNSENT_OUTREACH_STATUSES`), in a saved list's order and shape
(`VoterFileFilterService.findSentOutreachesByIds`). Someone who left is not a
member, so a send that reached only them is not in it. The summary's
`lastOutreachAt` is that history's newest row (`date`, else `createdAt`), so
the list row's "Last outreach" agrees with the sheet without its voter-file
aggregates.

### Building the panel across channels

The panel is built by one plan that splits the work across texts, calls and
doors, in waves (`CivicPanelBuildPlanService`, pure math in
`utils/civicPanelBuild.util.ts`, contracts in
`people/CivicPanelBuildPlan.schema.ts`). The webapp's panel page
(`/dashboard/contacts/citizens-panel`) is its home: the weekly time
question, the steps, Next and the groups the panel covers.

**Sized for coverage.** The member goal is the members it takes for every
major group to be expected to answer one question three times
(`docs/decisions/2026-10-19-civic-panel-two-rounds-coverage-sizing.md`).
Officials never see the answer count behind it; the panel page shows the
groups covered.
Contracts' `answersNeeded(smallestMajorShare)`
(`outreach/AnswersNeeded.const.ts`) is `ceil(MIN_VOICES_PER_GROUP /
share)`: enough answers for the district's smallest major group (one
holding `MAJOR_GROUP_SHARE`, 3%, or more on age band, gender, tract, or race
when `raceNameable` holds for the district) to be expected to answer 3
times. 100 where that group is 3% of the district, 15 where it is 20%.
`CensusCompositionSource.districtAnswersNeeded` reads it from the
district's cells (`smallestMajorShare` in
`utils/civicPanelAllocation.util.ts`, over the same cells the priority model
reads, cached 15 minutes per district); without them (no district row, no
district, or a failed read) it is `answersNeeded()`, 100, the most any
district needs. The panel's own math is in
`contracts/src/people/PanelAnswers.ts`: `panelGoalMembers(answers)` is
`ceil(answers / PANEL_ASSUMED_REPLY_RATE)`, 250 at most. The plan service
reads it itself; the Chief of Staff chat reads it once a turn through
`PriorityResultsService.districtAnswersNeeded`. A very small district with
fewer people to reach than its goal ends `exhausted`, not stuck. A
priority's checks are not sized here: see "Round 1 sizing" below.

**The model.** `CivicPanelBuildPlan` is one per office while `active`, held
by the partial unique index `civic_panel_build_plan_one_active_per_office`
(Prisma cannot declare it), plus an advisory lock per office around every
write. It ends `completed` once members reach `goalMembers` (the district's
`panelGoalMembers`) or `exhausted` once a wave can reach nobody;
either way a new plan can be made. `CivicPanelBuildStep` is one text, one
call list or one walkable area in a wave (`wave`, `channel`, `position`,
`targetSize`: residents to text, residents to call, households to knock).
`voterFileFilterId` is the frozen sample list the step drew; `outreachId`,
`phoneBankingListId`, `doorKnockingTurfId` and the three dates are written by
the plan read from what it finds made from that list. The official never
sets a flag.

**The goal follows the district.** A new plan's `goalMembers` is
`panelGoalMembers` of the district's population. Every read brings an active
plan's goal to the district's, written back to the row, so plans made toward
the old 100 members read like new ones with no migration. A goal may come
down (a census figure moved) but never below the members the panel has: the
plan then completes. The response's `progress` is `{ members, goal,
answersNeeded, expectedAnswers, groupsCovered, groupsTotal }`
(`CivicPanelBuildProgressSchema`): `expectedAnswers` is
`panelExpectedAnswers(members)`, members × `PANEL_ASSUMED_REPLY_RATE`,
rounded; the sizing fields never reach a screen. `groupsCovered` of
`groupsTotal` is `panelCoverage` (`utils/civicPanelSteering.util.ts`): the
major groups (age band, gender, tract, and race when `raceNameable` holds)
holding at least `PANEL_MEMBERS_PER_GROUP` (8: three answers at the 40%
answer rate) members. The census is read for any panel with a member, and
both are 0 when it cannot be. Without an active plan `goal` is the
district's, so an office whose old plan completed at 100 can make a new one.

**Sizing** (`sizePanelWave`, constants in contracts). One question: the
official's own hours each week, `hoursPerWeek`, `PANEL_MIN_HOURS_PER_WEEK`
(1) to `PANEL_MAX_HOURS_PER_WEEK` (20); 0 is a 400, because a text alone
does not build a panel. A wave spends `PANEL_WEEKS_PER_WAVE` (4) weeks of
it. Doors take `PANEL_DOOR_SHARE_OF_HOURS` (half) at
`PANEL_DOORS_PER_HOUR` (20), capped at `PANEL_MAX_DOOR_AREAS` (2) areas of
`PANEL_DOORS_PER_AREA` (100); the rest of the hours go to calls at
`PANEL_CALLS_PER_HOUR` (15). Neither is sized past the members it can be
expected to bring (`PANEL_DOOR_ASSUMED_JOIN_RATE` 10%,
`PANEL_CALL_ASSUMED_JOIN_RATE` 5%, assumptions until offices measure them),
and the text covers the rest of the gap at the cold 3%, capped at the
reachable cell phones and `MAX_LIST_SAMPLE_SIZE`. A channel nobody can be
reached on gets no step. `PATCH` changes `hoursPerWeek` (same bounds); only
waves made after it are sized from the new time. The pools are
`ContactsService.countWithin` over each channel's criteria.

**Sampling** (`prepare`). Every step list's criteria are
`civicPanelNeverInvited` + `notContactedRecently` (so no member, nobody who
left, nobody already invited, nobody reached in 30 days) plus the channel's
reach: `hasCellPhone` for texts, `hasAnyPhone` for calls, none for doors.
Each draw also leaves out, by id, everyone any step of the office's plans
already drew and everyone opted out of the office's texts, so steps never
overlap across channels or waves (`drawListSample`'s server-only
`excludePersonIds`, which always freezes the draw). Calls draw `hasLandline`
first, the residents a text cannot reach, and fill from anyone with a phone
(until the panel holds its share of people 65 and over; see "Steering by
census"). Doors pick a walkable area in the warehouse (`walkableAreaWithin`, the
peopleDb `walkableArea` read): every eligible rooftop-geocoded household in
the district, uncapped, goes into ~200m grid cells, the cell whose 3x3
neighborhood holds the most households is the seed, and the households
nearest that neighborhood's center are taken until the step's size; a
second area in the wave is drawn after the first, so it lands elsewhere. The
response's `area` is the padded box around those households, for the
turf's map; do-not-knock is left to the turf create, as for any turf. A
step drawn again returns its list. Every channel opens its flow on
`build_citizens_panel`: the text asks with the locked JOIN line; calls and
doors draft a short invite whose ask is the Serve join question the official
records ("Do they want to join your civic panel?"). That purpose is in
`PhoneBankingPurpose`, `DoorKnockingPurpose` and contracts'
`SERVE_PHONE_BANKING_PURPOSE_VALUES` (which Serve door knocking shares), and
its draft endpoints (`/v1/outreach/serve/phone-banking/draft`,
`…/door-knocking/draft`) 404 it with `serve-citizen-panels` off, as the SMS
draft does.

**Steering by census** (`utils/civicPanelSteering.util.ts`, Bryan,
2026-10-18). Each draw leans toward the groups the panel trails, so the
panel drifts toward the district's census mix. Dimensions are age (the
census's six adult bands, 18 to 24 through 65+), gender (census sex against
the voter file's `M`/`F`), tract and race, all from `weightingTargets`. Tenure
is out until a statistician rules on its household target. Race (Bryan and
Samuel, 2026-10-19, `docs/decisions/2026-10-19-race-ethnicity-in-civic-panel.md`) is L2's
modeled `EthnicGroups_EthnicGroup1Desc` folded into white, Black, Hispanic,
Asian and other against all-ages ACS shares (Native American and any group
under 2% of the district fold into other). It leans a draw and names a
group only when `raceNameable` holds (at least `MIN_KNOWN_RACE`, 10,
members with a known value and `MIN_KNOWN_RACE_SHARE`, 70%, of them);
otherwise race sits out the panel entirely. `other` is never leaned toward
or named. Race is read only into counts and draw weights, never onto a
person or a filter: the Serve ethnicity gate below is unchanged.
`CensusCompositionSource.weightingInputs` reads the members' cells and the
census (`findWeightingInputs`), cached 15 minutes per office and member set
in the plan service; a failed read leans nowhere. Draw weights come
from gaps: census share (`weightingTargets`: ACS adults by sex and age band,
adults per tract over the block groups the district's people live in)
against the members' unweighted share
among those with a known value, values under
`MIN_ANSWERS_PER_WEIGHTING_GROUP` (5) members pooled into `other`.
Texts (and calls, below) draw weighted: per value `clamp(c / p, 0.5, 2)`
(2 where `p = 0`), a person's weight the product clamped to [0.5, 2],
passed as `drawListSample`'s server-only `weights` and applied in
`buildSampleSql`'s order. Doors walk the barely reached tract
(`tractShortfalls`, on members) trailing most,
through `walkableAreaWithin`'s `tract`, and fall back to the district-wide
pick when it holds fewer households than the step. Calls drop landline-first
once the panel's 65+ share reaches the census's, and draw weighted from
the whole phone pool. Nothing leans below `PANEL_MIN_MEMBERS_FOR_BALANCE`
(30) members. A step's
`steeredToward` (`UnderrepresentedGroup`) is written when it is drawn;
before that the read predicts it for a not-started step. A call step's
`landlineFirst` (whether its draw put landlines first) is recorded and
predicted the same way; a call step drawn before it was recorded reads
true unless it leaned. A door step
leaning toward `unreachedAreas` reads "Knock on doors in a part of your
district we haven't reached" as its Next line. The response's `balance`
(null when the census cannot be read) is the panel's one status, in its
own words (`CIVIC_PANEL_BALANCE_STATUS_LABELS`, never the priority's
labels): `tooFewMembers` under 30 members, then `missingGroups` while any
major group is short of members, else `everyGroup`. `inviteMore` is the
largest missing group, set whenever groups are missing, even once the goal
is met; a text step's `steeredToward` is that same group (draw weights still
follow the share gaps). The panel page offers a new plan only under the member
goal, since the API refuses one past it; past it the balance section's line
is the next step. The official never sees a share, weight or target.

**Round 1 sizing** (`sizeRoundOne` in `utils/civicPanelAllocation.util.ts`,
Samuel, 2026-10-19, `docs/decisions/2026-10-19-civic-panel-two-rounds-coverage-sizing.md`).
A priority check's first round, which the priority chat proposes as a door,
a call and a text card at once (`size_round_one`,
`chats/general/chat-tools/sizeRoundOne.tool.ts`). A major group holds
`MAJOR_GROUP_SHARE` (3%) or more of the district on a steered dimension:
age band, gender, tract, and race only when `raceNameable` holds for the
door pool, never `other`. District shares are
`weightingTargets` of the census (`PriorityResultsService.districtCensus`),
or the door pool's own mix when the census cannot be read. Each channel's
pool is counted by group in the warehouse (`ContactsService.countByGroupWithin`,
peopleDb `buildPoolCellsSql`, counts only): `notContactedRecently` for
doors, plus `hasAnyPhone` for calls and `hasCellPhone` for the text. Doors
and calls take the official's weekly hours exactly as `sizePanelWave` splits
them, uncapped by any member gap (`roundOneHours`); the hours are the active
plan's, or the official's answer in the chat. The doors are one walkable
area (`PriorityResultsService.roundOneDoorArea`), picked the way a plan's
door step is: `walkableAreaWithin` in the tract the priority's answers trail
most (`doorTractFor`, once `PANEL_MIN_MEMBERS_FOR_BALANCE` people have
answered), else, or when that tract holds too few doors, across the
district. The area goes on the door card as `walkableArea`, the padded box
around its doors (`areaAround`), and the card's count is who that box holds
(`resolveGeoMemberIds`, then `countByGroupWithin` within those ids), so the
door part of a group's answers comes from who lives there, not from the
district. A group's expected answers are the invites reaching it on each
channel (the channel's size times the group's share of who it reaches: the
area for the doors, the pool for calls and the text) times that channel's
answer rate: `DOOR_ANSWER_RATE` 10%,
`CALL_ANSWER_RATE` 5%, `TEXT_ANSWER_RATE` 3%, placeholders until offices
measure them. The text is the most any short group needs to reach
`MIN_VOICES_PER_GROUP` (3), `(3 − expected) / (textShare × rate)`, capped
by the reachable cell phones and `MAX_LIST_SAMPLE_SIZE`; a group no cell
phone reaches does not size it. The tool says whether every major group
reaches 3 (`coversEveryGroup`).

**Round 2 targeting** (`utils/civicPanelAllocation.util.ts`, called by
`priorities/services/priorityRoundTwoDraw.service.ts`). Leans a priority's round 2 text, drawn on its scheduled date, toward
the groups a model of the round 1 answers is least sure about, rather than toward census gaps:
`batchTargets` ranks groups under `MIN_VOICES_PER_GROUP` (3) first, then by
share times range width; `batchWeights` turns that into the same
`SampleWeights` this steering passes, within [0.5, 4]; `splitBatch` keeps
`UNSTEERED_BATCH_SHARE` (15%) of the send unsteered. Groups under
`MAJOR_GROUP_SHARE` (3%) and the pooled `other` are never leaned toward, and
the caller leaves race out unless `raceNameable` holds. The model is
`priorities/util/mrp.util.ts`. Design and what is left:
`docs/features/civic-panel-mrp.md`.

**Statuses** (`stepStatus`, read on every GET, never stored).
`not_started` until something is made from the step's list; `in_progress`
for a text past checkout before its send date, or a call list or turf that
exists; `waiting_on_replies` for a sent text until its replies are in
(`PANEL_TEXT_REPLY_BUSINESS_DAYS`, 3 business days after the send date);
`done` once the text's results are in or that date passed, once every
person on the call list or walk was called or knocked or its envelope is
marked done, or `PANEL_STEP_WINDOW_DAYS` (30) after it started; `skipped`
for a step nobody started once a later wave exists, or that the official
skipped (`POST …/steps/:id/skip`, current wave, not started, writes
`skippedAt`; 409 once started). A skipped step is no longer synced, so it
stays skipped even if its list is used elsewhere, and its drawn people (if
it was prepared) are back in later draws; `prepare` on a skipped step is a 409. Skipping a whole wave makes the
next one on the next read; its steps start as not started. A text that never got
past checkout (`UNSENT_OUTREACH_STATUSES`) does not count.

**Ticked by hand.** The official can tick a call or door step done, or
untick it, over what its list says (`POST …/steps/:id/mark` with
`{ done }`, active plan only, 400 for a text, which is done once it is
sent, 409 for a step skipped before anything started from it). It writes `markedDone` and `markedAt`; the read applies it before
the status (`withMark`): ticked is done when it was ticked (or when the list
finished), unticked is never done whatever the list says. Null reads off the
list as above. Each step also carries `reached` (residents called, or
knocked across its turfs; null for a text or before anything is logged) and
`joined` (the residents its list drew who are on the panel now; null before
it is drawn), for the panel page's done lines.

**Waves.** `GET` moves the plan: it refreshes each step's links and dates,
closes the plan at the goal, and makes wave N+1 once wave N is due (every
step done or skipped, or the started ones done and the rest untouched for
`PANEL_UNSTARTED_STEP_DAYS`, 14, after the last finished; a wave whose every
step was skipped is due at once), sized to the gap that remains. The counts run before the lock; under it the read re-checks
the latest wave, so concurrent reads make one wave. `next` is the current
wave's first ready step (texts, then calls, then doors), else one being
worked, else the replies to wait for, with a plain line and a link to the
panel page (`CIVIC_PANEL_PAGE_HREF?step=<id>`). Waiting on a text has no
link; with nothing left to do or wait on, `next` is null.

**Analytics** (`EVENTS.CivicPanel` in `segment.types.ts`, sent to the
office's user through `trackForOffice`; ids, counts and enums only).
`Plan Created` (step counts per channel, `surface` `panel_page` or
`chief_of_staff`) and `Plan Updated` (only when the hours change) fire from
the writes. `Step Skipped` fires once per skip. `Step Completed` fires once per step:
with `how` `marked` on a tick of a step whose list has not finished, or from
the read (`how` `finished` or `window_ended`) when its sync writes the date
of a step nobody ticked or unticked. The read also fires `Step Started`, and
`Goal Reached` when it closes the plan. That sync writes conditionally on
the dates it read, so of two racing reads only one reports a change.
`Membership Changed` fires from `ContactStatusService.changeStatus` for every
civic panel write, with the from and to status and the source. The browser
fires `Civic Panel - Panel Viewed` and `Step Opened` itself.

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
2. Only `text | p2p | robocall` materialize. `doorKnocking` and
   `phoneBanking` are permanently excluded — each writes its own rows from
   its own logging endpoint (the phone-banking call-outcome endpoint,
   `src/phoneBanking/`, ENG-10915) rather than at launch; `socialMedia` has
   no model yet.
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
`peerlyPhoneListCapture.service.ts`). The `PeerlyPhoneList` row is created
`queued` before this build runs, not after — see
`src/voters/AGENTS.md`'s capture gotcha for the full `buildId`/`buildStatus`
lifecycle (`queued → processing → ready|failed`) and the additive
`GET /p2p/phone-list/build/:buildId/status` route.

**Opt-out scrub (ENG-10800).** `P2pPhoneListUploadService` excludes every
org-wide opted-out person (`ContactInteractionTextService.findOptedOutPersonIds`
— any past text/p2p send, not just the outreach that recorded it) from a new
phone-list build via `findContactsForFilter`'s `excludePersonIds` param, which
folds into whatever `id` resolution activity conditions/support status already
produced (`ContactsService.excludePersonIdsFromResolution`). Over the
people-db 100k id-filter cap (`MAX_RESOLVED_ID_SET_SIZE`), the scrub is
skipped and logged loudly rather than blocking the send. The excluded count is
persisted on `PeerlyPhoneList.excludedOptedOutCount` for a later UI ticket
(ENG-10808) to surface. The materialization fallback above (re-resolving the
filter when an outreach has a `phoneListId` but no capture rows) does **not**
run this scrub — it already overstates by design, and ENG-10800 didn't touch
it.

**Phone dedup (ENG-10801).** `P2pPhoneListUploadService.buildPhoneList` keeps
one CSV row per phone number: a `Set` of seen numbers spans the whole
pagination loop, and a person whose number was already kept is skipped
(first-seen wins — deterministic given the people-db query's stable ordering). This
also fixes the inbound sweep's phone->person mapping (`PeerlyPhoneListRecipient`),
which was ambiguous whenever two people shared a captured phone. The skipped
count is persisted on `PeerlyPhoneList.excludedDuplicatePhoneCount`, alongside
`excludedOptedOutCount`, for the same ENG-10808 UI to surface.

**The audience cap is checked BEFORE the resolution, not during it.**
`resolveFilterAudience` asks for the matched count on page 1 only (`skipCount:
page > 1`) and refuses a filter whose count already exceeds `maxRecipients`.
The in-loop cap it backs up is correct but was unreachable in production: it
can only throw once `maxRecipients` recipients have been resolved, i.e. page
101 at the phone-list defaults, which at the ~2.17s/page measured in prod is
~219s — and the gateway gives up at ~120s. So an over-cap `POST
/v1/p2p/phone-list` was killed in flight at 120s (logging `statusCode: null`,
which is what pages the `p2p-route-errors` rule), and the handler then spent
another ~99s paging toward a 400 no client was still connected to receive. Ten
of those in the 30 days to 2026-09-27.

Two things to know before touching it:

- **The count is an upper bound, so the refusal is slightly over-eager.**
  Every later step (missing-phone skip, `isEligible`, phone dedupe) only
  removes people, so a matched count over the cap does not prove the
  resolution would have tripped it — a dedupe-heavy list matching 110,500 rows
  can resolve 99,500 recipients. That list is refused now. It also could not
  be served before: 111 pages is ~241s. The honest fix for the band between
  "resolves under the cap" and "cannot resolve inside 120s" is to take the
  build off the request path; until then a fast refusal beats a silent hang.
- **The COUNT is nearly free, and only because it is parallel.** The Databricks
  path runs the count and the page query in `Promise.all`
  (`databricksVoter.service.ts`), so page 1 costs no extra round trip. Moving
  the check to its own call, or asking for the count on every page, would
  reintroduce the per-page COUNT `skipCount` exists to avoid.

**The wall clock is bounded separately from the cap (`timeBudgetMs`,
INC-101).** The pre-flight above only catches a filter over `maxRecipients`, and
the cap sits far above what the gateway will wait for: 100,000 recipients is 100
pages, and at the 1.3–2.5s/page measured in prod two minutes buys 50–90. So a
filter matching 55,000–100,000 rows passed every guard here and was then killed
in flight — in prod, 82 pages, `statusCode: null` at 120,038ms, and the handler
went on to upload the finished phone list to Peerly 45.9s _after_ the browser
had shown a failure, leaving a list nobody could see and inviting the retry that
made a second one. A caller with a request waiting now passes
`MAX_INTERACTIVE_RESOLUTION_MS` (90s — 120s minus the handler's own lookups, CSV
assembly, vendor upload and response) and gets two checks:

- the **projection**, once per full page from page 2 on. `matchedCount /
pageSize` is the pages this filter needs and the pages already fetched are
  what one costs, so a projected finish past the budget is a
  `BadRequestException` naming the matched count and the count that does fit.
  Page 1 is timed but excluded from the average: it carries the parallel COUNT,
  so it is the slowest page, and projecting from it refuses lists that land
  (a 60-page list at 1.4s/page finishes in 84.6s and must not be refused).
- the **hard stop**, before each fetch: elapsed past the budget throws
  `ServiceUnavailableException`. A 503, not a 400, because the projection
  passing and the clock still running out is ours to explain, and the route
  alerts page on 503 while they ignore 400.

Both stop the handler while the client is still connected, which is what keeps
it from creating something nobody will be told about. The band this closes is
still a band — the honest fix is taking the build off the request path — but a
refusal in ~4.5s naming a number beats a two-minute blank.

`outreachServeSmsCreate.service.ts` drives the same resolver on a request path
and gets both guards (the pre-flight cap for free, the deadline because it
passes `timeBudgetMs`). `outreachTextDelivery.service.ts` passes
`skipPreflightCap: true`, no `timeBudgetMs`, and keeps only the in-loop cap: it is SQS-driven, so no
gateway deadline ever applied to it, and there the over-eagerness above is not a
tolerable trade but a regression. Two reasons, either sufficient. Its
matched-minus-resolved gap is routinely the size of the org's whole opt-out set,
because it scrubs opt-outs in-process rather than as a query filter (so the
official can be shown how many _this_ audience lost); and `requestSend` reads a
4xx out of the resolver as "the data is wrong, a retry reads the same rows" and
marks the outreach permanently `failed` — on a row that is already paid, which
its own log line calls out as needing a refund decision. So a filter matching
105,000 rows and resolving 85,000 recipients must keep sending, and does.

### Write-back (collect-forward)

Two `@Cron` sweeps in `src/outreach/services/` (scheduled fetch — Peerly
has no signed webhook):

- `outreachCompletion.service.ts` — flips Peerly job status
  `pending → in_progress → completed`. Completion gates "specific
  campaign" activity conditions. Watch: it infers from `end_date` (the
  scheduled end), not delivery truth — refinement via CDR ingestion is
  ENG-10740 (open).
- `outreachInboundSweep.service.ts` — hourly, streams the message report
  for active/recently-completed jobs, maps phone → person through the
  capture rows, and writes `respondedAt` / `optedOutAt` idempotently on the
  vendor event id. Opt-outs come from the reply text (`isOptOutMessage`),
  plus a 6-hourly pass over Peerly's own opt-out flags for the ones its AI
  or texters mark without a stop word. Opt-outs drive the record's Opted
  In/Out chip.

### The AI assistant

Tools are **in-code functions with Zod schemas** (foreground CAP agent
pattern — explicitly not MCP): `crm-tools/` builders registered in the
campaign-manager handler (Win, unconditional) and chief-of-staff
handler (Serve, unconditional). Each tool calls the same services as
the UI routes in the user's org context, so mode rules, Pro gates, and
free-tier rules are inherited, never re-implemented. **No tool returns an
individual voter row** — aggregates, dimension metadata, and filter
ids/names only. `describe_filter_dimensions` reads
`filterDimensions.catalog.ts`, the single mode-aware vocabulary source.
**On Chief of Staff and the Campaign Manager the assistant never creates a list itself.** It offers one
with `present_list_proposal` (a display tool, args are the card) and the
official saves it from the card, which posts with a `proposalKey`
(`VoterFileFilter.proposalKey`, unique) so a second press returns the first
list; `GET /v1/voters/voter-file/filter/by-proposal-key/:key` is how a
reloaded card knows. See `docs/cap-interactive-agents.md` § A list is saved
from a card.
`crud_saved_filters` gained `action='get'`, the only way to read a SAVED
list's current size: `list` returns ids and names, `create` counts the filter
it was handed, and nothing answered "how big is list 7 now" — so the
assistant quoted whatever figure appeared earlier in the conversation, which
goes stale the moment a boundary is drawn on that list. It counts via
`ContactsService.countSegment`, which resolves by segment and therefore
applies the frozen geo members and the stored search the way every other
read of that list does. Counts stay OFF `action='list'` deliberately: one
count per saved list is the per-row N+1 that 504'd the lists index in prod.
`create` also takes `sample: { size }` (the size `size_outreach_sample`
returned), drawn through `ContactsService.drawListSample` exactly as the
voter-file filter route draws one, so the assistant can save a random sample
of an audience and the returned `count` is the sample's size. Neither
assistant uses it to hand over a text: both present a proposal card with the
unsaved filter and the sample size, and the text flow saves the list when
the user starts it.
Every list reference it returns also carries `hasBoundary` — whether a shape
is on the list, never where it is. A holder can draw one from either
assistant's own map card in the transcript, so a list's size can change between turns
with the model calling nothing; the webapp sends a hidden turn on that save
and the flag is the recovery path for a conversation that missed it
(`docs/cap-interactive-agents.md` § A drawn boundary reaches the
conversation). Geometry stays out of the INPUT schema: every model-facing
tool is built on `voterFilterBaseSchema`, which has no `geoPoly`, so the
assistant can never create a list already scoped to a shape — the prompt
tells it to say so rather than refuse.
Most catalog entries carry an optional `provenance` mark
(`observed` | `modeled` | `derived`) and the catalog exports the one rule
string that tells the model what a mark obliges it to say
(`FILTER_DIMENSION_PROVENANCE_RULES`, imported by the describe tool's
description and by the Chief of Staff prompt's `CRM_TOOLS_RULES` —
never restated). Most L2 demographics are `modeled`: the warehouse value
says "Likely"/"Probable"/"Estimated"/"Inferred" and the catalog label
strips it, so without the mark the assistant reported modeled ethnicity
as observed fact (Chief of Staff eval D3-05). Two dimensions (`children`,
`languageCodes`) carry no mark at all: `serve/output/l2_haystaq_codebook`
(the L2 National Models User Guide) only documents `hs_*` opinion-score
models, not these base columns, so rather than guess, the rule text tells
the model to treat an unmarked dimension exactly like `modeled` until
someone sources the real answer and a follow-up adds the mark.
The TDD's `GET /v1/contacts/filter-dimensions` route was deliberately
skipped (tools call services in-process). The webapp assistant bar rides
the existing `campaign_assistant` / `chief_of_staff` chat scopes — no new
scope.

## Access control and mode rules

| Rule                              | Enforcement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Win contacts access is default-on | The `win-voter-data` flag gate was removed 2026-07-20 (PRs #885–#887); `assertContactsAccess` is gone. Any Win campaign reaches the page                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Pro is per-action, not page-level | Non-Pro Win: real district aggregates + a **synthetic** preview (`utils/previewContacts.utils.ts` — fabricated rows, never real PII; `totalResults` is set to the real count so the stat card doesn't regress). `findContacts` rejects search/named segments; `findPerson`, `countContacts`, `downloadContacts`, notes, and interactions all reject non-Pro (`PRO_FILTERING_REQUIRED_MESSAGE`). **Every pro gate refuses with a `ForbiddenException` (403), never a `BadRequestException`** — a paywall refusal is an entitlement answer, not a malformed request. Alerting is why it changed (one free-tier user hitting the gate used to page the on-call, back when `EXCLUDED_STATUS_CODES` in `deploy/components/alerting/route-alerts.ts` counted 400) but no longer why it holds: that list excludes 400 now too, and 403 stays because it is the honest status. The same rule holds for `FILTER_PRO_REQUIRED_MESSAGE` (`voters/services/voterFileFilter.service.ts`) and `assertProAccess`, which door knocking, phone banking, and outreach all call. `filterAccessCheck` (the `FILTER_PRO_REQUIRED_MESSAGE` gate) only guards saved-filter update and delete plus its outreach-use call sites now — `POST /v1/voters/voter-file/filter` (create) dropped it (outreach-pro-gating-v2) so a free candidate can save a recommended list as a named list before upgrading |
| Serve = `eo-` slug prefix         | `hasElectedOfficeAccess`; Serve orgs are license-equivalent to Pro                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Affinity + ideology are Win-only  | `assertNoRecommendedListFilterForElectedOffice` 400s either at the same five choke points the party gate covers, and the dimensions catalog marks both `modes: 'win'`. Not a licensing rule like party — a permanent product rule, and a separate mechanism from the webapp's own visibility prop; see the recommended-list dimensions section                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Party never reaches Serve         | `stripWinOnlyFieldsIfElectedOffice` (list + detail + typeahead), download drops party (plus turnout propensity + vote history, ENG-10830) via projection, party **filters** 400 (`assertNoPartyFilterForElectedOffice`), the door-knocking route payload nulls it per target (`doorKnockingServe.service.ts`, which also declares `isServe` so the two paper surfaces can read one field rather than re-derive the prefix), and the dimensions catalog hides party. A party value in any `eo-` response is a bug — there's a party-leak test suite, in `contacts.service.test.ts` and in `doorKnocking.routes.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Ethnicity never reaches Serve     | Win-only, and a product rule rather than a licensing one. #1933 removed ethnicity subsetting from both products; the Win half was reverted and the rule now binds Serve alone. The catalog marks the dimension `modes: 'win'` so the Chief of Staff never learns it exists, `assertNoEthnicityFilterForElectedOffice` 400s the key at the same six choke points the party gate covers, `resolveSavedFilterSets` drops a pre-rule saved list carrying the columns rather than failing the whole union, `stripWinOnlyFieldsIfElectedOffice` removes `ethnicityGroup` from list/detail/typeahead, both CSV paths drop the column via projection (`EXCLUDABLE_VOTER_COLUMNS` and `SERVE_EXCLUDED_VOTER_FILE_COLUMNS`), and the door-knocking route payload nulls it per target. Aggregate district composition is a different question and stays (`voters.service.ts`'s `getEthnicityCounts`), and so does the civic panel's own use of the column in aggregate counts and draw weights (`docs/decisions/2026-10-19-race-ethnicity-in-civic-panel.md`): no official ever filters, sees or downloads it. The Chief of Staff prompt refuses the ask by name and refuses a proxy for it (language, surname, a neighborhood standing in); the Campaign Manager prompt carries no ethnicity rule, because Win may cut a list by the dimension                                           |
| One people table per request      | `withOrgDistrictResolution` resolves the org's `PeopleDataset` (`PeopleDatasetService`, `peopleDb/AGENTS.md`) next to the district and hands both to every peopleDb read. Callers paging one org's audience (`resolveFilterAudience`, the robocall phonebook, materialization, phone lookups) resolve it once with `resolvePeopleDataset` and pass it into `findContacts` / `findContactsForFilter` / `findPersonByPhone`, as they already do `resolveProAccess`. `resolveEligibleDistrict` returns the pair to modules that call peopleDb directly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| L2 voter id never leaves a file   | Narrower than the party and ethnicity rules by design, and not a dimension gate: there is no filter to 400 and nothing to strip from a response — `lalVoterId` stays on the person payload, because contact activity is keyed on it. Only the file that leaves someone's hands drops it, and both CSV paths do so via projection (`EXCLUDABLE_VOTER_COLUMNS` and `SERVE_EXCLUDED_VOTER_FILE_COLUMNS`). Win keeps the column — its download is a voter-file extract, and this is a Serve rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Free tier / AI                    | District stats stay open to non-Pro; counts are Pro-gated like search (the assistant's `count_contacts` recognizes `PRO_FILTERING_REQUIRED_MESSAGE` and suggests the upgrade); assistant tools are aggregate-only by construction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Team accounts (ENG-11025)         | `GET /v1/contact-engagement/:id/activities` (`UseEngagementContextGuard`) resolves org access via `OrganizationMembershipService.resolveRole` and now admits an org's `owner` or a `campaignAdmin` member, not just the owner; a `volunteer` membership row is denied. `eo-` (Serve) orgs stay owner-only regardless of role — Serve staff accounts are a Phase-1 non-goal. Voter-file download (`CanDownloadVoterFileGuard`) uses the same role resolution plus its own plan/eligibility check; `volunteer` is denied there too. **Carve-out (ENG-11057):** the four notes routes (`contactNotes.controller.ts`) carry `@AllowVolunteer()` and give a volunteer full CRUD scoped to people they can reach through an `OutreachAssignment` on a phone-banking or door-knocking envelope (`ContactNoteVolunteerAccessService`, `src/contactNote/`, mirroring the ENG-11050 phone-banking admission check — 404, not 403, on an unreachable person or note) — every other volunteer-denying surface in this table is unchanged                                                                                                                                                                                                                                                                                                                                                   |

## Debugging playbook

First stop for prod issues: Grafana Loki
`{service_name="gp-api", deployment_environment_name="prod"}`. Frontend errors: Sentry org `goodparty`.

| Symptom                                                        | Where to look                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Count ≠ what outreach reached                                  | Count is dynamic (filter re-resolved now); the send used the phone-list capture at launch. Compare `PeerlyPhoneListRecipient` rows vs a fresh `findContactsForFilter`. Also: channel reachability (SMS needs a cell phone) trims at phone-list build, not in the count                                                                                                                                                                                                                                                                                                |
| Outcome filter matches nothing                                 | Expected for pre-feature-5 sends (collect-forward, no backfill). Check the outreach's `ContactInteractionText` rows exist and sweeps ran                                                                                                                                                                                                                                                                                                                                                                                                                              |
| responded/opted-out never appears                              | Inbound sweep: is the job in the sweep window (anchored on scheduled send date)? Do capture rows exist for the phone list (phone→person mapping)? Check `sourceEventId` idempotency collisions and Loki for sweep errors                                                                                                                                                                                                                                                                                                                                              |
| "Specific campaign" missing from the wizard's campaign chips   | Only **completed** outreaches qualify; the completion sweep infers from Peerly `end_date` — a stale/never-run job can sit `in_progress` (ENG-10739 fixed the predicate; ENG-10740 tracks CDR truth)                                                                                                                                                                                                                                                                                                                                                                   |
| 409 on filter edit/delete                                      | `firstUsedForOutreachAt` is stamped — by design (duplicate to edit). A filter `updatedAt` newer than its stamp would be a real bug                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Party visible to a Serve org                                   | The choke points are `stripWinOnlyFieldsIfElectedOffice` + the download projection. Treat as a sev bug (license)                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Non-Pro sees real voter rows                                   | Must be impossible — `previewContacts.utils.ts` fabricates rows. Check nothing bypasses `findContacts`'s pro branch                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Empty contacts page on dev                                     | The dev voter mart genuinely lacks person rows for many districts (district-specific, not dev-wide). Stats can exist while rows don't — warned on since ENG-10745. Cheyenne WY 82001 has dev rows                                                                                                                                                                                                                                                                                                                                                                     |
| `VOTER_DATA_UNAVAILABLE` on an org that clearly has a district | Two different failures share that error code: `resolveDistrictInfoFromOrg` found no district at all, **or** the district resolved but has no `DistrictStats` row (`fetchStatsByDistrictId`, and the sample read on the poll-send path). Deliberate — they're the same user-facing state, and callers gate on the code, not the cause. The code lives in `shared/constants/voterData.consts.ts` rather than here, because `peopleDb/` raises it too and must not depend on contacts. Check `gp_api_district_stats` for the resolved `districtId` to tell the two apart |
| Typeahead empty / slow                                         | Name search is `lower(col) LIKE` over the mart (`buildSearchSql`), with a 3-character minimum on substring tokens. A slow one is warehouse queue/startup time — check the `people-db voter read` log line's `dbxMs` and `statementIds` against Databricks query history (see `src/peopleDb/CLAUDE.md`)                                                                                                                                                                                                                                                                |
| Filter 400 "too many ids"                                      | The 100k id-set cap in `src/peopleDb`'s filter pipeline — an activity/support condition resolved to more people than the transport allows. Logged; the projection fallback is the designed escape                                                                                                                                                                                                                                                                                                                                                                     |
| Assistant refuses / weird tool behavior                        | Serve: tools register whenever `contacts` + the organization resolve, no flag. Win: the same, except a campaign whose row says `isPro: false` gets counting, the catalog, sample sizing and the text card but not `list_precincts` or `crud_saved_filters` (their services refuse it), and the card's button is its Pro gate. Locked-filter 409 surfaces as an explanation                                                                                                                                                                                            |
| Feed missing legacy Win outreach rows                          | Legacy `VoterOutreachActivity` rows render only during the sunset and only for Win; new channels need a feed-mapping branch in `ContactEngagementService` + a `ConstituentActivity` variant                                                                                                                                                                                                                                                                                                                                                                           |

Useful SQL truths: derived support status =
`DISTINCT ON (organization_slug, person_id) … ORDER BY occurred_at DESC`
over interaction rows with a non-null `support_answer`; a "list" =
`SELECT person_id FROM contact_interaction_text WHERE outreach_id = X`.

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
