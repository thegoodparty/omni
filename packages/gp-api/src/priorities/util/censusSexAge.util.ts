import {
  ADULT_AGE_BANDS,
  type AcsCounts,
  type AdultAgeBand,
} from '@/peopleDb/databricks/districtCensusSql.util'

// Census targets for weighting answers by sex and age. Adults only: the
// people who can answer. Census sex is male or female, the same two values
// the voter and consumer files carry in Gender ('M', 'F', or blank), so a
// respondent with a blank Gender sits out this dimension rather than being
// guessed.

export interface AdultSexShares {
  male: number
  female: number
}

const BAND_COUNTS: Record<
  AdultAgeBand,
  (c: AcsCounts) => [number | null, number | null]
> = {
  '18to24': (c) => [c.populationMale18To24, c.populationFemale18To24],
  '25to34': (c) => [c.populationMale25To34, c.populationFemale25To34],
  '35to44': (c) => [c.populationMale35To44, c.populationFemale35To44],
  '45to54': (c) => [c.populationMale45To54, c.populationFemale45To54],
  '55to64': (c) => [c.populationMale55To64, c.populationFemale55To64],
  '65plus': (c) => [c.populationMale65Plus, c.populationFemale65Plus],
}

// Any suppressed or negative part makes the whole split unknown: a split
// over some of the people would mislead a weight more than no split.
const toShares = (
  parts: ReadonlyArray<readonly [string, number | null]>,
): Record<string, number> | null => {
  let total = 0
  for (const [, value] of parts) {
    if (value === null || value < 0) return null
    total += value
  }
  if (total <= 0) return null
  return Object.fromEntries(
    parts.map(([key, value]) => [key, (value ?? 0) / total]),
  )
}

export const adultSexShares = (district: AcsCounts): AdultSexShares | null => {
  const shares = toShares([
    ['male', district.populationMale18Plus],
    ['female', district.populationFemale18Plus],
  ])
  return shares ? { male: shares.male ?? 0, female: shares.female ?? 0 } : null
}

// Both sexes together, keyed by AdultAgeBand: the shape weighting targets
// take.
export const adultAgeBandShares = (
  district: AcsCounts,
): Record<string, number> | null =>
  toShares(
    ADULT_AGE_BANDS.map(({ key }) => {
      const [male, female] = BAND_COUNTS[key](district)
      return [key, male === null || female === null ? null : male + female]
    }),
  )
