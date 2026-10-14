import { describe, expect, it } from 'vitest'
import {
  computeRepresentation,
  MIN_RESPONDENTS_FOR_RACE,
  type AcsCounts,
} from './representation.util'

const EMPTY: AcsCounts = {
  totalPopulation: 0,
  populationUnder18: 0,
  population65Plus: 0,
  populationRaceUniverse: 0,
  populationWhiteNh: 0,
  populationBlackNh: 0,
  populationNativeAmericanNh: 0,
  populationAsianNh: 0,
  populationOtherNh: 0,
  populationHispanic: 0,
  population25Plus: 0,
  populationHsOrHigher: 0,
  populationBachelorsOrHigher: 0,
  households: 0,
  ownerOccupiedHouseholds: 0,
  populationPovertyUniverse: 0,
  populationBelowPoverty: 0,
  householdsIncomeUniverse: 0,
  householdsIncomeUnder25k: 0,
  householdsIncome25kTo50k: 0,
  householdsIncome50kTo75k: 0,
  householdsIncome75kTo100k: 0,
  householdsIncome100kTo150k: 0,
  householdsIncome150kPlus: 0,
}

const counts = (overrides: Partial<AcsCounts> = {}): AcsCounts => ({
  ...EMPTY,
  totalPopulation: 1000,
  populationUnder18: 200,
  population65Plus: 150,
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
  householdsIncomeUnder25k: 100,
  householdsIncome25kTo50k: 100,
  householdsIncome50kTo75k: 100,
  householdsIncome150kPlus: 100,
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

  it('skips a group whose universe is empty rather than dividing by zero', () => {
    const groups = computeRepresentation(counts({ households: 0 }), [counts()])
    expect(find(groups, 'owners')).toBeUndefined()
  })
})
