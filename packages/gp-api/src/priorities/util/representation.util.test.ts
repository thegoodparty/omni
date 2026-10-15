import { describe, expect, it } from 'vitest'
import {
  ACS_COUNT_KEYS,
  type AcsCounts,
} from '@/peopleDb/databricks/districtCensusSql.util'
import {
  computeRepresentation,
  MIN_RESPONDENTS_FOR_RACE,
} from './representation.util'

const EMPTY = Object.fromEntries(
  ACS_COUNT_KEYS.map((key) => [key, 0]),
) as AcsCounts

const counts = (overrides: Partial<AcsCounts> = {}): AcsCounts => ({
  ...EMPTY,
  totalPopulation: 1000,
  populationUnder18: 200,
  population65Plus: 160,
  populationRaceUniverse: 1000,
  populationWhiteNh: 700,
  populationBlackNh: 200,
  populationHispanic: 90,
  populationNativeAmericanNh: 5,
  population25Plus: 600,
  populationHsOrHigher: 540,
  populationBachelorsOrHigher: 240,
  households: 400,
  ownerOccupiedHouseholds: 240,
  populationPovertyUniverse: 1000,
  populationBelowPoverty: 100,
  householdsIncomeUniverse: 400,
  householdsIncomeUnder10k: 40,
  householdsIncome20kTo25k: 60,
  householdsIncome25kTo30k: 50,
  householdsIncome45kTo50k: 50,
  householdsIncome50kTo60k: 60,
  householdsIncome75kTo100k: 40,
  householdsIncome150kTo200k: 70,
  householdsIncome200kPlus: 30,
  ...overrides,
})

const find = (groups: ReturnType<typeof computeRepresentation>, key: string) =>
  groups.find((group) => group.key === key)

describe('computeRepresentation', () => {
  it("weights each respondent by their block group's makeup", () => {
    const renterBlock = counts({ ownerOccupiedHouseholds: 40 })
    const ownerBlock = counts({ ownerOccupiedHouseholds: 360 })

    const groups = computeRepresentation(counts(), [
      renterBlock,
      renterBlock,
      ownerBlock,
    ])

    // District: 240/400 own. Respondents: (0.1 + 0.1 + 0.9) / 3 own.
    expect(find(groups, 'owners')).toMatchObject({
      districtShare: 0.6,
      respondentShare: expect.closeTo(1.1 / 3, 5),
    })
    expect(find(groups, 'renters')?.respondentShare).toBeCloseTo(1.9 / 3, 5)
  })

  it('leaves race out until enough people answered', () => {
    const few = Array.from({ length: MIN_RESPONDENTS_FOR_RACE - 1 }, () =>
      counts(),
    )
    expect(
      computeRepresentation(counts(), few).some((g) => g.dimension === 'race'),
    ).toBe(false)

    const enough = [...few, counts()]
    expect(
      computeRepresentation(counts(), enough).some(
        (g) => g.dimension === 'race',
      ),
    ).toBe(true)
  })

  it('drops a race group too small in the district to read', () => {
    const enough = Array.from({ length: MIN_RESPONDENTS_FOR_RACE }, () =>
      counts(),
    )
    const groups = computeRepresentation(counts(), enough)
    expect(find(groups, 'nativeAmerican')).toBeUndefined()
    expect(find(groups, 'black')).toBeDefined()
  })

  it("drops a whole dimension when one respondent's block group lacks it", () => {
    const groups = computeRepresentation(counts(), [
      counts(),
      counts({ householdsIncomeUniverse: 0 }),
    ])
    expect(groups.some((g) => g.dimension === 'income')).toBe(false)
    expect(groups.some((g) => g.dimension === 'housing')).toBe(true)
  })

  it('rolls the 16 ACS income brackets up into the four bands', () => {
    const groups = computeRepresentation(counts(), [counts()])
    expect(find(groups, 'under25k')?.districtShare).toBe(0.25)
    expect(find(groups, '25kTo50k')?.districtShare).toBe(0.25)
    expect(find(groups, '50kTo100k')?.districtShare).toBe(0.25)
    expect(find(groups, '100kPlus')?.districtShare).toBe(0.25)
  })

  it('reads age over adults, with no under 18 row', () => {
    const groups = computeRepresentation(counts(), [counts()])
    // 800 adults: 640 are 18 to 64, 160 are 65 and over.
    expect(find(groups, '18to64')?.districtShare).toBe(0.8)
    expect(find(groups, '65plus')?.districtShare).toBe(0.2)
    expect(find(groups, 'under18')).toBeUndefined()
  })

  it('drops a dimension with a suppressed figure instead of reading it as zero', () => {
    const groups = computeRepresentation(counts(), [
      counts(),
      counts({ householdsIncome60kTo75k: null }),
    ])
    expect(groups.some((g) => g.dimension === 'income')).toBe(false)
    expect(groups.some((g) => g.dimension === 'education')).toBe(true)

    const district = computeRepresentation(
      counts({ ownerOccupiedHouseholds: null }),
      [counts()],
    )
    expect(district.some((g) => g.dimension === 'housing')).toBe(false)
  })

  it('skips a group whose universe is empty rather than dividing by zero', () => {
    const groups = computeRepresentation(counts({ households: 0 }), [counts()])
    expect(find(groups, 'owners')).toBeUndefined()
  })
})
