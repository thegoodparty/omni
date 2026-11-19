import { isBefore, subDays } from 'date-fns'
import type { LedgerEntry } from './ledger.util'

// The nightly cap (Implementation Notes 10.7): 3 to start, up to 5 when 70%
// or more of the last two weeks' proposals merged, 2 below 40% and 1 below
// 15%.
export const DEFAULT_NIGHTLY_CAP = 3
export const MERGE_SHARE_TREND_WINDOW_DAYS = 14
// Below this many settled proposals in the window there is no trend yet, so
// one or two outlier cases cannot swing the cap.
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

// Only proposals a person ruled on count: their PR merged or was closed
// unmerged. Dev and a prod dry run open no PRs, so nothing there settles and
// the cap stays at its default, and the 7-day auto-close is not a ruling. An
// outcome is matched by caseId without a window of its own: a case proposed
// near the window's start may be ruled on after its proposal has left it.
export const trailingMergeShare = (
  entries: LedgerEntry[],
  now: Date,
): number | undefined => {
  const cutoff = subDays(now, MERGE_SHARE_TREND_WINDOW_DAYS)
  const merged = new Set(
    entries
      .filter((entry) => entry.outcome === 'merged' && entry.caseId)
      .map((entry) => entry.caseId),
  )
  const rejected = new Set(
    entries
      .filter((entry) => entry.outcome === 'rejected' && entry.caseId)
      .map((entry) => entry.caseId),
  )
  const settled = entries.filter(
    (entry) =>
      entry.outcome === 'proposed' &&
      entry.createdAt !== undefined &&
      !isBefore(entry.createdAt, cutoff) &&
      entry.caseId &&
      (merged.has(entry.caseId) || rejected.has(entry.caseId)),
  )
  if (settled.length < MIN_SAMPLE_SIZE) return undefined
  return (
    settled.filter((entry) => merged.has(entry.caseId)).length / settled.length
  )
}
