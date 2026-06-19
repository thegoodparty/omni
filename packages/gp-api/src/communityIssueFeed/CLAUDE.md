# Community Issue Feed Module

> **NAMING — do not confuse with `src/communityIssues/`**
>
> This module (`CommunityIssueFeed*` / `community_issue_feed` / `GET /v1/community-issue-feed`) is the **Serve-side, org-keyed, agent-generated** issue feed for elected officials.
>
> The **unrelated** existing module `src/communityIssues/` (`CommunityIssue` / `community_issue` / `/v1/community-issues`) is the **campaign-side** issue/position feature used during Win. They share no code, no DB tables, and no API routes. When a code path, schema, or test refers to "community issues" — look at the prefix (`Feed` vs. none) and the route prefix to know which module you are in.

Serves "Community Issues" for elected officials: agent-generated top-issues and trending-issues feeds, one feed per org, surfaced in the Serve dashboard.

## How It Works

```
ElectedOffice created
   │
   │  onElectedOfficeCreated (signup hook)
   ▼
ExperimentRunsService.dispatchRun({ type: 'top_community_issues' | 'trending_issues', ... })
   │                                          ▲
   │ (also daily crons at 08:00 / 09:00 UTC) │ same path
   ▼
SQS → Lambda → Fargate (PMF Engine runbook)
   │
   ▼  artifact upload to S3
QueueConsumerService.handleAgentExperimentResult
   │
   ▼  status = COMPLETED
CommunityIssueFeedService.onExperimentRunCompleted
   │
   ├─ fetch artifact from S3
   ├─ validate via communityIssueFeedArtifact.validation.ts
   └─ CommunityIssueFeedUpsertService.upsertFromArtifact
         │
         └─ $transaction: update known issues, create new ones,
            archive by omission (archivedAt = now)
```

The pipeline reuses the experiment-run infrastructure from `src/agentExperiments/`. This module is the consumer: it hooks into the queue-consumer result path via `onExperimentRunCompleted`.

## Files

| File / Dir                                         | Purpose                                                                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `communityIssueFeed.module.ts`                     | Nest module — imports AgentExperimentsModule, AwsModule, CronModule, ElectedOfficeModule, OrganizationsModule                                                        |
| `communityIssueFeedArtifact.validation.ts`         | Zod schema for the S3 artifact shape; validates list, org, issues (max 10), and source-id refs in detail                                                             |
| `communityIssueFeedBucketing.ts`                   | FNV-1a 32-bit hash → deterministic bucket assignment; used by crons to spread dispatches across days                                                                 |
| `services/communityIssueFeed.service.ts`           | Main hook — `onExperimentRunCompleted`: filters experiment type, fetches + validates artifact, calls upsert                                                          |
| `services/communityIssueFeedUpsert.service.ts`     | Upserts issues from a validated artifact; update-or-create by `existing_issue_id`, archive by omission, inside `$transaction`                                        |
| `services/communityIssueFeedDispatch.service.ts`   | Signup hook + admin/ops cohort dispatch + two daily crons (trending 08:00 / top 09:00 UTC) with `CronLock`                                                           |
| `services/communityIssueFeedRead.service.ts`       | `listForOrg` and `getDetailForOrg`; joins priority state and related meeting-briefing links                                                                          |
| `services/communityIssueFeedPrioritize.service.ts` | `prioritize`: creates a `Priority` row from an issue; idempotent on unique-constraint conflict                                                                       |
| `controllers/communityIssueFeed.controller.ts`     | Routes: `GET /v1/community-issue-feed`, `GET /v1/community-issue-feed/:id`, `POST /v1/community-issue-feed/:id/prioritize`, `POST /v1/community-issue-feed/dispatch` |
| `schemas/communityIssueFeed.schema.ts`             | Zod DTOs and response schemas for the controller                                                                                                                     |

## Cron bucketing

`dispatchWeeklyTrendingIssues` (`@Cron('0 8 * * *')`) and `dispatchMonthlyTopIssues` (`@Cron('0 9 * * *')`) use `bucketForSlug(slug, mod)` to slice the org fleet:

- **trending:** `bucketForSlug(slug, 7) === today.getUTCDay()` — 1/7 of orgs per day
- **top:** `bucketForSlug(slug, 28) === Math.min(today.getUTCDate(), 28) - 1` — 1/28 per day

Both crons are guarded by `CronLockService.tryClaimDailyRun` (distributed lock) and a `DISPATCH_CAP_PER_TICK = 200` truncation guard. Both are no-ops unless `MEETINGS_AUTOMATION_ENABLED=true`.

## MCP exposure

`GET /v1/community-issue-feed` is decorated with `@McpTool` — it is callable from the MCP interface. `GET /v1/community-issue-feed/:id` and the prioritize endpoint are controller-only.

`POST /v1/community-issue-feed/dispatch` requires `AdminOrM2MGuard` (staff / M2M callers only).

## Data model

`CommunityIssueFeed` (see `prisma/schema/communityIssueFeed.prisma`):

- `organizationSlug`, `list` (top_community | trending), `category`, `priority`, `title`, `summary`, `rank`, `detail` (JSONB), `archivedAt`, `lastRefreshedRunId`
- `@@unique([organizationSlug, list, title])` (composite dedup key)

## Testing

```bash
npx vitest run src/communityIssueFeed/
```

Includes: artifact validation unit tests, bucketing unit tests, upsert service tests, endpoints (API-layer) tests.

## Environment variables

- `MEETINGS_AUTOMATION_ENABLED` — set `true` to enable cron dispatches and the signup hook
- `AGENT_DISPATCH_QUEUE_NAME` — inherited from `agentExperiments` (see that module's CLAUDE.md)
