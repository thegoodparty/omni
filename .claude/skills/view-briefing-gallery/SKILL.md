---
name: view-briefing-gallery
description: Use when you want to visually review a cohort of meeting_briefing artifacts rendered in the real webapp UI — "pop the gallery", "view the briefings", "let me page through these briefings". Pulls artifact JSON from S3 into a local dev-only gallery at http://localhost:4000/dev/briefings that renders each briefing through the production briefing components with prev/next paging. Dev-only, read-only, no prod spend.
---

# Runbook: pop the local briefing gallery

Render a cohort of `meeting_briefing` artifacts in the **real** webapp briefing UI
(ExecutiveSummaryCard + AgendaItemCard) so a human can page through them for visual
QA. This is a dev-only local tool: it reads artifact JSON off S3 into a gitignored
dir and serves them from a `NODE_ENV=development`-gated route. No prod spend, no
writes.

## How it works

- **Canonical data dir**: omni repo-root `.local-briefings/` (gitignored), or
  `LOCAL_BRIEFINGS_DIR` (absolute path — can point at a scratchpad subdir). One file
  per briefing: `<runId>.json` = the raw artifact JSON. Data never lives under
  `packages/gp-webapp/`.
- **Route handler** `packages/gp-webapp/app/api/dev/briefings/route.ts` reads the dir
  and returns every `*.json`. 404s unless `NODE_ENV === 'development'`.
- **Gallery page** `packages/gp-webapp/app/dev/briefings/page.tsx` fetches that,
  renders the selected artifact through the production cards, prev/next paging.
- **Always pull the agent runs too.** Whenever you pull briefings for the gallery,
  the underlying agent runs MUST come with them: the pull script fetches each run's
  `logs/session.jsonl` / `logs/milestones.jsonl` beside the artifact, powering the
  "View agent run" page (`/dev/runs/<runId>`). Never pull artifacts through a path
  that skips the logs; if "View agent run" 404s for a run, re-pull that run id.
- **Pull script** `scripts/pull-local-briefings.sh` copies artifacts from
  `s3://gp-agent-artifacts-dev/<exp>/<runId>/artifact.json` into the dir.

## Prerequisites

- AWS access via SSO profile `gp-admin` (`aws --profile gp-admin sts get-caller-identity`;
  if it fails, the human runs `aws sso login --profile gp-admin`). Region us-west-2.
- The human must be **logged into their local dev webapp** — `/dev/briefings` is not a
  public route, so Clerk middleware redirects an unauthenticated browser to `/login`.
  (The render path itself needs no auth; annotations/feedback API calls 500 without a
  local gp-api and the briefing still renders fully — that's expected.)

## Steps

### 1. Resolve the cohort → run_ids

Accept any of:

- **Explicit run_ids** — a comma-separated list the human gives you.
- **A rounds file** — `scratchpad/opt-loop/rounds/<tag>.json` maps `cases.<case>.run_id`
  and carries `experiment_type`. This is the common case after an opt-loop cohort.
- **An experiment + time window** — list S3 under `s3://gp-agent-artifacts-dev/<exp>/`
  and pick run dirs by `LastModified`, then pass those ids.

### 2. Pull artifacts into the canonical dir

From the omni repo root (or a worktree root):

```bash
# From a rounds file (reads run_ids + experiment_type):
scripts/pull-local-briefings.sh --rounds scratchpad/opt-loop/rounds/r0-baseline.json

# From explicit run_ids:
scripts/pull-local-briefings.sh --exp meeting_briefing --run-ids ID1,ID2,ID3

# Into a scratchpad dir instead of repo-root .local-briefings/:
scripts/pull-local-briefings.sh --rounds ROUNDS.json --dir /abs/path/to/briefings
# (then start the webapp with LOCAL_BRIEFINGS_DIR=/abs/path/to/briefings)
```

Missing artifacts print `MISS <id>` and are skipped — the gallery just shows the rest.

### 3. Start the dev webapp (if not already running)

```bash
npm run dev -w packages/gp-webapp   # port 4000; next dev sets NODE_ENV=development
```

`npm run dev` points the app at a local gp-api (localhost:3000). It does not need to
be running — the briefings render without it.

### 4. Hand off the URL

Tell the human: **http://localhost:4000/dev/briefings** — page through with
Previous / Next. To swap the cohort, re-run the pull script (step 2) and reload; to
change which dir is served, set `LOCAL_BRIEFINGS_DIR` before `npm run dev`.

## Notes

- The gallery renders `briefing_ready` / `agenda_provided_by_user` artifacts best
  (they carry full `items` + `sources`). `awaiting_agenda` / `no_meeting_found`
  artifacts render thinly — that's fine, they're the miss channels.
- Nothing here is committed data: `.local-briefings/` is gitignored. Clear it out by
  deleting the dir contents.
