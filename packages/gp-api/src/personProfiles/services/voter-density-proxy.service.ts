import { HttpService } from '@nestjs/axios'
import { BadGatewayException, Injectable } from '@nestjs/common'
import { isAxiosError } from 'axios'
import { PinoLogger } from 'nestjs-pino'
import { lastValueFrom } from 'rxjs'
import { VoterDensityService } from '@/peopleDb/services/voterDensity.service'
import { VoterDensityResponse } from '../schemas/public/VoterDensity.schema'

const { ELECTION_API_URL } = process.env

interface ElectionApiVoterDistrict {
  personId: string
  districtId: string | null
  state: string | null
}

/**
 * Resolves a person's L2 district (via election-api) and reads the precomputed,
 * k-anonymized voter-density cells for that district from people-db (via
 * gp-api's in-process `peopleDb` module) for the public /people page's heat
 * map. The cells are aggregated H3 centroids only — no raw PII ever transits.
 *
 * Graceful degradation, never an error to the caller: a person that maps to no
 * L2 district returns null (the controller 404s, the page renders no map), and
 * a district with no density rows returns empty cells. The public page also
 * hides the map on low `coverage`, so a sparsely-covered district simply shows
 * no map rather than a misleading one.
 */
@Injectable()
export class VoterDensityProxyService {
  constructor(
    private readonly httpService: HttpService,
    private readonly voterDensity: VoterDensityService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(VoterDensityProxyService.name)
  }

  async getVoterDensity(
    personId: string,
  ): Promise<VoterDensityResponse | null> {
    const districtId = await this.resolveDistrictId(personId)
    if (!districtId) return null

    const { coverage, cells } =
      await this.voterDensity.getVoterDensity(districtId)
    return { coverage, cells }
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
