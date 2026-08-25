# Where the door-knocking voter pack spends its time

A measured profile of `VoterPackService.build()` — the work behind
`GET /v1/door-knocking/pack`. Written to answer one question: of the 12.7–43.5 s
this endpoint takes in production, which parts are worth attacking?

**Headline: it is not the encoder, and it is not the driver. It is Postgres,
and specifically it is the keyset pagination.** The 50,000-row batching loop in
`voterPack.service.ts` makes Postgres touch **107 GB of buffers and read 11.5 GB
from storage to produce a 16 MB response**. Replacing the thirteen paginated
statements with one unordered statement streamed through a server-side cursor
cuts blocks touched by **116×** and measured wall clock by **2.4–2.8×**, with no
change to the wire format, the manifest contract, or the client decoder.

Everything below is measured on a synthesised dataset. [How the dataset was
generated](#the-dataset) and [what I am unsure
about](#confidence-and-what-would-change-these-numbers) are stated explicitly,
because every number here is conditional on that dataset resembling the live
district.

---

## Contents

- [What the pack actually is](#what-the-pack-actually-is)
- [Method and environment](#method-and-environment)
- [The dataset](#the-dataset)
- [The phase split](#the-phase-split)
- [Resource characterisation](#resource-characterisation-compute-allocation-or-io)
- [Why production is 12.7–43.5 s when this machine is 6 s](#why-production-is-127435s-when-this-machine-is-6s)
- [Candidates, measured](#candidates-measured)
- [Ranked recommendations](#ranked-recommendations)
- [Wire-format impact](#wire-format-impact)
- [Confidence and what would change these numbers](#confidence-and-what-would-change-these-numbers)
- [Reproducing this](#reproducing-this)

---

## What the pack actually is

The buffer layout in `packEncoder.utils.ts` gives an exact size formula. With
`P` people, `H` households, `D` dots and 17 dimension planes:

```
bytes = dataStart + 8D + 4P + 4H + 17P
```

Measured against a real build of my dataset (628,003 people): `dataStart` is
3,092 bytes, the manifest JSON is 3,087 bytes, and the formula reproduces the
byte count exactly. That works out to **25.27 bytes per person** once household
and dot overhead is included — not 21.

Solving for the production district's constant **16,010,618 bytes**:

| assumption | H/P | D/P | implied people |
| --- | --- | --- | --- |
| sparse / rural (every household its own rooftop point) | 0.550 | 0.550 | 579,983 |
| my dataset's ratios | 0.467 | 0.299 | **633,695** |
| dense / urban (large apartment share) | 0.420 | 0.100 | 681,752 |

So the live district holds roughly **580,000–680,000 people, most likely about
630,000** — about 25% more than the half-million the back-of-envelope
suggested. The exact figure depends on the district's household and
multi-unit-building structure, which I cannot observe from here. A
`SELECT counts FROM manifest` on a real pack would settle it in one request.

---

## Method and environment

Everything ran on Apple M5 Max (18 cores), 36 GB RAM, macOS 25.6.0 (darwin
arm64), Node 22.12.0. Postgres 16.14 (aarch64) in Docker. The harness imports
the **production** `PackEncoder`, `buildVoterWhereSql` and
`buildHouseholdKeySql`, so the SQL text and the encoding work are identical to
what the service does — only the transport plumbing around them varies between
candidates.

**This is macOS, so there is no `perf stat`.** I used, in its place:

- `--cpu-prof` (200 µs sampling interval) for self-time by named function
- `--heap-prof` for allocation attribution — see the caveat below
- `--trace-gc` plus a `PerformanceObserver` on `gc` entries for pause counts,
  pause totals and young-generation reclaim volume
- `/usr/bin/time -l` for instructions retired, cycles, IPC, hard page faults and
  minor page reclaims — this is the closest macOS equivalent to `perf stat`
- Postgres's own `EXPLAIN (ANALYZE, BUFFERS)` with `track_io_timing=on` for
  server-side execution time, buffer hits, physical reads and I/O wait

The `--heap-prof` sampling profiler was **not useful here** and I am not quoting
it: even at a 32 KB sampling interval it attributed only ~10 MB, essentially all
of it to module loading, because the allocations that matter are short-lived and
the profiler retains live-object attribution. The GC trace's young-generation
reclaim volume is the allocation-volume number I use instead.

Two Postgres configurations, because the difference between them turned out to
be the whole story:

- **Config W** ("warm"): `shared_buffers=2GB`, container memory unconstrained.
  The entire table stays resident. This is the flattering configuration.
- **Config P** ("production-like"): `shared_buffers=256MB`, container capped at
  1 GB. The district cannot stay resident, which is the production condition.

**Unless a table says otherwise, numbers are Config P.** Timings are best-of-3
after a discarded JIT-warming pass; server-side ablations are best/median-of-5.

---

## The dataset

There is no production-sized people-db locally, so I synthesised one.
`packages/gp-api/.perf/gen.mjs` (not committed — it is a throwaway harness)
generates it deterministically from a seeded xorshift PRNG.

**Shape:**

- **730,376 `green."Voter"` rows**, of which **628,003 pass the `MAPPABLE_ONLY`
  gate**. The 14% that fail are split 75/25 between a non-rooftop
  `LatLongAccuracy` code and rooftop rows carrying unparseable lat/lng text —
  the second kind matters, because it is what makes the regex predicates load
  bearing for the `::float8` casts.
- **113 columns**, matching `Voter.prisma`'s real width, with 87 filler text
  columns at realistic null rates. Average heap tuple **546 bytes**, table
  **401 MB**, total relation **459 MB**. This matters: the pack query projects
  20 columns but the scan still fetches whole tuples, and tuple width is what
  sets the pages-per-row ratio that drives the whole finding.
- **`green."DistrictVoter"`** 1:1 with the voter rows, one district. Tested both
  with a `(State, voter_id)` index and with only the `@@id([districtId,
  voterId])` primary key the Prisma schema declares — **the plan and the block
  counts are identical either way**, so the central finding does not depend on
  an index I invented.

**Cardinality and null rates**, chosen from what the codebase already
documents plus standard L2 append coverage:

- `Parties_Description` uses the exact proportions recorded in
  `politicalParty.rules.ts` from the Databricks GROUP BY (Democratic 37.9%,
  Republican 31.9%, Non-Partisan 27.7%, American Independent 0.52%, Registered
  Independent 0.49%, Declined to State 0.17%), plus a minor-party long tail, and
  null for most unregistered rows.
- Every mapped dimension uses the **exact raw spellings** `VALUE_MAPPERS`
  inverts (`'Probable Home Owner'`, `'Attended But Did Not Complete College
  Likely'`, `'Likely African-American'`, …). String *lengths* are the point:
  they set both wire bytes and JS string-allocation cost, so getting the
  vocabulary literally right matters more than getting the proportions exactly
  right.
- Consumer-append null rates: marital 35%, education 40%, income 30%, ethnicity
  15%, homeowner 25%, children 45%, veteran 92%, business owner 95%, language
  20%. Registered 88%; cell phone 45%; landline 18%.
- Geography: households drawn from buildings, 6% of which are multi-unit
  averaging ~10.5 units sharing one rooftop coordinate (so ~39% of household
  keys sit in a shared-coordinate building). Household size distribution means
  **2.03 mappable people per household key**.

**Calibration check:** the resulting pack is **15,866,823 bytes** against
production's **16,010,618** — within **0.9%**. That is the strongest evidence I
have that the dataset resembles the district in the dimensions that drive cost:
row count, household clustering and coordinate clustering all had to be roughly
right simultaneously to land that close.

**What it does not capture** is listed under
[confidence](#confidence-and-what-would-change-these-numbers).

---

## The phase split

Baseline = the production path: keyset pagination, Prisma `$queryRaw`, the
production `PackEncoder`. Wall clock best-of-3 under Config P: **5,573 ms**. The
CPU-profiled run below took 6,570 ms (profiling overhead), and percentages are
of that run.

| phase | ms | % of wall clock |
| --- | ---: | ---: |
| **Blocked on the people-db socket (`(idle)`)** | **4,744** | **72.2%** |
| `PackEncoder` (all of it) | 848 | 12.9% |
| Prisma JS materialization | 609 | 9.3% |
| Garbage collection | 198 | 3.0% |
| V8, Node core, module loading | ~171 | 2.6% |
| `toBuffer` (final buffer serialization) | 2.3 | **0.04%** |

Named functions, self time:

| function | ms | % | what it is |
| --- | ---: | ---: | --- |
| `(idle)` | 4,744 | 72.2% | waiting on Postgres |
| `PackEncoder.add` | 696 | 10.6% | the per-row encode loop |
| `Xn` (Prisma raw-result row assembler) | 371 | 5.6% | builds one JS object per row |
| `parseEngineResponse` | 228 | 3.5% | `JSON.parse` of the query engine's response |
| mapped-dim `encode` closures (10 sites) | 126 | 1.9% | the `rawToByte.get()` lookups |
| `(garbage collector)` | 198 | 3.0% | |
| `classifyPoliticalParty` | 24 | 0.4% | |
| **`GrowableU8.push`** | **2** | **0.03%** | ~10.7 M calls |

The same run under node-postgres on the single-pass shape, where **all** driver
parsing happens on the main thread and is therefore fully visible to the
profiler (3,512 ms total):

| function | ms | % |
| --- | ---: | ---: |
| `(idle)` | 1,898 | 54.0% |
| `PackEncoder.add` | 337 | 9.6% |
| `Buffer.slice` + `utf8Slice` — **string materialization** | 339 | 9.7% |
| pg-protocol `parseRow` / `parseDataRowMessage` / `_handleDataRow` / `parseInteger` | 307 | 8.7% |
| `(garbage collector)` | 182 | 5.2% |

### On the driver-allocation hypothesis

The working hypothesis was that the dominant cost is allocation and GC in the
driver — roughly ten million string allocations per request. **The allocation
count is right; the cost attribution is not.**

The allocations are real: the GC trace shows **~789 MB of young-generation
churn** to produce a 16 MB pack. But V8's scavenger absorbs that in **187 ms
across 90 collections (86 scavenges, 4 major)** — `--trace-gc` reports
`average mu = 0.996`, i.e. the mutator gets 99.6% of the time. And the visible
cost of actually creating those strings, in the node-postgres path where nothing
is hidden behind a Rust thread, is **339 ms of `utf8Slice` and `Buffer.slice`,
9.7%**.

Adding it up: **driver parse + string materialization + GC is ~20% of the
single-pass run and ~12% of the baseline.** Real, worth something, but not the
thing.

The obvious objection is that Prisma's library engine does its protocol work on
a Rust thread that the JS profiler cannot see, so some of that 72% "idle" could
be hidden Rust work rather than genuine socket wait. Two measurements say it is
not:

1. **node-postgres — a pure-JS driver with no hidden thread — is only ~7%
   faster than Prisma on the identical statement** (query phase 3,237 ms vs
   3,474 ms, Config W). If the Rust engine were burning seconds invisibly, a
   driver that does all the same work in profiler-visible JS would be
   dramatically faster. It is not.
2. **Postgres's own `EXPLAIN ANALYZE` accounts for the time independently.**
   Server-side execution alone is 2.8–5.4 s depending on cache state, which
   covers the idle window without needing any hidden client-side work to
   explain it.

`parseEngineResponse` doing a literal `JSON.parse` does confirm the engine
serialises the whole result set to a JSON string and JS parses it back — the
mechanism the hypothesis described is exactly as ugly as suspected. It just
costs 228 ms.

---

## Resource characterisation: compute, allocation, or IO?

`/usr/bin/time -l`, whole process, one build:

| | keyset (production shape) | single pass |
| --- | ---: | ---: |
| wall clock | 8.82 s | 2.81 s |
| CPU (user + sys) | 3.80 s | 2.55 s |
| **off-CPU share of wall clock** | **57%** | 9% |
| instructions retired | 44.59 G | 31.93 G |
| cycles elapsed | 15.02 G | 10.27 G |
| **IPC** | **2.97** | **3.11** |
| hard page faults | 369 | 16 |
| minor page reclaims | 82,601 | 51,215 |
| max RSS | 676 MB | 553 MB |

Read together with the GC numbers, this is unambiguous:

- **Not allocation-bound.** GC is 3.0% of wall clock with `mu = 0.996`. Nothing
  is waiting on the allocator.
- **Not memory-stalled.** IPC of ~3.0 is high — the code that runs, runs
  efficiently. 369 hard page faults across the whole process means the Node side
  never touches storage.
- **The in-process work is efficient compute**, and there is not much of it: the
  process is off-CPU for 57% of the baseline's wall clock.
- **It is IO-bound, on the Postgres side of the socket.** Under Config P with a
  cold buffer pool, **89% of Postgres's own execution time is `I/O Read Time`**
  (4,805 ms of 5,389 ms).

RSS deserves one note: the process peaks at **676 MB to emit a 16 MB
response**, and the single-shot (non-cursor) variant holds **416 MB of live JS
heap** at once because every row object is simultaneously live. Streaming
through a server-side cursor brings peak RSS down to 380–450 MB. That is a
capacity argument for cursoring, independent of latency.

---

## Why production is 12.7–43.5 s when this machine is 6 s

The keyset loop's query plan is the answer.

```
Limit
  Merge Join
    Index Scan on Voter using Voter_pkey
       Index Cond: (State = 'OH' AND id > <cursor>)
       Filter: lat/lng regexes AND LatLongAccuracy = 'GeoMatchRooftop'
    Index Scan on DistrictVoter using DistrictVoter_pkey
       Index Cond: (district_id = <district> AND voter_id IS NOT NULL)
```

**The cursor predicate reaches the `Voter` side of the merge join and not the
`DistrictVoter` side.** Nothing restricts the inner scan, so every batch
re-walks `DistrictVoter` from the start of the district to reach its merge
position. Measured rows scanned on the DV side: batch 0 → 58,147; batch 6 →
407,019. Blocks per batch climb monotonically:

| batch | 0 | 3 | 6 | 9 | 10 |
| --- | ---: | ---: | ---: | ---: | ---: |
| blocks touched | 351,303 | 878,205 | 1,405,845 | 1,934,229 | 2,108,733 |

**The pass is quadratic in district size.** This is the mechanism behind
"widening the flag to a bigger district makes it worse in proportion" — except
it is worse than proportional.

The totals, Config P, cold buffer pool, same 628,003 rows either way:

| | keyset (13 statements) | single pass (1 statement) | ratio |
| --- | ---: | ---: | ---: |
| blocks touched | 14,058,235 | 120,976 | **116×** |
| bytes touched | **107.3 GB** | 0.92 GB | |
| blocks physically read | 1,471,988 | 120,976 | 12.2× |
| **bytes read from storage** | **11.5 GB** | 945 MB | |
| Postgres `I/O Read Time` | 4,805 ms | 1,452 ms | 3.3× |
| Postgres `Execution Time` | 5,389 ms | 2,072 ms | 2.6× |
| I/O share of execution | 89% | 70% | |

**The endpoint reads 11.5 GB from storage to return 16 MB.** That is a 718×
read amplification, and it is the finding that explains the production numbers
in a way the client-side profile cannot.

On this machine those 1.47 M reads cost 3.3 µs each, because they are served by
a local NVMe and the Docker VM's page cache. On production storage — network
attached, whatever the people-db actually sits on — a random 8 KB read is
plausibly 50 µs to 1 ms. At 50 µs, 1.47 M reads is **74 s**. At 20 µs it is
**29 s**. The observed 12.7–43.5 s band sits inside that range, and the ~15%
timeout rate is what you get when the district's residency in the buffer pool
varies between requests: cached, you land at the fast end; evicted, you blow
through the 120 s ceiling. The single-pass shape reads 945 MB instead, and reads
it **sequentially**, which is the access pattern network storage is least bad at.

**This is checkable in production without deploying anything:**
`pg_stat_statements.shared_blks_read` for this query text should show reads on
the order of 10⁶ per call. If it does not, my model is wrong and this report's
ranking should be revisited.

### Where the remaining Postgres time goes

Server-side ablation on the single-pass shape (median of 5, Config P). Ablations
do not compose linearly — removing one thing changes the plan — so read these as
attributions, not a partition:

| variant | median exec | attributed to |
| --- | ---: | --- |
| full production projection | 1,435 ms | — |
| minus the household key | 885 ms | **`CONCAT_WS`/`UPPER`/`TRIM` ≈ 550 ms (38%)** |
| minus the two `~` regex predicates | — | **≈ 442 ms** (measured against the no-cast variant) |
| minus the `::float8` casts | 1,514 ms | ~0 — within noise |
| minus the 16 raw text columns | 1,606 ms | ~0 server-side |
| id only (scan + join + filter floor) | 870 ms | — |
| no `DistrictVoter` join | 1,210 ms | join ≈ 225 ms |

Two things worth noticing. **The household key is the single most expensive
expression in the query — more than the join.** And **the 16 text columns cost
nothing on the server**; their entire cost is wire bytes and driver parsing,
which is precisely why pushing bucketing into SQL does not pay (below).

---

## Candidates, measured

End to end, Config P, same 628,003 rows, same pack contents. Warm is best-of-3;
cold restarts Postgres before each run and is a single sample, so treat cold as
corroboration rather than precision. (Row E's cold figure is visibly noise — it
runs the identical statement to D.)

| | candidate | warm total | cold total | speedup (warm) | payload |
| --- | --- | ---: | ---: | ---: | ---: |
| **A** | keyset + Prisma + production encoder (**today**) | 6,072 ms | 6,126 ms | 1.00× | 15.13 MB |
| **B** | single pass + `pg` cursor + production encoder | 2,144 ms | 2,542 ms | **2.83×** | 15.13 MB |
| **C** | single pass + `pg` cursor + faster encoder | **1,864 ms** | 2,280 ms | **3.26×** | 15.13 MB |
| **D** | C + bucketing pushed into SQL | 2,178 ms | 2,307 ms | 2.79× | 15.13 MB |
| **E** | D + bit-packed planes | 2,160 ms | — | 2.81× | **7.72 MB** |
| **F** | keyset + `pg` + faster encoder (encoder fix alone) | 4,371 ms | 5,358 ms | 1.39× | 15.13 MB |

And the encoder in isolation — 628,003 rows pre-materialized into a JS array, no
Postgres in the loop, best of 5:

| variant | ms | payload |
| --- | ---: | ---: |
| production encoder (`add` + `toBuffer`) | 573 | 15,866,823 |
| `add()` only, no `toBuffer` | 583 | — |
| presized planes, string keys unchanged | 532 | — |
| presized + quantised numeric dot key | 276 | 15,866,467 |
| presized + numeric dot **and** household keys | **192** | 15,866,467 |
| bit-packed planes (37 bits/person) | 276 | **8,094,940** |
| *keys only*: `` `${lat}\|${lng}` `` + household map | 382 | — |
| *keys only*: quantised numeric + household map | 105 | — |
| *planes only*: 10.7 M `GrowableU8.push` | 28.4 | — |
| *planes only*: 10.7 M presized `Uint8Array` writes | 26.1 | — |

Now, hypothesis by hypothesis.

### 1. Push the bucketing into SQL — **measured net loss, do not do it**

Returning seventeen `smallint`s instead of twenty mostly-text columns does
exactly what it promises on the wire: `COPY ... TO STDOUT` output drops from
**120.7 MB to 78.2 MB, −35%**. And it does make the JS encode nearly free:
**264 ms → 103 ms**.

It also makes Postgres do 10 M `CASE` evaluations plus a hash of the
concatenated household key per pass, and **the query phase rises 1,600 ms →
2,075 ms**. Net: **+475 ms of database CPU to save 161 ms of application CPU, a
314 ms loss** (C 1,864 ms vs D 2,178 ms).

That trade is bad twice over. The database is the shared, hard-to-scale
resource and the Node process is the cheap, horizontally-scalable one, so even
a break-even swap would be the wrong direction. And the ablation above already
showed why the wire saving does not cash out: the 16 text columns cost **~0 ms
of server execution**, so all you are buying is fewer bytes through a driver
that only spends ~9.7% of its time materializing strings.

**On the correctness question you raised:** you were right to be suspicious, and
I would go further — the drift risk is not worth taking for a change that is
measurably negative. `packEncoder.utils.ts` derives its byte mappings by
inverting `VALUE_MAPPERS`, and `classifyPoliticalParty` is shared with the
display path, precisely so a pack byte cannot disagree with what the equivalent
list filter matches. A SQL `CASE` ladder is a *third* copy of that vocabulary,
in a different language, that no type checker relates to the other two. If
someone ever does want this, the only honest way to keep them in step is to
**generate the SQL from the same inverted maps at runtime** (walk
`invertMapper()`'s `rawToByte` and emit the `WHEN` arms from it, never hand-write
them) and to add a test that asserts the SQL-produced byte equals
`dim.encode(row)` for every row of a fixture covering every raw value including
the long tail. My prototype does neither — it hand-writes the ladders — which is
also why its numbers should be read as an upper bound on the idea's benefit.

### 2. Bypass Prisma — **yes, but for streaming, not for speed**

node-postgres is **~7% faster** than Prisma on the identical statement (3,237 ms
vs 3,474 ms, Config W). On its own that does not justify a migration.

But you need a **server-side cursor** to stream, and you need to stop
materializing 628 k row objects at once (416 MB of live heap on the single-shot
variant). `pg` + `pg-cursor` gives you both, and both are already dependencies.
So take it — just book the win under streaming and memory, not under latency.
`COPY ... TO STDOUT (FORMAT binary)` I measured too: it produces **139.5 MB**
against the text protocol's 120.7 MB, because `float8` and `uuid` are wider in
binary than in their text spellings here. It is not obviously a win and it costs
you a hand-written binary row parser.

### 3. The per-row string keys — **yes, the best change inside the encoder**

This one is much bigger than it looks. Isolated, the two key operations are
**382 ms of the encoder's 573 ms — 67%**. Replacing the
`` `${row.lat}|${row.lng}` `` template with a quantised numeric key drops that
to **105 ms**, and takes the whole encoder from **573 ms to 276 ms (2.1×)**.
Making the household key numeric too gets it to **192 ms (3.0×)**.

Caveat on quantisation: I packed `round((lat+90)*1e6)` and
`round((lng+180)*1e6)` into one float64. That is exact only if L2 really stores
six decimal places — **verify that against the live column before shipping it**,
because a coarser quantisation silently merges two distinct rooftops into one
dot and a finer one is not representable. If six decimals cannot be guaranteed,
`` `${lat}|${lng}` `` on the *already-parsed floats* is what today's code does
and is safe; the numeric key is the optimisation, not the correctness baseline.

Making the household key numeric requires the household identity to come from
Postgres (a `hashtext`, a `DENSE_RANK`, or a stored key column). `hashtext` is
32-bit, and at ~293 k households the birthday maths gives **~10 expected
collisions per district — a collision is not a risk, it is a certainty**. Each
one silently merges two unrelated families into one door. Definitively not
shippable. Take the dot-key half (free, self-contained, 573 → 276 ms) and leave
the household half until there is a real numeric household id — a 64-bit
`hashtextextended` would be safe on collisions but node-postgres hands `int8`
back as a string, which reintroduces exactly the allocation you were removing.

### 4. `GrowableU8.push` — **no. It is 2 ms.**

10.7 million calls cost **28.4 ms** in isolation; the same writes into presized
`Uint8Array`s cost **26.1 ms**. The entire theoretical win from presizing the
planes is **2.3 ms**, and the CPU profile puts `push`'s self time at **2 ms,
0.03% of wall clock**. The doubling reallocations do not appear in the profile at
all — 64 KB doubling to 628 KB is ten `set()` calls over the whole run.

V8 inlines the bounds check and the arrays are monomorphic. This hypothesis is
dead; presize the planes if you happen to be rewriting `add()` anyway, but do
not schedule work for it.

`toBuffer` is in the same category: **2.3 ms, 0.04%**. The fixpoint loop over
manifest offsets converges in two iterations and costs nothing.

### 5. Bit-packing the planes — **works, and is free to produce; it is a payload decision, not a build decision**

37 bits per person (party 2, gender 2, marital 3, veteran 1, children 2,
homeowner 2, education 3, ethnicity 3, age 3, voter status 3, income 4, language
2, and 1 each for the four booleans, plus 3 for canvass status) against today's
136. Measured:

- payload **15,866,467 → 8,094,940 bytes, −49%**
- encode cost **276 ms vs 276 ms — identical**. Packing is free; the shift-and-or
  costs the same as a byte store because both are dwarfed by the key lookups.

So it halves the 16 MB transfer at no build cost. What it is not is a fix for
**this** problem — it takes ~0 ms off a 6 s build.

Cost it honestly: `packEncoder.utils.ts`, `packDecoder.ts` and
`DoorKnockingPack.schema.ts` all move together, the manifest needs a per-dim bit
width (and `PACK_ARRAY_TYPES` needs a packed type, or dims need to stop being
`u8` arrays), and the schema's `plane.type !== 'u8'` and
`elementCount !== counts.people` invariants both need rewriting. On the client,
`runFilter` and `polygonStats` currently do a flat `Uint8Array` read per person
per dim; unaligned bit reads will be slower per access, though for the 1–3 bit
dims the reduced cache footprint may well win it back. **I did not measure the
client decode**, so I cannot tell you whether it nets out positive there.

Recommendation: hold it until the streaming agent has transfer numbers. If the
16 MB download is a material part of the 165 s a candidate experienced, this
halves it and it is worth the three-file change. If transfer is already a small
slice, skip it.

### 6. jemalloc / tcmalloc via `LD_PRELOAD` — **no, and the profile says so explicitly**

You called this a distraction and the data agrees. GC is **3.0%** of wall clock
with `mu = 0.996`. IPC is **2.97**. Hard page faults number **369** for the
entire process. There is no evidence of time going to `malloc` — the allocation
volume is high (789 MB churned) but it is absorbed by V8's scavenger, which does
not use the system allocator for young-generation objects anyway. A different
system allocator would act on the Prisma engine's Rust-side allocations, which
the node-postgres comparison already bounds at ~240 ms total.

### 7. Is TypeScript the wrong language? — **no, and this is the useful finding**

The encoder owns **12.9% of the baseline's wall clock** (848 ms of 6,570 ms).
After the query fix it owns **14%** of a much smaller number (264 ms of 1,864
ms). An encoder that took *zero* time would improve the current endpoint by
**13%**.

And the encoder is not even close to its own ceiling in JS: three of those
percentage points come back from a numeric dot key, which is a fifteen-line
change. Measured, the pure-JS encoder goes **573 → 192 ms**. Whatever headroom a
napi-rs addon has, it is competing against 192 ms, not 573 ms — and it is
competing for a slice of a request that is 72% socket wait.

Against that: a new build toolchain, a cross-compilation story for the deploy
image (the container is linux-musl; the dev machines are darwin-arm64 — this
repo already carries two Prisma query-engine binaries for exactly that reason),
prebuilds or a compiler in CI, and a class of failure that takes down the worker
process instead of throwing. **The measured headroom does not justify any of
that.** IPC of 3.0 says the typed-array loops are already running the way you
would want native code to run; this is the part of JavaScript that works.

---

## Ranked recommendations

Cheapest high-payoff first.

**R1 — Replace keyset pagination with one unordered statement streamed through a
server-side cursor.** Measured **2.4–2.8×** end to end (6,072 → 2,144 ms warm;
6,126 → 2,542 ms cold), **116× fewer blocks touched**, **12× fewer physical
reads**, peak RSS 676 → ~450 MB. The production win should be *larger* than the
local one, because production pays real storage latency for the reads this
eliminates and this machine mostly does not.

Two properties make this the cheapest change on the list:

- **No wire-format change. No client change. No manifest change.** The pack
  carries no person identifiers — the client only walks person → household → dot
  positionally and aggregates — so person ordering is unobservable downstream. I
  checked every consumer of `decodePack` (`runFilter`, `polygonStats`,
  `canvassStatusCounts`, `VoterMapCanvas`); none depends on order. `ORDER BY
  v."id"` exists only to make the cursor work, and the cursor exists only to
  bound memory, which a server-side cursor does better.
- **It is the same change the streaming work needs anyway.** Streaming requires
  a single statement and incremental reads; keyset pagination is precisely what
  prevents both. This should land *as part of* that work, not as a competing PR.
  Coordinate before touching `voterPack.service.ts`.

**R2 — Quantised numeric dot key in `PackEncoder.add`.** Encoder **573 → 276 ms
(2.1×)**; roughly **270 ms** off the end-to-end request, which is ~14% of the
post-R1 total. Self-contained, no wire change, no contract change. Gated on
confirming L2's stored coordinate precision. Presize the planes while you are in
there — it is 2 ms, but it is free once `add()` is already being edited.

**R3 — Investigate the household key's ~550 ms of server time.** It is 38% of
single-pass execution and larger than the `DistrictVoter` join, and it is
recomputed on every request for data that never changes. A stored generated
column on `green."Voter"` (or an expression index, if the planner will use it)
would remove it. I did not prototype this — it needs a migration on a 218 M-row
table, and `buildHouseholdKeySql` is shared with the list and CSV paths, so the
blast radius needs thinking about. Flagging it as the next thing to measure
after R1, not as a recommendation I have evidence for.

**R4 — Bit-pack the planes, *if* transfer is a measured problem.** **−49%
payload (15.87 → 8.09 MB)** at **zero** encode cost. Three files move in
lockstep and the client-side decode cost is unmeasured. Decide with the
streaming agent's transfer numbers, not on principle.

**Do not do:** SQL bucketing (**measured 314 ms net loss** plus a third copy of
the filter vocabulary); presizing `GrowableU8` as a standalone task (**2 ms**);
swapping the allocator (**GC is 3%, IPC is 3.0**); rewriting the encoder in
native code (**it owns 13%, and half of that is recoverable in JS**).

---

## Wire-format impact

| change | `packEncoder.utils.ts` | `packDecoder.ts` | `DoorKnockingPack.schema.ts` |
| --- | --- | --- | --- |
| R1 single-pass cursor | no | no | no |
| R2 numeric dot key | yes | **no** | **no** |
| R3 stored household key | no (SQL + migration) | no | no |
| R4 bit-packed planes | **yes** | **yes** | **yes** |
| SQL bucketing (rejected) | yes | no | no |

Only R4 requires all three to move together. R1, the change with by far the
largest measured payoff, requires none of them.

---

## Confidence and what would change these numbers

**What I trust.**

- **The phase split's shape.** 72% socket wait, ~13% encoder, ~9% driver, 3% GC,
  0.04% serialization. Three independent instruments agree (CPU profile, GC
  trace, process counters), and the two drivers behave the same way.
- **The block-count numbers**, more than any timing here. 14.06 M blocks vs
  120,976 comes from Postgres's own accounting, is deterministic, does not depend
  on my hardware, and reproduced identically under both `DistrictVoter` index
  layouts.
- **The relative encoder numbers.** Best-of-5 on a fixed in-memory array with no
  IO — the 573/276/192 ms ladder is tight and repeatable.
- **The dataset's overall scale**, on the strength of reproducing the production
  byte count to within 0.9%.

**What I do not trust, and you should not either.**

- **Absolute wall-clock times do not transfer.** 6 s here against 12.7–43.5 s
  there. This machine has an M5 Max, a local NVMe, and Postgres on the same host
  with no network hop. **Every speedup ratio in this report should be read as a
  lower bound for production**, because the thing production has more of —
  storage latency — is exactly what R1 removes. But "2.8× locally" is not a
  promise of 2.8× in production; it could be considerably better or, if the
  district is genuinely resident in the buffer pool on the fast requests,
  somewhat worse for those.
- **The single-pass plan is a planner choice, not a guarantee.** On my 730 k-row
  table it picks a hash join with sequential scans. On a 218 M-row partitioned
  table with different statistics it may not. `EXPLAIN` it against production
  before believing the 116×.
- **My district is one state partition with one district covering every row.**
  Production's `DistrictVoter` presumably holds many districts, and I did not
  model selectivity across them. This most likely *understates* the keyset
  problem — a smaller district within a large partition makes the unrestricted
  inner scan relatively worse — but I have not measured that.
- **Column-value distributions are educated guesses** outside
  `Parties_Description`, where the codebase records real measurements. Null
  rates and cardinalities shift string-allocation volume and wire bytes. Since
  those together account for ~10% of the run, even being substantially wrong
  here would not reorder the recommendations.
- **The cold-cache runs are single samples.** They corroborate the warm ranking;
  they are not precise. Row E's cold number is visibly noise.
- **I did not measure the client.** Bit-packing's decode-side cost, and how much
  of a candidate's 165 s was transfer and browser decode rather than server
  build, are both open. That is the streaming agent's territory and the R4
  decision belongs with whoever has those numbers.

**The one measurement that would most improve this report** is
`pg_stat_statements` for this query text in production —
`shared_blks_read`, `shared_blks_hit` and `total_exec_time` per call. If reads
are ~10⁶ per call, R1 is straightforwardly the whole answer. If they are not, the
model behind this report's ranking is wrong and it should be rerun.

---

## Reproducing this

The harnesses live in `packages/gp-api/.perf/` on the branch this document came
from and are **deliberately not committed** — they are throwaway measurement
code, not something to maintain. They are:

| file | what it does |
| --- | --- |
| `gen.mjs` | generates the synthetic dataset (deterministic, seeded) and its DDL |
| `harness2.ts` | phase split and server-side ablation across query variants |
| `harness3.ts` | keyset vs single pass, buffer traffic, plan shapes |
| `harness4.ts` | the end-to-end candidate matrix (A–F), warm and cold |
| `encbench.ts` | the encoder in isolation, all variants |
| `cold-io.mjs` | cold-buffer-pool IO characterisation |
| `keyset-probe.mjs` | per-batch plans and block counts for the keyset loop |
| `proj-ablate.mjs` | repeated server-side projection ablation |
| `profile-run.ts` | one build, isolated for `--cpu-prof` / `--heap-prof` |

Each imports the production `PackEncoder` and SQL builders directly, and each
bundles through `esbuild` before running so profiles are not polluted by a
TypeScript loader.
