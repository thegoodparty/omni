---
name: bulk-community-issues-cohort
description: Use when manually dispatching a cohort of community-issue agent jobs (top_community_issues + trending_issues) against prod via the AdminOrM2MGuard-protected endpoint POST /v1/community-issues/dispatch, monitoring them to completion, and producing the outcome/cost/runtime analysis and CSV export. Lower spend than briefings (~$1-2 per org pair of runs); requires gp-admin AWS access and this repo's packages/gp-api.
---

# Runbook: dispatch a cohort of community-issue jobs in prod and analyze them

> **HARD DEPENDENCY — DO NOT RUN UNTIL ALL THREE ARE TRUE:**
>
> 1. **PR #246** (the Community Issue feature, `community-issues-pr2` branch) is **merged and deployed to prod**.
> 2. The `top_community_issues` and `trending_issues` **runbooks are published to S3** in the PMF engine's runbook bucket.
> 3. The `POST /v1/community-issues/dispatch` endpoint is **live in prod with the serve-ICP gate present** — confirmed by the Prerequisites checks below (bad-token probe returns 401/403 not 404, and the gate commit is in master and deployed).
>
> Note: this dispatch path is **not** gated by a feature flag or by `MEETINGS_AUTOMATION_ENABLED` — it is an `AdminOrM2MGuard` (M2M) endpoint. `MEETINGS_AUTOMATION_ENABLED` gates only the daily crons / signup hook, and `serve-community-issues-v1` gates only the webapp nav item — so there is no flag to "enable" for a manual cohort.
>
> If any of these are false, abort and tell the human which precondition is not yet met. Do not attempt to dispatch.

You are running a one-shot bulk dispatch of community-issue agent jobs against
**prod**, using the serve-ICP gate (enforced server-side in `dispatchForCohort`),
then monitoring to completion and producing an outcome/cost/runtime analysis.

Each org in the cohort receives two dispatches: one `top_community_issues` run and
one `trending_issues` run. Both types are dispatched in a single HTTP call by
passing the full list of org slugs. The server skips non-ICP orgs and orgs that
already have an in-flight run (QUEUED/RUNNING/AWAITING_RESUME) for that type.
Terminal runs (COMPLETED/FAILED) are re-dispatchable — this endpoint is the
manual refresh path.

Community-issue runs are substantially cheaper than meeting briefings. Budget
accordingly: at roughly $1-2 per org pair of runs, a 100-org cohort costs ~$100-200.

Do the read-only pre-flight first, show the human the dry-run numbers, and get
an explicit go before the real dispatch.

## Prerequisites

- AWS access via SSO profile `gp-admin` (run `aws --profile gp-admin sts get-caller-identity` to confirm; if it fails, the human runs `aws sso login --profile gp-admin`).
- PR #246 merged and deployed to prod, **with the serve-ICP gate enforced**. Verify all three:
  1. **Route deployed** (no creds needed): `curl -s -o /dev/null -w "%{http_code}" -X POST https://gp-api.goodparty.org/v1/community-issues/dispatch -H "authorization: Bearer __bad__"` returns 401/403 (route exists), not 404 (not deployed).
  2. **ICP gate is in master**: `cd packages/gp-api && git log master --oneline -S isServeIcp -- src/communityIssues/services/communityIssueDispatch.service.ts` must show a commit. Abort if empty — a build before the gate would dispatch (and charge for) non-ICP orgs.
  3. **Prod is deployed at or past that commit** — confirm the deployed image SHA (ECS task definition tag / deploy log) is at or after the gate commit. Abort if behind.
- This repo's `packages/gp-api` on `develop` or `master` (the analysis tsx scripts will run here).
- The daily cron dispatches (`dispatchWeeklyTrendingIssues`, `dispatchMonthlyTopIssues`) are guarded by `MEETINGS_AUTOMATION_ENABLED=true`. Confirm no concurrent cron is running; a time window cleanly identifies your cohort.

## Secrets and where they live (you gather these, do not ask the human to set env)

- Prod DB password + prod Clerk keys: AWS Secrets Manager secret `GP_API_PROD`.
- Prod DB host: `gp-api-db-prod.cluster-cmb1uukjsfbe.us-west-2.rds.amazonaws.com`, db `gpdb`, user `gpuser`. Reachable directly (no tunnel).
- The M2M **caller** secret `GP_PROD_MACHINE_SECRET` is gp-admin's, NOT gp-api's. It lives in the `gp-admin-web` Vercel project (`prj_ZT7POAebSPy3jFf2u0xKIUZTQpcT`, production target). Pull it via the Vercel API using `VERCEL_TOKEN` + `VERCEL_TEAM_ID` from `GP_API_PROD`. Minting with gp-api's own `GP_WEBAPP_MACHINE_SECRET` fails with 401.
- Community-issue artifacts land in S3 bucket `gp-agent-artifacts-prod`, keys `top_community_issues/<runId>/artifact.json` and `trending_issues/<runId>/artifact.json`.

### Gotchas

- For the AWS **SDK** (used by the analysis tsx for S3), `unset AWS_PROFILE` after `eval "$(aws --profile gp-admin configure export-credentials --format env)"`, or the SDK tries to resolve the SSO profile in-process and fails. Also `export AWS_REGION=us-west-2`.
- Throwaway tsx analysis scripts must live INSIDE `packages/gp-api` (not `/tmp`) so `node_modules` resolves. Delete them after.
- The `PROD_DATABASE_URL` must be URL-encoded (password may contain special chars).

## Step 1: assemble env + non-destructive pre-flight probe ($0)

The probe mints the real M2M token and POSTs an **empty** slug list. `orgSlugs`
is validated server-side as 1–200 entries, so an empty list is **rejected at
validation with zero dispatch** — expect **HTTP 400**. A 400 confirms both that
the route is deployed and that the minted token authenticates (it reached body
validation past `AdminOrM2MGuard`). 404 = endpoint not deployed; 401/403 = the
minted token is bad (re-check the secrets). No run is ever dispatched.

```bash
cd packages/gp-api   # from the repo root
SECRET_JSON=$(aws --profile gp-admin secretsmanager get-secret-value --secret-id GP_API_PROD --query SecretString --output text)
read VTOKEN VTEAM < <(echo "$SECRET_JSON" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["VERCEL_TOKEN"],d["VERCEL_TEAM_ID"])')
PID=prj_ZT7POAebSPy3jFf2u0xKIUZTQpcT
ENVJSON=$(curl -s -H "Authorization: Bearer $VTOKEN" "https://api.vercel.com/v9/projects/$PID/env?teamId=$VTEAM")
getval(){ eid=$(echo "$ENVJSON"|python3 -c "import json,sys;d=json.load(sys.stdin);e=d.get('envs',d);print(next((x['id'] for x in e if x.get('key')=='$1' and 'production' in (x.get('target') or [])),''))"); curl -s -H "Authorization: Bearer $VTOKEN" "https://api.vercel.com/v9/projects/$PID/env/$eid?teamId=$VTEAM"|python3 -c 'import json,sys;print(json.load(sys.stdin).get("value","") or "")'; }
export GP_PROD_MACHINE_SECRET=$(getval GP_PROD_MACHINE_SECRET)
export CLERK_SECRET_KEY=$(getval CLERK_SECRET_KEY)
export CLERK_PUBLISHABLE_KEY=$(getval NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
export PROD_API_URL='https://gp-api.goodparty.org'
eval "$(echo "$SECRET_JSON" | python3 -c 'import json,sys,urllib.parse;d=json.load(sys.stdin);pw=urllib.parse.quote(d["DB_PASSWORD"],safe="");print(f"export PROD_DATABASE_URL=\"postgresql://gpuser:{pw}@gp-api-db-prod.cluster-cmb1uukjsfbe.us-west-2.rds.amazonaws.com:5432/gpdb\"")')"
TOKEN=$(npx tsx -e 'import{createClerkClient}from"@clerk/backend";(async()=>{const c=createClerkClient({secretKey:process.env.CLERK_SECRET_KEY,publishableKey:process.env.CLERK_PUBLISHABLE_KEY});const m=await c.m2m.createToken({machineSecretKey:process.env.GP_PROD_MACHINE_SECRET,secondsUntilExpiration:600});process.stdout.write(m.token||"")})().catch(e=>{console.error(e);process.exit(2)})')
curl -s -w "\nHTTP %{http_code}\n" -X POST "$PROD_API_URL/v1/community-issues/dispatch" \
  -H "content-type: application/json" -H "authorization: Bearer $TOKEN" \
  -d '{"orgSlugs":[]}'
# EXPECT: HTTP 400 — an empty orgSlugs list is rejected by the 1–200 validation,
# which confirms the route is deployed AND the token authenticates, with zero
# dispatch. Abort if 404 (endpoint not deployed) or 401/403 (bad token —
# re-check secrets). A 200 is unexpected (the endpoint should reject an empty
# list); investigate the deployed contract before proceeding.
```

## Step 2: assemble the cohort org list

The dispatch endpoint enforces the serve-ICP gate **server-side** (fail-closed via
`resolveServeContext`), so any non-ICP slugs you pass are harmlessly skipped and
counted in `skipped`. Note: `isServeIcp` is **not** a column on the gp-api
`Organization` model — it is derived from the org's election `position`
(`resolveServeContext` → `position.isServeIcp`), so you cannot filter on it in a
single Prisma query here. Source the serve population (orgs that have an elected
office) and let the server gate do the ICP filtering. (To pre-filter to ICP
client-side, source the ICP set from its system of record — the Databricks
`int__icp_offices` table — not a Prisma field.)

Query the elected-office org slugs:

```bash
# In the SAME shell (env still set from Step 1)
npx tsx -e '
import { PrismaClient } from "./src/generated/prisma"
const p = new PrismaClient({ datasourceUrl: process.env.PROD_DATABASE_URL })
;(async () => {
  const offices = await p.electedOffice.findMany({
    select: { organizationSlug: true },
    distinct: ["organizationSlug"],
    orderBy: { organizationSlug: "asc" },
  })
  console.log(JSON.stringify(offices.map(o => o.organizationSlug)))
  await p.$disconnect()
})()
'
# Save the output as ORG_SLUGS (a JSON array of strings). The server gate skips
# any non-serve-ICP slugs at dispatch (they show up in `skipped`).
```

Review the list with the human. Decide on a target cohort size. Smaller test runs
(20-50 orgs) are a good starting point before a full fleet dispatch.

If you want to exclude orgs that already have a COMPLETED run within the last N
days for either type, add a `NOT IN` subquery on `experiment_run` where
`experiment_type IN ('top_community_issues','trending_issues') AND status = 'COMPLETED'
AND created_at >= now() - interval 'N days'`. The endpoint re-dispatches them anyway,
but freshness filtering avoids unnecessary spend on recently-refreshed orgs.

## Step 3: dry-run summary (read-only), then get human go

Show the human: cohort size, expected dispatches (cohort \* 2 types), estimated
cost, any orgs with in-flight runs that will be skipped. Get an explicit go.

```bash
# In the SAME shell
COHORT='["org-slug-a","org-slug-b"]'  # replace with actual list
# Check in-flight counts for the cohort:
npx tsx -e '
import { PrismaClient } from "./src/generated/prisma"
const p = new PrismaClient({ datasourceUrl: process.env.PROD_DATABASE_URL })
const slugs: string[] = JSON.parse(process.env.COHORT || "[]")
;(async () => {
  const inFlight = await p.experimentRun.findMany({
    where: {
      organizationSlug: { in: slugs },
      experimentType: { in: ["top_community_issues","trending_issues"] },
      status: { in: ["QUEUED","RUNNING","AWAITING_RESUME"] },
    },
    select: { organizationSlug: true, experimentType: true, status: true, runId: true },
  })
  console.log("In-flight (will be skipped per type):", inFlight.length)
  if (inFlight.length) console.log(JSON.stringify(inFlight, null, 2))
  await p.$disconnect()
})()
' COHORT="$COHORT"
```

Report to the human:

- Cohort size: N orgs
- Max dispatches if no skips: N \* 2 = M (one per type per org)
- In-flight (server will skip): K
- Estimated cost: (M - K) \* ~$1.50 = ~$X (adjust estimate based on reference data)

Wait for explicit go.

## Step 4: real dispatch

Record the timestamp before dispatching — this defines the start of your cohort
window.

```bash
# In the SAME shell
DISPATCH_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "Dispatch start: $DISPATCH_START"

# Re-mint the token: the Step 1 token has a 10-min TTL and the Step 3 human
# review may have consumed it. A stale token would 401 the dispatch below.
TOKEN=$(npx tsx -e 'import{createClerkClient}from"@clerk/backend";(async()=>{const c=createClerkClient({secretKey:process.env.CLERK_SECRET_KEY,publishableKey:process.env.CLERK_PUBLISHABLE_KEY});const m=await c.m2m.createToken({machineSecretKey:process.env.GP_PROD_MACHINE_SECRET,secondsUntilExpiration:600});process.stdout.write(m.token||"")})().catch(e=>{console.error(e);process.exit(2)})')

curl -s -w "\nHTTP %{http_code}\n" -X POST "$PROD_API_URL/v1/community-issues/dispatch" \
  -H "content-type: application/json" -H "authorization: Bearer $TOKEN" \
  -d "{\"orgSlugs\":$COHORT}"
# EXPECT: HTTP 200 and body {"dispatched":<N>,"skipped":<K>}
DISPATCH_END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "Dispatch end: $DISPATCH_END"
```

Save `dispatched` and `skipped` counts. The server gate enforces serve-ICP and
skips orgs with in-flight runs; `dispatched` is per-type dispatch count
(max cohort_size \* 2).

Note: `TOKEN` has a 10-minute TTL. If re-minting is needed (e.g. for the analysis
step), repeat the `TOKEN=$(npx tsx ...)` mint from Step 1.

## Step 5: monitor to completion (once a minute until all terminal)

Community-issue runs are shorter than briefings. Expect ~5-10 min per run; the
45-min stale-run sweeper force-FAILs anything still RUNNING at that point.

Re-assemble `PROD_DATABASE_URL` and `COHORT` each call if the shell is new. Query
`experiment_run` for the cohort window and group by type + status:

```bash
SECRET_JSON=$(aws --profile gp-admin secretsmanager get-secret-value --secret-id GP_API_PROD --query SecretString --output text)
eval "$(echo "$SECRET_JSON"|python3 -c 'import json,sys,urllib.parse;d=json.load(sys.stdin);pw=urllib.parse.quote(d["DB_PASSWORD"],safe="");print(f"export PROD_DATABASE_URL=\"postgresql://gpuser:{pw}@gp-api-db-prod.cluster-cmb1uukjsfbe.us-west-2.rds.amazonaws.com:5432/gpdb\"")')"
START="$DISPATCH_START" END="$DISPATCH_END" COHORT="$COHORT" npx tsx -e '
import { PrismaClient } from "./src/generated/prisma"
const p = new PrismaClient({ datasourceUrl: process.env.PROD_DATABASE_URL })
const START = process.env.START, END = process.env.END
const slugs: string[] = JSON.parse(process.env.COHORT || "[]")
;(async () => {
  const w = {
    organizationSlug: { in: slugs },
    experimentType: { in: ["top_community_issues","trending_issues"] },
    createdAt: { gte: new Date(START), lte: new Date(END) },
  }
  const g = await p.experimentRun.groupBy({
    by: ["experimentType","status"],
    where: w,
    _count: { _all: true },
  })
  const agg = await p.experimentRun.aggregate({
    where: { ...w, status: "COMPLETED" },
    _avg: { durationSeconds: true },
    _sum: { costUsd: true },
  })
  console.log(new Date().toISOString())
  console.table(g.map(r => ({ type: r.experimentType, status: r.status, count: r._count._all })))
  console.log("COMPLETED avg dur:", agg._avg.durationSeconds, "s  total cost: $", agg._sum.costUsd)
  await p.$disconnect()
})()
'
```

Repeat ~60s apart. The run is **done** when COMPLETED + FAILED equals the
`dispatched` count from Step 4. On the last poll, also fetch FAILED `runId` + `error`.

The 45-min stale-run sweeper force-FAILs only **RUNNING** rows — not QUEUED or
AWAITING_RESUME. If after ~60 min any run is still QUEUED or AWAITING_RESUME it has
stalled with no automatic reclaim: stop polling, note those `runId`s from the table,
and treat them as failed for convergence — stop when
`COMPLETED + FAILED + stuck_non_terminal >= dispatched`, and carry the stuck runs
into Step 6 as failures.

## Step 6: analysis (run after all terminal)

Community-issue artifacts live in S3: `gp-agent-artifacts-prod/top_community_issues/<runId>/artifact.json`
and `gp-agent-artifacts-prod/trending_issues/<runId>/artifact.json`. Each artifact
contains the list of issues the agent produced for that org and type.

Write a tsx file INSIDE `packages/gp-api` (e.g. `./_tmp_issues_analysis.ts`), set
AWS SDK creds first, run, then `rm` it:

```bash
eval "$(aws --profile gp-admin configure export-credentials --format env)"; unset AWS_PROFILE; export AWS_REGION=us-west-2
# re-export PROD_DATABASE_URL as above
START="$DISPATCH_START" END="$DISPATCH_END" COHORT="$COHORT" npx tsx ./_tmp_issues_analysis.ts && rm ./_tmp_issues_analysis.ts
```

The script should:

1. `experimentRun.findMany` where `organizationSlug IN (the cohort slugs)`,
   `experimentType IN ('top_community_issues','trending_issues')`, and
   `createdAt` in [process.env.START, process.env.END] -> `runId`, `organizationSlug`,
   `experimentType`, `status`, `costUsd`, `durationSeconds`, `artifactBucket`,
   `artifactKey`, `error`.
2. For COMPLETED rows, `@aws-sdk/client-s3` GetObject on the artifact key, parse
   the issue list (count of issues returned, any validation errors).
3. Report, per type (top_community_issues / trending_issues) and per status
   (COMPLETED / FAILED): count, cost sum + avg, duration avg/min/max, avg issues
   per completed run.
4. Query `community_issue` rows upserted by the cohort runs (join via
   `lastRefreshedRunId IN (cohort runIds)`) to confirm persistence.
5. For FAILED: print `runId`, org, type, duration, full error. Note:
   `upstream stream ended unexpectedly` = transient (re-dispatchable);
   artifact-validation errors = agent-side issue, may recur.

## Step 7: CSV export

Emit `scripts/output/community_issues_cohort_<date>.csv` with columns:
`org_slug, experiment_type, run_id, status, cost_usd, duration_seconds, issue_count`.

- `org_slug` + `experiment_type`: from the `experimentRun` rows.
- `issue_count`: from the S3 artifact for COMPLETED runs; blank for FAILED.

## Reference expectations (first full-fleet run — update after the run)

No reference cohort exists yet (this runbook describes the first production run).
Once a cohort completes, record reference numbers here for future sanity-checking:
fleet size, outcome mix, cost/run, duration avg, failure rate, and failure error
breakdown. This section should be updated after every significant cohort run.
