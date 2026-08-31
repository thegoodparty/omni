import { VoterDensityCompareResult } from '../observability/person-profiles.metrics'
import {
  VoterDensityCell,
  VoterDensityResponse,
} from '../schemas/public/VoterDensity.schema'

/**
 * Comparison half of the people-db -> election-db voter-density migration.
 * Temporary by construction: this whole module goes away with the people-db
 * leg once the counter it feeds reads clean.
 */

/**
 * Both sources publish the H3 cell centroid for the same H3 index, so matching
 * cells should be bit-identical doubles. The epsilon only absorbs a formatting
 * difference between the two transports (Prisma's native double vs a JSON
 * round-trip); at ~0.1mm it cannot hide a genuinely different cell.
 */
const COORD_EPSILON = 1e-9

/**
 * One source's answer, with its failure captured rather than thrown. Both legs
 * are always caught so the comparison happens either way; the authoritative
 * leg's error is re-thrown afterwards, and the shadow leg's is only counted.
 */
export type LegOutcome =
  | { ok: true; value: VoterDensityResponse | null }
  | { ok: false; error: unknown }

export function compareLegs(
  legacy: LegOutcome,
  next: LegOutcome,
): VoterDensityCompareResult {
  if (!legacy.ok || !next.ok) return 'error'

  const legacyCells = legacy.value?.cells ?? []
  const nextCells = next.value?.cells ?? []

  // Checked before the cell-by-cell comparison so "the other side has nothing"
  // never reads as "the cells are wrong" — those two need different responses.
  // During the migration window only_legacy is the expected bulk state (the
  // pipeline has not published that district to election-db yet), while a
  // cell_mismatch on a district that IS published is a real defect.
  if (legacyCells.length > 0 && nextCells.length === 0) return 'only_legacy'
  if (nextCells.length > 0 && legacyCells.length === 0) return 'only_new'

  if (!sameCells(legacyCells, nextCells)) return 'cell_mismatch'

  // Compared as `?? null` rather than directly, so "no district" (a null
  // response) and "a district whose meta row has no coverage" agree instead of
  // reading as undefined !== null.
  if ((legacy.value?.coverage ?? null) !== (next.value?.coverage ?? null)) {
    return 'coverage_mismatch'
  }
  return 'match'
}

/**
 * Both sources order by (lat, lng), so this is a positional walk rather than a
 * set comparison — an ordering difference is itself worth catching, since
 * gp-marketing renders the array in the order it is given.
 */
function sameCells(a: VoterDensityCell[], b: VoterDensityCell[]): boolean {
  if (a.length !== b.length) return false
  return a.every((cell, i) => {
    const other = b[i]
    if (!other) return false
    return (
      cell.count === other.count &&
      Math.abs(cell.lat - other.lat) < COORD_EPSILON &&
      Math.abs(cell.lng - other.lng) < COORD_EPSILON
    )
  })
}
