import {
  createBag,
  type DbxDistrict,
  type DbxStatement,
} from './databricksVoterSql.util'
import { PEOPLE_DBX_CATALOG, PEOPLE_DBX_SCHEMA } from './peopleDbx.config'

const TABLE = (name: string): string =>
  `${PEOPLE_DBX_CATALOG}.${PEOPLE_DBX_SCHEMA}.${name}`

const CENSUS_TABLE_NAME = 'gp_api_district_census_stats'

export const CENSUS_TABLE = TABLE(CENSUS_TABLE_NAME)

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
