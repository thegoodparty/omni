import { z } from 'zod'
import { filtersSchema } from '../schemas/filters.schema'
import type { SampleWeights } from '../schemas/people.schema'
import {
  buildScopeSql,
  col,
  createBag,
  tractSql,
  type Bag,
  type DbxDistrict,
  type DbxStatement,
} from './databricksVoterSql.util'
import { PEOPLE_DBX_CATALOG, PEOPLE_DBX_SCHEMA } from './peopleDbx.config'

const TABLE = (name: string): string =>
  `${PEOPLE_DBX_CATALOG}.${PEOPLE_DBX_SCHEMA}.${name}`

export const CENSUS_TABLE = TABLE('gp_api_district_census_stats')
export const DISTRICT_DEMOGRAPHICS_TABLE = TABLE(
  'gp_api_district_census_demographics',
)
export const BLOCK_GROUP_DEMOGRAPHICS_TABLE = TABLE(
  'gp_api_block_group_census_demographics',
)

const BLOCK_GROUP_GEOID_COLUMN = 'Census_Block_Group_Geoid'

// The ACS 2024 5-year counts the district/people comparison reads. Both
// demographics marts carry them under the same names: the district row
// allocates block groups by 2020 population share, so its values are
// fractional; a block group row holds the published integers.
export const ACS_COUNT_COLUMNS = {
  totalPopulation: 'total_population',
  populationUnder18: 'population_under_18',
  population65Plus: 'population_65_plus',
  populationRaceUniverse: 'population_race_universe',
  populationWhiteNh: 'population_white_nh',
  populationBlackNh: 'population_black_nh',
  populationNativeAmericanNh: 'population_native_american_nh',
  populationAsianNh: 'population_asian_nh',
  populationOtherNh: 'population_other_nh',
  populationHispanic: 'population_hispanic',
  population25Plus: 'population_25_plus',
  populationHsOrHigher: 'population_hs_or_higher',
  populationBachelorsOrHigher: 'population_bachelors_or_higher',
  households: 'households',
  ownerOccupiedHouseholds: 'owner_occupied_households',
  populationPovertyUniverse: 'population_poverty_universe',
  populationBelowPoverty: 'population_below_poverty',
  householdsIncomeUniverse: 'households_income_universe',
  householdsIncomeUnder10k: 'households_income_under_10k',
  householdsIncome10kTo15k: 'households_income_10k_to_15k',
  householdsIncome15kTo20k: 'households_income_15k_to_20k',
  householdsIncome20kTo25k: 'households_income_20k_to_25k',
  householdsIncome25kTo30k: 'households_income_25k_to_30k',
  householdsIncome30kTo35k: 'households_income_30k_to_35k',
  householdsIncome35kTo40k: 'households_income_35k_to_40k',
  householdsIncome40kTo45k: 'households_income_40k_to_45k',
  householdsIncome45kTo50k: 'households_income_45k_to_50k',
  householdsIncome50kTo60k: 'households_income_50k_to_60k',
  householdsIncome60kTo75k: 'households_income_60k_to_75k',
  householdsIncome75kTo100k: 'households_income_75k_to_100k',
  householdsIncome100kTo125k: 'households_income_100k_to_125k',
  householdsIncome125kTo150k: 'households_income_125k_to_150k',
  householdsIncome150kTo200k: 'households_income_150k_to_200k',
  householdsIncome200kPlus: 'households_income_200k_plus',
} as const
export type AcsCountKey = keyof typeof ACS_COUNT_COLUMNS
export const ACS_COUNT_KEYS = Object.keys(ACS_COUNT_COLUMNS).filter(
  (key): key is AcsCountKey => key in ACS_COUNT_COLUMNS,
)
// Null where the Census suppressed a figure: never read as a zero.
const AcsCountsSchema = z.record(z.enum(ACS_COUNT_KEYS), z.number().nullable())
export type AcsCounts = z.infer<typeof AcsCountsSchema>

const acsColumns = (alias: string): string =>
  ACS_COUNT_KEYS.map((key) => `${alias}.${ACS_COUNT_COLUMNS[key]}`).join(', ')

// district_type here is a grain VALUE (a row like any other), not the L2
// column identifier buildScopeSql interpolates, so all three grain columns
// bind as ordinary parameters and none of them ever touch SAFE_IDENTIFIER.
export const buildDistrictCensusSql = (district: DbxDistrict): DbxStatement => {
  const bag = createBag()
  const sql =
    `SELECT district_population FROM ${CENSUS_TABLE}` +
    ` WHERE state_postal_code = ${bag.bind(district.state)}` +
    ` AND district_type = ${bag.bind(district.districtType)}` +
    ` AND district_name = ${bag.bind(district.districtName)}`
  return { sql, params: bag.params }
}

// Same key as buildDistrictCensusSql. A State district resolves to the
// mart's statewide row, which is keyed ('State', postal code) the way
// election-api names it.
export const buildDistrictCompositionSql = (
  district: DbxDistrict,
): DbxStatement => {
  const bag = createBag()
  const sql =
    `SELECT ${acsColumns('d')} FROM ${DISTRICT_DEMOGRAPHICS_TABLE} d` +
    ` WHERE d.state_postal_code = ${bag.bind(district.state)}` +
    ` AND d.district_type = ${bag.bind(district.districtType)}` +
    ` AND d.district_name = ${bag.bind(district.districtName)}`
  return { sql, params: bag.params }
}

// A census tract is the first 11 digits of a block group geoid. Weighting
// works on tracts: a block group holds too few answers to carry a weight.
const TRACT_GEOID_LENGTH = 11

// The census reads age in two adult bands (18 to 64, 65 and over), so the
// voter file's exact age folds into the same two.
const ageBandSql = (): string =>
  `CASE WHEN ${col('Age_Int')} >= 65 THEN '65plus'` +
  ` WHEN ${col('Age_Int')} >= 18 THEN '18to64' END`

// L2's modeled tenure. "Probable" owners count as owners because the census
// has only owner and renter.
const tenureSql = (): string =>
  `CASE WHEN ${col('Homeowner_Probability_Model')}` +
  ` IN ('Home Owner', 'Probable Home Owner') THEN 'owner'` +
  ` WHEN ${col('Homeowner_Probability_Model')} = 'Renter' THEN 'renter' END`

const genderSql = (): string =>
  `CASE WHEN ${col('Gender')} = 'M' THEN 'male'` +
  ` WHEN ${col('Gender')} = 'F' THEN 'female' END`

// L2's modeled ethnic group, folded into the census race and Hispanic
// origin categories the comparison bars use. L2 has no Native American
// group, so the census's Native American count joins 'other' on that side.
// Read only into counts and draw weights, never onto a person.
export const RACE_VALUES = [
  'white',
  'black',
  'hispanic',
  'asian',
  'other',
] as const
export type RaceValue = (typeof RACE_VALUES)[number]

const raceSql = (): string => {
  const group = col('EthnicGroups_EthnicGroup1Desc')
  return (
    `CASE WHEN ${group} = 'European' THEN 'white'` +
    ` WHEN ${group} = 'Likely African-American' THEN 'black'` +
    ` WHEN ${group} = 'Hispanic and Portuguese' THEN 'hispanic'` +
    ` WHEN ${group} = 'East and South Asian' THEN 'asian'` +
    ` WHEN ${group} = 'Other' THEN 'other' END`
  )
}

// One row per block group the given people live in and age band, gender,
// tenure and race among them, with how many share it: block group figures and a
// count, never a person. Scoped to the district like every other people
// read, so an id from elsewhere adds nothing, and a person with no geocoded
// block group drops out. The profile columns let weighting reach each row.
export const buildRespondentBlockGroupsSql = (
  district: DbxDistrict,
  personIds: string[],
): DbxStatement => {
  const bag = createBag()
  const geoid = col(BLOCK_GROUP_GEOID_COLUMN)
  const where = buildScopeSql(bag, {
    district,
    filters: filtersSchema.parse({ id: { in: personIds } }),
  })
  const sql =
    `SELECT r.respondents, ${acsColumns('bg')},` +
    ' r.age_band, r.gender, r.tenure, r.race,' +
    ` substr(r.block_group_geoid, 1, ${TRACT_GEOID_LENGTH}) AS tract FROM (` +
    `SELECT ${geoid} AS block_group_geoid, count(*) AS respondents,` +
    ` ${ageBandSql()} AS age_band, ${genderSql()} AS gender,` +
    ` ${tenureSql()} AS tenure, ${raceSql()} AS race` +
    ` FROM ${district.table} v ${where} AND ${geoid} IS NOT NULL` +
    ' GROUP BY 1, 3, 4, 5, 6' +
    `) r JOIN ${BLOCK_GROUP_DEMOGRAPHICS_TABLE} bg` +
    ' ON bg.block_group_geoid = r.block_group_geoid'
  return { sql, params: bag.params }
}

const figure = (raw: string | null | undefined): number | null => {
  if (raw == null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export const mapAcsCounts = (row: ReadonlyArray<string | null>): AcsCounts =>
  AcsCountsSchema.parse(
    Object.fromEntries(
      ACS_COUNT_KEYS.map((key, index) => [key, figure(row[index])]),
    ),
  )

// A person's draw weight for a census-steered sample: the product of their
// age band, gender, tract and race factors, held within the weights' bounds. A
// value with no factor, or unknown, counts 1. Factors are bound and cast.
export const sampleWeightSql = (bag: Bag, weights: SampleWeights): string => {
  const factor = (expression: string, factors: Record<string, number>) => {
    const arms = Object.entries(factors)
      .filter(([, value]) => value !== 1)
      .map(
        ([key, value]) =>
          ` WHEN ${bag.bind(key)} THEN CAST(${bag.bind(String(value))} AS DOUBLE)`,
      )
    return arms.length === 0
      ? null
      : `CASE ${expression}${arms.join('')} ELSE 1.0 END`
  }
  const factors = [
    factor(ageBandSql(), weights.age),
    factor(genderSql(), weights.gender),
    factor(tractSql(), weights.tract),
    factor(raceSql(), weights.race),
  ].filter((part): part is string => part !== null)
  if (factors.length === 0) return '1.0'
  const min = `CAST(${bag.bind(String(weights.minWeight))} AS DOUBLE)`
  const max = `CAST(${bag.bind(String(weights.maxWeight))} AS DOUBLE)`
  return `least(${max}, greatest(${min}, ${factors.join(' * ')}))`
}

const RespondentProfileSchema = z.object({
  ageBand: z.enum(['18to64', '65plus']).nullable(),
  gender: z.enum(['male', 'female']).nullable(),
  tenure: z.enum(['owner', 'renter']).nullable(),
  race: z.enum(RACE_VALUES).nullable(),
  tract: z.string().nullable(),
})
// What weighting knows about a respondent. Unknowns stay null.
export type RespondentProfile = z.infer<typeof RespondentProfileSchema>

const mapProfile = ([ageBand, gender, tenure, race, tract]: ReadonlyArray<
  string | null | undefined
>): RespondentProfile =>
  RespondentProfileSchema.parse({
    ageBand: ageBand ?? null,
    gender: gender ?? null,
    tenure: tenure ?? null,
    race: race ?? null,
    tract: tract ?? null,
  })

export type CensusCompositionRows = {
  // Null when the mart has no row for the district.
  district: AcsCounts | null
  // One entry per person placed in a block group, in no order.
  respondentBlockGroups: AcsCounts[]
  // The same people in the same order: who each one is, for weighting.
  respondentProfiles: RespondentProfile[]
}

export const mapCensusCompositionRows = (
  districtRows: ReadonlyArray<ReadonlyArray<string | null>>,
  blockGroupRows: ReadonlyArray<ReadonlyArray<string | null>>,
): CensusCompositionRows => {
  const districtRow = districtRows[0]
  const people = blockGroupRows.flatMap(([respondents, ...row]) => {
    const counts = mapAcsCounts(row)
    const profile = mapProfile(row.slice(ACS_COUNT_KEYS.length))
    return Array.from({ length: Number(respondents ?? 0) }, () => ({
      counts,
      profile,
    }))
  })
  return {
    district: districtRow ? mapAcsCounts(districtRow) : null,
    respondentBlockGroups: people.map(({ counts }) => counts),
    respondentProfiles: people.map(({ profile }) => profile),
  }
}

// How many of the given people share each age band, gender, tenure, tract
// and race: counts per combination, never a person. Unknowns stay NULL.
export const buildRespondentCellsSql = (
  district: DbxDistrict,
  personIds: string[],
): DbxStatement => {
  const bag = createBag()
  const where = buildScopeSql(bag, {
    district,
    filters: filtersSchema.parse({ id: { in: personIds } }),
  })
  const tract = `substr(${col(BLOCK_GROUP_GEOID_COLUMN)}, 1, ${TRACT_GEOID_LENGTH})`
  const sql =
    `SELECT ${ageBandSql()} AS age_band, ${genderSql()} AS gender,` +
    ` ${tenureSql()} AS tenure, ${tract} AS tract,` +
    ` ${raceSql()} AS race, count(*) AS respondents` +
    ` FROM ${district.table} v ${where}` +
    ' GROUP BY 1, 2, 3, 4, 5'
  return { sql, params: bag.params }
}

// Adults per tract, over the block groups the district's people live in.
// A block group straddling the district line counts whole: the district
// mart's own split is not published per block group.
export const buildDistrictTractAdultsSql = (
  district: DbxDistrict,
): DbxStatement => {
  const bag = createBag()
  const geoid = col(BLOCK_GROUP_GEOID_COLUMN)
  const where = buildScopeSql(bag, {
    district,
    filters: filtersSchema.parse({}),
  })
  const sql =
    `SELECT substr(bg.block_group_geoid, 1, ${TRACT_GEOID_LENGTH}) AS tract,` +
    ' sum(bg.total_population - bg.population_under_18) AS adults' +
    ` FROM ${BLOCK_GROUP_DEMOGRAPHICS_TABLE} bg` +
    ' WHERE bg.block_group_geoid IN (' +
    `SELECT DISTINCT ${geoid} FROM ${district.table} v ${where}` +
    ` AND ${geoid} IS NOT NULL)` +
    ' GROUP BY 1'
  return { sql, params: bag.params }
}

const RespondentCellSchema = RespondentProfileSchema.extend({
  count: z.number().int().positive(),
})
export type RespondentCell = z.infer<typeof RespondentCellSchema>

export interface WeightingInputs {
  // Null when the mart has no row for the district.
  district: AcsCounts | null
  cells: RespondentCell[]
  tractAdults: Map<string, number>
}

export const mapRespondentCells = (
  rows: ReadonlyArray<ReadonlyArray<string | null>>,
): RespondentCell[] =>
  rows.map(([ageBand, gender, tenure, tract, race, respondents]) =>
    RespondentCellSchema.parse({
      ageBand,
      gender,
      tenure,
      tract,
      race,
      count: Number(respondents),
    }),
  )

export const mapTractAdults = (
  rows: ReadonlyArray<ReadonlyArray<string | null>>,
): Map<string, number> =>
  new Map(
    rows.flatMap(([tract, adults]): Array<[string, number]> => {
      const value = figure(adults)
      return tract && value !== null && value > 0 ? [[tract, value]] : []
    }),
  )

// The grid squares the people of the given tracts live in: square indexes
// only, never a person or an address.
export const buildTractGridCellsSql = (
  district: DbxDistrict,
  tracts: string[],
  cellDegrees: number,
): DbxStatement => {
  const bag = createBag()
  const where = buildScopeSql(bag, {
    district,
    filters: filtersSchema.parse({}),
  })
  const lat = `CAST(${col('Residence_Addresses_Latitude')} AS DOUBLE)`
  const lng = `CAST(${col('Residence_Addresses_Longitude')} AS DOUBLE)`
  // A server constant, never input, so it is written into the statement.
  const size = Number(cellDegrees).toString()
  const tract = `substr(${col(BLOCK_GROUP_GEOID_COLUMN)}, 1, ${TRACT_GEOID_LENGTH})`
  const sql =
    `SELECT DISTINCT floor(${lat} / ${size}) AS grid_row,` +
    ` floor(${lng} / ${size}) AS grid_col` +
    ` FROM ${district.table} v ${where}` +
    ` AND ${tract} IN (${tracts.map((t) => bag.bind(t)).join(', ')})` +
    ` AND ${lat} IS NOT NULL AND ${lng} IS NOT NULL`
  return { sql, params: bag.params }
}

export const mapGridCells = (
  rows: ReadonlyArray<ReadonlyArray<string | null>>,
): Array<{ row: number; col: number }> =>
  rows.flatMap(([row, column]) => {
    const r = figure(row)
    const c = figure(column)
    return r === null || c === null ? [] : [{ row: r, col: c }]
  })
