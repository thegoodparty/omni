import { HttpService } from '@nestjs/axios'
import { BadGatewayException, Injectable } from '@nestjs/common'
import { isAxiosError } from 'axios'
import { PinoLogger } from 'nestjs-pino'
import { lastValueFrom } from 'rxjs'
import { ElectionApiTokenService } from '@/vendors/clerk/services/electionApiToken.service'
import { PersonLookupResponse } from '../schemas/PersonProfileRemoval.schema'

const { ELECTION_API_URL } = process.env

// Public person URLs are `/people/<base-slug>-<8 hex of the person id>`. The
// suffix is the real key, so anything after the slug segment (a trailing
// slash, a query string, a fragment) is noise to be dropped.
const PEOPLE_PATH = /\/people\/([^/?#]+)/

interface ElectionApiOfficeHolder {
  officeTitle: string | null
  positionName: string | null
  isCurrent: boolean | null
}

interface ElectionApiPerson {
  id: string
  fullName: string | null
  firstName: string | null
  lastName: string | null
  state: string | null
  OfficeHolders?: ElectionApiOfficeHolder[]
}

/**
 * Resolves the public `/people/...` URL an operator was handed into the
 * personId the takedown endpoints are keyed by.
 *
 * A privacy request arrives as "take down goodparty.org/people/jordan-reyes",
 * never as a UUID, and a mis-keyed UUID silently removes the wrong person's
 * page with no error to notice. The resolved name/state come back with the id
 * so the operator confirms the subject before submitting.
 *
 * Returns null when the slug resolves to nobody so the caller can 404 rather
 * than present an empty confirmation.
 */
@Injectable()
export class PersonLookupService {
  constructor(
    private readonly httpService: HttpService,
    private readonly logger: PinoLogger,
    private readonly tokenService: ElectionApiTokenService,
  ) {
    this.logger.setContext(PersonLookupService.name)
  }

  async lookup(query: string): Promise<PersonLookupResponse | null> {
    if (!ELECTION_API_URL) {
      throw new Error('Please set ELECTION_API_URL in your .env')
    }

    const slug = this.extractSlug(query)
    if (!slug) return null

    let person: ElectionApiPerson | undefined
    try {
      // election-api is M2M-locked; attach the Clerk bearer like every other
      // gp-api → election-api caller.
      const headers = await this.tokenService.authHeader()
      const response = await lastValueFrom(
        this.httpService.get<ElectionApiPerson>(
          `${ELECTION_API_URL}/v1/persons/by-slug/${encodeURIComponent(slug)}`,
          { headers },
        ),
      )
      person = response.data
    } catch (error) {
      // election-api 404s an unknown slug and 400s a malformed one. Both mean
      // "no such person" to an operator pasting a URL, and surfacing them as a
      // 502 would read as an outage rather than a typo.
      if (
        isAxiosError(error) &&
        (error.response?.status === 404 || error.response?.status === 400)
      ) {
        return null
      }
      this.logger.error({ err: error, slug }, 'Person slug lookup failed')
      throw new BadGatewayException('Failed to resolve person')
    }

    if (!person?.id) return null

    return {
      personId: person.id,
      fullName: this.displayName(person),
      state: person.state ?? null,
      office: this.currentOffice(person.OfficeHolders),
    }
  }

  private extractSlug(query: string): string | null {
    const trimmed = query.trim()
    if (!trimmed) return null
    // Accept a bare slug as well as a full or relative URL, because ops paste
    // whichever one the request happened to quote.
    return (PEOPLE_PATH.exec(trimmed)?.[1] ?? trimmed).replace(/\/+$/, '')
  }

  private displayName(person: ElectionApiPerson): string | null {
    const composed = [person.firstName, person.lastName]
      .filter(Boolean)
      .join(' ')
    return person.fullName ?? (composed || null)
  }

  // The office is shown purely to help the operator recognise the person, so a
  // current term wins over a past one and a missing title is not an error.
  private currentOffice(
    officeHolders: ElectionApiOfficeHolder[] | undefined,
  ): string | null {
    if (!officeHolders?.length) return null
    const current = officeHolders.find((held) => held.isCurrent)
    const chosen = current ?? officeHolders[0]
    return chosen?.officeTitle ?? chosen?.positionName ?? null
  }
}
