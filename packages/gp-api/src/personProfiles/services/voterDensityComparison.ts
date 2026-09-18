import { VoterDensityCompareResult } from '../observability/person-profiles.metrics'
import {
  VoterDensityCell,
  VoterDensityResponse,
} from '../schemas/public/VoterDensity.schema'

/**
 * Comparison half of the people-db -> election-db voter-density migration.
 * Temporary by construction: this whole module goes away with the people-db
 * leg once the counter it feeds reads clean.
 *
 * WHY THIS IS NOT AN EQUALITY CHECK, which is what it was until 2026-09-18.
 *
 * The two legs are not two implementations of the same query. They are two
 * COPIES OF THE SAME dbt MART, taken on different schedules: people-api-loader
 * writes people-db `@monthly`, and the nightly `sync_election_api` DAG (22:00
 * UTC, ~57 minutes for the density table) writes election-db. So every night
 * the new leg advances to a fresher rebuild while the legacy leg stays frozen
 * at its monthly vintage, and the mart underneath both is rebuilt from an L2
 * voter file that reloads nightly.
 *
 * Exact equality therefore asks the two copies to have been built at the same
 * instant, which they never are. In production it reported a mismatch on ~70%
 * of requests — a number that says nothing about whether the new leg is fit to
 * serve, and which made "flip once the comparison reads clean" a condition
 * that could not arrive.
 *
 * WHAT DIVERGENCE ACTUALLY LOOKS LIKE, measured over 30 days to 2026-09-18:
 *
 *   - 73% of reported mismatches had IDENTICAL cell counts, differing only in
 *     `coverage` around the 6th decimal place. `coverage` is
 *     rendered_voters/total_voters and `total_voters` counts non-geocoded
 *     voters too, so one voter with a new address moves it without touching a
 *     single cell.
 *   - The rest differed by a median of 1 cell and at most 18 (0.57% and 5.56%
 *     of the district). These are the K-anonymity cliff: `voter_density_k` is
 *     10, a cell holding exactly 10 voters is published, and one voter leaving
 *     drops it from the map entirely. Sampled prod districts carry 3.7-13.4%
 *     of their cells within 5 of K, which is the population these are drawn
 *     from.
 *
 * SO THE MEASURE IS VOTERS, NOT CELLS. Weighting the difference by the voters
 * it represents is what separates the two cases, and it is size-independent in
 * a way a cell percentage is not:
 *
 *   - worst observed vintage skew:        0.15-0.19% of rendered voters
 *   - typical vintage skew:               0.015-0.048%
 *   - ONE large cell going missing:       0.55% (big district) to 6% (small)
 *
 * A heat map is a density surface. Cells at the suppression boundary carry 10
 * voters against a top cell's 4,771, so they are ~0.2% of what the surface
 * renders — invisible. A cell that carries real weight disappearing is not,
 * and that is the defect this still has to catch.
 */

/**
 * Both sources publish the H3 cell centroid for the same H3 index, so matching
 * cells should be bit-identical doubles. The epsilon only absorbs a formatting
 * difference between the two transports (Prisma's native double vs a JSON
 * round-trip); at ~0.1mm it cannot hide a genuinely different cell.
 */
const COORD_EPSILON = 1e-9

/** Decimal places that express COORD_EPSILON, for keying cells by position. */
const COORD_KEY_PLACES = 9

/**
 * Share of a district's rendered voters that may sit in cells the two legs
 * disagree about — whether the cell is missing from one side or present on
 * both with a different count.
 *
 * 1% is ~5x the worst vintage skew measured (0.19%) and ~20x the typical case,
 * while still being a fifth of what a single heavy cell is worth in a large
 * district. Set deliberately above the measured maximum rather than at it: the
 * 0.19% figure assumes every differing cell sits exactly at K, which is the
 * floor of what the difference can be worth, and drift between two matched
 * cells could not be measured from the logs at all before this shipped.
 *
 * `voterDensityDriftFraction` is now logged on every non-exact comparison, so
 * this can be tightened against real numbers within a day of deploying rather
 * than argued about.
 */
const VOTER_DRIFT_FRACTION = 0.01

/**
 * Share of rendered voters that any ONE disagreeing cell may carry.
 *
 * The aggregate budget above is spent by many tiny cells or by one large one,
 * and those are different events: 100 boundary cells flickering is the
 * pipeline working, one 4,771-voter cell vanishing is a defect that happens to
 * fit inside 1%. This is what keeps the budget from laundering the second into
 * the first, and it is why the aggregate can afford to be generous.
 */
const SINGLE_CELL_DRIFT_FRACTION = 0.005

/**
 * Absolute difference allowed between the two coverage figures.
 *
 * Observed maximum is 5.2e-3 and the median is 6.9e-5. 0.01 clears the worst
 * case with room and is still far below a difference that would mean the two
 * sides disagree about how much of the district is represented.
 *
 * NOTE for whoever tunes this: gp-marketing hides the map below a coverage of
 * 0.5 (MIN_VOTER_DENSITY_COVERAGE), so two legs within this epsilon can still
 * disagree about whether a map renders at all when they straddle that line.
 * Measured at 63 requests in 24h, 0.02% of traffic. Tightening the epsilon
 * does not fix that — only agreeing on a vintage would — so it is recorded
 * here rather than defended against.
 */
const COVERAGE_EPSILON = 0.01

/**
 * One source's answer, with its failure captured rather than thrown. Both legs
 * are always caught so the comparison happens either way; the authoritative
 * leg's error is re-thrown afterwards, and the shadow leg's is only counted.
 */
export type LegOutcome =
  | { ok: true; value: VoterDensityResponse | null }
  | { ok: false; error: unknown }

/**
 * The comparison's verdict plus the numbers behind it, so a disagreement is
 * logged as a magnitude rather than as a boolean and the tolerances above can
 * be re-derived from production instead of from a sample.
 */
export type VoterDensityComparison = {
  result: VoterDensityCompareResult
  /** Voters sitting in cells the two legs disagree about. */
  driftedVoters: number
  /** Those voters as a share of the larger side's rendered total. */
  driftFraction: number
  /** The worst single cell's share, which SINGLE_CELL_DRIFT_FRACTION caps. */
  largestCellDriftFraction: number
  /** Absolute coverage difference, or null when either side has none. */
  coverageDelta: number | null
}

export function compareLegs(
  legacy: LegOutcome,
  next: LegOutcome,
): VoterDensityCompareResult {
  return compareLegsDetailed(legacy, next).result
}

export function compareLegsDetailed(
  legacy: LegOutcome,
  next: LegOutcome,
): VoterDensityComparison {
  const none: Omit<VoterDensityComparison, 'result'> = {
    driftedVoters: 0,
    driftFraction: 0,
    largestCellDriftFraction: 0,
    coverageDelta: null,
  }

  if (!legacy.ok || !next.ok) return { result: 'error', ...none }

  const legacyCells = legacy.value?.cells ?? []
  const nextCells = next.value?.cells ?? []

  // Checked before anything else so "the other side has nothing" never reads
  // as "the cells are wrong" — those two need different responses. During the
  // migration window only_legacy is the expected bulk state (the pipeline has
  // not published that district to election-db yet), while a real difference
  // on a district that IS published is a defect.
  if (legacyCells.length > 0 && nextCells.length === 0) {
    return { result: 'only_legacy', ...none }
  }
  if (nextCells.length > 0 && legacyCells.length === 0) {
    return { result: 'only_new', ...none }
  }

  const legacyCoverage = legacy.value?.coverage ?? null
  const nextCoverage = next.value?.coverage ?? null
  const coverageDelta =
    legacyCoverage === null || nextCoverage === null
      ? null
      : Math.abs(legacyCoverage - nextCoverage)

  const drift = measureDrift(legacyCells, nextCells)
  const metrics = { ...drift, coverageDelta }

  // Both sides order by (lat, lng) and gp-marketing renders the array as given,
  // so an unsorted side is a rendering difference regardless of its contents.
  // Checked as sortedness rather than by walking the two in parallel, which is
  // what the old positional comparison did: a single inserted or dropped cell
  // misaligned every cell after it and reported the whole district as changed.
  if (!isSortedByPosition(legacyCells) || !isSortedByPosition(nextCells)) {
    return { result: 'cell_mismatch', ...metrics }
  }

  if (
    drift.driftFraction > VOTER_DRIFT_FRACTION ||
    drift.largestCellDriftFraction > SINGLE_CELL_DRIFT_FRACTION
  ) {
    return { result: 'cell_mismatch', ...metrics }
  }

  // A coverage figure present on one side and absent on the other is a
  // difference in kind rather than degree — a fully suppressed district and
  // one whose meta row was never built are not the same state — so no epsilon
  // applies and it cannot be tolerated.
  if ((legacyCoverage === null) !== (nextCoverage === null)) {
    return { result: 'coverage_mismatch', ...metrics }
  }
  if (coverageDelta !== null && coverageDelta > COVERAGE_EPSILON) {
    return { result: 'coverage_mismatch', ...metrics }
  }

  const exact =
    drift.driftedVoters === 0 && (coverageDelta === null || coverageDelta === 0)

  return { result: exact ? 'match' : 'match_within_tolerance', ...metrics }
}

/**
 * Voters sitting in cells the two legs do not agree on, as an absolute count
 * and as a share of the district.
 *
 * Cells are matched by position rather than by index, because a cell dropped
 * from one side shifts every later index. A cell present on only one side
 * contributes its whole count; a cell on both contributes the difference.
 */
function measureDrift(
  legacyCells: VoterDensityCell[],
  nextCells: VoterDensityCell[],
): Omit<VoterDensityComparison, 'result' | 'coverageDelta'> {
  const legacyByPosition = byPosition(legacyCells)
  const nextByPosition = byPosition(nextCells)

  let driftedVoters = 0
  let largestCellDrift = 0

  const note = (voters: number) => {
    driftedVoters += voters
    largestCellDrift = Math.max(largestCellDrift, voters)
  }

  for (const [key, count] of legacyByPosition) {
    const other = nextByPosition.get(key)
    note(other === undefined ? count : Math.abs(count - other))
  }
  for (const [key, count] of nextByPosition) {
    if (!legacyByPosition.has(key)) note(count)
  }

  // The larger side, so a district that shed cells is not judged against the
  // smaller total it shed them into — which would inflate the fraction exactly
  // when cells went missing. Guarded because a zero total would make every
  // fraction Infinity, though both sides are known non-empty by here.
  const renderedVoters = Math.max(sumCounts(legacyCells), sumCounts(nextCells))
  if (renderedVoters === 0) {
    return { driftedVoters, driftFraction: 0, largestCellDriftFraction: 0 }
  }

  return {
    driftedVoters,
    driftFraction: driftedVoters / renderedVoters,
    largestCellDriftFraction: largestCellDrift / renderedVoters,
  }
}

const sumCounts = (cells: VoterDensityCell[]) =>
  cells.reduce((total, cell) => total + cell.count, 0)

/**
 * Cells keyed by rounded centroid, summing any duplicates rather than letting
 * the last one win — two rows on the same centroid is itself a difference
 * worth counting, and dropping one would hide the voters it carries.
 *
 * Rounding to COORD_KEY_PLACES is what applies COORD_EPSILON here: the same
 * centroid arriving via Prisma's double and via a JSON round-trip has to land
 * on one key.
 */
function byPosition(cells: VoterDensityCell[]): Map<string, number> {
  const byKey = new Map<string, number>()
  for (const cell of cells) {
    const key = `${cell.lat.toFixed(COORD_KEY_PLACES)},${cell.lng.toFixed(COORD_KEY_PLACES)}`
    byKey.set(key, (byKey.get(key) ?? 0) + cell.count)
  }
  return byKey
}

/** Ascending by (lat, lng), the order both sources claim to publish. */
function isSortedByPosition(cells: VoterDensityCell[]): boolean {
  for (let i = 1; i < cells.length; i++) {
    const previous = cells[i - 1]
    const current = cells[i]
    if (!previous || !current) return false
    if (current.lat - previous.lat < -COORD_EPSILON) return false
    if (
      Math.abs(current.lat - previous.lat) < COORD_EPSILON &&
      current.lng - previous.lng < -COORD_EPSILON
    ) {
      return false
    }
  }
  return true
}
