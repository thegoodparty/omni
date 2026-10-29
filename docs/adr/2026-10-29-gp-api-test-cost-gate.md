---
title: gp-api CI fails a run that adds test time past fixed ceilings
status: active
decided_by: [swain]
date: 2026-10-29
code: ['#3386']
scope:
  - packages/gp-api/src/test-cost-reporter.ts
  - packages/gp-api/test-cost-budget.json
  - packages/gp-api/src/test-service.ts
  - packages/gp-api/vitest.config.ts
supersedes: []
superseded_by:
---

# gp-api CI fails a run that adds test time past fixed ceilings

## Decision

When `CI` is set, a vitest reporter (`src/test-cost-reporter.ts`) fails each
`Test` shard if one test runs over 10s, one file over 30s, or the median
`useTestService()` boot over 3s, or if the number of `fresh-modules` files
(those calling `vi.mock`, `vi.doMock`, `vi.unmock` or `vi.resetModules`)
differs from the number in `test-cost-budget.json`. Tests and files that are
over a ceiling today are allowlisted in that file, each with a reason. The
allowlist only shrinks: an entry that runs under a quarter of its ceiling, or
whose test or file is gone, fails until it is deleted. Every failure says what
to do instead. Each shard writes its per-file times and median boot to the
job summary.

## Context

The test corpus grew fast, mostly written by agents, and nothing pushed back
on cost. A test-suite audit found single tests seeding 200k rows (12-16s
each), a file spawning a `tsx` process per test (55s), and every
`fresh-modules` file paying ~5s to reimport the app graph. Each one passed
review because nobody saw its time. The ceilings sit at roughly 3x the
slowest non-outlier in 16 green main runs, so runner noise cannot trip them.
The stale threshold is a quarter of the ceiling, not the ceiling itself,
because entries sit near the ceiling and would otherwise flap.

## Alternatives rejected

- A total-runtime budget per shard: shards are split by file count, so one
  shard's total moves with whatever else lands in it, and a failure would not
  name the test that caused it.
- Reporting times without failing: the audit's data was already visible in
  every CI log, and nobody acted on it.
- Gating local runs too: local machines vary too much for a fixed ceiling,
  and the gate would get in the way of iterating on a test.

## Revisit if

CI moves to different runners (recalibrate the ceilings from the job
summaries), or the shard count changes enough that per-shard median boot
stops being a stable sample.
