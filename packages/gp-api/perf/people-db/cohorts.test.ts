import { describe, it, expect } from 'vitest'
import { COHORTS, checkDrift, type Cohort } from './cohorts'

describe('COHORTS', () => {
  it('has one district per band with valid ranges', () => {
    expect(COHORTS.map((c) => c.band)).toEqual([
      'small',
      'medium',
      'large',
      'mega',
      'statewide',
    ])
    for (const c of COHORTS) {
      expect(c.districtId).toMatch(/^[0-9a-f-]{36}$/)
      expect(c.expectedMax).toBeGreaterThan(c.expectedMin)
    }
  })

  it('covers the join-path size range where getAggregates times out', () => {
    const large = COHORTS.find((c) => c.band === 'large')
    const mega = COHORTS.find((c) => c.band === 'mega')
    // Non-statewide districts pay the DistrictVoter join; production 504s
    // cluster above `large`, so mega must sit strictly beyond it and stay
    // below statewide (which takes the no-join useVoterOnlyPath).
    expect(mega?.expectedMin).toBeGreaterThan(large?.expectedMax ?? 0)
    const statewide = COHORTS.find((c) => c.band === 'statewide')
    expect(mega?.expectedMax).toBeLessThan(statewide?.expectedMin ?? 0)
  })
})

describe('checkDrift', () => {
  const cohort: Cohort = {
    band: 'small',
    districtId: 'x',
    expectedMin: 4000,
    expectedMax: 6000,
    district: 'a district',
    partition: 'CA (429M rows / 63GB)',
    description: 'a cohort',
  }
  it('passes when the actual count is inside the band', () => {
    expect(checkDrift(cohort, 5000).ok).toBe(true)
  })
  it('fails and explains when the actual count has drifted', () => {
    const r = checkDrift(cohort, 50)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('drift')
  })
})
