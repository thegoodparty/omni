# scripts/perf/

Performance tooling wrappers. Convenience scripts behind the canonical commands in [`ai-rules/performance-tools.md`](../../ai-rules/performance-tools.md).

| Script                  | What it does                                                                                                                                             | Cookbook section |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `setup-check.sh`        | Audit the local env — what can/can't be measured right now                                                                                               | §11.6            |
| `bench-endpoint.sh`     | Single-endpoint HTTP load test (autocannon)                                                                                                              | §1               |
| `profile-cpu.sh`        | V8 CPU profile of any node command (writes `.cpuprofile`)                                                                                                | §3               |
| `explain.sh`            | `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` against the configured DB                                                                                          | §5               |
| `bench-people-query.sh` | Latency benchmark for the two heavy people-db voter-query classes (statewide filtered count + rare-pattern trigram name search), timed against baselines | §5               |

Every script supports `-h` / `--help` and prints its prerequisites at the top of the help block.

## Quick start

```bash
# What's available locally?
scripts/perf/setup-check.sh
```

If `setup-check.sh` is clean, the rest will work. If something is ✗, the script tells you the install command for your platform (or the no-install fallback).

## Prereqs

The scripts try hard not to require global installs:

- **autocannon / lighthouse / source-map-explorer** — `npx --yes <tool>` fallback is automatic when not installed globally. First `npx` run downloads; subsequent runs are warm.
- **psql** — when not on PATH but Postgres is in Docker, `docker exec <container> psql` is used automatically. Override the container name with `PG_DOCKER_CONTAINER=<name>`.
- **hyperfine** — no convenient `npx` equivalent; if you want statistical comparison runs, install it:
  ```bash
  brew install hyperfine        # mac
  cargo install hyperfine       # linux / cross-platform
  ```

For agents working in a fresh `git worktree`, also see `ai-rules/performance-tools.md` §11.6 — `.env` and the `ai-rules` submodule are common first-time stumbling blocks.

## Examples

```bash
# Quick health check load (defaults: 10 connections, 20s; npx fallback if no global)
scripts/perf/bench-endpoint.sh /health

# Heavier load, with auth, against a specific port
PORT=3001 scripts/perf/bench-endpoint.sh \
  -c 50 -d 60 \
  -H 'authorization: Bearer dev-token' \
  /v1/things

# Compare two branches end-to-end with hyperfine
hyperfine --warmup 1 --runs 5 \
  'git checkout main && scripts/perf/bench-endpoint.sh -c 10 -d 10 /v1/things | tail -1' \
  'git checkout my-branch && scripts/perf/bench-endpoint.sh -c 10 -d 10 /v1/things | tail -1'

# Profile a one-off node script (exits naturally)
scripts/perf/profile-cpu.sh -- node dist/scripts/some-job.js
scripts/perf/profile-cpu.sh -- tsx scripts/some-job.ts
scripts/perf/profile-cpu.sh -- npx tsx scripts/some-job.ts

# Profile a long-running server — note: npm/nest-start indirection is NOT supported.
# Profile the built JS directly:
scripts/perf/profile-cpu.sh -- node dist/main.js
# In another terminal: drive load through it, then ^C the server.
# Open the .cpuprofile in Chrome DevTools (Performance > Load profile)
# or run: npx flamebearer < profiles/CPU.*.cpuprofile

# EXPLAIN a slow query (auto-uses docker exec if host psql missing)
scripts/perf/explain.sh 'SELECT * FROM "User" WHERE "email" = '\''x@y.com'\'''
scripts/perf/explain.sh -f scripts/perf/slow.sql

# Benchmark the two heavy people-db voter-query classes (needs PEOPLE_DATABASE_URL
# pointed at people-db; refuses prod unless ALLOW_PROD=1). Reports median
# EXPLAIN ANALYZE time per case vs an initial baseline.
scripts/perf/bench-people-query.sh                     # both cases
scripts/perf/bench-people-query.sh statewide-phone-count
PLAN=1 RUNS=5 scripts/perf/bench-people-query.sh rare-name-trigram
```

## People-query benchmark (`bench-people-query.sh`)

Tracks the latency of the two voter-query classes that dominate the outreach
count / contacts-search paths, so regressions are visible:

- **`statewide-phone-count`** — a filtered `COUNT(*)` over the full FL Voter
  partition with a phone predicate (the query class behind
  `GET /voters/voter-file?countOnly=true&type=sms` (cell) / `type=robocall`
  (landline)). A full-partition `Seq Scan` is expected; baseline **~3500ms**.
  This is the honest count the removed 10k "fence" floor used to hide.
- **`rare-name-trigram`** — a rare last-name pattern (`LIKE '%zzq%'`, the query
  class behind `GET /v1/contacts?search=zzq`) wrapped in a `MATERIALIZED` CTE
  so it resolves off the `pg_trgm` GIN indexes instead of walking the ordering
  index across the partition; baseline **sub-second**. A multi-second number
  means the trigram plan regressed to a partition scan.

The SQL lives in [`people-queries/`](people-queries/) and mirrors what
`VoterQueryService` (`src/peopleDb/services/voterQuery.service.ts`) emits. The
script delegates execution to `explain.sh` (so it inherits the psql/docker
fallback and the `BEGIN; … ROLLBACK;` safety wrapper) but points it at
people-db via `PEOPLE_DATABASE_URL` instead of gp-api's `DATABASE_URL`.

Baselines are **initial, prod-derived** and marked to tune from production
telemetry — dev people-db often has only a partial FL partition, so absolute
numbers differ there; the harness still catches plan regressions. The
endpoint-level equivalents can also be load-tested with `bench-endpoint.sh`,
but those routes are auth- and campaign-gated (the place is fixed by the
campaign's district, not a query param), so they need a running server, an
auth token, and a FL-statewide campaign fixture.

See the cookbook for the full menu of tools (k6, microbenchmarks, Lighthouse, bundle analysis, GC tracing, heap profiles, production telemetry).

## Critic tie-in

Per the [performance critic rules](../../ai-rules/performance.md), any PR that claims a performance improvement should include before/after numbers from one of these tools (or production telemetry). Without a measurement, the change is a refactor.

When the critic itself is an agent with shell access, it should run `setup-check.sh` first, then use any GREEN tool it has the prerequisites for (see the readiness table in `performance-tools.md`). It should never fabricate measurements.
