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
| `services/affectedResidents.service.ts`        | Reads one issue's affected-residents list from S3              |
| `schemas/affectedResidents.schema.ts`          | Zod schema for an affected-residents list                      |

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
  email ends with `@goodparty.org`. Same in-flight gating as the cohort path. Backs the staff-only buttons on the Serve Community Issues page.
- `POST /seed` — `@UseElectedOffice()`; deterministic test seeding for the
  caller's own org. Persists issues through the real `upsertFromArtifact` path
  (one COMPLETED `ExperimentRun` + artifact per list) plus optional related
  `MeetingBriefing` links — no S3 / SQS / agent run. **Disabled on qa/prod**
  (`OTEL_SERVICE_ENVIRONMENT`), so it's reachable only on local/test/preview/dev.
  Exists for the gp-webapp Community Issues e2e suite, which runs against the
  per-PR preview stack (and dev post-merge).
- `POST /dispatch-if-needed` — any authenticated user; self-serve landing
  catch-up (`dispatchIfNeeded`). Dispatches both experiment types for the
  caller's own org if not already in flight, skipping the
  inactivity gate (landing already proves activity) but applying a freshness
  gate: a list whose last completed run is within `INACTIVITY_THRESHOLD_DAYS`
  is left alone. That window is intentionally the same constant the cron uses
  to stop dispatching for an inactive user, so an active user (kept fresh by
  the cron) never re-triggers on landing, and a returning user whose issues
  went stale while they were away regenerates immediately. Distinct from
  `self-dispatch`, which is staff-only and single-type.
- `GET /:id/affected-residents` — `@UseElectedOffice()`; the ranked,
  contactable residents most materially affected by that one issue. Returns
  `{ list: null }` both for an issue with no list and for an issue belonging to
  another office, so it cannot be used to probe another org's feed.

## Affected-residents lists

Individual-level L2 records, so this is restricted data on a different footing
from the rest of the module: the issue feed is agent-generated per org, these
lists come from the serve-lists runbook one at a time (an L2 scoring run, a
representation gate, a contact gate).

**They are not a committed asset, and must not become one.** A list in the repo
puts real names, street addresses and phone numbers into git history
permanently, and history is not practically reversible. They live in S3 at
`affected-residents/<communityIssueId>.json` in `AFFECTED_RESIDENTS_BUCKET`,
read through the same `S3Service.getFile` this module already uses for
experiment artifacts. The repo carries the schema, the route and a synthetic
fixture. An unset bucket serves no list rather than failing.

- **The issue lookup is the authorization.** `getForIssue` resolves the issue
  with `where { id, organizationSlug }` before it touches the bucket, so the
  S3 key is always built from an id already proven to belong to the caller and
  a caller-supplied string never reaches S3 on its own.
- **The payload is checked against the key it was found under.** A list whose
  `communityIssueId` or `organizationSlug` disagrees with the request is
  refused, because that means the wrong object is in the bucket and serving it
  would hand one officeholder another's constituents.
- **Factors are per-issue, and so are their keys.** The list declares its own
  factors; each resident's `factorScores` is keyed by those declarations and
  the schema rejects a resident scored on an undeclared factor or missing a
  declared one. A missing key is a build error; `null` is a measured absence.
  Do not reintroduce fixed columns — the first version hardcoded
  proximity/tenure/income and could not carry the second list at all.
- **A `null` factor score left both sides of the weighted average** rather than
  scoring zero. It is not a low score and must not render as one.
- **`confidence` is epistemic, not affectedness**, and stays out of the score.
  Some saved lists nevertheless folded it into their frozen ranking, which is
  why `rankingScore` exists alongside `affectednessScore` and why a list whose
  two differ has to explain itself in `rankingNote`.
- **Each entry carries its own `caveats` and the schema requires at least one.**
  A score never ships without the coverage caveats that qualify it. Most of one
  of these lists is scored with a factor dropped out, and a reader who does not
  know that will misread the ranking.
- **The cache is bounded on purpose.** Unbounded, a process that served every
  issue would hold every office's constituents in memory. Entries are immutable
  per run, so eviction only costs a re-fetch.

## Activity gate

`dispatchTypeForOrg` (shared by the cron and `dispatchIfNeeded`) checks
`metaData.lastVisited` on the org's user via a `skipActivityGate` option,
defaulting to `true` so `dispatchForCohort`/`dispatchSelfServe` keep their
existing unconditional-dispatch behavior. The cron (`dispatchSlice`) is the
only caller that passes `skipActivityGate: false` — if the user hasn't
opened the product in `INACTIVITY_THRESHOLD_DAYS` (30), it fires
`Community Issues - Top Issues Dispatch Skipped` or `Community Issues -
Trending Issues Dispatch Skipped` (per experiment type, feeds a HubSpot
re-engagement email) instead of dispatching. `dispatchIfNeeded` passes
`skipActivityGate: true`
explicitly. The gate itself (`isInactiveUser`, `INACTIVITY_THRESHOLD_DAYS`)
lives in `src/shared/util/userActivity.util.ts`, shared with
`meetingBriefings.service.ts` — the two domains use the same threshold and
comparison, just wired through different dispatch flows.

## Test command

```bash
npx vitest run src/communityIssues/
```
