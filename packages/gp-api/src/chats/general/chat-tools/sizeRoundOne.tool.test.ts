import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { WalkableAreaBox } from '@goodparty_org/contracts'
import type { Organization } from '../../../generated/prisma'
import type {
  AcsCounts,
  DistrictCell,
} from '@/peopleDb/databricks/districtCensusSql.util'
import type { WeightingCensus } from '@/priorities/util/censusWeighting.util'
import {
  buildSizeRoundOneTool,
  ROUND_ONE_AUDIENCES,
  sameWalkableArea,
  walkableAreaPolygon,
} from './sizeRoundOne.tool'

const ORGANIZATION = { slug: 'eo-maple' } as Organization
const PRIORITY_ID = 'pri-1'

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
// The walkable area's residents, mixed like the district.
const AREA: DistrictCell[] = [
  cell('35to44', 't1', 'white', 60),
  cell('65plus', 't2', 'black', 30),
  cell('35to44', 't3', 'hispanic', 10),
]

const doorsAt = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    lat: 35.6 + index * 0.0001,
    lng: -82.55 + index * 0.0001,
    personIds: [`p-${index}`],
  }))

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
  pools = { door: POOL, phone: POOL, text: POOL },
  area = AREA,
  census = CENSUS,
  planHoursPerWeek = 1,
}: {
  pools?: { door: DistrictCell[]; phone: DistrictCell[]; text: DistrictCell[] }
  area?: DistrictCell[]
  census?: WeightingCensus | null
  planHoursPerWeek?: number | null
} = {}) => {
  const countByGroupWithin = vi.fn(
    (
      _org: Organization,
      criteria: Record<string, boolean>,
      within?: string[],
    ) =>
      Promise.resolve(
        within !== undefined
          ? area
          : criteria.hasCellPhone
            ? pools.text
            : criteria.hasAnyPhone
              ? pools.phone
              : pools.door,
      ),
  )
  const resolveGeoMemberIds = vi.fn(() => Promise.resolve(['p-0', 'p-1']))
  const districtCensus = vi.fn(() => Promise.resolve(census))
  const roundOneDoorArea = vi.fn(
    (_org: Organization, _id: string, _c: object, households: number) =>
      Promise.resolve(doorsAt(households)),
  )
  const areas: WalkableAreaBox[] = []
  const tool = buildSizeRoundOneTool({
    contacts: { countByGroupWithin, resolveGeoMemberIds },
    priorityResults: { districtCensus, roundOneDoorArea },
    organization: ORGANIZATION,
    priorityId: PRIORITY_ID,
    planHoursPerWeek,
    onArea: (box) => areas.push(box),
  })
  return {
    tool,
    areas,
    countByGroupWithin,
    resolveGeoMemberIds,
    roundOneDoorArea,
  }
}

describe('size_round_one', () => {
  it('sizes one walkable area of doors, the calls and a text', async () => {
    const {
      tool,
      areas,
      countByGroupWithin,
      resolveGeoMemberIds,
      roundOneDoorArea,
    } = build()
    const result = await tool.execute({})

    for (const criteria of Object.values(ROUND_ONE_AUDIENCES)) {
      expect(countByGroupWithin).toHaveBeenCalledWith(ORGANIZATION, criteria)
    }
    // The hours buy 40 doors, all in the one area the priority picks.
    expect(roundOneDoorArea).toHaveBeenCalledWith(
      ORGANIZATION,
      PRIORITY_ID,
      ROUND_ONE_AUDIENCES.doorKnocking,
      40,
    )
    expect(areas).toHaveLength(1)
    const [area] = areas
    if (area === undefined) throw new Error('expected an area')
    // The door part is counted from who lives in that area.
    expect(resolveGeoMemberIds).toHaveBeenCalledWith(
      ORGANIZATION,
      walkableAreaPolygon(area),
    )
    expect(countByGroupWithin).toHaveBeenCalledWith(
      ORGANIZATION,
      ROUND_ONE_AUDIENCES.doorKnocking,
      ['p-0', 'p-1'],
    )
    expect(area.west).toBeLessThan(-82.55)
    expect(area.north).toBeGreaterThan(35.6039)
    expect(result).toEqual({
      hoursPerWeek: 1,
      cards: [
        {
          channel: 'doorKnocking',
          audienceFilters: { notContactedRecently: true },
          count: 100,
          doors: 40,
          walkableArea: area,
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
          // One purchase of 817: half now, the rest held for the follow-up.
          sampleSize: 409,
          roundTwoSize: 408,
          targetResponses: 24,
          assumedReplyRate: 0.03,
          civicPanelAsk: true,
        },
      ],
      textCost: expect.any(Number),
      coversEveryGroup: true,
    })
  })

  it('sizes the text bigger when the area holds one group only', async () => {
    const { tool } = build({ area: [cell('35to44', 't1', 'white', 100)] })
    expect(await tool.execute({})).toMatchObject({
      cards: expect.arrayContaining([
        expect.objectContaining({
          channel: 'text',
          sampleSize: 475,
          roundTwoSize: 475,
        }),
      ]),
    })
  })

  it('offers no door card when the area reaches nobody', async () => {
    const { tool, areas } = build({ area: [] })
    const result = await tool.execute({})
    expect(result).toMatchObject({
      cards: [
        expect.objectContaining({ channel: 'phoneBanking' }),
        expect.objectContaining({ channel: 'text' }),
      ],
    })
    expect(areas).toEqual([])
  })

  it('uses the weekly time the official just gave over none', async () => {
    const { tool, roundOneDoorArea } = build({ planHoursPerWeek: null })
    const result = await tool.execute({ hoursPerWeek: 20 })
    expect(result).toMatchObject({ hoursPerWeek: 20 })
    expect(roundOneDoorArea).toHaveBeenCalledWith(
      ORGANIZATION,
      PRIORITY_ID,
      ROUND_ONE_AUDIENCES.doorKnocking,
      200,
    )
  })

  it('asks for the weekly time when nobody has given it', async () => {
    const { tool, countByGroupWithin } = build({ planHoursPerWeek: null })
    expect(await tool.execute({})).toEqual({
      error: expect.stringContaining(
        'How much time can you spend each week to connect with constituents by phone or in person?',
      ),
    })
    expect(countByGroupWithin).not.toHaveBeenCalled()
  })

  it('sizes from who the doors reach when the census cannot be read', async () => {
    const { tool } = build({ census: null })
    expect(await tool.execute({})).toMatchObject({
      cards: expect.arrayContaining([
        expect.objectContaining({
          channel: 'text',
          sampleSize: 409,
          roundTwoSize: 408,
        }),
      ]),
    })
  })

  it('says when the cell phones cannot cover every group', async () => {
    const { tool } = build({
      pools: {
        door: POOL,
        phone: POOL,
        text: [cell('35to44', 't1', 'white', 300)],
      },
    })
    expect(await tool.execute({})).toMatchObject({
      coversEveryGroup: false,
    })
  })

  it('offers nothing when no channel reaches anyone', async () => {
    const { tool } = build({
      pools: { door: [], phone: [], text: [] },
      area: [],
    })
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

  it('relays a refused door area as a tool error', async () => {
    const { tool, resolveGeoMemberIds } = build()
    resolveGeoMemberIds.mockRejectedValueOnce(
      new ForbiddenException('Pro access required'),
    )
    expect(await tool.execute({})).toEqual({ error: 'Pro access required' })
  })
})

describe('sameWalkableArea', () => {
  const box = { west: -82.55, south: 35.6, east: -82.54, north: 35.61 }

  it('matches a box within the rounding and nothing further off', () => {
    expect(sameWalkableArea(box, { ...box, west: -82.5500004 })).toBe(true)
    expect(sameWalkableArea(box, { ...box, west: -82.551 })).toBe(false)
  })
})
