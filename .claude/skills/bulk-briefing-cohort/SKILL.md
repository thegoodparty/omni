---
name: bulk-briefing-cohort
description: Use when manually triggering a bulk run of meeting briefings — dispatching a cohort of meeting_briefing agent jobs against prod via the imminence-gated endpoint, monitoring them to completion, and producing the outcome/cost/runtime analysis and CSV export. Irreversible prod spend (~$6 per dispatched briefing); requires gp-admin AWS access and this repo's packages/gp-api.
---

# Runbook: dispatch a cohort of meeting_briefing jobs in prod and analyze them

You are running a one-shot bulk dispatch of `meeting_briefing` agent jobs against
**prod**, using the product's gate (serve-ICP, fail closed + 3-day imminence
window + future-briefing dedupe), then monitoring to completion and producing an
outcome/cost/runtime analysis. Target for this run: **200 dispatched briefings**.

The dispatch script enforces a fleet cap: at most **100 meeting_briefing agents
RUNNING at once** (`--max-in-flight`, default 100). For targets above the cap it
dispatches the first wave fast, then trickles the rest in as agents complete
(~15 min each), so a 200-target dispatch phase takes roughly 30-60 min, not ~5.
Do not "fix" the slowness by raising the cap or running a second copy.

This is an irreversible, money-spending prod action (about $6 per dispatched
briefing, so ~$1,200 at 200). Do the read-only pre-flight first, show the human
the dry-run numbers, and get an explicit go before the real dispatch.

## Prerequisites

- AWS access via SSO profile `gp-admin` (run `aws --profile gp-admin sts get-caller-identity` to confirm; if it fails, the human runs `aws sso login --profile gp-admin`).
- This repo's `packages/gp-api` on `main` (the script `scripts/dispatch-imminent-briefings.ts` and the `useImminenceGate` endpoint are merged). Verify the checked-out branch before running.
- **Prod gp-api must be running a build where `dispatchManual` enforces the serve-ICP gate under `useImminenceGate`** (the same fail-closed check the daily cron uses; landed 2026-06-11). The script has no client-side ICP filter — the server gate is the only enforcement, so if prod predates it the cohort WILL include non-ICP offices. Verify before dispatching: `cd packages/gp-api && git log main --oneline -S 'skipping gated manual dispatch' -- src/meetings/services/meetingBriefings.service.ts` must show a commit, and prod must be deployed at or past it. Abort and tell the human if not.
- `psql` not required; everything goes through `npx tsx`.
- **The daily meetings cron is ENABLED in prod as of 2026-07-15** (`MEETINGS_AUTOMATION_ENABLED=true`, `dispatchDailyBriefings` at `@Cron('0 7 * * *')` in `meetingBriefings.service.ts`). It writes `experimentType: meeting_briefing` rows to the same table your manual cohort does, so a bare `createdAt` time window can now pick up cron-dispatched runs too if your window overlaps 7am UTC. Prefer diffing against `records.push`'d `electedOfficeId`s from your own run's JSONL log over a pure time-window query, or run outside the cron's firing window.
- The cron path (`dispatchBriefingIfNeeded`) also applies a 30-day user-inactivity gate (`isInactiveUser` in `src/shared/util/userActivity.util.ts`) that **`dispatchManual` — the endpoint this script calls — does not enforce itself**. The script now replicates that gate client-side (filters the office pool before dispatching) so a manual run doesn't diverge from what the cron would actually do, but the underlying gap in `dispatchManual` is still open; don't assume the endpoint is gate-complete if you call it directly instead of through this script.

## Secrets and where they live (you gather these, do not ask the human to set env)

- Prod DB password + prod Clerk keys: AWS Secrets Manager secret `GP_API_PROD`.
- Prod DB host: `gp-api-db-prod.cluster-cmb1uukjsfbe.us-west-2.rds.amazonaws.com`, db `gpdb`, user `gpuser`. Reachable directly (no tunnel) as of 2026-06.
- The M2M **caller** secret `GP_PROD_MACHINE_SECRET` is gp-admin's, NOT gp-api's. It lives in the `gp-admin-web` Vercel project (`prj_ZT7POAebSPy3jFf2u0xKIUZTQpcT`, production target). Pull it via the Vercel API using `VERCEL_TOKEN` + `VERCEL_TEAM_ID` from `GP_API_PROD` (no `vercel login` needed). Minting with gp-api's own `GP_API_MACHINE_SECRET` fails with 401.
- Artifacts (schedule + briefing JSON) live in S3 bucket `gp-agent-artifacts-prod`, keys `meeting_briefing/<runId>/artifact.json` and the schedule equivalent.

### Gotchas

- For the AWS **SDK** (used by the analysis tsx for S3), `unset AWS_PROFILE` after `eval "$(aws --profile gp-admin configure export-credentials --format env)"`, or the SDK tries to resolve the SSO profile in-process and fails. Also `export AWS_REGION=us-west-2`.
- Throwaway tsx analysis scripts must live INSIDE `packages/gp-api` (not `/tmp`) so `node_modules` resolves. Delete them after.
- The dispatch script's `PROD_DATABASE_URL` must be URL-encoded (password may contain special chars).

## Step 1: assemble env + non-destructive pre-flight probe ($0)

The probe mints the token and POSTs a bogus office id with the gate on. New prod
code returns `201 {dispatched:false}` (no dispatch); old code 404s; bad auth 401/403.
This proves auth AND that prod is serving the gated endpoint, with zero spend.

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
curl -s -o /dev/stderr -w "HTTP %{http_code}\n" -X POST "$PROD_API_URL/v1/meetings/briefings/dispatch" -H "content-type: application/json" -H "authorization: Bearer $TOKEN" -d '{"electedOfficeId":"__probe__","kind":"briefing","useImminenceGate":true}'
# EXPECT: HTTP 201 and body {"dispatched":false,"kind":"briefing"}. Abort if 404 (old code) or 401/403 (bad auth).
```

## Step 2: dry run (read-only), then get human go

In the SAME shell (env does not persist across calls):

```bash
npx tsx scripts/dispatch-imminent-briefings.ts --dry-run --target=200
```

Show the human: total offices (~1,800), how many the local 30-day activity
gate skips, the resulting eligible pool, target 200, max cost (~$1,200). Note
offices already covered by a future briefing (e.g. the prior cohort's
`briefing_ready` ones) are skipped by the gate dedupe, and offices whose
position is not serve-ICP are skipped fail-closed server-side. Neither the
ICP status nor coverage dedupe is visible in the pool count (only the activity
gate is applied client-side) — until the Databricks `is_serve_icp` backfill is
broadly populated, expect far more gate-skips per dispatch than the reference
run, and possibly an unreachable target (the script just exhausts the pool and
reports fewer dispatched). Wait for explicit go.

## Step 3: real dispatch

```bash
echo y | npx tsx scripts/dispatch-imminent-briefings.ts --target=200
```

It walks the shuffled pool calling the gated endpoint until 200 briefings
dispatch (hard cap, no overshoot), logging one JSONL line per call to
`scripts/output/`.

The script also enforces the fleet cap itself: before each dispatch it checks
how many `meeting_briefing` runs are active in prod (RUNNING or
AWAITING_RESUME — paused runs respawn as new Fargate tasks, so they count; DB
count refreshed every 30s, plus the script's own un-reconciled dispatches
counted conservatively) and pauses while that is >= `--max-in-flight`
(default 100). Expect it to print
`throttled: N agents active >= 100 cap` lines and sit idle for stretches —
this is correct behavior, leave it running in the same shell (it re-mints its
Clerk token automatically if the run outlasts the 1h TTL). A 200-target run
takes ~30-60 min end to end.

SAVE the final summary JSON, especially `reconcile.runStart`
and `reconcile.runEnd` (UTC). Those two timestamps define your cohort.

## Step 4: monitor to completion (once a minute until all terminal)

Re-assemble `PROD_DATABASE_URL` each call. Query `experiment_run` for the cohort
window and group by status. meeting_briefing agents take ~15 min each and run
~1:1 as Fargate tasks in the `pmf-engine-prod` ECS cluster; the stale-run sweeper
force-FAILs anything still RUNNING at 45 min.

```bash
SECRET_JSON=$(aws --profile gp-admin secretsmanager get-secret-value --secret-id GP_API_PROD --query SecretString --output text)
eval "$(echo "$SECRET_JSON"|python3 -c 'import json,sys,urllib.parse;d=json.load(sys.stdin);pw=urllib.parse.quote(d["DB_PASSWORD"],safe="");print(f"export PROD_DATABASE_URL=\"postgresql://gpuser:{pw}@gp-api-db-prod.cluster-cmb1uukjsfbe.us-west-2.rds.amazonaws.com:5432/gpdb\"")')"
npx tsx -e '
import { PrismaClient } from "./src/generated/prisma"
const p=new PrismaClient({datasourceUrl:process.env.PROD_DATABASE_URL})
const START="<runStart>", END="<runEnd>"   // from the dispatch summary
;(async()=>{const w={experimentType:"meeting_briefing",createdAt:{gte:new Date(START),lte:new Date(END)}}
const g=await p.experimentRun.groupBy({by:["status"],where:w,_count:{_all:true}})
const c={RUNNING:0,COMPLETED:0,FAILED:0} as any; for(const r of g) c[r.status]=r._count._all
const agg=await p.experimentRun.aggregate({where:{...w,status:"COMPLETED"},_avg:{durationSeconds:true},_sum:{costUsd:true}})
console.log(new Date().toISOString(),c, "avgDur", agg._avg.durationSeconds, "cost", agg._sum.costUsd)
await p.$disconnect()})()'
```

Schedule a wakeup ~60s apart and repeat until COMPLETED+FAILED == 200. On the
last poll, also fetch FAILED `runId` + `error`.

## Step 5: analysis (run after all terminal)

Outcome breakdown lives in the S3 artifact (`briefing_status`), not the DB. Pull
the cohort runs, fetch each COMPLETED artifact, bucket by `briefing_status`
(`briefing_ready` = meeting found, `awaiting_agenda`, `no_meeting_found`), and
join cost/duration. Also count `meeting_resource_location` rows (type AGENDA,
linked by `experimentRunId`) and diagnose each FAILED run.

Write a tsx file INSIDE `packages/gp-api` (e.g. `./_tmp_cohort_analysis.ts`), set
AWS SDK creds first, run, then `rm` it:

```bash
eval "$(aws --profile gp-admin configure export-credentials --format env)"; unset AWS_PROFILE; export AWS_REGION=us-west-2
# re-export PROD_DATABASE_URL as above
npx tsx ./_tmp_cohort_analysis.ts && rm ./_tmp_cohort_analysis.ts
```

The script should:

1. `experimentRun.findMany` where type=meeting_briefing, createdAt in [runStart,runEnd] -> runId, organizationSlug, status, costUsd, durationSeconds, artifactBucket, artifactKey, error.
2. For COMPLETED rows, `@aws-sdk/client-s3` GetObject on `gp-agent-artifacts-prod/meeting_briefing/<runId>/artifact.json`, parse `briefing_status`.
3. Report, per bucket (briefing_ready / awaiting_agenda / no_meeting_found / FAILED): count, cost sum + avg, duration avg/min/max.
4. Count `meetingResourceLocation` rows where experimentRunId in the cohort (expect ~1 per COMPLETED run).
5. For FAILED: print runId, org, duration, full error. Note: `upstream stream ended unexpectedly` = transient (re-dispatchable); `Artifact rejected: Raw HTML not allowed` = validation, needs agent-side fix, may recur.

## Step 6: CSV export

Emit `scripts/output/meeting_briefing_cohort_<date>.csv` with columns:
`elected_office_id, meeting_briefing_id, run_id, org_slug, briefing_status`.

- `elected_office_id`: resolve via `electedOffice.findMany` where organizationSlug in the cohort slugs (covers all rows incl. failures).
- `meeting_briefing_id`: `meetingBriefing.findMany` where experimentRunId in cohort runIds (populated only for `briefing_ready`; blank otherwise, since only ready/user-provided statuses persist a MeetingBriefing row).

## Visual review (optional)

To eyeball briefings rendered in the real webapp UI, use the `view-briefing-gallery`
skill — it pulls `<runId>/artifact.json` into a local dev-only gallery at
`http://localhost:4000/dev/briefings`. Its pull helper defaults to the **dev** bucket;
for this prod cohort, copy the artifacts from `gp-agent-artifacts-prod` into
`.local-briefings/<runId>.json` yourself (or point `LOCAL_BRIEFINGS_DIR` at a dir you
populate).

## Reference numbers from the 2026-06-08 cohort of 100 (for sanity-checking yours)

- ~1,850 elected offices; ~1,612 have a real (found) schedule; cadence ~1.6 meetings/30d (mostly twice-monthly).
- Outcome mix of completed: ~51% briefing_ready, ~34% awaiting_agenda, ~15% no_meeting_found.
- ~96% success; ~$6/dispatched briefing actual (not the $3.90 code estimate); ~15 min avg runtime.
- 100 dispatches took 346 endpoint calls (the rest gate-skipped). For 200 expect to walk a larger slice of the pool, and note prior-cohort `briefing_ready` offices are deduped out.
- That cohort predates both the serve-ICP gating and the in-flight cap: expect a worse dispatched/calls ratio (server-side ICP skips) and a longer wall-clock dispatch phase (throttling) than those numbers suggest.
- That cohort also predates the client-side 30-day activity gate (added 2026-07-15): expect a smaller eligible pool up front than 1,800, on top of the ICP/coverage skips that happen per-call.
