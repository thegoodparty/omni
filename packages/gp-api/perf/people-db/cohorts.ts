export type Band = 'small' | 'medium' | 'large' | 'statewide'

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
