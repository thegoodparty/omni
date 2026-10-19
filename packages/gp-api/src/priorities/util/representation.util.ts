import type {
  RepresentationDimension,
  RepresentationGroup,
} from '@goodparty_org/contracts'
import type { AcsCounts } from '@/peopleDb/databricks/districtCensusSql.util'

type Figure = number | null

interface GroupDefinition {
  dimension: RepresentationDimension
  key: string
  label: string
  count: (c: AcsCounts) => Figure
  universe: (c: AcsCounts) => Figure
}

// Any suppressed part makes the whole figure unknown, never a smaller one.
const sum = (...values: Figure[]): Figure => {
  let total = 0
  for (const value of values) {
    if (value === null) return null
    total += value
  }
  return total
}
const minus = (a: Figure, b: Figure): Figure =>
  a === null || b === null ? null : a - b
const positive = (value: Figure): boolean => value !== null && value > 0

// Age is read over adults (18 and over), the population respondents and
// panel members are drawn from, so both rows are shares of the people who
// could have answered. Over everyone, a neighborhood with many children
// would read as having fewer adults of every age.
const adults = (c: AcsCounts): Figure =>
  minus(c.totalPopulation, c.populationUnder18)

const GROUPS: GroupDefinition[] = [
  {
    dimension: 'age',
    key: '18to64',
    label: '18 to 64',
    count: (c) => minus(adults(c), c.population65Plus),
    universe: adults,
  },
  {
    dimension: 'age',
    key: '65plus',
    label: '65 and over',
    count: (c) => c.population65Plus,
    universe: adults,
  },
  {
    dimension: 'race',
    key: 'white',
    label: 'White',
    count: (c) => c.populationWhiteNh,
    universe: (c) => c.populationRaceUniverse,
  },
  {
    dimension: 'race',
    key: 'black',
    label: 'Black',
    count: (c) => c.populationBlackNh,
    universe: (c) => c.populationRaceUniverse,
  },
  {
    dimension: 'race',
    key: 'hispanic',
    label: 'Hispanic or Latino',
    count: (c) => c.populationHispanic,
    universe: (c) => c.populationRaceUniverse,
  },
  {
    dimension: 'race',
    key: 'asian',
    label: 'Asian',
    count: (c) => c.populationAsianNh,
    universe: (c) => c.populationRaceUniverse,
  },
  {
    dimension: 'race',
    key: 'nativeAmerican',
    label: 'Native American',
    count: (c) => c.populationNativeAmericanNh,
    universe: (c) => c.populationRaceUniverse,
  },
  {
    dimension: 'race',
    key: 'other',
    label: 'Another race or more than one',
    count: (c) => c.populationOtherNh,
    universe: (c) => c.populationRaceUniverse,
  },
  {
    dimension: 'education',
    key: 'noDiploma',
    label: 'No high school diploma',
    count: (c) => minus(c.population25Plus, c.populationHsOrHigher),
    universe: (c) => c.population25Plus,
  },
  {
    dimension: 'education',
    key: 'bachelors',
    label: "Bachelor's degree or higher",
    count: (c) => c.populationBachelorsOrHigher,
    universe: (c) => c.population25Plus,
  },
  // The mart publishes the 16 ACS brackets; these are the bands the page
  // shows.
  {
    dimension: 'income',
    key: 'under25k',
    label: 'Under $25k',
    count: (c) =>
      sum(
        c.householdsIncomeUnder10k,
        c.householdsIncome10kTo15k,
        c.householdsIncome15kTo20k,
        c.householdsIncome20kTo25k,
      ),
    universe: (c) => c.householdsIncomeUniverse,
  },
  {
    dimension: 'income',
    key: '25kTo50k',
    label: '$25k to $50k',
    count: (c) =>
      sum(
        c.householdsIncome25kTo30k,
        c.householdsIncome30kTo35k,
        c.householdsIncome35kTo40k,
        c.householdsIncome40kTo45k,
        c.householdsIncome45kTo50k,
      ),
    universe: (c) => c.householdsIncomeUniverse,
  },
  {
    dimension: 'income',
    key: '50kTo100k',
    label: '$50k to $100k',
    count: (c) =>
      sum(
        c.householdsIncome50kTo60k,
        c.householdsIncome60kTo75k,
        c.householdsIncome75kTo100k,
      ),
    universe: (c) => c.householdsIncomeUniverse,
  },
  {
    dimension: 'income',
    key: '100kPlus',
    label: '$100k and over',
    count: (c) =>
      sum(
        c.householdsIncome100kTo125k,
        c.householdsIncome125kTo150k,
        c.householdsIncome150kTo200k,
        c.householdsIncome200kPlus,
      ),
    universe: (c) => c.householdsIncomeUniverse,
  },
  {
    dimension: 'housing',
    key: 'owners',
    label: 'Own their home',
    count: (c) => c.ownerOccupiedHouseholds,
    universe: (c) => c.households,
  },
  {
    dimension: 'housing',
    key: 'renters',
    label: 'Rent their home',
    count: (c) => minus(c.households, c.ownerOccupiedHouseholds),
    universe: (c) => c.households,
  },
  {
    dimension: 'poverty',
    key: 'belowPoverty',
    label: 'Below the poverty line',
    count: (c) => c.populationBelowPoverty,
    universe: (c) => c.populationPovertyUniverse,
  },
]

// Ethnicity reaches an elected official only as district-wide shares, and
// only when enough people answered that no one stands out in them.
export const MIN_RESPONDENTS_FOR_RACE = 25
// A group this small in the district swings on a handful of people.
export const MIN_DISTRICT_SHARE_FOR_RACE_GROUP = 0.02

const share = (count: Figure, universe: Figure): number | null =>
  count !== null && universe !== null && universe > 0
    ? Math.max(0, Math.min(1, count / universe))
    : null

// Compares the places respondents live with the whole district. Each
// respondent contributes their block group's composition, so a respondent
// in a mostly-renter block group counts mostly as a renter: it measures
// whether outreach reached the right places, not who each person is.
export const computeRepresentation = (
  district: AcsCounts,
  respondentBlockGroups: AcsCounts[],
  // One per respondent, in the same order. Absent, everyone counts once.
  weights?: number[],
): RepresentationGroup[] => {
  if (respondentBlockGroups.length === 0) return []
  const showRace = respondentBlockGroups.length >= MIN_RESPONDENTS_FOR_RACE
  // A dimension shows only when the census has it for the district and for
  // every respondent's block group (a small one can have a figure
  // suppressed). Otherwise two rows of one dimension would average over
  // different sets of people.
  const readable = (group: GroupDefinition, c: AcsCounts): boolean =>
    positive(group.universe(c)) && group.count(c) !== null
  const covered = (dimension: RepresentationDimension): boolean =>
    GROUPS.filter((group) => group.dimension === dimension).every(
      (group) =>
        readable(group, district) &&
        respondentBlockGroups.every((bg) => readable(group, bg)),
    )
  return GROUPS.flatMap((group) => {
    if (group.dimension === 'race' && !showRace) return []
    if (!covered(group.dimension)) return []
    const districtShare = share(group.count(district), group.universe(district))
    if (districtShare === null) return []
    if (
      group.dimension === 'race' &&
      districtShare < MIN_DISTRICT_SHARE_FOR_RACE_GROUP
    ) {
      return []
    }
    const weightOf = (index: number): number => weights?.[index] ?? 1
    const totalWeight = respondentBlockGroups.reduce(
      (total, _bg, index) => total + weightOf(index),
      0,
    )
    const respondentShare =
      respondentBlockGroups.reduce(
        (total, bg, index) =>
          total +
          weightOf(index) * (share(group.count(bg), group.universe(bg)) ?? 0),
        0,
      ) / totalWeight
    return [
      {
        dimension: group.dimension,
        key: group.key,
        label: group.label,
        respondentShare,
        districtShare,
      },
    ]
  })
}
