import { Prisma } from '../../generated/prisma'
import { DOOR_KNOCKING_UNIT_KEY_COLUMNS } from '@goodparty_org/contracts'
import { quoteIdent } from 'src/people/utils/buildHouseholdKeySql.utils'

// Unit-granularity twin of buildHouseholdKeySql: the CRM household key
// groups by AddressLine, which merges every apartment in a building into
// one key — a knockable door is a UNIT, so this key adds the apartment
// number (and the address components that disambiguate it). Normalization
// is identical so the two keys stay comparable in spirit.
export const buildDoorKnockingAddressKeySql = (alias = 'v'): Prisma.Sql => {
  const parts = DOOR_KNOCKING_UNIT_KEY_COLUMNS.map(
    (col) =>
      Prisma.sql`UPPER(TRIM(COALESCE(${Prisma.raw(`${alias}.${quoteIdent(col)}::text`)}, '')))`,
  )
  return Prisma.sql`CONCAT_WS('|', ${Prisma.join(parts, ', ')})`
}
