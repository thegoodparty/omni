export type Band = 'small' | 'medium' | 'large' | 'mega' | 'statewide'

export type Cohort = {
  band: Band
  districtId: string
  expectedMin: number
  expectedMax: number
}

// Pinned from prod people-db (green."DistrictStats") on 2026-07-31; re-run the
// discovery query in the plan if checkDrift starts warning. Ranges are wide
// bands, not exact counts, so ordinary data refreshes do not trip the guard.
export const COHORTS: readonly Cohort[] = [
  {
    band: 'small',
    districtId: '0ac8551e-b5ab-2ef0-a941-94e8b43b1e1e',
    expectedMin: 3000,
    expectedMax: 12000,
  }, // SAN BUENAVENTURA VLG WARD 1 (7998)
  {
    band: 'medium',
    districtId: 'e8eb34fd-c89d-f4d8-3f66-f4b4b2882e34',
    expectedMin: 35000,
    expectedMax: 90000,
  }, // CARSON CITY EST. (64926)
  {
    band: 'large',
    districtId: '635757db-05b1-3ade-ad90-02fb1aef5476',
    expectedMin: 150000,
    expectedMax: 500000,
  }, // US Congressional District 29 (399907)
  // Pinned 2026-08-16. The only NON-CA cohort, and that is the point: every
  // other band is a California district, so the suite could not separate
  // "big district" from "big state partition". Orange County FL has 2.3x the
  // membership of `large` yet the unfiltered getAggregates measured 1.7s warm
  // against `large`'s 18.7s (and a 25s timeout cold) — DistrictVoter_CA is
  // 429M rows / 63GB vs FL's 116M / 17GB. Membership size is not the driver;
  // per-member probe cost into the state partition is. Keep this cell so a
  // regression in one can never be mistaken for the other.
  {
    band: 'mega',
    districtId: '0d75291d-7cfe-8ebf-c604-a68e95f6f66d',
    expectedMin: 600_000,
    expectedMax: 1_500_000,
  }, // County ORANGE FL (898598)
  // NOT the heaviest cell despite the row count: resolveDistrict.util.ts sets
  // useVoterOnlyPath when type === 'State' && name === state, which nulls the
  // districtId and drops the DistrictVoter join for a single partition-pruned
  // Voter scan. Keep it as the no-join control, not as the worst case.
  {
    band: 'statewide',
    districtId: '84ff95bb-f3a4-f6ea-b802-4f7cd4b5ac6c',
    expectedMin: 15_000_000,
    expectedMax: 30_000_000,
  }, // State CA (23543563)
]

export const checkDrift = (
  cohort: Cohort,
  actualConstituents: number,
): { ok: boolean; message: string } => {
  const ok =
    actualConstituents >= cohort.expectedMin &&
    actualConstituents <= cohort.expectedMax
  return {
    ok,
    message: ok
      ? `${cohort.band}: ${actualConstituents} constituents (in band)`
      : `${cohort.band}: drift detected — ${actualConstituents} constituents outside [${cohort.expectedMin}, ${cohort.expectedMax}]; re-pin the district`,
  }
}
