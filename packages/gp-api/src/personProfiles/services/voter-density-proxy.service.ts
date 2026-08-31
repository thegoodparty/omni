import { HttpService } from '@nestjs/axios'
import { BadGatewayException, Injectable } from '@nestjs/common'
import { isAxiosError } from 'axios'
import { PinoLogger } from 'nestjs-pino'
import { lastValueFrom } from 'rxjs'
import { VoterDensityService } from '@/peopleDb/services/voterDensity.service'
import { ElectionApiTokenService } from '@/vendors/clerk/services/electionApiToken.service'
import { recordVoterDensityCompare } from '../observability/person-profiles.metrics'
import {
  VoterDensityCell,
  VoterDensityResponse,
} from '../schemas/public/VoterDensity.schema'
import { compareLegs, LegOutcome } from './voterDensityComparison'

const { ELECTION_API_URL } = process.env

interface ElectionApiVoterDistrict {
  personId: string
  districtId: string | null
  state: string | null
}

interface ElectionApiVoterDensity {
  personId: string
  districtId: string | null
  coverage: number | null
  cells: VoterDensityCell[]
}

/**
 * Which source answers the request. The other one still runs, as a shadow.
 * Read per-call rather than destructured at import so the flag can be flipped
 * without a rebuild of the module graph (and so tests can flip it).
 */
function electionApiIsAuthoritative(): boolean {
  return process.env.VOTER_DENSITY_SOURCE === 'election-api'
}

/**
 * Serves the public /people page's heat map, reading it from both the old and
 * the new home while the serving tables move from people-db into election-db.
 *
 * The legacy leg is the two-database one this service was built for: resolve
 * the person's L2 district via election-api, then read the precomputed cells
 * from people-db. The new leg asks election-api for the whole thing, now that
 * the cells live beside the District they are keyed on. Both run on every
 * request; `VOTER_DENSITY_SOURCE` picks which one is believed, and the other is
 * compared against it and counted in
 * `person_profile_voter_density_compare_count_total`. A shadow failure is
 * counted and dropped — it must never turn a working page into an error — while
 * the authoritative leg keeps exactly the semantics it had before.
 *
 * The cells are aggregated H3 centroids only — no raw PII ever transits.
 *
 * Degrades to no-map for the domain cases the page expects: a person that maps
 * to no L2 district returns null (the controller 404s, the page renders no
 * map), and a district with no density rows returns empty cells (the page also
 * hides the map on low `coverage`, so a sparsely-covered district shows no map
 * rather than a misleading one). A hard election-api failure (non-404) is NOT
 * swallowed — it surfaces as a 502, recorded as an `error` — so a genuine
 * outage stays visible instead of masquerading as "no map".
 */
@Injectable()
export class VoterDensityProxyService {
  constructor(
    private readonly httpService: HttpService,
    private readonly voterDensity: VoterDensityService,
    private readonly logger: PinoLogger,
    private readonly tokenService: ElectionApiTokenService,
  ) {
    this.logger.setContext(VoterDensityProxyService.name)
  }

  async getVoterDensity(
    personId: string,
  ): Promise<VoterDensityResponse | null> {
    const preferElectionApi = electionApiIsAuthoritative()

    const [legacy, next] = await Promise.all([
      this.attempt(() => this.readFromPeopleDb(personId)),
      this.attempt(() => this.readFromElectionApi(personId)),
    ])

    this.recordComparison(personId, legacy, next)

    const chosen = preferElectionApi ? next : legacy
    if (!chosen.ok) throw chosen.error
    return chosen.value
  }

  private async attempt(
    read: () => Promise<VoterDensityResponse | null>,
  ): Promise<LegOutcome> {
    try {
      return { ok: true, value: await read() }
    } catch (error) {
      return { ok: false, error }
    }
  }

  // The original path: election-api for the district, people-db for the cells.
  private async readFromPeopleDb(
    personId: string,
  ): Promise<VoterDensityResponse | null> {
    const districtId = await this.resolveDistrictId(personId)
    if (!districtId) return null

    const { coverage, cells } =
      await this.voterDensity.getVoterDensity(districtId)
    return { coverage, cells }
  }

  // The path this migration is moving to: one call, because the cells now live
  // in the same database as the District they are keyed on.
  private async readFromElectionApi(
    personId: string,
  ): Promise<VoterDensityResponse | null> {
    const data = await this.getFromElectionApi<ElectionApiVoterDensity>(
      `${this.baseUrl()}/v1/persons/${encodeURIComponent(personId)}/voter-density`,
      personId,
      'Failed to read voter density from election API',
    )

    // A 404 (unknown person) and a resolved person with no district are the
    // same thing to the page: no map. Mirrors the legacy leg's null.
    if (!data || !data.districtId) return null
    return { coverage: data.coverage, cells: data.cells }
  }

  // election-api owns the person -> office/candidacy -> position -> district
  // chain; we just call its resolver. A missing person or a person that maps to
  // no district (404 / null districtId) is "no district" (null), so the page
  // degrades to no-map; any other failure surfaces as a 502 rather than being
  // silently hidden.
  private async resolveDistrictId(personId: string): Promise<string | null> {
    const data = await this.getFromElectionApi<ElectionApiVoterDistrict>(
      `${this.baseUrl()}/v1/persons/${encodeURIComponent(personId)}/voter-district`,
      personId,
      'Failed to resolve voter district from election API',
    )
    return data?.districtId ?? null
  }

  /** Resolves to null on a 404; throws a 502 on anything else. */
  private async getFromElectionApi<T>(
    url: string,
    personId: string,
    failureMessage: string,
  ): Promise<T | null> {
    try {
      // election-api is M2M-locked; attach the Clerk bearer like every other
      // gp-api → election-api caller. Without it these reads 401 once
      // ELECTION_API_AUTH_ENFORCED is on (a 401 is not a 404, so the caller
      // would 502 instead of degrading to "no district").
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

  private recordComparison(
    personId: string,
    legacy: LegOutcome,
    next: LegOutcome,
  ): void {
    const result = compareLegs(legacy, next)
    recordVoterDensityCompare(result)

    if (result === 'match') return

    // A bare counter says the two disagree but not how, and the districts that
    // disagree are the only ones anyone would go look at. `only_legacy` is
    // expected in bulk early on, so it stays at debug until the cutover nears.
    const detail = {
      personId,
      result,
      legacyCells: legacy.ok ? (legacy.value?.cells.length ?? null) : null,
      newCells: next.ok ? (next.value?.cells.length ?? null) : null,
      legacyCoverage: legacy.ok ? (legacy.value?.coverage ?? null) : null,
      newCoverage: next.ok ? (next.value?.coverage ?? null) : null,
      ...(legacy.ok ? {} : { legacyError: legacy.error }),
      ...(next.ok ? {} : { newError: next.error }),
    }

    if (result === 'only_legacy') {
      this.logger.debug(
        detail,
        'voter density not yet published to election-db',
      )
    } else {
      this.logger.warn(detail, 'voter density sources disagree')
    }
  }
}
