import { HttpService } from '@nestjs/axios'
import { BadGatewayException, Injectable } from '@nestjs/common'
import { isAxiosError } from 'axios'
import { PinoLogger } from 'nestjs-pino'
import { lastValueFrom } from 'rxjs'
import { VoterDensityResponse } from '../schemas/public/VoterDensity.schema'

const { ELECTION_API_URL } = process.env

interface ElectionApiVoterDistrict {
  personId: string
  districtId: string | null
  state: string | null
}

/**
 * Resolves a person's L2 district (via election-api) for the public /people
 * page's voter-density heat map.
 *
 * The density cells themselves were previously proxied from a people-api
 * `/v1/people/voter-density` endpoint over S2S. people-api has been removed
 * (its data access now lives in gp-api's `peopleDb` module), and that density
 * endpoint was never implemented on the people-api side — so there is no
 * source to port. Until a people-db voter-density query exists, this returns
 * no cells and the page renders no map (the same behavior production had, since
 * the upstream endpoint always 404'd). A future people-db density query is the
 * intended home; wire it into `getVoterDensity` when it lands.
 *
 * Returns null when the person maps to no L2 district so the controller 404s
 * and the page renders no map.
 */
@Injectable()
export class VoterDensityProxyService {
  constructor(
    private readonly httpService: HttpService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(VoterDensityProxyService.name)
  }

  async getVoterDensity(
    personId: string,
  ): Promise<VoterDensityResponse | null> {
    const districtId = await this.resolveDistrictId(personId)
    if (!districtId) return null

    // No people-db voter-density query exists yet; render no map. See the
    // class doc for the migration note.
    return { coverage: null, cells: [] }
  }

  // election-api owns the person -> office/candidacy -> position -> district
  // chain; we just call its resolver. A missing person (404) or any resolution
  // failure is treated as "no district" (null) rather than an error, so the
  // page degrades to no-map instead of erroring.
  private async resolveDistrictId(personId: string): Promise<string | null> {
    if (!ELECTION_API_URL) {
      throw new Error('Please set ELECTION_API_URL in your .env')
    }

    try {
      const response = await lastValueFrom(
        this.httpService.get<ElectionApiVoterDistrict>(
          `${ELECTION_API_URL}/v1/persons/${encodeURIComponent(
            personId,
          )}/voter-district`,
        ),
      )
      return response.data?.districtId ?? null
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        return null
      }
      this.logger.error(
        { error, personId },
        'Failed to resolve voter district from election API',
      )
      throw new BadGatewayException('Failed to resolve district')
    }
  }
}
