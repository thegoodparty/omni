import { Prisma } from '../../generated/people-prisma'
import {
  DOOR_KNOCKING_LEGACY_UNIT_KEY_COLUMNS,
  DOOR_KNOCKING_UNIT_KEY_COLUMNS,
} from '@goodparty_org/contracts'
import { quoteIdent } from './buildHouseholdKeySql.util'

const concatKey = (
  alias: string,
  columns: readonly string[],
  pinnedEmpty: ReadonlySet<string> = new Set(),
): Prisma.Sql => {
  const parts = columns.map((col) =>
    pinnedEmpty.has(col)
      ? Prisma.sql`''`
      : Prisma.sql`UPPER(TRIM(COALESCE(${Prisma.raw(`${alias}.${quoteIdent(col)}::text`)}, '')))`,
  )
  return Prisma.sql`CONCAT_WS('|', ${Prisma.join(parts, ', ')})`
}

// A stored legacy key's two direction segments are empty in every row of
// DoorKnockingStopTarget, because the columns they came from were INTEGER in
// the mirror when those routes were frozen. The data platform now serves them
// as text, so reading them here would recompute a key no frozen route matches
// and `residents()` would return nothing for a route mid-walk. Pinning the two
// segments empty keeps a legacy key reproducible from any mirror.
const LEGACY_EMPTY_SEGMENTS: ReadonlySet<string> = new Set([
  'Residence_Addresses_PrefixDirection',
  'Residence_Addresses_SuffixDirection',
])

// Unit-granularity twin of buildHouseholdKeySql: the CRM household key
// groups by AddressLine, which merges every apartment in a building into
// one key — a knockable door is a UNIT, so this key adds the apartment
// number. Normalization is identical so the two keys stay comparable in
// spirit.
export const buildDoorKnockingAddressKeySql = (alias = 'v'): Prisma.Sql =>
  concatKey(alias, DOOR_KNOCKING_UNIT_KEY_COLUMNS)

// The same recipe over the component columns door knocking used to key by, for
// reading back routes frozen before the switch. See
// DOOR_KNOCKING_LEGACY_UNIT_KEY_COLUMNS for why nothing is written this way any
// more.
export const buildLegacyDoorKnockingAddressKeySql = (alias = 'v'): Prisma.Sql =>
  concatKey(alias, DOOR_KNOCKING_LEGACY_UNIT_KEY_COLUMNS, LEGACY_EMPTY_SEGMENTS)
