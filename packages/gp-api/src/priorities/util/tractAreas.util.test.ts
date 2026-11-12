import { describe, expect, it } from 'vitest'
import { MAJOR_GROUP_SHARE } from '@goodparty_org/contracts'
import { POOLED_VALUE } from './censusWeighting.util'
import { MAX_TRACTS_READ_ALONE, tractAreas } from './tractAreas.util'

const tractsIn = (county: string, count: number, adults = 1000) =>
  Array.from({ length: count }, (_, i): [string, number] => [
    `${county}${String(i + 1).padStart(6, '0')}`,
    adults,
  ])

const sharesOf = (areas: Map<string, string>, adults: Map<string, number>) => {
  const total = [...adults.values()].reduce((sum, count) => sum + count, 0)
  const held = new Map<string, number>()
  for (const [tract, area] of areas) {
    held.set(area, (held.get(area) ?? 0) + (adults.get(tract) ?? 0) / total)
  }
  return held
}

describe('tractAreas', () => {
  it('reads a district of up to MAX_TRACTS_READ_ALONE tracts by tract', () => {
    expect(
      tractAreas(new Map(tractsIn('37119', MAX_TRACTS_READ_ALONE))),
    ).toBeNull()
  })

  it('splits a one-county district into runs of tracts, each a major group', () => {
    const adults = new Map(tractsIn('37119', 800))

    const areas = tractAreas(adults)

    const shares = sharesOf(areas ?? new Map(), adults)
    expect(shares.size).toBe(30)
    expect([...shares.keys()]).toContain('37119:1')
    expect([...shares.keys()]).toContain('37119:30')
    expect(Math.min(...shares.values())).toBeGreaterThanOrEqual(
      MAJOR_GROUP_SHARE,
    )
    // Runs follow GEOID order: the first tracts make the first area.
    expect(areas?.get('37119000001')).toBe('37119:1')
    expect(areas?.get('37119000800')).toBe('37119:30')
  })

  it('keeps a mid-sized county whole and pools the smallest', () => {
    const adults = new Map([
      ...tractsIn('37119', 900),
      ...tractsIn('37183', 50),
      ...tractsIn('37001', 40),
      ...tractsIn('37003', 5),
      ...tractsIn('37005', 5),
    ])

    const areas = tractAreas(adults)

    // 50 of 1,000 tracts is 5%, under two areas' worth: one whole county.
    expect(areas?.get('37183000001')).toBe('37183')
    expect(areas?.get('37183000050')).toBe('37183')
    // 4% stays whole too; 0.5% pools.
    expect(areas?.get('37001000001')).toBe('37001')
    expect(areas?.get('37003000001')).toBe(POOLED_VALUE)
    expect(areas?.get('37005000005')).toBe(POOLED_VALUE)
    // 90% splits into 27 runs.
    const pieces = new Set(
      [...(areas ?? new Map()).entries()]
        .filter(([tract]) => tract.startsWith('37119'))
        .map(([, area]) => area),
    )
    expect(pieces.size).toBe(27)
  })

  it('sizes runs by adults, not by tract count', () => {
    // The first 100 tracts hold three times the adults of the rest.
    const adults = new Map([
      ...tractsIn('37119', 100, 3000),
      ...tractsIn('37119', 400).map(([tract, count]): [string, number] => [
        `37119${String(Number(tract.slice(5)) + 100).padStart(6, '0')}`,
        count,
      ]),
    ])

    const shares = sharesOf(tractAreas(adults) ?? new Map(), adults)

    expect(shares.size).toBe(30)
    for (const share of shares.values()) expect(share).toBeCloseTo(1 / 30, 2)
  })

  it('gives the same areas whatever order the tracts come in', () => {
    const tracts = [...tractsIn('37119', 70), ...tractsIn('37183', 30)]
    expect(tractAreas(new Map([...tracts].reverse()))).toEqual(
      tractAreas(new Map(tracts)),
    )
  })
})
