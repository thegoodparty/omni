# people-db benchmark suite

In-process latency + load benchmarks for the gp-api `peopleDb` services
(`src/peopleDb/`). Boots a minimal Nest context against a chosen people-db and
drives the real service methods. Design: `docs/superpowers/specs/2026-07-31-people-db-benchmark-suite-design.md`.

## Run it

MUST run with the swc-node loader (the `perf:people-db` npm script does this).
`tsx` does NOT work: esbuild drops decorator metadata and Nest DI resolves to
`undefined`.

```bash
# On the VPN. Export the target people-db read-only URL first (SSM/Secrets
# Manager per the workspace CLAUDE.md). prod requires the VPN.
export PEOPLE_DATABASE_URL='<connection-string>'

npm run perf:people-db -- --mode=latency --env=dev    # the matrix, p50/p95
npm run perf:people-db -- --mode=load --env=dev        # concurrency sweep + gate
npm run perf:people-db -- --smoke --env=dev            # one case, boot check
```

Results print as a table and are written to `scripts/output/people-db-bench-<env>-<sha>-<mode>.json`.

`load` mode adds real pool contention; run against prod (`--env=prod`) only
off-peak. It exits non-zero if any scenario's error rate at the target
concurrency (50, the `connection_limit`) is above its budget.

## Add a benchmark when you add a query

If you add or change a query method on a `peopleDb` service, add or adjust a
case here so it stays covered:

1. New filter shape worth measuring -> add a `FilterVariant` in `filterVariants.ts`.
2. New query method -> add a `QueryType` and a branch in `harness.ts`'s `invoke`,
   then emit cases for it in `cases.ts` (`buildLatencyCases`).
3. New concurrency concern -> add a `LoadScenario` in `loadScenarios.ts`.
4. Re-pin cohorts if `checkDrift` warns (re-run the discovery SQL in the plan).

## Deliberately out of scope (future additions)

- `activity-condition` filtering: resolved gp-api-side into `idOverrides` /
  `contactsMadeIdOverrides` from contact-interaction rows; not a `PeopleFilters`
  field, so the pure harness cannot synthesize it.
- `id-set` (`filters.id`) and `groupByHousehold`: expressible but need a per-run
  setup step (sample real ids first); add as a separate axis when needed.
- CI wiring: prod people-db is VPC-private; the intended path is a scheduled
  in-VPC ECS task (see the design doc). The JSON artifact is shaped for it.
