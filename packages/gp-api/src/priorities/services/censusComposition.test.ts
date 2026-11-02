import { describe, expect, it, vi } from 'vitest'
import {
  ACS_COUNT_KEYS,
  type AcsCounts,
  type DistrictCells,
} from '@/peopleDb/databricks/districtCensusSql.util'
import { StatsService } from '@/peopleDb/services/stats.service'
import type { MrpFrameCell } from '../util/mrp.util'
import { DistrictCensusComposition } from './censusComposition'

const counts = (value: number): AcsCounts =>
  Object.fromEntries(ACS_COUNT_KEYS.map((key) => [key, value])) as AcsCounts

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
    dataset: { base: 'voters' as const },
    answers: [{ personId: '0190a1b2-0000-7000-8000-00000000000a', yes: 1 }],
  }

  const withCells = (
    findDistrictCells: (
      ...args: Parameters<StatsService['findDistrictCells']>
    ) => Promise<
      Omit<DistrictCells, 'tractAdults'> &
        Partial<Pick<DistrictCells, 'tractAdults'>>
    >,
    findAnswerCells: StatsService['findAnswerCells'],
  ) => {
    const warn = vi.fn()
    const source = new DistrictCensusComposition(
      {
        findDistrictCells: (...args) =>
          findDistrictCells(...args).then((read) => ({
            tractAdults: new Map<string, number>(),
            ...read,
          })),
        findAnswerCells,
      } as StatsService,
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

  describe('census age, sex and tract margins', () => {
    const SEX_AGE = {
      ...DISTRICT,
      populationMale18To24: 100,
      populationFemale18To24: 100,
      populationMale25To34: 0,
      populationFemale25To34: 0,
      populationMale35To44: 0,
      populationFemale35To44: 0,
      populationMale45To54: 0,
      populationFemale45To54: 0,
      populationMale55To64: 0,
      populationFemale55To64: 0,
      populationMale65Plus: 300,
      populationFemale65Plus: 300,
      populationMale18Plus: 400,
      populationFemale18Plus: 400,
    }
    // The voter file is 80% young; the census says a quarter.
    const voterCell = (
      ageBand: string,
      gender: string,
      tract: string,
      count: number,
    ) => ({ ageBand, gender, tract, race: null, count })
    const VOTER_CELLS = [
      voterCell('18to24', 'male', 'a', 20),
      voterCell('18to24', 'female', 'a', 20),
      voterCell('18to24', 'male', 'b', 20),
      voterCell('18to24', 'female', 'b', 20),
      voterCell('65plus', 'male', 'a', 5),
      voterCell('65plus', 'female', 'a', 5),
      voterCell('65plus', 'male', 'b', 5),
      voterCell('65plus', 'female', 'b', 5),
    ]
    const total = (frame: MrpFrameCell[]) =>
      frame.reduce((sum, c) => sum + c.count, 0)
    const share = (frame: MrpFrameCell[], dimension: string, value: string) =>
      total(frame.filter((c) => c.values[dimension] === value)) / total(frame)

    it('poststratifies the frame to census sex by age and tract adults', async () => {
      const { source, warn } = withCells(
        vi.fn().mockResolvedValue({
          district: SEX_AGE,
          cells: VOTER_CELLS,
          tractAdults: new Map([
            ['a', 500],
            ['b', 500],
          ]),
        }),
        vi.fn().mockResolvedValue([]),
      )

      const inputs = await source.mrpInputs(MODEL_INPUT)

      expect(share(inputs?.frame ?? [], 'age', '18to24')).toBeCloseTo(0.25)
      expect(share(inputs?.frame ?? [], 'age', '65plus')).toBeCloseTo(0.75)
      expect(share(inputs?.frame ?? [], 'tract', 'a')).toBeCloseTo(0.5)
      expect(warn).not.toHaveBeenCalled()
    })

    it('keeps the voter file for suppressed margins and logs it', async () => {
      const { source, warn } = withCells(
        vi.fn().mockResolvedValue({
          district: { ...SEX_AGE, populationMale65Plus: null },
          cells: VOTER_CELLS,
          tractAdults: new Map(),
        }),
        vi.fn().mockResolvedValue([]),
      )

      const inputs = await source.mrpInputs(MODEL_INPUT)

      expect(share(inputs?.frame ?? [], 'age', '18to24')).toBeCloseTo(0.8)
      expect(warn).toHaveBeenCalledWith(
        { districtId: 'd-1', dimensions: ['age', 'tract'] },
        expect.stringContaining('voter file'),
      )
    })

    it('sits an answer out of a tract the frame does not hold', async () => {
      const { source } = withCells(
        vi.fn().mockResolvedValue({
          district: SEX_AGE,
          cells: VOTER_CELLS,
          tractAdults: new Map([['a', 500]]),
        }),
        vi.fn().mockResolvedValue([
          {
            ageBand: '18to24',
            gender: 'male',
            tract: 'b',
            race: null,
            yes: 1,
            count: 1,
          },
        ]),
      )

      const inputs = await source.mrpInputs(MODEL_INPUT)

      expect(inputs?.answers[0]?.values).toMatchObject({
        age: '18to24',
        tract: null,
      })
    })

    it('sizes major groups on the same frame', async () => {
      // The census puts the younger band at 25%, so the smallest major
      // group is a quarter of the district: 12 answers, not the 15 a voter
      // file's 20% group would ask for.
      const { source } = withCells(
        vi.fn().mockResolvedValue({
          district: SEX_AGE,
          cells: VOTER_CELLS,
          tractAdults: new Map([
            ['a', 500],
            ['b', 500],
          ]),
        }),
        vi.fn(),
      )

      expect(await source.districtAnswersNeeded(MODEL_INPUT)).toBe(12)
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

  it('never shares a district read between orgs with different datasets', async () => {
    const district = vi.fn().mockResolvedValue({
      district: DISTRICT,
      cells: [],
    })
    const { source } = withCells(district, vi.fn().mockResolvedValue([]))

    await source.mrpInputs(MODEL_INPUT)
    await source.mrpInputs({
      ...MODEL_INPUT,
      dataset: { base: 'constituents' },
    })
    await source.mrpInputs({
      ...MODEL_INPUT,
      dataset: {
        base: 'constituents',
        overlayOrgSlug: 'eo-1',
        overlayDistrictId: 'd-1',
      },
    })
    await source.mrpInputs({
      ...MODEL_INPUT,
      dataset: {
        base: 'constituents',
        overlayOrgSlug: 'eo-2',
        overlayDistrictId: 'd-1',
      },
    })

    expect(district).toHaveBeenCalledTimes(4)
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

    it('sizes a group by its share of the whole district, unknowns included', async () => {
      // Hispanic residents are 3% of everyone but 4% of those with a known
      // race; it is the 3% that sets how many answers reach them.
      expect(
        await sizeFor([
          cell('18to64', 'female', 'a', 'white', 450),
          cell('65plus', 'male', 'a', 'black', 270),
          cell('18to64', 'male', 'a', 'hispanic', 30),
          cell('65plus', 'female', 'a', null, 250),
        ]),
      ).toBe(100)
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
