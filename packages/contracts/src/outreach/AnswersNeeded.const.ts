/**
 * How many answers give a good read on a district: the sample size for a
 * margin of about 10 points either way at 95% confidence, when residents
 * split close to evenly, corrected for the district's size.
 */

/** z for 95% confidence. */
export const ANSWERS_CONFIDENCE_Z = 1.96

/** Within this share either way. */
export const ANSWERS_MARGIN_OF_ERROR = 0.1

/** p(1 - p) at a 50/50 split, the most answers any split needs. */
export const ANSWERS_SPLIT_VARIANCE = 0.25

/** ≈ 96.04, the answers needed before correcting for district size. */
export const ANSWERS_NEEDED_UNCORRECTED =
  (ANSWERS_CONFIDENCE_Z ** 2 * ANSWERS_SPLIT_VARIANCE) /
  ANSWERS_MARGIN_OF_ERROR ** 2

/**
 * Answers needed for a good read of a district of `population` residents.
 * An unknown or empty population gets the uncorrected figure.
 */
export const answersNeeded = (population?: number | null): number => {
  const n0 = ANSWERS_NEEDED_UNCORRECTED
  if (!population || population <= 0) return Math.round(n0)
  return Math.round(n0 / (1 + (n0 - 1) / population))
}
