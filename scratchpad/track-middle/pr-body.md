## What this is

Everything between a stored record and a verdict on a PR: the normalizer,
the judge call, the scoring, the bootstrap and the report. Track E, F and G
of the parallel build plan, shipped together.

They are one PR on purpose. Normalizer, judge, scoring and report are a
chain where each is the producer for the next, so splitting a producer from
its consumer would leave two PRs that neither work nor review on their own.
That mistake has already cost this project once.

Nothing here calls a model, touches product code, or spends anything. Every
function is pure over the wave-0 fixtures, and the panel runs against a fake
`JsonJudgeModel`.

## The four modules

| File | What it does |
| --- | --- |
| `judge/normalize.ts` | Pairs records by case and attempt, relabels the arms X and Y at random, strips anything that names an arm, and renders the opaque `input`/`output` into a payload. |
| `judge/judge.ts` | Runs the blind comparison. Returns X, Y, tie or cannot_determine per dimension, with a magnitude. Never sees a slot map. |
| `judge/score.ts` | Un-blinds, orients to the candidate, averages per case then across cases, and applies the four labels. |
| `judge/bootstrap.ts` | The cluster bootstrap over cases, plus a seeded PRNG so an interval is reproducible. |
| `judge/report.ts` | The PR comment. |
| `judge/config.ts` | Every tunable. |

`config.ts` is the one file beyond the five the track was scoped to. The
design rule is that changing a tunable must be a file edit rather than a
code change, and spreading the values across four modules would have made
"change the margin" a four-file hunt. No other track owns it.

## How the blinding is proven

Three tests, at three levels, and each one fails under a mutation.

**No field names an arm.** The payload's key set is walked recursively and
asserted not to contain `arm`, `variant`, `ref`, `commit`, `configDigest`,
`runId`, `sweepId`, `telemetry`, `trace`, `status` or `slotMap`. This fails
the moment someone adds `variant` to the payload for convenience.

**No value names an arm.** Each record is rewritten so the agent echoes its
own branch, commit, model, run id and digest into its answer. Every one of
those strings is asserted **present in the record** and then absent from the
payload, so the test cannot pass by checking for something that was never
there. The strip list is the union of both records, applied to both, because
scrubbing each arm with only its own values leaves one side mangled and the
other intact, and asymmetric mangling is itself a direction signal. A
separate test pins that symmetry.

**Nothing reaches the wire.** The same assertion runs over the messages a
fake model actually received, with a seat model deliberately unlike either
arm's. `judgeCase` takes a payload and a key, never a `NormalizedCase`, so
there is no code path from the judge to the slot map.

Two more that matter as much. The slot map is asserted never to lie: over
200 random draws, the run sitting in slot S holds the output of arm
`slotMap[S]`, and both orientations occur. And end to end, a fake judge that
reads only the payload and prefers the fuller answer recovers a BETTER
verdict through the blind — while a fake that just always names slot X comes
out as Δ 0, 0% position consistency and a gated CAN'T SAY, which is the
order-swap subsample doing its job.

## How the bootstrap works, and how it is tested

Resample the case-level means with replacement, take the mean each time,
sort, and read nearest-rank percentiles off `(B - 1)`. Twenty lines, no
numpy, a `Rng` injected so it is deterministic.

The unit that gets resampled is the **case**, never the judgment. Attempts of
one case and the two orders of one pair share an input and whatever that case
is hard about, so resampling judgments would treat correlated observations as
independent and report an interval far narrower than the evidence supports.

Tested so that each property has a mutation that breaks it:

- A stream stuck at zero can only draw case 0, so the interval collapses onto
  that case's score. This proves the resample indexes the list with the rng.
- Four scripted iterations over two cases give resample means
  `[0, 0.5, 0.5, 1]`, and the 5th/95th percentiles are pinned by hand.
- A higher confidence widens the interval on the same seed.
- More cases narrow it, which is what makes the case-count floor worth having.
- And the one that matters: **the same twenty judgments clustered into two
  cases produce a strictly wider interval than spread over twenty.** Replacing
  the per-case mean with a flat list of judgments fails this.

## What is config

`judge/config.ts`: attempts per case, the dimension set, the judge seats and
temperature, the practical margin δ, the case-count floor, the
position-consistency floor, the cannot-determine ceiling, the panel
disagreement ceiling, whether the order-swap subsample runs and at what
fraction, bootstrap iterations and confidence, the render cap, and the
identity patterns scrubbed from agent text.

The dimension set is config for a specific reason: v1 judges final outputs
only, so the rubric's two trace-dependent dimensions are absent. Turning
them on later is this list plus a renderer, and stored records re-grade at
zero agent cost.

## Two things in the design that did not work as written

**The SAME rule and the sub-margin rule overlap.** The rubric doc applies
IMPROVED, WORSE, SAME, then inconclusive in order, where SAME is "the entire
95% interval falls inside [−δ, +δ]". It then gives Δ = 0.05 with interval
[0.01, 0.09] as a CAN'T SAY, "real but below the practical margin". That
interval satisfies the SAME condition, so taken in the stated order the
example returns SAME. Calling a measured effect equivalence is the wrong
answer, so the sub-margin check runs before SAME here. A test pins it: the
same data with a smaller margin is a real BETTER.

**An unpriceable model cannot be allowed to throw.** `priceUsd` throws on a
model with no rates, which is right — a guessed rate makes the cost evidence
fiction. But measured evidence is never allowed to gate a verdict, and an
exception is the strongest possible gate. Cost is caught and reported as
"not derivable", with the reason, and the verdict survives.

## Rules the code is built around

- **A tool failure is never a quality signal.** `isComparable()` decides;
  either arm's tool error excludes the case from Δ and counts it as
  infrastructure. Reported apart from an infra error, which is a different
  fact about a different failure.
- **A refusal is a result.** `blocked` keeps its output and stays judgeable.
- **Cost is re-derived, never compared as stored.** A test gives the base arm
  a stored `usdAtCapture` of $99 and the candidate $1, and asserts the report
  shows the token-derived $0.03 delta. `pricingVersion` mismatch is surfaced.
- **Δ is never blended across agents.** `normalizeAgent` refuses a record set
  covering more than one.
- **Identical digests are refused**, per pair and for the agent as a whole, so
  a sweep whose every case happened to be excluded cannot slip past.
- **The coverage line always prints**, asserted as an exact string against a
  crafted registry rather than a `/\d+ of \d+/` pattern that would pass
  whichever registry got counted.
- **A judge failure is ungraded**, counted apart from CAN'T SAY.
- **Flags and floor failures are oriented per judgment**, since a flag on "X"
  is a different arm in the next judgment. They are deduped across the two
  orders of a pair so the swapped subsample cannot inflate them, and counted
  by arm and type in the report.
- **Magnitude is reported, never weighted.** Calibration across judge families
  does not exist, so weighting the score by it would add an unvalidated
  assumption to the primary statistic.
- **The panel gates on direction, not on strength.** Two seats splitting X
  against tie is a disagreement; only X against Y is a direction conflict, and
  only that counts toward the gate.

## A rendered report

```
## Universal Judge

### chief_of_staff — BETTER

overall +1.00 [1.00, 1.00] over 22 cases — the whole interval is above zero

| dimension | Δ (95% CI) | cases | W/T/L | can't tell |
| --- | --- | --- | --- | --- |
| overall | +1.00 [1.00, 1.00] | 22 | 27/0/0 | 0 |
| task_success | +1.00 [1.00, 1.00] | 22 | 27/0/0 | 0 |
| instruction_adherence | +1.00 [1.00, 1.00] | 22 | 27/0/0 | 0 |
| user_utility | +1.00 [1.00, 1.00] | 22 | 27/0/0 | 0 |

Overall magnitudes: 27 clear.

Measured, beside the verdict and never part of it (re-derived at pricing
2026-09, not read from the records stored dollars):

- cost: +0.0000 USD per run pair (base 0.0970, candidate 0.0970)
- latency: +0 ms per run pair
- tool errors: +0.04 per run pair
- measured over 23 pairs

Excluded: 1 tool error, 1 infra error, 0 unpaired. Separately, 0 ungraded
(the judge itself failed, which is not a CAN'T SAY verdict).

Position consistency: 100%

Change under test: thegoodparty/omni #2198 — [workflow run 36592029654](...)

**Coverage: 0 of 20 agents wired.**
- blocked: briefing_annotation — No ChatScopeHandler yet. ...
```

The report prints no agent output, no evidence quotes and no flag
explanations. omni is public, so a PR comment is a public artifact, and the
judged text stays in S3 where the record already lives.

## Not in this PR

- `judge/README.md` still says wave 0 has no judge or report. It is a shared
  file and nine tracks are in flight, so it is left for wave 2 rather than
  becoming nine conflicting edits.
- Concurrency. Seats and cases are judged one at a time. A sweep is hundreds
  of calls against a shared rate limit, and scheduling belongs to whatever
  orchestrates a sweep in wave 2.
- The prompt wording, which the rubric doc owns. It sits in one marked block
  in `judge.ts` with a link, and the machinery around it is what this PR is.
