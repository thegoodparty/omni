---
name: view-issue-gallery
description: Use when you want to spot-check a cohort of community-issue artifacts (top_community_issues + trending_issues) locally — "pop the issue gallery", "view the issues", "let me eyeball these issue artifacts". Pulls artifact JSON from S3 into a local dev-only viewer at http://localhost:4000/dev/issues that renders ranked issues with category/priority chips, overview text, and sources. Dev-only, read-only, no prod spend.
---

# Runbook: pop the local issue gallery

Render a cohort of `top_community_issues` / `trending_issues` agent artifacts in a
local dev-only viewer so a human can spot-check them during community-issues cost
iteration — instead of reading raw artifact JSON. It reads artifact JSON off S3 into
a gitignored dir and serves it from a `NODE_ENV=development`-gated route. No prod
spend, no writes.

## How it works

- **Canonical data dir**: omni repo-root `.local-issues/` (gitignored), or
  `LOCAL_ISSUES_DIR` (absolute path — can point at a scratchpad subdir). One file
  per run: `<runId>.json` = the raw artifact JSON. Each artifact carries its own
  `list` (top_community | trending) and `organization_slug`, so the filename is just
  the run id. Data never lives under `packages/gp-webapp/`.
- **Route handler** `packages/gp-webapp/app/api/dev/issues/route.ts` reads the dir
  and returns every `*.json`. 404s unless `NODE_ENV === 'development'`.
- **Viewer page** `packages/gp-webapp/app/dev/issues/page.tsx` fetches that, shows a
  left list of artifacts (org slug + list type + run id + data_quality badge) and a
  detail pane of ranked issues.
- **Pull script** `scripts/pull-local-issues.sh` copies artifacts from
  `s3://gp-agent-artifacts-dev/{top_community_issues,trending_issues}/<runId>/artifact.json`
  into the dir.

## Prerequisites

- AWS access via SSO profile `work` (`aws --profile work sts get-caller-identity`; if
  it fails, the human runs `aws sso login --profile work`). Region us-west-2.
  Override the profile with `AWS_PROFILE`.
- The human must be **logged into their local dev webapp** — `/dev/issues` is not a
  public route, so Clerk middleware redirects an unauthenticated browser to `/login`.
  (The render path itself needs no auth or gp-api.)

## Steps

### 1. Pull artifacts into the canonical dir

From the omni repo root (or a worktree root):

```bash
# Latest N runs from each experiment (the common spot-check case):
scripts/pull-local-issues.sh --latest 10

# From explicit run_ids (tries both experiment prefixes):
scripts/pull-local-issues.sh --run-ids ID1,ID2,ID3

# Pin one experiment:
scripts/pull-local-issues.sh --run-ids ID1 --exp trending_issues

# From a rounds file (reads run_ids + experiment_type):
scripts/pull-local-issues.sh --rounds scratchpad/opt-loop/rounds/r0-baseline.json

# Into a scratchpad dir instead of repo-root .local-issues/:
scripts/pull-local-issues.sh --latest 10 --dir /abs/path/to/issues
# (then start the webapp with LOCAL_ISSUES_DIR=/abs/path/to/issues)
```

Missing artifacts print `MISS <id>` and are skipped — the viewer just shows the rest.

### 2. Start the dev webapp (if not already running)

```bash
npm run dev -w packages/gp-webapp   # port 4000; next dev sets NODE_ENV=development
```

`npm run dev` points the app at a local gp-api (localhost:3000). It does not need to
be running — the issue artifacts render without it.

### 3. Hand off the URL

Tell the human: **http://localhost:4000/dev/issues** — pick an artifact from the left
list. To swap the cohort, re-run the pull script (step 1) and reload; to change which
dir is served, set `LOCAL_ISSUES_DIR` before `npm run dev`.

## Always pull the agent runs too

Whenever you pull artifacts for this gallery, the underlying agent runs MUST come
with them: each run's `logs/session.jsonl` and `logs/milestones.jsonl` land beside
the artifact as `<runId>.session.jsonl` / `<runId>.milestones.jsonl`, powering the
"View agent run" page (`/dev/runs/<runId>`) the gallery links to. The pull script
fetches them automatically — never pull artifacts through some other path that
skips the logs, and if a run's "View agent run" 404s, re-run the pull script for
that run id. Spot-checking an artifact without being able to open its run is half
the tool.

## Notes

- The viewer renders the raw artifact `output_schema` (issues[].detail: sources,
  overview, history, quotes, research, legislation). `insufficient_signal` artifacts
  render thinly — that's expected, they're the miss channel.
- Nothing here is committed data: `.local-issues/` is gitignored. Clear it out by
  deleting the dir contents.
