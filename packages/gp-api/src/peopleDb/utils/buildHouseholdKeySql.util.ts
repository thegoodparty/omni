import { HOUSEHOLD_KEY_RESIDENCE_COLUMNS } from '@goodparty_org/contracts'
import { Prisma } from '../../generated/people-prisma'

const quoteIdent = (id: string) => `"${id.replace(/"/g, '""')}"`

// Normalized residence-address composite that identifies one physical
// household for door-knocking de-dup. Each column is COALESCE'd to '' so a
// NULL component doesn't void the whole key, TRIM'd and UPPER'd so minor
// formatting/case differences group together, and the parts are joined with a
// delimiter that can't appear inside a single column so distinct addresses
// can't collide. Column names come from @goodparty_org/contracts so the key
// definition stays in lockstep across services; they're fixed identifiers
// (not user input), quoted as a defense-in-depth measure.
export const buildHouseholdKeySql = (alias = 'v'): Prisma.Sql => {
  const parts = HOUSEHOLD_KEY_RESIDENCE_COLUMNS.map(
    (col) =>
      Prisma.sql`UPPER(TRIM(COALESCE(${Prisma.raw(`${alias}.${quoteIdent(col)}`)}, '')))`,
  )
  return Prisma.sql`CONCAT_WS('|', ${Prisma.join(parts, ', ')})`
}
