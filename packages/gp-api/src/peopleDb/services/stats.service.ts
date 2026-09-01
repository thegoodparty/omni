import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { StatsDTO } from '../schemas/people.schema'
import { DatabricksVoterService } from '../databricks/databricksVoter.service'
import {
  STATS_DIMENSION_KEYS,
  type ComputedDistrictStats,
} from '../databricks/databricksDistrictStatsSql.util'
import { statementIdCollector } from '../databricks/peopleDbxStatement.client'
import { VoterReadLogService } from '../databricks/voterReadLog.service'

export const STATS_DUAL_READ_MESSAGE = 'district stats dual read'

// The mirrored stats table is refreshed on a pipeline cadence, so what it
// serves can be weeks old. Computing the same five dimensions from the voter
// rows costs one scan, and this comparison is how we find out whether the two
// agree before anything depends on the answer. The mirrored table stays
// authoritative: it serves the response, and the live scan only ever produces
// a log line.
const MAX_CONCURRENT_LIVE_READS = 2

type Fingerprint = {
  total: number
  withCell: number
  buckets: Record<string, Record<string, number>>
}

// Compared as label -> count per dimension rather than as an ordered array, so
// a different bucket order is not reported as a disagreement. Percent is
// derived from the counts and would only restate them.
//
// Labels are sorted before the object is built, because the comparison below is
// a JSON.stringify equality and that IS key-order sensitive: the mirrored table
// returns buckets in arbitrary array order while the live mapper sorts by
// descending count, so without this every district disagrees on every
// multi-bucket dimension while its totals match exactly.
const fingerprint = (stats: ComputedDistrictStats): Fingerprint => {
  const buckets: Record<string, Record<string, number>> = {}
  for (const key of STATS_DIMENSION_KEYS) {
    buckets[key] = Object.fromEntries(
      stats.buckets[key]
        .map(({ label, count }): [string, number] => [label, count])
        .sort(([a], [b]) => a.localeCompare(b)),
    )
  }
  return {
    total: stats.totalConstituents,
    withCell: stats.totalConstituentsWithCellPhone,
    buckets,
  }
}

const diffDimensions = (a: Fingerprint, b: Fingerprint): string[] =>
  STATS_DIMENSION_KEYS.filter(
    (key) => JSON.stringify(a.buckets[key]) !== JSON.stringify(b.buckets[key]),
  )

@Injectable()
export class StatsService {
  private liveInFlight = 0
  private readonly liveWaiters: Array<() => void> = []

  constructor(
    private readonly databricks: DatabricksVoterService,
    private readonly readLog: VoterReadLogService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(StatsService.name)
  }

  async findStats(dto: StatsDTO): Promise<ComputedDistrictStats | null> {
    const authoritative = await this.readLog.measure({
      op: 'stats',
      districtId: dto.districtId,
      read: () => this.databricks.findStats(dto.districtId),
    })
    // Deliberately not awaited: the live scan is a second, heavier query and
    // must not add a millisecond to the response or fail it. Errors are
    // swallowed into the log line for the same reason.
    void this.compareLive(dto.districtId, authoritative)
    return authoritative
  }

  private async compareLive(
    districtId: string,
    authoritative: ComputedDistrictStats | null,
  ): Promise<void> {
    try {
      await this.withLiveSlot(async () => {
        const statementIds: string[] = []
        const startedAt = performance.now()
        const live = await statementIdCollector.run(statementIds, () =>
          this.databricks.findStatsLive(districtId),
        )
        const liveMs = Math.round(performance.now() - startedAt)
        // Both absent is agreement: a district with no mirrored row and no
        // voters in scope is the same answer from both stores.
        const agrees =
          authoritative === null || live === null
            ? authoritative === live
            : JSON.stringify(fingerprint(authoritative)) ===
              JSON.stringify(fingerprint(live))
        this.logger.info(
          {
            districtId,
            liveMs,
            statementIds,
            agrees,
            martTotal: authoritative?.totalConstituents ?? null,
            liveTotal: live?.totalConstituents ?? null,
            martWithCell: authoritative?.totalConstituentsWithCellPhone ?? null,
            liveWithCell: live?.totalConstituentsWithCellPhone ?? null,
            // Only when they differ, and only the dimension names: the counts
            // are already reachable by re-running the statement ids.
            ...(!agrees &&
              authoritative &&
              live && {
                mismatchedDimensions: diffDimensions(
                  fingerprint(authoritative),
                  fingerprint(live),
                ),
              }),
          },
          STATS_DUAL_READ_MESSAGE,
        )
      })
    } catch (err) {
      this.logger.warn(
        { err, districtId, agrees: null },
        STATS_DUAL_READ_MESSAGE,
      )
    }
  }

  // A statewide district scans tens of millions of rows, so more than a couple
  // of these at once would put real load on the warehouse for a number nobody
  // is waiting on. Requests past the cap queue rather than pile on.
  private async withLiveSlot(work: () => Promise<void>): Promise<void> {
    while (this.liveInFlight >= MAX_CONCURRENT_LIVE_READS) {
      await new Promise<void>((resolve) => this.liveWaiters.push(resolve))
    }
    this.liveInFlight += 1
    try {
      await work()
    } finally {
      this.liveInFlight -= 1
      this.liveWaiters.shift()?.()
    }
  }
}
