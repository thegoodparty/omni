/**
 * The answers a read of a district needs at the least: enough that every
 * major group is expected to answer at least MIN_VOICES_PER_GROUP times
 * (docs/decisions/2026-10-19-civic-panel-two-rounds-coverage-sizing.md).
 * A floor, not a promise: the read also needs the model sure of each group.
 * Sizing only; nothing shows it to an official.
 */

/** Answers each major group is expected to give. */
export const MIN_VOICES_PER_GROUP = 3

/** A group holding this share of the district or more is a major group. */
export const MAJOR_GROUP_SHARE = 0.03

/**
 * Answers needed for a good read of a district whose smallest major group
 * holds `smallestMajorShare` of it. Without the district's mix, it is sized
 * for the smallest a major group can be: 100.
 */
export const answersNeeded = (smallestMajorShare?: number | null): number => {
  const share = Math.max(smallestMajorShare ?? 0, MAJOR_GROUP_SHARE)
  // Rounded to six places first so float noise (3 / 0.03) never asks one
  // more answer than the math says.
  return Math.ceil(Number((MIN_VOICES_PER_GROUP / share).toFixed(6)))
}
