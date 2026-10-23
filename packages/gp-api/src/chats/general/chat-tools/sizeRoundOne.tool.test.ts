import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { Organization } from '../../../generated/prisma'
import type {
  AcsCounts,
  DistrictCell,
} from '@/peopleDb/databricks/districtCensusSql.util'
import type { WeightingCensus } from '@/priorities/util/censusWeighting.util'
import { buildSizeRoundOneTool, ROUND_ONE_AUDIENCE } from './sizeRoundOne.tool'

const ORGANIZATION = { slug: 'eo-maple' } as Organization

const cell = (
  ageBand: DistrictCell['ageBand'],
  tract: string,
  race: DistrictCell['race'],
  count: number,
): DistrictCell => ({ ageBand, gender: 'female', tract, race, count })

const POOL: DistrictCell[] = [
  cell('35to44', 't1', 'white', 6_000),
  cell('65plus', 't2', 'black', 3_000),
  cell('35to44', 't3', 'hispanic', 1_000),
]

const district = (counts: Partial<AcsCounts>): AcsCounts =>
  ({
    // 10,000 adults in two of the six age bands; no 18+ sex totals, so
    // gender sits out.
    populationMale35To44: 3_500,
    populationFemale35To44: 3_500,
    populationMale65Plus: 1_500,
    populationFemale65Plus: 1_500,
    populationMale18Plus: null,
    populationFemale18Plus: null,
    totalPopulation: 12_000,
    populationUnder18: 2_000,
    population65Plus: 3_000,
    populationWhiteNh: 7_200,
    populationBlackNh: 3_600,
    populationHispanic: 1_200,
    populationAsianNh: 0,
    populationNativeAmericanNh: 0,
    populationOtherNh: 0,
    households: null,
    ownerOccupiedHouseholds: null,
    ...counts,
  }) as AcsCounts

const CENSUS: WeightingCensus = {
  district: district({}),
  tractAdults: new Map([
    ['t1', 6_000],
    ['t2', 3_000],
    ['t3', 1_000],
  ]),
}

const build = ({
  pool = POOL,
  census = CENSUS,
}: {
  pool?: DistrictCell[]
  census?: WeightingCensus | null
} = {}) => {
  const countByGroupWithin = vi.fn(() => Promise.resolve(pool))
  const districtCensus = vi.fn(() => Promise.resolve(census))
  const tool = buildSizeRoundOneTool({
    contacts: { countByGroupWithin },
    priorityResults: { districtCensus },
    organization: ORGANIZATION,
  })
  return { tool, countByGroupWithin }
}

const TEXT_CARD = {
  channel: 'text',
  audienceFilters: { notContactedRecently: true, hasCellPhone: true },
  count: 10_000,
  // One purchase of 1,000: half now, the rest held for the follow-up.
  sampleSize: 500,
  roundTwoSize: 500,
  targetResponses: 30,
  assumedReplyRate: 0.03,
  civicPanelAsk: true,
}

describe('size_round_one', () => {
  it('sizes one text across the district', async () => {
    const { tool, countByGroupWithin } = build()
    const result = await tool.execute({})

    expect(countByGroupWithin).toHaveBeenCalledWith(
      ORGANIZATION,
      ROUND_ONE_AUDIENCE,
    )
    expect(result).toEqual({
      cards: [TEXT_CARD],
      textCost: expect.any(Number),
      coversEveryGroup: true,
    })
  })

  it('sizes from who the text reaches when the census cannot be read', async () => {
    const { tool } = build({ census: null })
    expect(await tool.execute({})).toMatchObject({ cards: [TEXT_CARD] })
  })

  it('says when the cell phones cannot cover every group', async () => {
    const { tool } = build({ pool: [cell('35to44', 't1', 'white', 300)] })
    expect(await tool.execute({})).toMatchObject({
      coversEveryGroup: false,
    })
  })

  it('offers nothing when nobody can be texted', async () => {
    const { tool } = build({ pool: [] })
    expect(await tool.execute({})).toEqual({
      error: expect.stringContaining('Nobody in the district can be reached'),
    })
  })

  it('relays a refused count as a tool error', async () => {
    const { tool, countByGroupWithin } = build()
    countByGroupWithin.mockRejectedValueOnce(
      new BadRequestException('No district for this organization'),
    )
    expect(await tool.execute({})).toEqual({
      error: 'No district for this organization',
    })
  })
})
