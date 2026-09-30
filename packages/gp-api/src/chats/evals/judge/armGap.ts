import {
  differenceInMilliseconds,
  formatDuration,
  intervalToDuration,
  isBefore,
  parseISO,
} from 'date-fns'
import type { ArmManifest } from './records'

// THE TDD SAYS THE ARMS ALTERNATE IN TIME. For chat they cannot, and this
// module is what we do instead.
//
// The TDD's claim is that the orchestrator runs "base, candidate, base,
// candidate" so a mid-sweep deploy or shifting data cannot pass for a variant
// difference. That is not achievable here. An arm is a worktree, a worktree is
// a separate checkout, and two checkouts of one module graph cannot be
// imported into one Node process — so each arm is its own process and all of
// base runs before any of candidate. Faking the claim would be worse than
// dropping it, because the report would assert a property the sweep does not
// have.
//
// So: each arm stamps when its capture started and finished, the report prints
// the distance between the two windows, and a comparison whose arms are far
// apart is flagged. Anything that moved between the two captures — a
// deploy, a Delta table, the live web — had that long to move, and the
// reader is told how long rather than reassured it was zero.
//
// This is not a special case. The background runner's cached base arm already
// gets exactly this treatment, for exactly this reason.

export interface CaptureWindow {
  startedAt: string
  endedAt: string
}

export interface ArmGap {
  base: CaptureWindow
  candidate: CaptureWindow
  // Milliseconds between the end of the earlier capture and the start of the
  // later one, so the number is the time the world had to move rather than
  // the span of the sweep. Zero when the two windows overlap.
  gapMs: number
  // The two instants `gapMs` spans, so the gap can be formatted from real
  // dates rather than from epoch 0. Equal when the windows overlap.
  gapFrom: string
  gapTo: string
  // True when candidate finished before base started, which is the ordering a
  // re-judge of a cached base arm produces. Worth stating, because "the gap"
  // reads as "base then candidate" otherwise.
  candidateFirst: boolean
  // Over the configured threshold, so the reader is told that whatever moved
  // between the arms had long enough to matter.
  farApart: boolean
}

export const windowOf = (manifest: ArmManifest): CaptureWindow => ({
  startedAt: manifest.startedAt,
  endedAt: manifest.endedAt,
})

export const armGap = (
  base: CaptureWindow,
  candidate: CaptureWindow,
  maxGapMs: number,
): ArmGap => {
  const baseStart = parseISO(base.startedAt)
  const baseEnd = parseISO(base.endedAt)
  const candidateStart = parseISO(candidate.startedAt)
  const candidateEnd = parseISO(candidate.endedAt)

  const candidateFirst = isBefore(candidateEnd, baseStart)
  // Measured between the windows rather than between their starts: two arms
  // that ran back to back are minutes apart however long each one took, and
  // that is the number a reader needs.
  const from = candidateFirst ? candidateEnd : baseEnd
  const to = candidateFirst ? baseStart : candidateStart
  const raw = differenceInMilliseconds(to, from)

  // Overlapping windows are possible — two arms driven concurrently from one
  // shell — and a negative gap would render as a negative duration.
  const overlapping = raw <= 0
  const gapMs = overlapping ? 0 : raw

  return {
    base,
    candidate,
    gapMs,
    // Collapsed to one instant when the windows overlap, so `formatGap`
    // cannot be handed a backwards interval.
    gapFrom: (overlapping ? to : from).toISOString(),
    gapTo: to.toISOString(),
    candidateFirst,
    farApart: gapMs > maxGapMs,
  }
}

// Formatted from the two real instants, and with EVERY unit in the format
// list. Both halves of that matter, and getting either wrong is how this
// function lied.
//
// `intervalToDuration` is calendar-aware: it returns years and months, so a
// format list that named only days and below DISCARDED them. A 31-day gap
// came out as the empty string — rendered "under a second" — directly under
// the "the arms are far apart" warning it contradicted, and 400 days came out
// as "4 days". Wrong in the reassuring direction, on the one number this
// module exists to produce.
//
// And from real dates rather than `{ start: 0, end: gapMs }`, so "1 month"
// is the month that actually elapsed rather than however long January is.
export const formatGap = (gap: ArmGap): string =>
  gap.gapMs === 0
    ? 'none (the captures overlap)'
    : formatDuration(
        intervalToDuration({
          start: parseISO(gap.gapFrom),
          end: parseISO(gap.gapTo),
        }),
        {
          format: ['years', 'months', 'days', 'hours', 'minutes', 'seconds'],
          zero: false,
        },
        // A sub-second gap has no non-zero unit and would format as the
        // empty string.
      ) || 'under a second'
