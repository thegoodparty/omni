import { HttpService } from '@nestjs/axios'
import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { isAxiosError } from 'axios'
import { PinoLogger } from 'nestjs-pino'
import { lastValueFrom } from 'rxjs'
import { z } from 'zod'
import { ElectionApiTokenService } from '@/vendors/clerk/services/electionApiToken.service'
import { DistrictById } from './district.service'

const { ELECTION_API_URL } = process.env

// election-api also returns its L2-derived voter aggregates (registeredVoters,
// uniqueCellphones, uniqueLandlines). Only the four identity columns are read
// here, and they are the four this table and people-db's District agree on
// exactly: a checksum over (id, state, type, name) across all 131,642 rows
// matched byte for byte when this was written.
const districtSchema = z.object({
  id: z.string(),
  state: z.string(),
  L2DistrictType: z.string(),
  L2DistrictName: z.string(),
})

/**
 * Resolves a district for the Databricks voter path from election-api rather
 * than from people-db.
 *
 * election-api owns this table; people-db's copy is downstream of it, which is
 * why the ids are required to match. Reading the upstream directly is what lets
 * a Databricks-served voter read touch people-db not at all — the district
 * lookup was the last thing keeping that cluster on the path.
 *
 * The trade is a service hop where there used to be a local query. It is paid
 * once per district per task (DatabricksVoterService memoizes the result), so
 * the cost is bounded, but voter reads now depend on election-api being up.
 */
@Injectable()
export class ElectionApiDistrictService {
  constructor(
    private readonly httpService: HttpService,
    private readonly logger: PinoLogger,
    private readonly tokenService: ElectionApiTokenService,
  ) {
    this.logger.setContext(ElectionApiDistrictService.name)
  }

  async findDistrictById(id: string): Promise<DistrictById> {
    if (!ELECTION_API_URL) {
      throw new Error('Please set ELECTION_API_URL in your .env')
    }

    try {
      // election-api is M2M-locked, so the Clerk bearer is required rather
      // than optional. The token service caches for an hour and coalesces
      // concurrent mints, so this is not a per-call round trip.
      const headers = await this.tokenService.authHeader()
      const { data } = await lastValueFrom(
        this.httpService.get<unknown>(
          `${ELECTION_API_URL}/v1/districts/${encodeURIComponent(id)}`,
          { headers },
        ),
      )
      const parsed = districtSchema.safeParse(data)
      if (!parsed.success) {
        this.logger.error(
          { issues: parsed.error.issues, districtId: id },
          'election-api district response failed schema validation',
        )
        throw new BadGatewayException(
          'election-api returned an unexpected district shape',
        )
      }
      return {
        id: parsed.data.id,
        type: parsed.data.L2DistrictType,
        name: parsed.data.L2DistrictName,
        state: parsed.data.state,
      }
    } catch (err) {
      if (err instanceof BadGatewayException) throw err
      // A 404 is a missing district, which is the caller's domain error and
      // carries the same message the people-db lookup used to produce.
      if (isAxiosError(err) && err.response?.status === 404) {
        throw new NotFoundException(`District not found for id=${id}`)
      }
      this.logger.error(
        { err, districtId: id },
        'Failed to resolve district from election-api',
      )
      throw new BadGatewayException('Failed to resolve district')
    }
  }
}
