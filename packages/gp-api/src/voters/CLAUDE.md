# Voters Module

Voter data layer. Talks to L2 (commercial voter file vendor) for live counts/filtering and persists per-campaign voter file filters used by outreach. Owns the `VoterFileFilter` model and the voter-file download access flow.

This module does not store the voter file itself — L2 is the source of truth. We persist filters, derived counts, and audit metadata.

## Key files

| Path                                  | Purpose                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `voters.module.ts`                    | Module wiring; exports `VoterFileService`, `VotersService`, `VoterFileFilterService`, `VoterDatabaseService` |
| `voterFile/voterFile.controller.ts`   | HTTP: list/create/update/delete `VoterFileFilter`, request downloads                                         |
| `voterFile/voterFile.service.ts`      | CRUD on `VoterFileFilter`, download URL signing                                                              |
| `services/voters.service.ts`          | L2 API client (counts, demographic breakdowns)                                                               |
| `services/voterDatabase.service.ts`   | Direct queries against the in-house voter database                                                           |
| `services/voterFileFilter.service.ts` | Filter persistence + per-campaign filter listing                                                             |
| `services/voterOutreach.service.ts`   | Bridges voter filters to outreach campaigns                                                                  |
| `schemas/`                            | Zod input schemas for filter create/update                                                                   |
| `voters.types.ts`                     | `VoterCounts`, `EthnicityCounts`, `GenderCounts`, `PartisanCounts`, `VoterHistoryColumn`                     |

## Patterns

- **L2 is the system of record for voters.** Treat `VotersService` as a thin axios wrapper — never cache L2 responses in our DB beyond the explicit count snapshots on `VoterFileFilter`.
- **`L2_DATA_KEY` is required at boot** (`voters.service.ts` throws on missing env). Don't add lazy fallbacks.
- **Voter file downloads are gated** through `VoterFileDownloadAccessService` (in `src/shared/services/`) — it checks campaign tier + entitlement. Don't bypass it from new endpoints.
- Filters are scoped to a campaign via `@UseCampaign()` + `@ReqCampaign()` — same pattern as the rest of the campaign-scoped surface.
- **A filter locks on first outreach launch.** `VoterFileFilterService.stampFirstUsedForOutreach` does an atomic `updateMany WHERE id = ... AND first_used_for_outreach_at IS NULL` (first-write-wins, never rolled back). `assertNotLocked` reads that column to 409 PUT/DELETE once it's set. The stamp is called from `OutreachMaterializationService` (`src/outreach/services/outreachMaterialization.service.ts`) at outreach launch, alongside writing per-person `ContactInteraction<channel>` rows for the resolved filter — see that module for the materialization flow.

## Gotchas

- `VoterDatabaseService` and `VotersService` look similar but query different sources: the former hits our Postgres, the latter hits L2's HTTP API. Pick deliberately.
- **The legacy webapp voter-records page is gone** (win-voter-data went 100% and was removed; `/dashboard/voter-records` redirects to `/dashboard/contacts`). Its endpoints (`wake-up`, `help-message`, `can-download`) were deleted with it. `GET /voters/voter-file` (counts + CSV via `VoterDatabaseService` → the `gp-voter-db` cluster) is still live: the outreach/task-flow audience download and count (`downloadVoterList.util.ts` / `RecordCount` in gp-webapp) remain its callers until ENG-5032 migrates them to people-api. Only then can `VoterFileService`'s query path, `typeToQuery`/`customFiltersToQuery`, `VoterDatabaseService`, and the `gp-voter-db` cluster itself be decommissioned.
- The L2 API has its own rate limits and timeouts; wrap new calls in `try/catch` and throw `BadGatewayException` per `.cursor/rules/rules.mdc` Rule 3.
- Counts surfaced to the UI come from L2 in real time and may shift between page loads — don't rely on them for billing or quota math.
- `VotersModule` imports `OutreachModule` (one-way). If you find yourself wanting `OutreachModule` to import voters too, route the dependency through an existing service instead — adding a back-edge will require `forwardRef` and is a smell.
- **The SMS/Peerly phone-list path no longer uses `customFiltersToQuery`/`typeToQuery`** (ENG-10728). `P2pPhoneListUploadService` (`src/vendors/peerly/services/p2pPhoneListUpload.service.ts`) now resolves the request through `ContactsService.findContactsForFilter` — the same activityConditions/supportStatus/search resolution engine list/count/download use — paged (`SEGMENT_PAGE_SIZE` 1000, 100k cap) with `hasCellPhone: true` forced, instead of the old hardcoded `CustomFilter` switch. `voterFile/util/voterFile.util.ts`'s `VoterFileType.sms` branch and `customFiltersToQuery` are unchanged and still reachable — they remain the code path for the general (non-Peerly) voter-file download/task-type export (`voterFile.service.ts`), which still only honors the subset of fields mapped there. `peerly/utils/audienceMapping.util.ts` is deleted; don't resurrect it for new Peerly filter mapping.
- **Every uploaded Peerly phone list is captured.** `PeerlyPhoneListCaptureService` (`src/vendors/peerly/services/peerlyPhoneListCapture.service.ts`, backed by `PeerlyPhoneList`/`PeerlyPhoneListRecipient`) writes one parent row (keyed by the Peerly upload token) plus one recipient row per CSV line — `(personId, phone)` — in a single transaction, only after the Peerly upload itself succeeds. The status endpoint (`GET /p2p/phone-list/:token/status`) stamps the resolved numeric Peerly list id onto the capture row the first time it sees the list ready (`peerlyListId`, guarded so a repeat poll can't clobber it) — that id equals `Outreach.phoneListId`, which downstream materialization/inbound-mapping tasks use to find the capture row.
