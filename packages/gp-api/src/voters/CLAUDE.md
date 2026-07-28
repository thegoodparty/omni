# Voters Module

Voter data layer. Talks to L2 (commercial voter file vendor) for live counts/filtering and persists per-campaign voter file filters used by outreach. Owns the `VoterFileFilter` model and the voter-file download access flow.

This module does not store the voter file itself — L2 is the source of truth. We persist filters, derived counts, and audit metadata.

## Key files

| Path                                  | Purpose                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `voters.module.ts`                    | Module wiring; exports `VoterFileService`, `VotersService`, `VoterFileFilterService`     |
| `voterFile/voterFile.controller.ts`   | HTTP: list/create/update/delete `VoterFileFilter`, voter-file counts + CSV               |
| `voterFile/voterFile.service.ts`      | `GET /voters/voter-file` counts/CSV via `ContactsService` → people-api (ENG-5032)        |
| `services/voters.service.ts`          | L2 API client (counts, demographic breakdowns)                                           |
| `services/voterFileFilter.service.ts` | Filter persistence + per-campaign filter listing                                         |
| `services/voterOutreach.service.ts`   | Bridges voter filters to outreach campaigns                                              |
| `schemas/`                            | Zod input schemas for filter create/update                                               |
| `voters.types.ts`                     | `VoterCounts`, `EthnicityCounts`, `GenderCounts`, `PartisanCounts`, `VoterHistoryColumn` |

## Patterns

- **L2 is the system of record for voters.** Treat `VotersService` as a thin axios wrapper — never cache L2 responses in our DB beyond the explicit count snapshots on `VoterFileFilter`.
- **`L2_DATA_KEY` is required at boot** (`voters.service.ts` throws on missing env). Don't add lazy fallbacks.
- **Voter file downloads are gated** through `VoterFileDownloadAccessService` (in `src/shared/services/`) — it checks campaign tier + entitlement. Don't bypass it from new endpoints.
- Filters are scoped to a campaign via `@UseCampaign()` + `@ReqCampaign()` — same pattern as the rest of the campaign-scoped surface.
- **A filter locks on first outreach launch.** `VoterFileFilterService.stampFirstUsedForOutreach` does an atomic `updateMany WHERE id = ... AND first_used_for_outreach_at IS NULL` (first-write-wins, never rolled back). `assertNotLocked` reads that column to 409 PUT/DELETE once it's set. The stamp is called from `OutreachMaterializationService` (`src/outreach/services/outreachMaterialization.service.ts`) at outreach launch, alongside writing per-person `ContactInteraction<channel>` rows for the resolved filter — see that module for the materialization flow.

## Gotchas

- **gp-api no longer queries `gp-voter-db`** (ENG-5032). `GET /voters/voter-file` (the outreach/task-flow audience download and count — `downloadVoterList.util.ts` / `RecordCount` in gp-webapp) resolves through `ContactsService.countVoterFilePeople` / `downloadVoterFilePeople` → people-api, mapping the legacy underscore filters and per-type population rules in `voterFile/util/voterFilePeopleFilter.util.ts` (mirrors `segmentsToFiltersMap.const.ts`). Those two `ContactsService` methods are deliberately NOT pro-gated — the endpoint never was; `CanDownloadVoterFileGuard` owns access. The CSV is people-api's curated ~54-column subset with friendly headers (`DOWNLOAD_COLUMNS` in `packages/people-api/src/people/people.select.ts`, ENG-10766) — not the raw L2 columns, and not people-api's full internal projection either. `typeToQuery`/`customFiltersToQuery`/`VoterDatabaseService` are deleted; what remains of the old stack is deploy plumbing (`VOTER_DATASTORE` in `deploy/docker-entrypoint.sh`, the `voterCluster` resources in `deploy/index.ts`) and the nightly `write__l2_databricks_to_gp_api` ETL (gp-data-platform repo) — decommission those together, cluster last.
- The L2 API has its own rate limits and timeouts; wrap new calls in `try/catch` and throw `BadGatewayException` per `.cursor/rules/rules.mdc` Rule 3.
- Counts surfaced to the UI come from L2 in real time and may shift between page loads — don't rely on them for billing or quota math.
- `VotersModule` imports `OutreachModule` (one-way). If you find yourself wanting `OutreachModule` to import voters too, route the dependency through an existing service instead — adding a back-edge will require `forwardRef` and is a smell.
- **The SMS/Peerly phone-list path resolves through `ContactsService.findContactsForFilter`** (ENG-10728) — the same activityConditions/supportStatus/search resolution engine list/count/download use — paged (`SEGMENT_PAGE_SIZE` 1000, 100k cap) with `hasCellPhone: true` forced (`src/vendors/peerly/services/p2pPhoneListUpload.service.ts`). `peerly/utils/audienceMapping.util.ts` is deleted; don't resurrect it for new Peerly filter mapping.
- **Every uploaded Peerly phone list is captured.** `PeerlyPhoneListCaptureService` (`src/vendors/peerly/services/peerlyPhoneListCapture.service.ts`, backed by `PeerlyPhoneList`/`PeerlyPhoneListRecipient`) writes one parent row (keyed by the Peerly upload token) plus one recipient row per CSV line — `(personId, phone)` — in a single transaction, only after the Peerly upload itself succeeds. The status endpoint (`GET /p2p/phone-list/:token/status`) stamps the resolved numeric Peerly list id onto the capture row the first time it sees the list ready (`peerlyListId`, guarded so a repeat poll can't clobber it) — that id equals `Outreach.phoneListId`, which downstream materialization/inbound-mapping tasks use to find the capture row.
