# communityIssues

Serve-side community-issues feature. Ingests a ranked list of civic issues
from an AI experiment run, surfaces them to elected officials, and lets them
prioritize issues into their elected-office priority list.

This module is the consolidation of two earlier ones: the dead campaign-side
constituent-issue tracker (deleted, it had no consumers) and the Serve issue
feed that was briefly named with a "Feed" suffix to avoid the collision —
renamed onto this clean name once the dead module was removed.

## Key files

| File                                           | Purpose                                                        |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `communityIssues.module.ts`                    | NestJS module; exports nothing (consumers import the module)   |
| `controllers/communityIssues.controller.ts`    | HTTP routes under `/v1/community-issues`                       |
| `schemas/communityIssues.schema.ts`            | Zod DTOs and response schemas                                  |
| `services/communityIssue.service.ts`           | Root service; handles `onExperimentRunCompleted`               |
| `services/communityIssueUpsert.service.ts`     | Upsert logic for artifact rows                                 |
| `services/communityIssueRead.service.ts`       | Read queries (list, detail)                                    |
| `services/communityIssuePrioritize.service.ts` | Prioritize / de-prioritize an issue                            |
| `services/communityIssueDispatch.service.ts`   | Dispatch AI experiment runs per org slug (cohort + self-serve) |
| `services/communityIssueSeed.service.ts`       | Preview/dev-only deterministic seeding for e2e tests           |
| `communityIssueBucketing.ts`                   | FNV-1a bucket assignment (deterministic slug → list)           |
| `communityIssueArtifact.validation.ts`         | Zod validation for S3 artifact JSON                            |

## Prisma model

`CommunityIssue` — accessed via `this.client.communityIssue` / `tx.communityIssue`.
Enum types: `CommunityIssueList`, `CommunityIssueCategory`, `CommunityIssuePriority`.

Related fields on other models:

- `Priority.sourceCommunityIssueId` + `PrioritySource.community_issue`
- `MeetingBriefingItemLink.communityIssueId`

## HTTP routes

All routes under `@Controller('community-issues')` → `/v1/community-issues`.

- `POST /dispatch` — `AdminOrM2MGuard`; dispatches both experiment types for
  a list of org slugs (`dispatchForCohort`). Ops/cohort path.
- `POST /self-dispatch` — authenticated user; dispatches a single experiment
  type (`{ type }`) for the caller's own elected-office org
  (`dispatchSelfServe`). Staff-only: rejects with `403` unless the caller's
  email ends with `@goodparty.org`. Same serve-ICP + in-flight gating as the
  cohort path. Backs the staff-only buttons on the Serve Community Issues page.
- `POST /seed` — `@UseElectedOffice()`; deterministic test seeding for the
  caller's own org. Persists issues through the real `upsertFromArtifact` path
  (one COMPLETED `ExperimentRun` + artifact per list) plus optional related
  `MeetingBriefing` links — no S3 / SQS / agent run. **Disabled on qa/prod**
  (`OTEL_SERVICE_ENVIRONMENT`), so it's reachable only on local/test/preview/dev.
  Exists for the gp-webapp Community Issues e2e suite, which runs against the
  per-PR preview stack (and dev post-merge).
- `POST /dispatch-if-needed` — any authenticated user; self-serve landing
  catch-up (`dispatchIfNeeded`). Dispatches both experiment types for the
  caller's own org if ICP-eligible and not already in flight, skipping only
  the 90-day-inactivity gate (landing already proves activity). Distinct from
  `self-dispatch`, which is staff-only and single-type.

## Activity gate

`dispatchTypeForOrg` (shared by the cron and `dispatchIfNeeded`) checks
`metaData.lastVisited` on the org's user via a `skipActivityGate` option,
defaulting to `true` so `dispatchForCohort`/`dispatchSelfServe` keep their
existing unconditional-dispatch behavior. The cron (`dispatchSlice`) is the
only caller that passes `skipActivityGate: false` — if the user hasn't
opened the product in `INACTIVITY_THRESHOLD_DAYS` (90), it fires
`Community Issues - Dispatch Skipped` (feeds a HubSpot re-engagement email)
instead of dispatching. `dispatchIfNeeded` passes `skipActivityGate: true`
explicitly.

## Test command

```bash
npx vitest run src/communityIssues/
```
