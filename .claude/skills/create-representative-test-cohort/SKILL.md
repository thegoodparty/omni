---
name: create-representative-test-cohort
description: Use when you need a cohort of test users in dev that mirrors the current PRODUCTION user population's distribution across district size (total registered voters), for either the Win (candidate) or Serve (elected-official) product. Creates real dev users bound to real ICP offices (so downstream ICP-gated agent dispatch fires), and emits an org-slug manifest to hand off to a dispatch skill (e.g. bulk-community-issues-cohort). Analysis is Databricks-only; creation is headless (no Playwright). Does NOT dispatch — it stops at the manifest.
---

# Runbook: create a representative test-user cohort in dev

You are creating N dev test users whose distribution across district size mirrors
the current prod user population, each **bound to a real ICP office** so that
downstream ICP-gated dispatch (community issues, briefings) actually fires. This
skill **stops at a manifest of created org slugs** — dispatch is a separate skill.

The whole thing is two data sources, no AWS:

- **Databricks** for the prod distribution + the real office identities to mirror.
- **dev Clerk + gp-api-dev** for headless user creation (the e2e `.env` already
  holds dev Clerk keys).

## Step 0: ask the operator (do not assume)

1. **Product — Win or Serve?** This decides the population, the ICP flag, and the
   creation flow:
   - **Serve** (elected officials): population = `int__serve_district_resolution`
     where `is_active_serve_user AND icp_office_serve`; ICP flag
     `m_election_api__position.is_serve_icp`; bind via `positionId`.
   - **Win** (candidates): population = launched candidate campaigns; ICP flag
     `is_win_icp` / `icp_office_win`; creation picks a race by zip (no positionId
     bind). See "Win variant" below — the Serve path is the proven one.
2. **Cohort size** (default 25).
3. **Target env** (default `dev`; this skill is validated against dev only).
4. **Size tiers** (default total registered voters: `<10k`, `10k–50k`,
   `50k–100k`). The serve-ICP voter band caps at 100k, so a `>100k` tier is
   normally empty; include it only if the distribution shows offices there.

## Prerequisites

- Databricks CLI authenticated: `databricks auth describe` (host
  `dbc-3d8ca484-79f3.cloud.databricks.com`). See `docs/databricks.md`. Warehouse
  id `18583d8b081c6486`. Run SQL via
  `databricks api post /api/2.0/sql/statements --json '{"warehouse_id":"…","statement":"…","wait_timeout":"50s"}'`.
- `packages/gp-webapp/e2e-tests/.env` present with dev `CLERK_SECRET_KEY` /
  `CLERK_PUBLISHABLE_KEY` (dev uses the Clerk **test** instance, shared with
  local). `.env` is gitignored — if working in a worktree, copy it in from the
  main checkout.
- `createHeadlessTestUser` + `create-test-cohort.ts` in
  `packages/gp-webapp/e2e-tests/tests/utils/` (committed by this skill's PR).

## Step 1: prod distribution (Databricks)

Bucket the real prod population by voter count and confirm every office maps to an
election-api position with the product's ICP flag true. Serve example:

```sql
WITH pop AS (
  SELECT sdr.ballotready_position_id, io.voter_count, p.is_serve_icp
  FROM goodparty_data_catalog.dbt.int__serve_district_resolution sdr
  JOIN goodparty_data_catalog.dbt.int__icp_offices io
    ON sdr.ballotready_position_id = io.br_database_position_id
  JOIN goodparty_data_catalog.dbt.m_election_api__position p
    ON sdr.ballotready_position_id = p.br_database_id
  WHERE sdr.is_active_serve_user = true AND sdr.icp_office_serve = true
)
SELECT
  CASE WHEN voter_count < 10000 THEN '1:<10k'
       WHEN voter_count < 50000 THEN '2:10k-50k'
       WHEN voter_count < 100000 THEN '3:50k-100k'
       ELSE '4:>100k' END AS tier,
  COUNT(*) AS offices,
  SUM(CASE WHEN is_serve_icp = true THEN 1 ELSE 0 END) AS bindable
FROM pop GROUP BY 1 ORDER BY 1
```

Allocate N across tiers **proportionally with largest-remainder rounding** so the
allocation sums to exactly N. (Reference: 2026-06-25 serve run was 502/188/36 →
17/7/1 for N=25.) Show the operator the distribution + allocation.

## Step 2: select the offices to mirror (Databricks)

Per tier, draw the allocated count of real ICP offices (seeded `rand` for
reproducibility), returning the **election-api position id** (`m_election_api__position.id`)
— this is what binds the test office. Adjust the per-tier `rn<=` caps to the Step-1
allocation:

```sql
WITH pop AS (
  SELECT sdr.ballotready_position_id, io.voter_count, sdr.state,
         sdr.l2_district_type, p.id AS ea_position_id
  FROM goodparty_data_catalog.dbt.int__serve_district_resolution sdr
  JOIN goodparty_data_catalog.dbt.int__icp_offices io
    ON sdr.ballotready_position_id = io.br_database_position_id
  JOIN goodparty_data_catalog.dbt.m_election_api__position p
    ON sdr.ballotready_position_id = p.br_database_id
  WHERE sdr.is_active_serve_user = true AND sdr.icp_office_serve = true
    AND p.is_serve_icp = true AND p.id IS NOT NULL
),
tiered AS (
  SELECT *, CASE WHEN voter_count<10000 THEN 't1' WHEN voter_count<50000 THEN 't2'
                 ELSE 't3' END AS tier FROM pop
),
ranked AS (
  SELECT *, row_number() OVER (PARTITION BY tier ORDER BY rand(42)) AS rn FROM tiered
)
SELECT tier, ea_position_id, state, l2_district_type, voter_count FROM ranked
WHERE (tier='t1' AND rn<=17) OR (tier='t2' AND rn<=7) OR (tier='t3' AND rn<=1)
```

Optional safety check: for a sample of the chosen `ea_position_id`s, confirm dev
resolves them ICP-true (the prod mart writes to dev too, but verify):
`GET https://election-api-dev.goodparty.org/v1/positions/<id>?includeDistrict=true`
→ expect `isServeIcp: true`.

## Step 3: create the cohort (headless, dev)

Build a selection file from Step 2:

```json
{
  "product": "serve",
  "termStartDate": "2024-01-01",
  "termEndDate": "2027-12-31",
  "entries": [
    {
      "positionId": "<ea_position_id>",
      "tier": "t1",
      "voterCount": 1108,
      "state": "IL"
    }
  ]
}
```

Run the creator from `packages/gp-webapp/e2e-tests` against dev (use the repo's
`tsx` binary directly — `npx` chdir's to the wrong package root):

```bash
cd packages/gp-webapp/e2e-tests
API_BASE_URL=https://dev.goodparty.org \
  ../../../node_modules/.bin/tsx tests/utils/create-test-cohort.ts \
  --in <selection.json> --out <manifest.json>
```

It prints `created N/N` and the slug list, and writes the manifest
(`orgSlug, positionId, tier, voterCount, state, clerkUserId, userId, email`).
Each org slug is `eo-<electedOfficeId>`.

## Step 4: hand off

Output the manifest path + the JSON slug array. Stop here. To run agents over the
cohort, pass the slugs to a dispatch skill (`bulk-community-issues-cohort` with
`--env dev`).

## Testing the skill (job-free)

Creation never dispatches by itself unless the target env has
`MEETINGS_AUTOMATION_ENABLED=true` AND the office binds to a resolvable position.
To validate the skill without any agent spend:

- **Analysis steps** are read-only Databricks queries — run them and eyeball the
  distribution + selection.
- **Creation step**: run the creator with `--dry-run`. It creates the users +
  elected offices **unbound** (no position / no `customPositionName`). The signup
  dispatch (`onElectedOfficeCreated`) is not ICP-gated, but it still bails when
  `resolveServeContext` returns null — and for an unbound office both `state` and
  `positionName` are empty (organizations.service.ts), so it returns null. That
  null gates **both** the signup path and the ICP cohort path, so an unbound
  dry-run dispatches nothing in any env, including `MEETINGS_AUTOMATION_ENABLED=true`.
  This exercises the full pipeline (selection parse, Clerk user creation, EO
  creation, manifest, slug list, failure handling) at any N.
- **Binding fidelity** (the one thing `--dry-run` skips — the position bind) is
  cheap to spot-check on a single bound user: create one without `--dry-run`, then
  `GET election-api-dev /v1/positions/<id>?includeDistrict=true` and confirm
  `isServeIcp: true`, or read back the created org.
- The endpoint's `refresh.status` is **not** a "did it dispatch" signal: it returns
  `running` whenever there is no run at all (`latestRun ? map : 'running'`), so it
  cannot distinguish "queued/running" from "never dispatched". Only `completed` /
  `failed` are meaningful.

## Notes / gotchas

- **Cleanup window.** Created users are `@test.goodparty.org` and are swept by
  gp-api's `deleteTestUsers` (~24h). Dispatch promptly after creating.
- **Auto-dispatch on create.** Creating a **bound** elected office fires
  `onElectedOfficeCreated` → community-issue dispatch **iff
  `MEETINGS_AUTOMATION_ENABLED=true`**. That signup path is NOT ICP-gated, but it
  still requires a resolvable position (`resolveServeContext` non-null) — so an
  unbound office never dispatches (see Testing above), only a real bound one does.
  If you want a clean single dispatch window for bound creation, expect it may have
  already dispatched; the dispatch endpoint skips in-flight runs and re-dispatches
  terminal ones.
- **Binding mechanism.** `POST /v1/elected-office` with `ballotReadyPositionId`
  set to the **election-api position id** (no org context) stores it as
  `org.positionId`; `resolveServeContext` reads that position's `isServeIcp`.
- **Win variant (same shape, not yet exercised end-to-end).** Swap to
  `icp_office_win` / `is_win_icp`; source the population from launched candidate
  campaigns; create with `race: { zip, office }` entries instead of `positionId`
  (createHeadlessTestUser already supports the win path: campaign create + launch).
  Verify the campaign population join before the first win run.

```

```
