import type {
  RepresentationDimension,
  RepresentationGroup,
} from '@goodparty_org/contracts'

// The ACS counts gp-data-platform publishes per district
// (gp_api_district_census_stats, acs_*) and per block group
// (gp_api_block_group_census_demographics), in camelCase. Both tables carry
// the same columns, which is what lets a respondent's block group and the
// district be read as one shape.
export const ACS_COUNT_KEYS = [
  'totalPopulation',
  'populationUnder18',
  'population65Plus',
  'populationRaceUniverse',
  'populationWhiteNh',
  'populationBlackNh',
  'populationNativeAmericanNh',
  'populationAsianNh',
  'populationOtherNh',
  'populationHispanic',
  'population25Plus',
  'populationHsOrHigher',
  'populationBachelorsOrHigher',
  'households',
  'ownerOccupiedHouseholds',
  'populationPovertyUniverse',
  'populationBelowPoverty',
  'householdsIncomeUniverse',
  'householdsIncomeUnder25k',
  'householdsIncome25kTo50k',
  'householdsIncome50kTo75k',
  'householdsIncome75kTo100k',
  'householdsIncome100kTo150k',
  'householdsIncome150kPlus',
] as const
export type AcsCountKey = (typeof ACS_COUNT_KEYS)[number]
export type AcsCounts = Record<AcsCountKey, number>

interface GroupDefinition {
  dimension: RepresentationDimension
  key: string
  label: string
  count: (c: AcsCounts) => number
  universe: (c: AcsCounts) => number
}

const ageWorking = (c: AcsCounts): number =>
  c.totalPopulation - c.populationUnder18 - c.population65Plus

const GROUPS: GroupDefinition[] = [
  {
    dimension: 'age',
    key: 'under18',
    label: 'Under 18',
    count: (c) => c.populationUnder18,
    universe: (c) => c.totalPopulation,
  },
  {
    dimension: 'age',
    key: '18to64',
    label: '18 to 64',
    count: ageWorking,
    universe: (c) => c.totalPopulation,
  },
  {
    dimension: 'age',
    key: '65plus',
    label: '65 and over',
    count: (c) => c.population65Plus,
    universe: (c) => c.totalPopulation,
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
    count: (c) => c.population25Plus - c.populationHsOrHigher,
    universe: (c) => c.population25Plus,
  },
  {
    dimension: 'education',
    key: 'bachelors',
    label: "Bachelor's degree or higher",
    count: (c) => c.populationBachelorsOrHigher,
    universe: (c) => c.population25Plus,
  },
  {
    dimension: 'income',
    key: 'under25k',
    label: 'Under $25k',
    count: (c) => c.householdsIncomeUnder25k,
    universe: (c) => c.householdsIncomeUniverse,
  },
  {
    dimension: 'income',
    key: '25kTo50k',
    label: '$25k to $50k',
    count: (c) => c.householdsIncome25kTo50k,
    universe: (c) => c.householdsIncomeUniverse,
  },
  {
    dimension: 'income',
    key: '50kTo100k',
    label: '$50k to $100k',
    count: (c) => c.householdsIncome50kTo75k + c.householdsIncome75kTo100k,
    universe: (c) => c.householdsIncomeUniverse,
  },
  {
    dimension: 'income',
    key: '100kPlus',
    label: '$100k and over',
    count: (c) => c.householdsIncome100kTo150k + c.householdsIncome150kPlus,
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
    count: (c) => c.households - c.ownerOccupiedHouseholds,
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

const share = (count: number, universe: number): number | null =>
  universe > 0 ? Math.max(0, Math.min(1, count / universe)) : null

// Compares the places respondents live with the whole district. Each
// respondent contributes their block group's composition, so a respondent
// in a mostly-renter block group counts mostly as a renter: it measures
// whether outreach reached the right places, not who each person is.
export const computeRepresentation = (
  district: AcsCounts,
  respondentBlockGroups: AcsCounts[],
): RepresentationGroup[] => {
  if (respondentBlockGroups.length === 0) return []
  const showRace = respondentBlockGroups.length >= MIN_RESPONDENTS_FOR_RACE
  // A dimension shows only when the census has it for every respondent's
  // block group (a small one can have a figure suppressed). Otherwise two
  // rows of one dimension would average over different sets of people.
  const covered = (dimension: RepresentationDimension): boolean =>
    GROUPS.filter((group) => group.dimension === dimension).every(
      (group) =>
        group.universe(district) > 0 &&
        respondentBlockGroups.every((bg) => group.universe(bg) > 0),
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
    const respondentShare =
      respondentBlockGroups.reduce(
        (sum, bg) => sum + (share(group.count(bg), group.universe(bg)) ?? 0),
        0,
      ) / respondentBlockGroups.length
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
