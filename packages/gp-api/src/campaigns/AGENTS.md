# Campaigns Module

The core domain entity. A `Campaign` is the per-candidate workspace that hangs off an `Organization` (1:1) and owns plans, tasks, positions, AI-generated content, TCR/SMS compliance, and update history. Most other modules (websites, voters, payments, outreach) reference a campaign as their unit of work.

This module is `@Global` — `CampaignsService` is available without re-importing.

## Key files

| Path                                       | Purpose                                                         |
| ------------------------------------------ | --------------------------------------------------------------- |
| `campaigns.module.ts`                      | `@Global()`, wires submodule services and re-exports            |
| `campaigns.controller.ts`                  | HTTP for campaigns + nested route groups under `/campaigns/*`   |
| `services/campaigns.service.ts`            | Core CRUD on `Campaign`, slug build, list/pagination            |
| `services/campaignPlanVersions.service.ts` | Append-only history of campaign plan JSON snapshots             |
| `services/crmCampaigns.service.ts`         | Sync staff-managed campaigns to/from HubSpot                    |
| `ai/`                                      | LLM-driven plan/copy generation (`campaignsAi.module.ts`)       |
| `tasks/`                                   | Weekly tasks digest; legacy `campaign_task` completion routes   |
| `tcrCompliance/`                           | TCR brand/campaign registration for Peerly SMS sending + the agentic `compliance_setup` flow (see `tcrCompliance/CLAUDE.md`) |
| `positions/`                               | Race positions a campaign is running for                        |
| `updateHistory/`                           | User-facing `CampaignUpdateHistory` (per-field audit log)       |
| `decorators/`                              | `@ReqCampaign()`, `@UseCampaign()` — load campaign onto request |
| `guards/`                                  | Campaign-scoped access guards                                   |
| `campaigns.types.ts`                       | `CampaignWith<...>` helpers for Prisma includes                 |

## Patterns

- **Sub-feature directories own their own controller/service/schemas** (`tasks/`, `tcrCompliance/`, `positions/`, `updateHistory/`). They are wired into `CampaignsModule`, not registered as separate Nest modules — keep them inside this module unless they grow third-party deps.
- **`@UseCampaign()` + `@ReqCampaign()`** is the standard way to scope a route to "the current user's campaign". Don't pull `campaignId` out of the body — read the campaign off the request.
- **Plan versions are append-only.** Treat `campaignPlanVersions` as event-sourced; never UPDATE an existing row, always INSERT a new version.
- **`Organization.overrideDistrictId` outranks the race's own district.** An override is set by staff precisely because the race matched the wrong district, so in `fetchLiveRaceTargetMetrics` every _district-derived_ field — `projectedTurnout`, `winNumber`, `voterContactGoal`, `registeredVoters`, `uniqueCellphones`, `uniqueLandlines`, and the four prediction bounds (`projectedTurnoutLower`/`Upper`, `winNumberLower`/`Upper`) — is recomputed from the override, or nulled where the override path has no equivalent even when `details.raceId` resolves a `/campaign-strategy-context` response. _Race-level_ fields (candidates, election dates, office name/level/type, seats, filing fee/office/requirements, milestones) still come from that response. When the override district can't produce a trustworthy electorate the method returns `null` — never the race district's numbers. Adding a field to `RaceTargetMetrics` means classifying it into one of those two buckets.
- The `Campaign.data`, `details`, and `aiContent` columns are `Json` with typed `.jsonTypes.d.ts` shadows. New fields belong in **proper columns**, not these blobs (Rule 25 in `.cursor/rules/rules.mdc`).
- **Never read-modify-write a `campaign` JSON column.** Reading the blob, spreading a patch over it in application memory and writing it back is a lost update that no isolation level fixes, because the read is a separate round trip — `Serializable` around the write alone buys nothing, and that is exactly how `details.subscriptionId` was dropped for paying customers. Every writer of these columns must either merge in the statement or hold the row lock across its own read:
  - **Single-key `details` writes go through `patchCampaignDetails`,** which issues one `UPDATE campaign SET details = details || $1::jsonb`. Concurrent patches of different keys cannot clobber each other. The invariant that every such write routes through that one method was established by commit `230e1dae2`; what it now guarantees is atomicity. `||` is a top-level merge (a nested object in the patch replaces rather than merges), and an explicit `null` writes JSON null, which `persistCampaignProCancellation` depends on. A campaign id that does not resolve is a `NotFoundException`; a `details` column that is not a JSON object stays a 500.
  - **`getStatus` stamps `data.lastVisited` with the same kind of single statement.** It runs on a `GET` the campaign UI polls several times a second, and it used to rebuild the whole `data` column from the row `UseCampaignGuard` read before the handler started — which both aborted concurrent saves and, in the other interleaving, silently overwrote them. Keep the `jsonb_typeof` `CASE`: a bare `jsonb ||` on a non-object column does not raise, it concatenates into an **array**.
  - **`updateJsonFields` is the multi-field path and still reads inside its transaction,** because `deepMerge`, its conditional key deletions, and the `resetStaleResults` / `ballotStatusChanged` flags it derives from the pre-write row have no single-statement jsonb equivalent. It takes `SELECT id FROM campaign WHERE id = $1 FOR UPDATE` **before** that read, at the default READ COMMITTED. Both halves are load-bearing: the lock makes a concurrent writer something to wait for rather than collide with, and READ COMMITTED's per-statement snapshot is what lets the read that follows see the committed result. Do not put `Serializable` back — under it the lock statement itself raises 40001 on a concurrently-updated row, which is the old failure one statement earlier. The `outerTx` path is unfixed for the same reason: its one caller owns a `Serializable` transaction.
- **`setIsPro`'s read-then-write is the remaining contended writer, and it is knowingly unfixed.** Its transition read and `isPro` flip serialize under `Serializable`, so a concurrent Pro upgrade gets P2034 rather than recomputing `becamePro=false` — the gate holds only because the failure is loud and Stripe redelivers into an already-Pro row (1 prod / ~679 dev in the 30 days to 2026-09-17, the dev figure inflated by the `test-set-pro` E2E route). It also stamps `details.isProUpdatedAt` through a second transaction **after** the flip has committed, so a failure between the two leaves a Pro campaign the CRM sync publishes with no `pro_upgrade_date`. Fixing it means the same row lock plus moving the stamp inside the flip's transaction; both were deferred because turning a loud failure Stripe retries into a silent no-op needs a change that can test that transition on its own.

## Gotchas

- Module is `@Global` — adding a service here exposes it app-wide. Don't re-export from another module.
- `WebsitesModule` uses `forwardRef(() => CampaignsModule)` to break a cycle (campaigns imports `WebsitesModule` directly). Adding new cross-edges risks a circular-import surprise; prefer routing the dependency through `payments` or `organizations` if possible.
- `organizationSlug` is the foreign key, not `organizationId`. Cascade-delete is on the slug.
- **`CampaignDetailsSchema` is an allowlist that _strips_, not rejects.** A `details.*` key that isn't declared there is dropped silently and the request still returns 200 — that is how `details.ballotStatus` was lost for three months after `.passthrough()` came off. Adding a details field means adding it to that schema in the same change; a new field should be a column instead (Rule 25).
- Several services here import from `@goodparty_org/contracts` (e.g. `CampaignLaunchStatus`). When changing those enums, follow `docs/contracts.md` — the SDK and `gp-admin` consume them.
