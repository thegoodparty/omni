import { isBefore, subDays } from 'date-fns'
import type { LedgerEntry } from './ledger.util'

// The nightly cap (Implementation Notes 10.7): 3 to start, up to 5 when 70%
// or more of the last two weeks' proposals merged, 2 below 40% and 1 below
// 15%.
export const DEFAULT_NIGHTLY_CAP = 3
export const MERGE_SHARE_TREND_WINDOW_DAYS = 14
// Below this many proposals in the window there is no trend yet, so one or
// two outlier cases cannot swing the cap.
export const MIN_SAMPLE_SIZE = 3

export const nightlyCapForMergeShare = (
  mergeShare: number | undefined,
): number => {
  if (mergeShare === undefined) return DEFAULT_NIGHTLY_CAP
  if (mergeShare >= 0.7) return 5
  if (mergeShare < 0.15) return 1
  if (mergeShare < 0.4) return 2
  return DEFAULT_NIGHTLY_CAP
}

// A merge is matched by caseId without a window of its own: a case proposed
// near the window's start may merge after its proposal has left it.
export const trailingMergeShare = (
  entries: LedgerEntry[],
  now: Date,
): number | undefined => {
  const cutoff = subDays(now, MERGE_SHARE_TREND_WINDOW_DAYS)
  const proposed = entries.filter(
    (entry) =>
      entry.outcome === 'proposed' &&
      entry.createdAt !== undefined &&
      !isBefore(entry.createdAt, cutoff) &&
      entry.caseId,
  )
  if (proposed.length < MIN_SAMPLE_SIZE) return undefined
  const merged = new Set(
    entries
      .filter((entry) => entry.outcome === 'merged' && entry.caseId)
      .map((entry) => entry.caseId),
  )
  return (
    proposed.filter((entry) => merged.has(entry.caseId)).length /
    proposed.length
  )
}
