import { HttpService } from '@nestjs/axios'
import { BadGatewayException, Injectable } from '@nestjs/common'
import { isAxiosError } from 'axios'
import { PinoLogger } from 'nestjs-pino'
import { lastValueFrom } from 'rxjs'
import { ElectionApiTokenService } from '@/vendors/clerk/services/electionApiToken.service'
import {
  VoterDensityCell,
  VoterDensityResponse,
} from '../schemas/public/VoterDensity.schema'

const { ELECTION_API_URL } = process.env

interface ElectionApiVoterDensity {
  personId: string
  districtId: string | null
  coverage: number | null
  cells: VoterDensityCell[]
}

// The public page asks for the map on every render and each miss fans out to
// election-api, which in turn resolves the district and reads its cells. The
// cells are recomputed on a daily cadence, so answering an identical lookup
// from memory for a minute costs no freshness a visitor could notice. Per
// process, so each replica warms its own.
const CACHE_TTL_MS = 60_000
const MAX_CACHE_ENTRIES = 1_000

/**
 * Serves the public /people page's heat map out of election-db, where the
 * precomputed cells sit beside the `District` they are keyed on, so one call
 * answers the whole question.
 *
 * The cells are aggregated H3 centroids only — no raw PII ever transits.
 *
 * Degrades to no-map for the domain cases the page expects: a person that maps
 * to no L2 district returns null (the controller 404s, the page renders no
 * map), and a district with no density rows returns empty cells (the page also
 * hides the map on low `coverage`, so a sparsely-covered district shows no map
 * rather than a misleading one). A hard election-api failure (non-404) is NOT
 * swallowed — it surfaces as a 502 — so a genuine outage stays visible instead
 * of masquerading as "no map".
 */
@Injectable()
export class VoterDensityProxyService {
  private readonly cache = new Map<
    string,
    { expiresAtMs: number; value: VoterDensityResponse | null }
  >()

  constructor(
    private readonly httpService: HttpService,
    private readonly logger: PinoLogger,
    private readonly tokenService: ElectionApiTokenService,
  ) {
    this.logger.setContext(VoterDensityProxyService.name)
  }

  async getVoterDensity(
    personId: string,
  ): Promise<VoterDensityResponse | null> {
    const now = Date.now()
    const cached = this.cache.get(personId)
    if (cached && cached.expiresAtMs > now) return cached.value

    const data = await this.getFromElectionApi<ElectionApiVoterDensity>(
      `${this.baseUrl()}/v1/persons/${encodeURIComponent(personId)}/voter-density`,
      personId,
      'Failed to read voter density from election API',
    )

    // A 404 (unknown person) and a resolved person with no district are the
    // same thing to the page: no map.
    const value =
      !data || !data.districtId
        ? null
        : { coverage: data.coverage, cells: data.cells }

    this.remember(personId, value, now)
    return value
  }

  // A failed read throws before reaching here, so only answers are cached.
  private remember(
    personId: string,
    value: VoterDensityResponse | null,
    now: number,
  ): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      for (const [key, entry] of this.cache) {
        if (entry.expiresAtMs <= now) this.cache.delete(key)
      }
      // Nothing had expired, so every entry is live and there is no
      // least-useful one to drop. Starting over costs one round trip per
      // person and keeps the map bounded.
      if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.clear()
    }
    this.cache.set(personId, { value, expiresAtMs: now + CACHE_TTL_MS })
  }

  /** Resolves to null on a 404; throws a 502 on anything else. */
  private async getFromElectionApi<T>(
    url: string,
    personId: string,
    failureMessage: string,
  ): Promise<T | null> {
    try {
      // election-api is M2M-locked; attach the Clerk bearer like every other
      // gp-api → election-api caller. Without it these reads 401 (a 401 is not
      // a 404, so the caller would 502 instead of degrading to "no district").
      const headers = await this.tokenService.authHeader()
      const response = await lastValueFrom(
        this.httpService.get<T>(url, { headers }),
      )
      return response.data ?? null
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        return null
      }
      this.logger.error({ error, personId }, failureMessage)
      throw new BadGatewayException('Failed to resolve district')
    }
  }

  private baseUrl(): string {
    if (!ELECTION_API_URL) {
      throw new Error('Please set ELECTION_API_URL in your .env')
    }
    return ELECTION_API_URL
  }
}
