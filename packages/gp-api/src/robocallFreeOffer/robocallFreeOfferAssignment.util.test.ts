import { describe, expect, it } from 'vitest'
import { assignPrecincts } from './robocallFreeOfferAssignment.util'

// Always draws 0: no shuffle swaps, and the low side of an odd tie-break.
const lowest = () => 0
// Always draws the top of the range: the high side of an odd tie-break.
const highest = (max: number) => max - 1

const treatmentCount = (rows: { arm: string }[]) =>
  rows.filter((row) => row.arm === 'treatment').length

describe('assignPrecincts', () => {
  it('splits a fresh even district in half at p = 0.5', () => {
    const rows = assignPrecincts({
      totalKnown: 6,
      existingTreatment: 0,
      unassigned: ['a', 'b', 'c', 'd', 'e', 'f'],
      randomInt: lowest,
    })
    expect(rows).toHaveLength(6)
    expect(treatmentCount(rows)).toBe(3)
    expect(rows.every((row) => row.pTreatment === 0.5)).toBe(true)
  })

  it('rounds an odd district either way, and still reports p = 0.5', () => {
    const unassigned = ['a', 'b', 'c', 'd', 'e']
    const low = assignPrecincts({
      totalKnown: 5,
      existingTreatment: 0,
      unassigned,
      randomInt: lowest,
    })
    const high = assignPrecincts({
      totalKnown: 5,
      existingTreatment: 0,
      unassigned,
      randomInt: highest,
    })
    expect(treatmentCount(low)).toBe(2)
    expect(treatmentCount(high)).toBe(3)
    expect(low[0]?.pTreatment).toBe(0.5)
    expect(high[0]?.pTreatment).toBe(0.5)
  })

  it('counts treatment an overlapping district already assigned', () => {
    // 6 known, 2 already treatment and 1 already control: 1 more of the
    // 3 left is treatment, so each has a 1 in 3 chance.
    const rows = assignPrecincts({
      totalKnown: 6,
      existingTreatment: 2,
      unassigned: ['d', 'e', 'f'],
      randomInt: lowest,
    })
    expect(treatmentCount(rows)).toBe(1)
    expect(rows[0]?.pTreatment).toBeCloseTo(1 / 3)
  })

  it('assigns no treatment when the district is already past half', () => {
    const rows = assignPrecincts({
      totalKnown: 4,
      existingTreatment: 3,
      unassigned: ['d'],
      randomInt: lowest,
    })
    expect(rows).toEqual([{ key: 'd', arm: 'control', pTreatment: 0 }])
  })

  it('returns nothing when every precinct is already assigned', () => {
    expect(
      assignPrecincts({
        totalKnown: 4,
        existingTreatment: 2,
        unassigned: [],
        randomInt: lowest,
      }),
    ).toEqual([])
  })

  it('keeps every key exactly once', () => {
    const unassigned = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const rows = assignPrecincts({
      totalKnown: 7,
      existingTreatment: 0,
      unassigned,
      randomInt: highest,
    })
    expect(rows.map((row) => row.key).sort()).toEqual(unassigned)
  })
})
