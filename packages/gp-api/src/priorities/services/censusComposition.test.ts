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

describe('DistrictCensusComposition.mrpInputs', () => {
  // Asian under 2% of the district, so it folds into other.
  const DISTRICT = {
    ...counts(0),
    populationWhiteNh: 600,
    populationBlackNh: 300,
    populationHispanic: 80,
    populationAsianNh: 10,
    populationNativeAmericanNh: 5,
    populationOtherNh: 5,
  }
  const MODEL_INPUT = {
    districtId: 'd-1',
    dataset: 'voters' as const,
    answers: [{ personId: '0190a1b2-0000-7000-8000-00000000000a', yes: 1 }],
  }

  const withCells = (
    findDistrictCells: StatsService['findDistrictCells'],
    findAnswerCells: StatsService['findAnswerCells'],
  ) => {
    const warn = vi.fn()
    const source = new DistrictCensusComposition(
      { findDistrictCells, findAnswerCells } as StatsService,
      { setContext: vi.fn(), warn } as never,
    )
    return { source, warn }
  }

  it('puts the district and the answers in the same cells, race folded', async () => {
    const { source } = withCells(
      vi.fn().mockResolvedValue({
        district: DISTRICT,
        cells: [
          {
            ageBand: '18to64',
            gender: 'female',
            tract: '53017950100',
            race: 'asian',
            count: 40,
          },
          {
            ageBand: '65plus',
            gender: null,
            tract: null,
            race: null,
            count: 9,
          },
        ],
      }),
      vi.fn().mockResolvedValue([
        {
          ageBand: '18to64',
          gender: 'female',
          tract: '53017950100',
          race: 'black',
          yes: 1.5,
          count: 2,
        },
      ]),
    )

    expect(await source.mrpInputs(MODEL_INPUT)).toEqual({
      frame: [
        {
          count: 40,
          values: {
            age: '18to64',
            gender: 'female',
            tract: '53017950100',
            race: 'other',
          },
        },
        { count: 9, values: { age: '65plus' } },
      ],
      answers: [
        {
          yes: 1.5,
          answers: 2,
          values: {
            age: '18to64',
            gender: 'female',
            tract: '53017950100',
            race: 'black',
          },
        },
      ],
      raceNameable: false,
    })
  })

  it('leaves race out when the census has no race figures', async () => {
    const { source } = withCells(
      vi.fn().mockResolvedValue({
        district: { ...DISTRICT, populationWhiteNh: null },
        cells: [
          {
            ageBand: '18to64',
            gender: null,
            tract: null,
            race: 'white',
            count: 4,
          },
        ],
      }),
      vi.fn().mockResolvedValue([]),
    )

    const inputs = await source.mrpInputs(MODEL_INPUT)
    expect(inputs?.frame).toEqual([{ count: 4, values: { age: '18to64' } }])
  })

  it('reads a district with no census row as no read', async () => {
    const { source } = withCells(
      vi.fn().mockResolvedValue({ district: null, cells: [] }),
      vi.fn().mockResolvedValue([]),
    )
    expect(await source.mrpInputs(MODEL_INPUT)).toBeNull()
  })

  it('reads the district once for every priority, and again after a failure', async () => {
    const district = vi
      .fn()
      .mockRejectedValueOnce(new Error('warehouse down'))
      .mockResolvedValue({
        district: DISTRICT,
        cells: [
          {
            ageBand: '18to64',
            gender: null,
            tract: null,
            race: null,
            count: 4,
          },
        ],
      })
    const { source, warn } = withCells(district, vi.fn().mockResolvedValue([]))

    expect(await source.mrpInputs(MODEL_INPUT)).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
    await Promise.all([
      source.mrpInputs(MODEL_INPUT),
      source.mrpInputs({ ...MODEL_INPUT, answers: [] }),
    ])
    expect(await source.mrpInputs(MODEL_INPUT)).not.toBeNull()
    expect(district).toHaveBeenCalledTimes(2)
  })

  describe('districtAnswersNeeded', () => {
    const cell = (
      ageBand: string,
      gender: string,
      tract: string,
      race: string | null,
      count: number,
    ) => ({ ageBand, gender, tract, race, count })
    const sizeFor = (cells: ReturnType<typeof cell>[]) =>
      withCells(
        vi.fn().mockResolvedValue({ district: DISTRICT, cells }),
        vi.fn(),
      ).source.districtAnswersNeeded(MODEL_INPUT)

    it('sizes for the smallest group holding 3% or more', async () => {
      expect(
        await sizeFor([
          cell('18to64', 'female', 'a', null, 760),
          cell('65plus', 'male', 'a', null, 200),
          cell('18to64', 'male', 'b', null, 40),
        ]),
      ).toBe(75)
    })

    it('leaves a group under 3% out of the sizing', async () => {
      expect(
        await sizeFor([
          cell('18to64', 'female', 'a', null, 760),
          cell('65plus', 'male', 'a', null, 200),
          cell('18to64', 'male', 'b', null, 20),
        ]),
      ).toBe(15)
    })

    it('sizes for race only when it may be named', async () => {
      const cells = [
        cell('18to64', 'female', 'a', 'white', 650),
        cell('65plus', 'male', 'a', 'black', 300),
        cell('18to64', 'male', 'a', 'hispanic', 50),
      ]
      expect(await sizeFor(cells)).toBe(60)
      expect(
        await sizeFor([...cells, cell('18to64', 'female', 'a', null, 1_000)]),
      ).toBe(20)
    })

    it('reads no census row, or a failure, as unknown', async () => {
      expect(
        await withCells(
          vi.fn().mockResolvedValue({ district: null, cells: [] }),
          vi.fn(),
        ).source.districtAnswersNeeded(MODEL_INPUT),
      ).toBeNull()
      const { source, warn } = withCells(
        vi.fn().mockRejectedValue(new Error('warehouse down')),
        vi.fn(),
      )
      expect(await source.districtAnswersNeeded(MODEL_INPUT)).toBeNull()
      expect(warn).toHaveBeenCalledOnce()
    })
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
