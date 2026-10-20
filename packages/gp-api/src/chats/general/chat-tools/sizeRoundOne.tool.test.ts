import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { Organization } from '../../../generated/prisma'
import type {
  AcsCounts,
  DistrictCell,
} from '@/peopleDb/databricks/districtCensusSql.util'
import type { WeightingCensus } from '@/priorities/util/censusWeighting.util'
import { buildSizeRoundOneTool, ROUND_ONE_AUDIENCES } from './sizeRoundOne.tool'

const ORGANIZATION = { slug: 'eo-maple' } as Organization

const cell = (
  ageBand: DistrictCell['ageBand'],
  tract: string,
  race: DistrictCell['race'],
  count: number,
): DistrictCell => ({ ageBand, gender: 'female', tract, race, count })

const POOL: DistrictCell[] = [
  cell('18to64', 't1', 'white', 6_000),
  cell('65plus', 't2', 'black', 3_000),
  cell('18to64', 't3', 'hispanic', 1_000),
]

const district = (counts: Partial<AcsCounts>): AcsCounts =>
  ({
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
  pools = { door: POOL, phone: POOL, text: POOL },
  census = CENSUS,
  planHoursPerWeek = 1,
}: {
  pools?: { door: DistrictCell[]; phone: DistrictCell[]; text: DistrictCell[] }
  census?: WeightingCensus | null
  planHoursPerWeek?: number | null
} = {}) => {
  const countByGroupWithin = vi.fn(
    (_org: Organization, criteria: Record<string, boolean>) =>
      Promise.resolve(
        criteria.hasCellPhone
          ? pools.text
          : criteria.hasAnyPhone
            ? pools.phone
            : pools.door,
      ),
  )
  const districtCensus = vi.fn(() => Promise.resolve(census))
  const tool = buildSizeRoundOneTool({
    contacts: { countByGroupWithin },
    priorityResults: { districtCensus },
    organization: ORGANIZATION,
    planHoursPerWeek,
  })
  return { tool, countByGroupWithin, districtCensus }
}

describe('size_round_one', () => {
  it('sizes a door, a call and a text card from the plan hours', async () => {
    const { tool, countByGroupWithin } = build()
    const result = await tool.execute({})

    expect(countByGroupWithin).toHaveBeenCalledWith(
      ORGANIZATION,
      ROUND_ONE_AUDIENCES.doorKnocking,
    )
    expect(countByGroupWithin).toHaveBeenCalledWith(
      ORGANIZATION,
      ROUND_ONE_AUDIENCES.phoneBanking,
    )
    expect(countByGroupWithin).toHaveBeenCalledWith(
      ORGANIZATION,
      ROUND_ONE_AUDIENCES.text,
    )
    expect(result).toEqual({
      hoursPerWeek: 1,
      cards: [
        {
          channel: 'doorKnocking',
          audienceFilters: { notContactedRecently: true },
          count: 10_000,
          sampleSize: 40,
        },
        {
          channel: 'phoneBanking',
          audienceFilters: { notContactedRecently: true, hasAnyPhone: true },
          count: 10_000,
          sampleSize: 30,
        },
        {
          channel: 'text',
          audienceFilters: { notContactedRecently: true, hasCellPhone: true },
          count: 10_000,
          sampleSize: 817,
          targetResponses: 24,
          assumedReplyRate: 0.03,
          civicPanelAsk: true,
        },
      ],
      textCost: expect.any(Number),
      coversEveryGroup: true,
    })
  })

  it('uses the weekly time the official just gave over none', async () => {
    const { tool } = build({ planHoursPerWeek: null })
    const result = await tool.execute({ hoursPerWeek: 20 })
    expect(result).toMatchObject({
      hoursPerWeek: 20,
      cards: expect.arrayContaining([
        expect.objectContaining({ channel: 'doorKnocking', sampleSize: 200 }),
      ]),
    })
  })

  it('asks for the weekly time when nobody has given it', async () => {
    const { tool, countByGroupWithin } = build({ planHoursPerWeek: null })
    expect(await tool.execute({})).toEqual({
      error: expect.stringContaining('How much time can you give each week?'),
    })
    expect(countByGroupWithin).not.toHaveBeenCalled()
  })

  it('sizes from who the doors reach when the census cannot be read', async () => {
    const { tool } = build({ census: null })
    expect(await tool.execute({})).toMatchObject({
      cards: expect.arrayContaining([
        expect.objectContaining({ channel: 'text', sampleSize: 817 }),
      ]),
    })
  })

  it('says when the cell phones cannot cover every group', async () => {
    const { tool } = build({
      pools: {
        door: POOL,
        phone: POOL,
        text: [cell('18to64', 't1', 'white', 300)],
      },
    })
    expect(await tool.execute({})).toMatchObject({
      coversEveryGroup: false,
    })
  })

  it('offers nothing when no channel reaches anyone', async () => {
    const { tool } = build({ pools: { door: [], phone: [], text: [] } })
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
