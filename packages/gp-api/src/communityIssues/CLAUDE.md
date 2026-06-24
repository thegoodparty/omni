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

## Test command

```bash
npx vitest run src/communityIssues/
```
