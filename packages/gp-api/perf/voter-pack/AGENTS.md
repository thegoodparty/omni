# voter-pack benchmark harness

Three standalone benchmarks behind
[`docs/perf/voter-pack-headroom.md`](../../docs/perf/voter-pack-headroom.md).
Unlike [`perf/people-db/`](../people-db/), these do **not** boot Nest and do not
touch the real people-db — they run against a synthetic local table, because the
question they answer is "what does this row shape cost to move", not "how fast is
production".

| file | answers |
| --- | --- |
| `gen-pack-table.mjs` | builds the synthetic `green."Voter"` / `green."DistrictVoter"` pair |
| `driverbench.ts` | Prisma vs `pg` vs `COPY TO STDOUT`, into the real `PackEncoder` |
| `clientbench.mjs` | `decodePack` / `filterEngine` / `buildColors` + compression |

## Run it

No VPN and no credentials — a throwaway local Postgres is the whole setup.

Both scripts default to `postgres://postgres:pw@localhost:5599/peopledb` and
take `PGURL` as an override, so the container can live anywhere.

```bash
docker run -d --name dkhpg -e POSTGRES_PASSWORD=pw -p 5599:5432 postgres:16
ROWS=700000 node perf/voter-pack/gen-pack-table.mjs   # → 601,820 mappable rows

npx esbuild perf/voter-pack/driverbench.ts --bundle --platform=node \
  --format=cjs --target=node22 --packages=external \
  --outfile=perf/voter-pack/driverbench.cjs

RUNS=4 node perf/voter-pack/driverbench.cjs a   # Prisma $queryRaw (production path)
RUNS=4 node perf/voter-pack/driverbench.cjs b   # pg + pg-cursor
RUNS=4 node perf/voter-pack/driverbench.cjs c   # pg rowMode:'array'
RUNS=4 node perf/voter-pack/driverbench.cjs d   # COPY TO STDOUT
RUNS=4 node perf/voter-pack/driverbench.cjs a-  # …and `-` suffixes discard rows
node perf/voter-pack/driverbench.cjs server     # server-side EXPLAIN ANALYZE ablations

node perf/voter-pack/clientbench.mjs
```

`esbuild` must emit **CJS**: the Prisma client `require`s Node built-ins at
runtime and an ESM bundle dies with `Dynamic require of "node:fs" is not
supported`. That is also why `driverbench.ts` ends in `void main()` rather than
a top-level `await`.

## Read the CPU column, not the wall clock

This is the one thing to get right. Wall clock on a shared machine is worthless
here — during the session that produced the document, the identical variant
measured 1,279 ms and 5,641 ms an hour apart, purely from other work on the
host, and an entire fetch-size sweep inverted its own ordering between runs.

CPU time (`process.cpuUsage()`, user + system) held to ~10% across load averages
from 5 to 20 and is what the bench reports first. It is also the quantity that
actually binds in production: the gp-api task is `cpu: '1024'` — one vCPU — so
"CPU microseconds per row" is the number that transfers, as a **ratio**. Absolute
times do not transfer; production measures ~4.7× this machine on the same phase.

If a result looks dramatic, check `uptime` before believing it.

## Each variant gets its own process

`main()` runs exactly one variant per invocation, and that is deliberate.
Running them in sequence in one process lets the heap and GC state from variant
A contaminate variant B — early runs of this harness "showed" that discarding
rows was slower than encoding them, which is impossible and was entirely
promotion pressure carried over from the previous variant.

The bench installs a `PerformanceObserver` on `gc` and prints pause count, total
and worst pause alongside each result. Those are the numbers to watch when
changing `FETCH_SIZE` (env var, default 50,000) or V8 flags.

## Known dead ends — do not re-derive these

Recorded so the next person does not spend an afternoon on them:

- **`FETCH_SIZE` does not matter.** 50k/20k/10k/5k all land within run-to-run
  noise at production row count. An earlier sweep showing a 31% win for 5k was
  measuring host contention.
- **`--max-semi-space-size=64` does not help.** 3× fewer scavenges, identical
  total GC time and CPU.
- **This harness does not reproduce production's GC stalls.** It sees ~596 ms of
  GC across 296 pauses at 601k rows; the production trace shows ~3.1 s
  concentrated in three fetches. The gap is the 1-vCPU container, not the
  workload, so do not use this harness to argue about GC in production.
  `--v8-pool-size=0` (+11% CPU) is the closest proxy it can offer.

## The synthetic table is shaped, not real

`gen-pack-table.mjs` matches the production projection's **column set and tuple
width** (412 bytes/row measured) and its household/dot clustering, so
driver-marshalling cost per row is comparable. It does **not** reproduce the
production access path: production joins `DistrictVoter` to a 218M-row
state-partitioned `Voter` via a nested loop of random index probes into a cold
multi-GB partition, and no local NVMe table with a warm page cache will imitate
that. **Never quote this harness on database time** — that is what
`EXPLAIN (ANALYZE, BUFFERS)` on the real mirror is for, and it needs the VPN.
