import { HttpService } from '@nestjs/axios'
import { BadGatewayException, Injectable } from '@nestjs/common'
import { isAxiosError } from 'axios'
import jwt from 'jsonwebtoken'
import { PinoLogger } from 'nestjs-pino'
import { lastValueFrom } from 'rxjs'
import { VoterDensityResponse } from '../schemas/public/VoterDensity.schema'

const { ELECTION_API_URL, PEOPLE_API_URL, PEOPLE_API_S2S_SECRET } = process.env

// Shape people-api returns from GET /v1/people/voter-density. We consume only
// coverage + cells; the rest (districtId, resolution, minCellCount) is dropped
// before the public boundary.
interface PeopleApiVoterDensity {
  coverage: number | null
  cells: { lat: number; lng: number; count: number }[]
}

interface ElectionApiVoterDistrict {
  personId: string
  districtId: string | null
  state: string | null
}

/**
 * Resolves a person's L2 district (via election-api) and proxies the precomputed
 * voter-density cells (from people-api, S2S) to the public /people page. This is
 * the ONLY path by which the read-only, S2S-only people-api density data reaches
 * an unauthenticated caller — no raw PII ever transits (people-api emits only
 * aggregated, k-anonymized centroid cells).
 *
 * Returns null when the person maps to no L2 district (federal/statewide, or a
 * person the data team hasn't reconciled) so the controller can 404 and the
 * page simply renders no map.
 */
@Injectable()
export class VoterDensityProxyService {
  private cachedS2SToken: string | null = null

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

    const density = await this.fetchDensityFromPeopleApi(districtId)
    return { coverage: density.coverage, cells: density.cells }
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

  private async fetchDensityFromPeopleApi(
    districtId: string,
  ): Promise<PeopleApiVoterDensity> {
    if (!PEOPLE_API_URL) {
      throw new Error('Please set PEOPLE_API_URL in your .env')
    }

    try {
      const response = await lastValueFrom(
        this.httpService.get<PeopleApiVoterDensity>(
          `${PEOPLE_API_URL}/v1/people/voter-density`,
          {
            headers: { Authorization: `Bearer ${this.getValidS2SToken()}` },
            params: { districtId },
          },
        ),
      )
      return response.data
    } catch (error) {
      this.logger.error(
        { error, districtId },
        'Failed to fetch voter density from people API',
      )
      throw new BadGatewayException(
        'Failed to fetch voter density from people API',
      )
    }
  }

  // S2S token mint/cache — mirrors ContactsService: HS256 over
  // PEOPLE_API_S2S_SECRET, iss gp-api / aud people-api, 5m lifetime.
  private getValidS2SToken(): string {
    if (!PEOPLE_API_S2S_SECRET) {
      throw new Error('Please set PEOPLE_API_S2S_SECRET in your .env')
    }
    if (this.cachedS2SToken && this.isTokenValid(this.cachedS2SToken)) {
      return this.cachedS2SToken
    }
    const now = Math.floor(Date.now() / 1000)
    this.cachedS2SToken = jwt.sign(
      { iss: 'gp-api', aud: 'people-api', iat: now, exp: now + 300 },
      PEOPLE_API_S2S_SECRET,
    )
    return this.cachedS2SToken
  }

  private isTokenValid(token: string): boolean {
    try {
      // jwt.decode returns string | JwtPayload | null
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const decoded = jwt.decode(token) as { exp?: number } | null
      if (!decoded?.exp) return false
      return decoded.exp > Math.floor(Date.now() / 1000) + 60
    } catch {
      return false
    }
  }
}
