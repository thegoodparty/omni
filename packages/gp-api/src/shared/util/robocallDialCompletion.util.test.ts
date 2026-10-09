import { differenceInMinutes } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import { describe, expect, it } from 'vitest'
import {
  estimateRobocallDialCompletion,
  SCHEDULE_TZ,
} from './robocallDialCompletion.util'

const EASTERN_TZ = 'America/New_York'

// Builds an instant from a wall-clock time in a zone, so expectations read as
// the local times the estimator reasons about rather than UTC offsets.
const at = (local: string, timeZone = SCHEDULE_TZ): Date =>
  fromZonedTime(local, timeZone)

describe('estimateRobocallDialCompletion', () => {
  it('finishes a small audience the same day', () => {
    // 600 / 10 = 60 dialing-minutes from 10:00, well inside the window.
    expect(
      estimateRobocallDialCompletion({
        audienceSize: 600,
        callsPerMinute: 10,
        startAt: at('2026-06-15 10:00:00'),
      }),
    ).toEqual(at('2026-06-15 11:00:00'))
  })

  it('spills a start near the 21:00 cutoff to the next morning', () => {
    // 900 / 10 = 90 minutes from 20:30: 30 before 21:00, 60 roll to 09:00.
    expect(
      estimateRobocallDialCompletion({
        audienceSize: 900,
        callsPerMinute: 10,
        startAt: at('2026-06-15 20:30:00'),
      }),
    ).toEqual(at('2026-06-16 10:00:00'))
  })

  it('waits for 09:00 when started before the window opens', () => {
    // 60 minutes from a 06:00 start begin only once the window opens at 09:00.
    expect(
      estimateRobocallDialCompletion({
        audienceSize: 600,
        callsPerMinute: 10,
        startAt: at('2026-06-15 06:00:00'),
      }),
    ).toEqual(at('2026-06-15 10:00:00'))
  })

  it('spans multiple days for a large audience', () => {
    // 15000 / 10 = 1500 minutes: 720 on day one, 720 on day two, 60 on day
    // three starting at 09:00 → 10:00 on the third day.
    expect(
      estimateRobocallDialCompletion({
        audienceSize: 15000,
        callsPerMinute: 10,
        startAt: at('2026-06-15 09:00:00'),
      }),
    ).toEqual(at('2026-06-17 10:00:00'))
  })

  it('fills exactly to 21:00 when the work lands on the close', () => {
    // 7200 / 10 = 720 minutes from 09:00 consumes the whole window.
    expect(
      estimateRobocallDialCompletion({
        audienceSize: 7200,
        callsPerMinute: 10,
        startAt: at('2026-06-15 09:00:00'),
      }),
    ).toEqual(at('2026-06-15 21:00:00'))
  })

  it('treats a start exactly at 21:00 as past the window', () => {
    expect(
      estimateRobocallDialCompletion({
        audienceSize: 600,
        callsPerMinute: 10,
        startAt: at('2026-06-15 21:00:00'),
      }),
    ).toEqual(at('2026-06-16 10:00:00'))
  })

  it('waits for the next open when started after 21:00', () => {
    expect(
      estimateRobocallDialCompletion({
        audienceSize: 300,
        callsPerMinute: 10,
        startAt: at('2026-06-15 22:00:00'),
      }),
    ).toEqual(at('2026-06-16 09:30:00'))
  })

  it('rounds a tiny audience up to a single dialing-minute', () => {
    // 73 / 120 rounds up to 1 minute — a sub-minute audience still consumes a
    // whole minute, never zero.
    const startAt = at('2026-06-15 10:00:00')
    const completion = estimateRobocallDialCompletion({
      audienceSize: 73,
      callsPerMinute: 120,
      startAt,
    })
    expect(completion).toEqual(at('2026-06-15 10:01:00'))
    expect(differenceInMinutes(completion, startAt)).toBe(1)
  })

  it('never counts minutes outside the 09:00-21:00 window', () => {
    // 1200 / 10 = 120 minutes from 20:00: 60 before 21:00 and 60 after the
    // next open. The overnight 21:00-09:00 gap must not be counted, so the
    // billable window minutes equal the raw 120 even though wall time is ~14h.
    const startAt = at('2026-06-15 20:00:00')
    const completion = estimateRobocallDialCompletion({
      audienceSize: 1200,
      callsPerMinute: 10,
      startAt,
    })
    expect(completion).toEqual(at('2026-06-16 10:00:00'))

    const windowMinutes =
      differenceInMinutes(at('2026-06-15 21:00:00'), startAt) +
      differenceInMinutes(completion, at('2026-06-16 09:00:00'))
    expect(windowMinutes).toBe(120)
  })

  it('applies the daily window in the given timezone', () => {
    // The same wall-clock start resolves to different instants per zone, so an
    // Eastern campaign that waits for 09:00 ET finishes an hour (of real time)
    // before a Central one would.
    expect(
      estimateRobocallDialCompletion({
        audienceSize: 600,
        callsPerMinute: 10,
        startAt: at('2026-06-15 06:00:00', EASTERN_TZ),
        timeZone: EASTERN_TZ,
      }),
    ).toEqual(at('2026-06-15 10:00:00', EASTERN_TZ))
  })

  it('defaults the timezone to the CallHub schedule zone', () => {
    // Omitting timeZone must behave exactly as passing SCHEDULE_TZ. Use a
    // before-open start so the zone actually drives the result.
    const params = {
      audienceSize: 900,
      callsPerMinute: 10,
      startAt: at('2026-06-15 06:00:00'),
    }
    expect(estimateRobocallDialCompletion(params)).toEqual(
      estimateRobocallDialCompletion({ ...params, timeZone: SCHEDULE_TZ }),
    )
    expect(estimateRobocallDialCompletion(params)).toEqual(
      at('2026-06-15 10:30:00'),
    )
  })

  it('does not mutate the startAt it is given', () => {
    const startAt = at('2026-06-15 20:00:00')
    const snapshot = startAt.toISOString()
    estimateRobocallDialCompletion({
      audienceSize: 1200,
      callsPerMinute: 10,
      startAt,
    })
    expect(startAt.toISOString()).toBe(snapshot)
  })

  it('rejects a non-positive dial rate', () => {
    expect(() =>
      estimateRobocallDialCompletion({
        audienceSize: 600,
        callsPerMinute: 0,
        startAt: at('2026-06-15 10:00:00'),
      }),
    ).toThrow(RangeError)
  })

  it('rejects a non-positive audience size', () => {
    // A 0/negative audience would silently return startAt unchanged (even
    // off-hours), feeding a later caller an invalid next-start; reject it the
    // same way as a non-positive rate rather than return an off-window instant.
    expect(() =>
      estimateRobocallDialCompletion({
        audienceSize: 0,
        callsPerMinute: 120,
        startAt: at('2026-06-15 06:00:00'),
      }),
    ).toThrow(RangeError)
  })
})
