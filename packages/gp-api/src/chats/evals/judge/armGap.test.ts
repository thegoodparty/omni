import { describe, expect, it } from 'vitest'
import { hoursToMilliseconds, minutesToMilliseconds } from 'date-fns'
import { armGap, formatGap, windowOf } from './armGap'
import type { ArmManifest } from './records'

const window = (startedAt: string, endedAt: string) => ({ startedAt, endedAt })

const SIX_HOURS = hoursToMilliseconds(6)

describe('armGap', () => {
  // The number a reader needs is how long the world had to move between the
  // two captures, not how long the sweep took. Measuring start-to-start
  // would report a 40-minute base arm as a 40-minute gap.
  it('measures the space between the windows, not between their starts', () => {
    const gap = armGap(
      window('2026-09-29T10:00:00.000Z', '2026-09-29T10:40:00.000Z'),
      window('2026-09-29T10:45:00.000Z', '2026-09-29T11:25:00.000Z'),
      SIX_HOURS,
    )
    expect(gap.gapMs).toBe(minutesToMilliseconds(5))
    expect(gap.candidateFirst).toBe(false)
    expect(gap.farApart).toBe(false)
  })

  it('flags a comparison whose arms are far apart', () => {
    const gap = armGap(
      window('2026-09-20T10:00:00.000Z', '2026-09-20T10:40:00.000Z'),
      window('2026-09-29T10:00:00.000Z', '2026-09-29T10:40:00.000Z'),
      SIX_HOURS,
    )
    expect(gap.farApart).toBe(true)
    expect(formatGap(gap)).toContain('8 days')
  })

  // Right at the threshold is not over it, and the difference decides whether
  // a warning goes on a PR.
  it('does not flag a gap exactly at the threshold', () => {
    const gap = armGap(
      window('2026-09-29T00:00:00.000Z', '2026-09-29T01:00:00.000Z'),
      window('2026-09-29T07:00:00.000Z', '2026-09-29T08:00:00.000Z'),
      SIX_HOURS,
    )
    expect(gap.gapMs).toBe(SIX_HOURS)
    expect(gap.farApart).toBe(false)
  })

  // A re-judge of a cached base arm produces this ordering, and "the gap"
  // reads as base-then-candidate unless it is said.
  it('reports the ordering when the candidate was captured first', () => {
    const gap = armGap(
      window('2026-09-29T12:00:00.000Z', '2026-09-29T12:30:00.000Z'),
      window('2026-09-29T10:00:00.000Z', '2026-09-29T10:30:00.000Z'),
      SIX_HOURS,
    )
    expect(gap.candidateFirst).toBe(true)
    expect(gap.gapMs).toBe(minutesToMilliseconds(90))
  })

  // Two arms driven concurrently from one shell overlap. A negative gap would
  // render as a negative duration.
  it('clamps overlapping windows to no gap', () => {
    const gap = armGap(
      window('2026-09-29T10:00:00.000Z', '2026-09-29T11:00:00.000Z'),
      window('2026-09-29T10:30:00.000Z', '2026-09-29T11:30:00.000Z'),
      SIX_HOURS,
    )
    expect(gap.gapMs).toBe(0)
    expect(formatGap(gap)).toBe('none (the captures overlap)')
  })
})

describe('formatGap', () => {
  const after = (baseEnd: string, candidateStart: string) =>
    armGap(
      window('2026-01-01T00:00:00.000Z', baseEnd),
      window(candidateStart, '2030-01-01T00:00:00.000Z'),
      SIX_HOURS,
    )

  it('says so rather than rendering empty for a sub-second gap', () => {
    expect(
      formatGap(after('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.400Z')),
    ).toBe('under a second')
  })

  it('reads as a duration', () => {
    expect(
      formatGap(after('2026-01-01T00:00:00.000Z', '2026-01-02T02:00:00.000Z')),
    ).toBe('1 day 2 hours')
  })

  // THE REGRESSION. `intervalToDuration` is calendar-aware, so a format list
  // naming only days and below discarded years and months: a 31-day gap came
  // out as the empty string and rendered "under a second", and 400 days came
  // out as "4 days" — both immediately under the "the arms are far apart"
  // warning they contradicted.
  //
  // Matched on the leading units rather than the whole string: month
  // arithmetic is calendar-aware and therefore timezone-aware, so the
  // trailing hour wobbles across a DST boundary in the runner's zone. The
  // leading units are what the old code dropped, so they are what is
  // asserted. Against the old code these all fail: 31 days formatted as the
  // empty string and 400 days as "4 days".
  it.each([
    ['2026-02-01T00:00:00.000Z', /^1 month/],
    ['2026-04-10T00:00:00.000Z', /^3 months 9 days/],
    ['2027-02-05T00:00:00.000Z', /^1 year 1 month/],
  ])('keeps the months and years in a gap to %s', (start, expected) => {
    const gap = after('2026-01-01T00:00:00.000Z', start)
    expect(gap.farApart).toBe(true)
    expect(formatGap(gap)).toMatch(expected)
    // And never the reassuring answer.
    expect(formatGap(gap)).not.toBe('under a second')
  })
})

describe('windowOf', () => {
  it('takes the capture window off a manifest', () => {
    const manifest: ArmManifest = {
      schemaVersion: 1,
      sweepId: 'swp_1',
      arm: 'base',
      ref: 'universal-judge',
      commit: 'a'.repeat(40),
      startedAt: '2026-09-29T10:00:00.000Z',
      endedAt: '2026-09-29T10:40:00.000Z',
      agents: [],
      skipped: [{ agentId: 'x', reason: 'no runner' }],
    }
    expect(windowOf(manifest)).toEqual({
      startedAt: '2026-09-29T10:00:00.000Z',
      endedAt: '2026-09-29T10:40:00.000Z',
    })
  })
})
