import { describe, expect, it } from 'vitest'
import { parseElectionYear } from './parseElectionYear'

describe('parseElectionYear', () => {
  it('reads ISO dates', () => {
    expect(parseElectionYear('2026-05-02')).toBe(2026)
  })

  it('reads epoch-ms strings (ENG-11293)', () => {
    expect(parseElectionYear('1777680000000')).toBe(2026)
  })

  it('reads epoch-seconds strings', () => {
    expect(parseElectionYear('1777680000')).toBe(2026)
  })

  it('returns 0 for empty or garbage input', () => {
    expect(parseElectionYear(null)).toBe(0)
    expect(parseElectionYear('')).toBe(0)
    expect(parseElectionYear('not-a-date')).toBe(0)
  })
})
