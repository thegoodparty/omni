import { GatewayTimeoutException, Inject, Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/people-prisma'
import { DatabricksVoterDensityService } from '../databricks/databricksVoterDensity.service'
import { createPeopleDbBase, PEOPLE_MODELS } from '../peopleDbBase.util'
import {
  COMPARISON_STATEMENT_TIMEOUT_MS,
  ShadowReadService,
} from '../shadowRead.service'
import { hash32 } from '../util/hash.util'
import {
  isStatementTimeoutError,
  STATEMENT_TIMEOUT_MS,
} from '../utils/statementTimeout.util'

// The app selects a resolution per request; res 8 is the default the
// data-team handoff documents when none is given.
const DEFAULT_RESOLUTION = 8

const TIMEOUT_MESSAGE =
  'The voter density map took too long to load. Please try again.'

/** A single precomputed heat-map cell: an H3 centroid and its voter count. */
export interface VoterDensityCell {
  lat: number
  lng: number
  count: number
}

export interface VoterDensityResult {
  // rendered_voters / total_voters in [0, 1], from the meta row. null when no
  // meta exists for this (district, resolution) — the public page treats
  // null/low coverage as "do not render".
  coverage: number | null
  cells: VoterDensityCell[]
}

// Coordinates are fixed to six decimals (~0.1m, far finer than a heat-map cell
// centroid needs) before hashing. Both arms ultimately read the same mart, but
// the Postgres copy arrives through the loader's round-trip, and float
// formatting noise must not read as a divergence.
const DIGEST_PRECISION = 6

// Order-insensitive digest over the cell set, not a cell count: two heat maps
// with the same number of cells can cover different ground, and that is the
// divergence worth catching. Coverage is folded in because it is the value the
// page thresholds on, and it can drift while the cell set does not.
const fingerprintDensity = (value: VoterDensityResult): string => {
  const cells = value.cells.map(
    (cell) =>
      `${cell.lat.toFixed(DIGEST_PRECISION)},` +
      `${cell.lng.toFixed(DIGEST_PRECISION)},${cell.count}`,
  )
  const coverage =
    value.coverage === null ? 'null' : value.coverage.toFixed(DIGEST_PRECISION)
  return `${cells.length}:${coverage}:${hash32([...cells].sort().join(';'))}`
}

/**
 * Read-only access to the precomputed voter-density heat map, from Databricks
 * or people-db depending on `PEOPLE_DB_DUAL_READ`. There is NO H3 math on
 * either arm: the pipeline already binned voters to H3 cells, k-anonymized
 * them, and stored each cell's centroid, so this is a keyed read on
 * (districtId, resolution) plus the matching coverage meta row.
 */
@Injectable()
export class VoterDensityService extends createPeopleDbBase(
  PEOPLE_MODELS.DistrictVoterDensity,
) {
  // Injected rather than constructor-args because createPeopleDbBase owns the
  // constructor; property injection keeps the base's super() contract intact.
  @Inject(ShadowReadService)
  private readonly shadow!: ShadowReadService

  @Inject(DatabricksVoterDensityService)
  private readonly databricksDensity!: DatabricksVoterDensityService

  async getVoterDensity(
    districtId: string,
    resolution: number = DEFAULT_RESOLUTION,
  ): Promise<VoterDensityResult> {
    if (!this.shadow.enabled) {
      return this.readFromPostgres(districtId, resolution)
    }
    return this.shadow.compare({
      op: 'voter-density',
      districtId,
      authoritative: () =>
        this.databricksDensity.findVoterDensity(districtId, resolution),
      comparison: () => this.readFromPostgres(districtId, resolution),
      // A cell count would call two heat maps equal whenever they happened to
      // have the same number of cells, and the divergence worth catching is a
      // different set of cells of the same size. Coverage is folded in because
      // it is the value the page thresholds on, and it can drift while the cell
      // set does not.
      //
      // Unlike the other dual reads, disagreement here is not necessarily a
      // defect: both arms read the same marts, but Postgres receives its copy
      // through the monthly loader while Databricks reads the mart directly, so
      // the two legitimately differ between a mart rebuild and the next load.
      // Until the loader has run once for these tables, people-db has no
      // density rows at all and every comparison will disagree. Read these
      // fingerprints as a staleness signal; the latency fields are the part
      // that measures the engine.
      fingerprintAuthoritative: fingerprintDensity,
      fingerprintComparison: fingerprintDensity,
    })
  }

  private async readFromPostgres(
    districtId: string,
    resolution: number,
  ): Promise<VoterDensityResult> {
    // These are model-level reads, so they cannot go through
    // runUnderStatementTimeout, which takes raw SQL. The SET LOCAL rides in the
    // same batch transaction instead: Prisma runs a batch on one connection, so
    // the ceiling scopes to exactly these queries. Comparison-only reads take
    // the tighter one, since a slow shadow must not hold a pooled connection
    // open when nothing is waiting on its answer.
    const timeoutMs = this.shadow.enabled
      ? COMPARISON_STATEMENT_TIMEOUT_MS
      : STATEMENT_TIMEOUT_MS
    const startedAt = Date.now()
    try {
      // The cells and their coverage meta are independent reads on the same
      // key. They serialize here rather than running concurrently, which is the
      // cost of sharing one transaction's timeout.
      const [, rows, meta] = await this.client.$transaction([
        // SET takes no bind parameters, and the interval is a compile-time
        // constant, so Prisma.raw is safe.
        this.client.$executeRaw(
          Prisma.raw(`SET LOCAL statement_timeout = '${timeoutMs}ms'`),
        ),
        this.model.findMany({
          where: { districtId, resolution },
          select: { lat: true, lng: true, voterCount: true },
          // Deterministic order keeps responses stable across identical
          // requests.
          orderBy: [
            { lat: Prisma.SortOrder.asc },
            { lng: Prisma.SortOrder.asc },
          ],
        }),
        this.client.districtVoterDensityMeta.findUnique({
          where: { districtId_resolution: { districtId, resolution } },
          select: { coverage: true },
        }),
      ])

      return {
        coverage: meta?.coverage ?? null,
        cells: rows.map((r) => ({
          lat: r.lat,
          lng: r.lng,
          count: r.voterCount,
        })),
      }
    } catch (error) {
      if (!isStatementTimeoutError(error)) throw error
      this.logger.error(
        { err: error, elapsedMs: Date.now() - startedAt },
        'people-db query exceeded the statement timeout',
      )
      throw new GatewayTimeoutException(TIMEOUT_MESSAGE)
    }
  }
}
