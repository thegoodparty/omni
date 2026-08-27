import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import type { VoterDensityResult } from '../services/voterDensity.service'
import {
  buildVoterDensityMetaSql,
  buildVoterDensitySql,
  mapVoterDensityCells,
  mapVoterDensityCoverage,
} from './databricksVoterDensitySql.util'
import {
  PeopleDbxStatementClient,
  PeopleDbxTimeoutError,
  PeopleDbxUnavailableError,
} from './peopleDbxStatement.client'

const UNAVAILABLE_MESSAGE =
  'Voter density data is temporarily unavailable. This is a connection ' +
  'problem, not a district without a heat map.'

const TIMEOUT_MESSAGE =
  'The voter density map took too long to load. Please try again.'

/**
 * Reads the precomputed voter-density heat map from the `mart_gp_api` schema in
 * Databricks, the same marts the loader mirrors into people-db Postgres.
 *
 * Its own class rather than a method on `DatabricksVoterService` because
 * density is its own service on the Postgres side too, and because it needs
 * none of that service's machinery: no district resolution, no L2 column probe,
 * no filter pipeline. It is two keyed reads.
 */
@Injectable()
export class DatabricksVoterDensityService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly client: PeopleDbxStatementClient,
  ) {
    this.logger.setContext(DatabricksVoterDensityService.name)
  }

  async findVoterDensity(
    districtId: string,
    resolution: number,
  ): Promise<VoterDensityResult> {
    // Independent reads on the same key, issued together the way the Postgres
    // arm issues its pair.
    const [cellRows, metaRows] = await Promise.all([
      this.run(buildVoterDensitySql(districtId, resolution)),
      this.run(buildVoterDensityMetaSql(districtId, resolution)),
    ])

    return {
      coverage: mapVoterDensityCoverage(metaRows.rows),
      cells: mapVoterDensityCells(cellRows.rows),
    }
  }

  private async run(statement: Parameters<typeof this.client.query>[0]) {
    try {
      return await this.client.query(statement)
    } catch (err) {
      // A district with no heat map is a real, common answer that the page
      // renders as "no map". An unreachable warehouse must never be able to
      // present as that, or a warehouse outage silently becomes "this district
      // has no data" on every public profile at once.
      if (err instanceof PeopleDbxUnavailableError) {
        this.logger.error({ err }, 'databricks voter density is unreachable')
        throw new BadGatewayException(UNAVAILABLE_MESSAGE)
      }
      if (!(err instanceof PeopleDbxTimeoutError)) throw err
      this.logger.error(
        { err },
        'databricks voter density query exceeded its ceiling',
      )
      throw new GatewayTimeoutException(TIMEOUT_MESSAGE)
    }
  }
}
