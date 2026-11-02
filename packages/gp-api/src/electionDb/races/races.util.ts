import { Prisma } from '@/generated/election-prisma'
import type { ElectionDbPrismaClient } from '@/electionDb/electionDb.service'

export function getDedupedRacesBySlug<
  T extends { slug: string; positionNames: string[] },
>(races: T[]): T[] {
  const uniqueRaces = new Map<string, T>()
  for (const race of races) {
    const existing = uniqueRaces.get(race.slug)
    if (existing) {
      // Use a set to avoid duplicates
      existing.positionNames = [
        ...new Set([...existing.positionNames, ...race.positionNames]),
      ]
    } else {
      uniqueRaces.set(race.slug, {
        ...race,
        positionNames: [...race.positionNames],
      })
    }
  }
  return [...uniqueRaces.values()]
}

/**
 * One row per merged race group, resolved in Postgres. `id` is the group's
 * first row (lowest `id`), the same row `getDedupedRacesBySlug` keeps for
 * every column except `positionNames`.
 */
export type MergedRaceHead = {
  id: string
  placeId: string | null
  positionNames: string[]
}

/**
 * Database-side equivalent of `getDedupedRacesBySlug`. Groups the Race rows
 * matching `where` (a SQL condition on "Race") and returns one head per group
 * with `positionNames` already merged, so the other rows and their positionNames
 * arrays never cross the wire. Groups are per slug, or per (place, slug) when
 * `perPlace` is set.
 *
 * The merge matches the JS one: values in first-seen order across rows ordered
 * by id, deduped. A group of one row keeps its array untouched, since the JS
 * version only deduped when it had a second row to merge.
 */
export async function findMergedRaceHeads(
  client: Pick<ElectionDbPrismaClient, '$queryRaw'>,
  where: Prisma.Sql,
  perPlace: boolean,
): Promise<MergedRaceHead[]> {
  // Constant fragments only; every caller-supplied value stays in `where`.
  const keys = Prisma.raw(perPlace ? 'place_id, slug' : 'slug')
  return client.$queryRaw<MergedRaceHead[]>`
    WITH base AS (
      SELECT id, place_id, slug, position_names,
             row_number() OVER (PARTITION BY ${keys} ORDER BY id) AS rn,
             count(*) OVER (PARTITION BY ${keys}) AS n
      FROM "Race"
      WHERE ${where}
    ),
    heads AS (
      SELECT id, place_id, slug, position_names, n
      FROM base
      WHERE rn = 1
    ),
    -- Each value's first position: (row number, index in its array) packed into
    -- one number, so a hash aggregate finds it without sorting every element.
    firsts AS (
      SELECT ${keys}, u.v,
             min(base.rn::bigint * 4294967296 + u.ord) AS pos
      FROM base, unnest(base.position_names) WITH ORDINALITY AS u(v, ord)
      GROUP BY ${keys}, u.v
    ),
    merged AS (
      SELECT ${keys}, array_agg(v ORDER BY pos) AS names
      FROM firsts
      GROUP BY ${keys}
    )
    SELECT heads.id,
           heads.place_id AS "placeId",
           CASE WHEN heads.n = 1 THEN heads.position_names
                ELSE COALESCE(merged.names, ARRAY[]::text[])
           END AS "positionNames"
    FROM heads
    LEFT JOIN merged USING (${keys})
    ORDER BY heads.slug, heads.id
  `
}
