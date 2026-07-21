import { Bbox } from '@goodparty_org/contracts'
import { Prisma } from '../../generated/prisma'

const NUMERIC_TEXT = '^-?[0-9]+(\\.[0-9]+)?$'

// Lat/lng are free text in people_db. The CASE guarantees the regex check
// runs before the cast — a bare text::float8 in WHERE can abort the whole
// query on a garbage row, because the planner may reorder AND predicates.
// Rows with non-numeric coordinates fall out (NULL BETWEEN is not true).
const guardedFloatCast = (column: string): Prisma.Sql => {
  const ident = Prisma.raw(`v."${column}"`)
  return Prisma.sql`CASE WHEN ${ident} ~ ${NUMERIC_TEXT} THEN ${ident}::float8 END`
}

// TODO(geom-index): interim geo — a bbox prefilter over casted text columns.
// When people_db grows a geometry column + GiST index, this becomes
// ST_Contains against the caller's exact polygon and the bbox (plus the
// caller-side ray-cast in gp-api) disappears, with no contract change.
export const buildBboxSql = (bbox: Bbox): Prisma.Sql =>
  Prisma.sql`${guardedFloatCast('Residence_Addresses_Latitude')} BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
    AND ${guardedFloatCast('Residence_Addresses_Longitude')} BETWEEN ${bbox.minLng} AND ${bbox.maxLng}`
