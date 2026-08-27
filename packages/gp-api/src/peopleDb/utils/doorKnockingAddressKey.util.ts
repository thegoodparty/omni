import { Prisma } from '../../generated/people-prisma'
import {
  DOOR_KNOCKING_LEGACY_UNIT_KEY_COLUMNS,
  DOOR_KNOCKING_UNIT_KEY_COLUMNS,
} from '@goodparty_org/contracts'
import { quoteIdent } from './buildHouseholdKeySql.util'

const concatKey = (alias: string, columns: readonly string[]): Prisma.Sql => {
  const parts = columns.map(
    (col) =>
      Prisma.sql`UPPER(TRIM(COALESCE(${Prisma.raw(`${alias}.${quoteIdent(col)}::text`)}, '')))`,
  )
  return Prisma.sql`CONCAT_WS('|', ${Prisma.join(parts, ', ')})`
}

// Unit-granularity twin of buildHouseholdKeySql: the CRM household key
// groups by AddressLine, which merges every apartment in a building into
// one key — a knockable door is a UNIT, so this key adds the apartment
// number. Normalization is identical so the two keys stay comparable in
// spirit.
export const buildDoorKnockingAddressKeySql = (alias = 'v'): Prisma.Sql =>
  concatKey(alias, DOOR_KNOCKING_UNIT_KEY_COLUMNS)

// The same recipe over the component columns door knocking used to key by, for
// reading back routes frozen before the switch. See
// DOOR_KNOCKING_LEGACY_UNIT_KEY_COLUMNS for why nothing is written this way
// any more: two of its seven columns are INTEGER in the mirror and so are
// permanently empty, which is what dropped cardinal directions from the key.
export const buildLegacyDoorKnockingAddressKeySql = (alias = 'v'): Prisma.Sql =>
  concatKey(alias, DOOR_KNOCKING_LEGACY_UNIT_KEY_COLUMNS)
