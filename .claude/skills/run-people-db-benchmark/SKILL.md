---
name: run-people-db-benchmark
description: Use when running the people-db benchmark suite — "run the people-db benchmarks", "run the full benchmark suite", "benchmark the voter queries", "bench the candidate cluster", or when qualifying a new people-db cluster before promotion. Runs the latency matrix and/or the concurrency load sweep in packages/gp-api/perf/people-db against a chosen people-db, then ALWAYS publishes the generated fixed-format HTML page as a Claude artifact. Requires the VPN for prod.
---

# Runbook: run the people-db benchmark suite

Drives `packages/gp-api/perf/people-db` against a chosen people-db and publishes
the result as a Claude artifact. The suite boots a minimal Nest context and calls
the real `peopleDb` service methods, so it measures the production code path, not
a reimplementation of it.

Suite internals, cohort rationale, and how to add a case:
`packages/gp-api/perf/people-db/AGENTS.md`. Read it before changing anything
about _what_ is measured; this skill only covers _running_ it and reporting.

## The output contract — do not deviate

**Every run publishes the generated HTML as a Claude artifact.** The page is
produced by `perf/people-db/artifactHtml.ts` and written next to the JSON on
every run. It has a **fixed format**:

1. Provenance (mode, env, commit, recorded-at, cell count, id-set size + seed)
2. The results table (latency matrix, or the load concurrency sweep)
3. Failures
4. Cohorts / Query types / Filter variants — the description tables
5. "How to read this" — constant boilerplate

**Never hand-write prose into the artifact, and never add an analysis or
findings section to it.** Every word on the page is either fixed boilerplate in
`artifactHtml.ts` or a `description` string carried in the JSON. That is what
makes two runs comparable at a glance, and it is the whole point of the format.

If a run needs interpretation, put the interpretation in your chat reply to the
human, not on the page. If a description is wrong or missing, fix it at source
(`filterVariants.ts`, `cases.ts`'s `QUERY_DESCRIPTIONS`, or `cohorts.ts`) so
every future run inherits the fix.

## Steps

### 1. Pick the target and confirm it

Resolve the connection string from SSM (never hardcode it):

```bash
# live prod
aws ssm get-parameter --name people-db-connection-string-prod \
  --with-decryption --region us-west-2 --query Parameter.Value --output text

# a dated candidate cluster (qualifying a promotion)
aws ssm describe-parameters --region us-west-2 \
  --parameter-filters "Key=Name,Option=Contains,Values=people-db-connection-string" \
  --query "Parameters[].[Name,LastModifiedDate]" --output text | sort -k2
```

These clusters are VPC-private. **You must be on the GoodParty VPN.** A 5432
connection that times out while DNS still resolves means the tunnel is down, not
that credentials are wrong.

Echo the target host (never the password) back to the human before running, and
**confirm which cluster** when more than one plausible target exists — a dated
candidate cluster and live prod are very different runs.

### 2. Smoke first, always

```bash
cd packages/gp-api
export PEOPLE_DATABASE_URL='<from SSM>'
npm run perf:people-db -- --smoke --env=prod --store=postgres
```

One case, boots the Nest graph. If this fails on DI (`undefined` service), the
loader is wrong — the suite MUST run under `-r @swc-node/register`, which the
npm script does. `tsx` silently drops decorator metadata.

### 3. Latency, then load — never together

```bash
npm run perf:people-db -- --mode=latency --env=prod --store=postgres
npm run perf:people-db -- --mode=load --env=prod --store=postgres
```

`--store` picks the backing store for the run (`postgres`, the default, or
`databricks`) by setting `USE_DATABRICKS_PEOPLE_DB` before the Nest graph
boots. The cases and what they measure are identical either way — the
Databricks run needs the `DATABRICKS_*` credentials instead of
`PEOPLE_DATABASE_URL`, and no VPN. The store is part of the artifact filename
and its provenance table, so the two runs never overwrite each other.

Run them **sequentially**. Concurrently they contend for the same 50-connection
pool and neither number means anything.

Latency is ~75-100 min and read-only at concurrency 1. Run it in the background
and monitor for failing cells rather than polling.

**Load mode is the dangerous one.** It drives c=50 (the full
`connection_limit`). Against live prod it competes with real candidate traffic.
The suite's own guidance is off-peak only. Before running it against live prod:

- Check what the latency pass just found. If unfiltered aggregates are already
  failing at concurrency 1, c=50 has a real chance of _producing_ user-visible
  504s rather than measuring them. Say so and get an explicit decision.
- Prefer pointing load mode at an idle candidate cluster when one exists — same
  hardware class and data, zero user impact.

### 4. Publish the artifact

Each run prints both paths:

```
artifact: scripts/output/people-db-bench-<env>-<store>-<sha>-<mode>.json
artifact (html): scripts/output/people-db-bench-<env>-<store>-<sha>-<mode>.html
```

Publish the `.html` with the Artifact tool as-is. Do not edit it, do not
regenerate it by hand, do not add sections.

- `favicon`: keep it stable across runs so the human's tab stays recognizable.
- `description`: one factual sentence — mode, env, cluster, cell count.
- Updating an earlier run's page? Publish to a **new** artifact; runs are
  records and overwriting one loses the baseline you would compare against.

To re-render an older JSON after the renderer changes (no re-run needed):

```bash
npm run perf:people-db:html -- scripts/output/people-db-bench-prod-postgres-<sha>-latency.json
```

Older JSON predating a new variant renders fine — the matrix just has fewer
rows, while the description tables still document the full catalog.

### 5. Report to the human in chat

The artifact carries the numbers; your reply carries the reading. Lead with what
changed against the previous run, then anything at or past the 25s ceiling, then
the failures. Two habits matter:

- **Read the cold column first.** The loader cuts prod to a brand-new cluster
  with an empty buffer pool, so cold is the production shape.
- **Check the failure COUNT, not just the cold marker.** The console `done` line
  prints only cold + warm p50 and hides how many runs failed; a cell can read
  "cold ERR, warm fine" while having failed 7 of 8. The count is in the JSON and
  in the artifact's Failures table. Do not characterize a cell from the console
  line alone.

## Gotchas that have bitten

- `report.ts`'s `BAND_ORDER` and `VARIANT_ORDER` are hardcoded. A cohort or
  variant missing from them **runs and never prints** — the cells are silently
  dropped from the matrix. Add to both when you add either.
- Only the `:none` cell of each band gets a genuinely cold measurement. `none`
  is first in `FILTER_VARIANTS`, so it absorbs the band's whole cold-cache cost
  and every later cell in that row free-rides on the partition it warmed.
- `csv` sets `statement_timeout = 0`, so its cells are unbounded and never
  error. Do not read a fast-looking csv row as safe.
- The outreach variants need a sampled id set per cohort (`sampleIds` in
  `harness.ts`). That is setup, excluded from the timings, and seeded so the
  same ids come back every run.
