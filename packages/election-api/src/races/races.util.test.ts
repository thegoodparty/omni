import { describe, expect, it } from 'vitest'
import { getDedupedRacesBySlug } from './races.util'

type TestRace = { slug: string; positionNames: string[] }

describe('getDedupedRacesBySlug', () => {
  it('returns an empty array for empty input', () => {
    expect(getDedupedRacesBySlug([])).toEqual([])
  })

  it('returns a single race unchanged', () => {
    const races: TestRace[] = [{ slug: 'mayor', positionNames: ['Mayor'] }]
    expect(getDedupedRacesBySlug(races)).toEqual([
      { slug: 'mayor', positionNames: ['Mayor'] },
    ])
  })

  it('merges races that share a slug into one', () => {
    const races: TestRace[] = [
      { slug: 'mayor', positionNames: ['Mayor'] },
      { slug: 'mayor', positionNames: ['City Mayor'] },
    ]
    const deduped = getDedupedRacesBySlug(races)
    expect(deduped).toHaveLength(1)
    expect(deduped[0].slug).toBe('mayor')
  })

  it('unions positionNames without duplicates when merging', () => {
    const races: TestRace[] = [
      { slug: 'council', positionNames: ['Council', 'At-Large'] },
      { slug: 'council', positionNames: ['At-Large', 'District 1'] },
    ]
    const deduped = getDedupedRacesBySlug(races)
    expect(deduped).toHaveLength(1)
    expect(deduped[0].positionNames).toEqual([
      'Council',
      'At-Large',
      'District 1',
    ])
  })

  it('keeps distinct slugs separate', () => {
    const races: TestRace[] = [
      { slug: 'mayor', positionNames: ['Mayor'] },
      { slug: 'council', positionNames: ['Council'] },
      { slug: 'mayor', positionNames: ['Mayor', 'Interim Mayor'] },
    ]
    const deduped = getDedupedRacesBySlug(races)
    expect(deduped).toHaveLength(2)
    expect(deduped.map((r) => r.slug)).toEqual(['mayor', 'council'])
    expect(deduped[0].positionNames).toEqual(['Mayor', 'Interim Mayor'])
  })

  it('does not mutate the input races', () => {
    const first: TestRace = { slug: 'mayor', positionNames: ['Mayor'] }
    const second: TestRace = { slug: 'mayor', positionNames: ['City Mayor'] }
    getDedupedRacesBySlug([first, second])
    expect(first.positionNames).toEqual(['Mayor'])
    expect(second.positionNames).toEqual(['City Mayor'])
  })
})
