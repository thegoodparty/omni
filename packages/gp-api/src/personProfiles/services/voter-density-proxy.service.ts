import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { PersonsService } from '@/electionDb/persons/persons.service'
import {
  VoterDensityResponse,
  VoterDensityResponseSchema,
} from '../schemas/public/VoterDensity.schema'

type ElectionVoterDensity = Awaited<
  ReturnType<PersonsService['getVoterDensity']>
>

/**
 * Serves the public /people page's heat map out of election-db, where the
 * precomputed cells sit beside the `District` they are keyed on, so one read
 * answers the whole question.
 *
 * The cells are aggregated H3 centroids only — no raw PII ever transits.
 *
 * Degrades to no-map for the domain cases the page expects: a person that maps
 * to no L2 district returns null (the controller 404s, the page renders no
 * map), and a district with no density rows returns empty cells (the page also
 * hides the map on low `coverage`, so a sparsely-covered district shows no map
 * rather than a misleading one). A hard read failure is NOT swallowed — it
 * surfaces as a 502 — so a genuine outage stays visible instead of
 * masquerading as "no map".
 */
@Injectable()
export class VoterDensityProxyService {
  constructor(
    private readonly persons: PersonsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(VoterDensityProxyService.name)
  }

  async getVoterDensity(
    personId: string,
  ): Promise<VoterDensityResponse | null> {
    let density: ElectionVoterDensity | undefined
    try {
      density = await this.persons.getVoterDensity(personId)
    } catch (error) {
      // An unknown person throws NotFoundException where the route 404'd, and
      // a 404 and a resolved person with no district are the same thing to the
      // page: no map.
      if (error instanceof NotFoundException) return null
      this.logger.error(
        { error, personId },
        'Failed to read voter density from election-db',
      )
      throw new BadGatewayException('Failed to resolve district')
    }

    if (!density?.districtId) return null

    // The read returns the district and person id alongside the cells. Parse
    // rather than spread: this body is served to an unauthenticated page, and
    // the schema is the only thing keeping a wider election-db row out of it.
    return VoterDensityResponseSchema.parse({
      coverage: density.coverage,
      cells: density.cells,
    })
  }
}
