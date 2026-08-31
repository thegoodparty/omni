# What is left in the voter pack, measured against production

A follow-on to [`voter-pack-profile.md`](./voter-pack-profile.md). That document
found and killed the quadratic keyset pagination; this one asks what accounts
for the **~23 s** the endpoint still takes for its worst real district, and what
would actually move it.

**Headline: the pack is no longer waiting on anything pathological — it is
paying full price for 611,000 rows, twice.** Half the request (11.4 s) is
Postgres materialising those rows; another 38% (8.8 s) is Prisma turning them
into JavaScript objects that exist only to be read once and discarded. The
client is **38 ms** and the network is **~0.5 s**; neither is worth a line of
work.

The single fact that matters more than the split: **the expensive 22.5 s
depends only on `districtId`.** The per-organization part of the pack is a
handful of knock bytes. One user rebuilt the identical 15.4 MB of Collin County
**19 times in 14 days**. Caching, not optimising, is the answer to "get this
under a few seconds".

And caching is cheaper than it looks, because **peopleDB is a monthly,
full-rebuild mirror of Databricks rather than a source of truth**. The data is
immutable between rebuilds and gp-api already observes the rebuild, so there is
no staleness policy to choose and nothing to invalidate incrementally — see
[option 1](#1-cache-the-pack-per-district--22-s-and-the-only-option-that-reaches-a-few-seconds).

---

## Contents

- [What was measured, and what could not be](#what-was-measured-and-what-could-not-be)
- [The production request, decomposed](#the-production-request-decomposed)
- [The client is not the problem](#the-client-is-not-the-problem)
- [The driver tax, measured](#the-driver-tax-measured)
- [Negative results](#negative-results)
- [Ranked options](#ranked-options)
- [Reproducing this](#reproducing-this)

---

## What was measured, and what could not be

**Measured directly against production:** the phase split below comes from a
real OpenTelemetry trace of a real Collin County request, decomposed span by
span. The request volume comes from Loki. These are not estimates.

**Measured locally, and extrapolated by ratio:** the driver comparison. A
synthetic table matching the production projection's column set and tuple width
(412 bytes/row, 601,820 mappable rows) stands in for the real district. Absolute
times do not transfer — the production task is one Fargate vCPU and this machine
is not — so every local number is reported as **CPU microseconds per row** and
applied to production only as a *ratio*. Wall clock was discarded entirely: this
machine was shared with other agents and ran at load average 117 for part of the
session, which moved the same measurement by 4×. CPU time did not move.

**Could not be measured:** `EXPLAIN (ANALYZE, BUFFERS)` and `pg_stat_statements`
against the production people-db. It is VPC-private and needs the VPN plus
credentials from SSM; this environment has neither (`aws sts get-caller-identity`
fails, no tunnel, no `PEOPLE_DATABASE_URL`). **The 116× claim from the previous
document is therefore still unverified against production**, and the 11.4 s of
Postgres time below is a black box — I know its size, not its shape. There is
also no continuous profiling: the `grafanacloud-profiles` datasource has no
`service_name` values, so Pyroscope cannot corroborate the GC reading.

---

## The production request, decomposed

Trace `dbbf18dbf2b0090888fe8f434c025e6c`, user `user_3CcsGZ3w0QHizU5UKvZyE9ZRDnM`,
`GET /v1/door-knocking/pack`, **23,026.8 ms**, status 200. The paired request
`b366ad4a…` measured 23,224 ms, so this is the stable shape and not an outlier.

The scan issues **13 cursor fetches** at `CURSOR_FETCH_SIZE = 50_000`. Twelve
are full; the thirteenth does 22% of a full fetch's database work, which puts
the district at **≈611,000 mappable rows**. That is consistent with the previous
document's independent estimate of 580k–680k (most likely ~630k) inverted from
the 16,010,618-byte pack constant.

At that document's measured 25.27 bytes per person, 611,000 rows implies a
**~15.4 MB** pack. Every pack size quoted below for Collin County is derived
that way rather than read off the wire: the `Request completed` log line records
`"bytes": null` for this route, because the response is a stream and Fastify
never sees a content length.

Every span nests cleanly, so the split is exactly additive:

| phase | ms | share |
| --- | ---: | ---: |
| pre-transaction setup (district resolve, 3 positions calls) | 56 | 0.2% |
| **Postgres executing `FETCH` (`prisma:engine:db_query`)** | **11,413** | **49.6%** |
| Prisma engine, Rust row conversion | 1,771 | 7.7% |
| Prisma engine, JSON serialization | 613 | 2.7% |
| **Prisma client JS — `JSON.parse` + object construction + GC** | **6,446** | **28.0%** |
| `encoder.add()` in the `onRows` gaps between fetches | 2,268 | 9.9% |
| commit + `toBuffer()` + socket write | 460 | 2.0% |
| **total** | **23,027** | |

Two things follow immediately.

**The driver tax is 8,830 ms — 38.3% of the request.** Rust conversion plus JSON
serialization plus JS parsing is work whose entire product is 611,000 short-lived
JS objects, each read once by `encoder.add()` and dropped. Nothing downstream
needs an object; the encoder wants seventeen bytes and three numbers per row.

**Transport is 460 ms, and that includes the final 15.4 MB `Buffer.alloc` and
copy.** Compression cannot help a number that small — see
[negative results](#negative-results).

### The three slow fetches

Ten of the thirteen fetches cost a very steady ~1,250 ms. Three do not:

| fetch | operation | engine query | of which db | client-side JS |
| --- | ---: | ---: | ---: | ---: |
| #1 | 1,634.7 | 1,034.2 | 855.1 | 600.6 |
| #3 | **2,741.5** | 1,007.1 | 795.0 | **1,734.4** |
| #7 | **2,718.5** | 2,418.0 | **2,219.5** | 300.5 |
| #10 | **2,647.3** | 1,016.0 | 800.0 | **1,631.3** |
| typical | 1,257 | 1,000 | 810 | ~255 |

Fetch #7 is a database excursion — its `db_query` alone tripled while the JS
side stayed normal. Fetches #3 and #10 are the opposite: the database was
perfectly normal and the *JavaScript* stalled for an extra ~1.4 s each. Against
a baseline of ~255 ms, fetches #1, #3 and #10 carry **~3.1 s of excess JS time**
between them, in a phase whose only job is parsing. That is the signature of
full mark-compact pauses, on a task that has one vCPU and therefore nowhere to
put concurrent marking.

I could not confirm this against production heap telemetry (no Pyroscope), and I
could not reproduce it locally either — see [negative
results](#negative-results). Treat the ~3.1 s as *attributed*, not measured.

---

## The client is not the problem

Benchmarked against a synthetic 620,000-person / 290,000-household /
220,000-dot pack of **15,942,764 bytes**, running the real `packDecoder.ts`,
`filterEngine.ts` and `VoterMapCanvas.tsx` code paths:

| step | best | median |
| --- | ---: | ---: |
| `decodePack` (mount typed-array views) | 0.0 ms | 0.0 ms |
| `runFilter` (1 active dim) | 4.5 ms | 6.6 ms |
| `canvassStatusCounts` (district-wide) | 3.9 ms | 4.3 ms |
| `buildColors` | 1.6 ms | 1.9 ms |
| `packOpeningCenter` | 27.9 ms | 29.2 ms |

**~38 ms in total.** `decodePack` rounds to zero because the format is already
right — it mounts views over the received `ArrayBuffer` and copies nothing. Even
at a 5× phone penalty this is under 200 ms.

**No client-side work is worth doing.** A decode worker would move 0 ms off the
main thread. This closes out the "move decode into a worker" question: there is
nothing to move.

---

## The driver tax, measured

Four ways of getting the same 601,820 rows of the production projection into the
same `PackEncoder`, each run in its own process (heap state from a previous run
contaminates the next), best CPU of 4:

| variant | CPU | µs/row | vs today |
| --- | ---: | ---: | ---: |
| **A** Prisma `$queryRaw` + encoder (today) | 2,337 ms | 3.88 | — |
| **B** `pg` + `pg-cursor` + encoder | 1,819 ms | 3.02 | **−22%** |
| **C** `pg` `rowMode:'array'` + encoder | 2,035 ms | 3.38 | −13% |
| **D** `COPY TO STDOUT` + encoder | **1,503 ms** | **2.50** | **−36%** |

B and C are within ~10% of each other and the ordering between them flipped
between runs at different scales; treat them as one option worth ~15–22%, not
two. D is the floor — it is what the work costs when nothing materialises a row
at all.

Applied as ratios to the 11,098 ms production spends on driver-plus-encoder:

- `pg` + `pg-cursor`: **≈2.5 s saved**
- `COPY TO STDOUT`: **≈4.0 s saved**

Production spends 18.2 µs/row on this phase against 3.88 µs/row locally — a 4.7×
penalty, which is the single Fargate vCPU, the GC stalls, and co-tenancy with
whatever else that task is serving.

The swap was unusually contained: the cursor scan had **exactly one production
caller** (the pack build), and `pg` and `pg-copy-streams` were already
dependencies.

---

## Negative results

Recorded because each closes a plausible line of attack.

**`CURSOR_FETCH_SIZE` does not matter.** At 601,820 rows: 50k → 2,409 ms CPU,
20k → 2,710, 10k → 2,625, 5k → 2,291. Non-monotone, an 18% spread, and every
variant's own four runs spanned more than that. An earlier sweep on a loaded
machine appeared to show a 31% win for smaller batches; that was contention, not
signal. **Leave the constant at 50,000.**

**`--max-semi-space-size=64` is not a win.** It cuts scavenge *count* by 3×
(296 → 94 pauses) and changes neither total GC time (596 → 511 ms) nor CPU
(3.88 → 3.81 µs/row). The allocation rate is the cost, not the pause frequency.

**Local GC does not reproduce the production stalls.** At production row count
this machine spends 596 ms in GC across 296 pauses, worst pause 8 ms. Production
shows ~3.1 s of excess concentrated in three fetches. The difference is the
container, not the workload, and it is why the 2-vCPU option below is an
estimate rather than a measurement.

**`--v8-pool-size=0` costs +11% CPU** (3.88 → 4.12 µs/row), with GC total rising
596 → 656 ms. This is the closest thing to direct evidence that a second vCPU
helps: denying V8 its helper threads — which is effectively what a 1-vCPU task
does — measurably costs real work.

**Compression is worth ~nothing here, and a lot on mobile.** On the 15.94 MB
pack: gzip-1 → 6.13 MB in 177 ms, gzip-6 → 5.22 MB in 988 ms, brotli-4 →
5.04 MB in 309 ms. Against a 460 ms transport tail on a desk connection, gzip-1
spends 177 ms of the one vCPU to save perhaps 300 ms of transfer — a wash. On a
canvasser's LTE link at 5 Mbps the same trade is 25 s → 8 s, which is enormous.
**Compression is a field-usability change, not a latency fix**, and it should be
argued on that basis.

---

## Ranked options

Savings are against the measured 23.0 s. "Measured" means from the trace or the
benchmark; "estimated" means reasoned from those numbers.

### 1. Cache the pack per district — **~22 s, and the only option that reaches "a few seconds"**

**Saving: ~22.5 s of 23.0 s (measured — it is everything except the 460 ms
tail). Cost: medium. Risk: low — invalidation, which looked like the hard part,
turns out to be a single event gp-api already receives.**

The structural finding: `DoorKnockingPackService.build()` resolves a
`districtId` and a per-organization `knockStatuses` array, and
`VoterPackService.build()` uses the district for a 611,000-row scan and the
statuses for a **single `u8` plane** (`canvassStatus`, one byte per person at a
manifest-declared offset). The 22.5 s is a pure function of `districtId` and the
voter mirror's contents. Everything organization-specific is one byte per knocked
person.

Loki says this is not hypothetical: over 14 days the Collin user issued **19**
completed pack requests, and every one rebuilt the same bytes. Total endpoint
volume is low (tens of requests), so this is a repeat-visit cache far more than a
cross-tenant one — which is exactly the reported complaint, since the client's
React Query cache (`staleTime: Infinity`, `gcTime: 10 min`) already covers
within-session reuse and nothing covers a reload.

Sketch: key on `districtId` + voter-mirror version. Store the encoded pack with
`canvassStatus` left zeroed, plus a sidecar of person ids in row order. Serve by
copying the cached buffer and writing one byte per knock at
`canvassStatusOffset + rowIndex`. That is O(knocks), not O(district).

Build it so the cached artifact **can be produced offline** — a loader step or a
scheduled job — rather than only memoised in-process on first request. The two
designs serve identically; the offline one additionally survives peopleDB's
retirement, because a pack that was built ahead of time does not care what it
was built from. See [option 4](#4-replace-prisma-with-pg-in-scanundercursor--25-s-contained)
for why that matters.

**On the staleness blocker.** `door-knocking.md` §"Why it is still built per
request" rejects caching partly because the L2-derived voter data has "no
revision handle exposed to gp-api — no mirror watermark, no refresh timestamp on
the read path", making any cache key a chosen staleness window rather than a
fact. **There is a handle, and it is better than the one I first proposed.**

> **Correction (2026-08-26).** An earlier revision of this section argued that
> `green."Voter"` and `green."DistrictVoter"` carry `updated_at`, so the blocker
> was "expose a cheap mirror watermark" — a small watermark table or a covering
> index, because `max(updated_at)` over 611k index entries is not free. **The
> columns exist but the reasoning was wrong.** The `gp-data-platform` mart
> header for `m_people_api__voter.sql` states that `created_at`/`updated_at`
> come from the L2 `loaded_at`, so the value is a **per-load constant, not a
> per-row change feed**. It cannot drive incremental invalidation, and no
> watermark table or covering index should be built for this.

The actual mechanism is simpler and costs nothing. **peopleDB is not a source of
truth — it is a monthly, full-rebuild mirror of Databricks.** The dbt mart
`m_people_api__voter.sql` builds the table, `people-api-loader` unloads it to S3
and COPYs it into a **brand-new Aurora cluster**, on an `@monthly` Airflow
schedule. Two consequences:

- **The data is immutable between rebuilds.** There is nothing to invalidate
  incrementally, because nothing changes incrementally.
- **The version handle is the cluster swap**, published as an SSM parameter
  update — and `PeopleDbUrlProvider` already polls that parameter every five
  minutes and fires `onChange()` only when the URL actually moves.
  `PeopleDbService` and `VoterDownloadService` are already subscribers, each
  swapping its client on the event. A cache invalidator is a third subscriber.

So the key is `(districtId, mirrorVersion)` where `mirrorVersion` is the
resolved connection string's cluster identity, and invalidation is wholesale on
`onChange()`. **No watermark table, no covering index, no scan, and no product
decision about how stale a map may be** — the mirror has exactly one version per
month and gp-api already observes the change without querying anything.

The other design question is **the sidecar**: the pack deliberately carries no
person identity on the wire, so the id→index map has to live server-side. 611k
UUIDs is ~10 MB packed binary; a sorted array with binary search per knock
avoids rebuilding a 611k-entry JS `Map` on every cache hit.

Also inherited from the older document, and still true: `generatedAt` in the
manifest changes on every build, so a cache has to stabilise it or no two
responses ever share an ETag.

This is not a small change and I did not build it. It is the recommendation.

### 2. Give the task a second vCPU — **one line, ~1–3 s, do this first regardless**

**Saving: 1–3 s (estimated). Cost: trivial — `cpu: '1024'` → `'2048'` in
`deploy/components/service.ts:236`. Risk: low. ~$58/month for two tasks.**

The prod task is 1 vCPU / 4 GB, `desiredCount: 2`. For ~11.6 s of this request
the task is CPU-saturated, and V8's concurrent marking, the Prisma engine's Rust
threads and the main JS thread are all contending for the same core. Denying V8
its helper threads locally costs a measured +11%, and the ~3.1 s of stalls in
fetches #1/#3/#10 is what that contention looks like at production scale.

There is a second reason that has nothing to do with this endpoint: **one Collin
County build occupies half the production fleet for 23 seconds.** With two tasks
and one core each, a single pack request is a availability problem for every
other caller on that task, which is a plausible contributor to the `list-detail`
504s seen over the same period.

I would ship this before anything else and re-read the trace, because it is
cheap, reversible, and it also sharpens every measurement above.

### 3. The household key — **~1–2 s, and far cheaper than recorded**

**Saving: ~1–2 s (estimated; the previous document's ~550 ms was measured
against the encoder alone). Cost: low — one column in the monthly rebuild.
Risk: low.**

> **Correction (2026-08-26).** Both this document and `door-knocking.md` costed
> this as "a migration on a 218M-row partitioned mirror" and "a decision about
> lock behaviour and rollout". **That is not what it is.** The mirror is rebuilt
> from scratch every month into a fresh Aurora cluster, and the loader
> **already** adds a `STORED GENERATED` column that does not exist in the mart —
> `Voter."geom"`, registered in `schema_spec.LOADER_ADDED_COLUMNS` so validation
> permits it. A precomputed household key is one more entry in that list, or one
> more column in `m_people_api__voter.sql`. No lock, no rollout risk, no live
> migration on a running table: it lands on the next monthly build.

The household key concatenates four address columns into a text key. It is
computed per row in the query, serialized, parsed back into a JS string
and hashed into a `Map` — 611,000 times. The previous estimate costed the
encoder-side `Map` work only; the full path is worth more than that, because
this string is also a large share of the ~193 bytes/row on the wire. The
rebuild is also the natural place to hand the encoder a genuinely **numeric**
household id, which is what it actually wants and which `hashtext`'s 32-bit
collisions currently block.

**Cheaper does not make it urgent.** It ranks here — above both driver swaps —
because it is the best ratio left once the cost is right: low risk, no live
migration, and unlike options 4 and 5 it is a change to the pipeline rather than
to Postgres-specific request code, so the store migration does not discard it.
It does **not** rank above option 1, because it only pays inside the live build
and caching deletes the live build.

The honest reading is that this is worth doing *with* option 1 rather than
instead of it: when the pack is built in the pipeline anyway, a precomputed
household key is nearly free there and it also lets the encoder index households
numerically. On its own, ahead of caching, it buys 1–2 s of a 23 s request.

### 4. Replace Prisma with `pg` in the cursor scan — **~2.5 s, contained**

**Saving: ~2.5 s (measured ratio, extrapolated). Cost: low-medium. Risk:
low-medium.**

One utility, one caller, one test file, and `pg` is already a dependency. The
argument is not that Prisma is slow in general but that this specific path asks
it to do something pointless: build 611,000 objects so that a loop can read each
one once. `pg` with `pg-cursor` skips the engine's JSON round-trip.

The wrinkle is connection management — Prisma owns the people-db URL and pool
today, so this introduces a second pool with its own limits, which is exactly
the sort of thing that causes a production incident on a busy day. Worth doing,
worth doing carefully, and worth doing *after* the cache, at which point it
optimises a cold path that runs on a schedule rather than in a request.

**There is a second, independent reason to sequence this last: it is
Postgres-specific work on a path that is written down as moving.**
`VoterPackService.build` is named in the [#1370](https://github.com/thegoodparty/omni/pull/1370)
PR body as one of the surfaces that must be ported before the Aurora cluster can
be retired, alongside `VoterDoorKnockingService` and `VoterDensityService`, and
nothing has started on it. A new `pg` pool and a hand-tuned cursor loop are
exactly the kind of asset that a store migration discards.

That does not mean the pack should be pointed at Databricks — the existing
`PeopleDbxStatementClient` is `INLINE`/`JSON_ARRAY`/string-typed and accumulates
the whole result in one array, which is the opposite shape to a 611k-row
streaming scan, and its own comments record a 10–20 s serverless resume on the
first read after an idle period. The house pattern for this already exists: the
voter-density heat map is computed as dbt marts in Databricks, H3-binned and
k-anonymised there, then loaded into Postgres and read as a plain indexed lookup
with "NO H3 math here". **Precompute in the warehouse, serve from something that
answers in milliseconds** — which is option 1 with the build moved into the
pipeline, and it is why option 1 is also the thing that unblocks the port.

### 5. `COPY TO STDOUT` — **~4.0 s, and I would not**

**Saving: ~4.0 s (measured ratio). Cost: high. Risk: high.**

Fastest thing measured (2.50 µs/row) because nothing materialises a row. It
also means hand-writing a COPY-text parser that has to get NULLs, quoting and
escaping exactly right for 17 encoded dimensions, forever. That is a permanent
correctness liability for 4 s that option 1 removes entirely.

### 6. Viewport / turf-scoped or progressive loading — **rejected on the measurement**

The map genuinely needs the whole district: `filterEngine.ts` aggregates
district-wide counts and `packOpeningCenter` needs every dot. Chunked delivery
would not reduce total work, only reveal it earlier, and it would require the
client to merge partial dot and household indices — significant work in
`app/dashboard/door-knocking/native/`, which two other agents are holding. With
the client at 38 ms and the server at 23 s, this is a large change to the
hardest-to-change layer for a perceived-latency win that option 1 makes moot.

### 7. `EXPLAIN (ANALYZE, BUFFERS)` on the real district — **not an optimisation, but the top follow-up**

The largest single line in the table is 11,413 ms of Postgres, and I know only
its size. The join is a nested loop doing one index probe per district member
into a state partition, and partition residency — not district size —
dominates: US Cong 29 CA (398k members) measured 18.7 s while Orange County FL
(898k members) measured 1.7 s.
Collin County is 611k members against the TX partition at ~18.7 µs/row, which
fits the random-probe story.

If that plan is what production is running, a hash join or bitmap heap scan may
be dramatically better for a district this large, and `cursor_tuple_fraction` is
currently tuned to encourage exactly the fast-first-row plan that produces
nested loops. **This is worth one VPN session with someone who has credentials**,
and it is the only remaining place where a large, cheap win could still be
hiding.

---
