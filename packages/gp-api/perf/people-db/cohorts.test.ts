import { describe, it, expect } from 'vitest'
import { COHORTS, checkDrift, type Cohort } from './cohorts'

describe('COHORTS', () => {
  it('has one district per band with valid ranges', () => {
    expect(COHORTS.map((c) => c.band)).toEqual([
      'small',
      'medium',
      'large',
      'statewide',
    ])
    for (const c of COHORTS) {
      expect(c.districtId).toMatch(/^[0-9a-f-]{36}$/)
      expect(c.expectedMax).toBeGreaterThan(c.expectedMin)
    }
  })
})

describe('checkDrift', () => {
  const cohort: Cohort = {
    band: 'small',
    districtId: 'x',
    expectedMin: 4000,
    expectedMax: 6000,
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
