import { describe, expect, it, vi } from 'vitest'
import { MIN_RESPONDENTS_FOR_REPRESENTATION } from '@goodparty_org/contracts'
import {
  ACS_COUNT_KEYS,
  type AcsCounts,
} from '@/peopleDb/databricks/districtCensusSql.util'
import { StatsService } from '@/peopleDb/services/stats.service'
import {
  DistrictCensusComposition,
  representationFrom,
} from './censusComposition'

const counts = (value: number): AcsCounts =>
  Object.fromEntries(ACS_COUNT_KEYS.map((key) => [key, value])) as AcsCounts

const INPUT = {
  districtId: 'd-1',
  dataset: 'voters' as const,
  personIds: ['0190a1b2-0000-7000-8000-00000000000a'],
}

const build = (
  findCensusComposition: StatsService['findCensusComposition'],
) => {
  const warn = vi.fn()
  const source = new DistrictCensusComposition(
    { findCensusComposition } as StatsService,
    { setContext: vi.fn(), warn } as never,
  )
  return { source, warn }
}

describe('DistrictCensusComposition', () => {
  it('passes the district row and placed people through', async () => {
    const district = counts(100)
    const placed = [counts(5), counts(5)]
    const read = vi.fn().mockResolvedValue({
      district,
      respondentBlockGroups: placed,
    })
    const { source } = build(read)

    expect(await source.compose(INPUT)).toEqual({
      available: true,
      district,
      respondentBlockGroups: placed,
    })
    expect(read).toHaveBeenCalledWith('d-1', 'voters', INPUT.personIds)
  })

  it('reads a district with no census row as unavailable', async () => {
    const { source } = build(
      vi.fn().mockResolvedValue({
        district: null,
        respondentBlockGroups: [counts(5)],
      }),
    )

    expect(await source.compose(INPUT)).toEqual({ available: false })
  })

  it('isolates a warehouse failure as unavailable, logged at warn', async () => {
    const { source, warn } = build(
      vi.fn().mockRejectedValue(new Error('warehouse timeout')),
    )

    expect(await source.compose(INPUT)).toEqual({ available: false })
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('representationFrom', () => {
  const placed = (n: number) => Array.from({ length: n }, () => counts(10))

  it('shows unavailable census as a comparison with no rows', () => {
    expect(representationFrom({ available: false }, 40)).toEqual({
      respondentCount: 40,
      groups: [],
    })
  })

  it('withholds the comparison when too few people were placed', () => {
    expect(
      representationFrom(
        {
          available: true,
          district: counts(10),
          respondentBlockGroups: placed(MIN_RESPONDENTS_FOR_REPRESENTATION - 1),
        },
        50,
      ),
    ).toBeNull()
  })

  it('counts the people placed, not the people asked about', () => {
    const representation = representationFrom(
      {
        available: true,
        district: counts(10),
        respondentBlockGroups: placed(MIN_RESPONDENTS_FOR_REPRESENTATION),
      },
      50,
    )
    expect(representation?.respondentCount).toBe(
      MIN_RESPONDENTS_FOR_REPRESENTATION,
    )
    expect(representation?.groups.length).toBeGreaterThan(0)
  })
})
