import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { PersonsService } from '@/electionDb/persons/persons.service'
import { getPersonBySlugParamsSchema } from '@/electionDb/persons/persons.schema'
import { WEBAPP_ROOT } from '@/shared/util/appEnvironment.util'
import {
  PersonLookupResponse,
  PersonLookupResponseSchema,
} from '../schemas/PersonProfileRemoval.schema'

// Public person URLs are `/people/<base-slug>-<8 hex of the person id>`. The
// suffix is the real key, so anything after the slug segment (a trailing
// slash, a query string, a fragment) is noise to be dropped.
const PEOPLE_PATH = /\/people\/([^/?#]+)/

// Keeps one `id IN (...)` bounded, and keeps a failure costing one batch of
// names rather than the whole takedown log.
const IDENTITY_BATCH_SIZE = 100

// The only columns the takedown log renders. Passed through so the read stays
// a narrow select rather than every scalar on Person.
const IDENTITY_COLUMNS = 'id,slug,fullName,firstName,lastName'

// These reads now return election-db Prisma rows rather than the narrow HTTP
// bodies this service used to receive, and both of its outputs feed pages —
// one public, one admin. Parsing each row back down to the fields actually
// rendered is what stops a column added to Person from riding along; a spread
// would carry it. `.parse()` strips everything not named here.
const personIdentitySchema = z.object({
  id: z.string(),
  slug: z.string().nullish(),
  fullName: z.string().nullish(),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
})

const officeHolderSchema = z.object({
  officeTitle: z.string().nullish(),
  positionName: z.string().nullish(),
  isCurrent: z.boolean().nullish(),
})

const personSubjectSchema = personIdentitySchema.extend({
  state: z.string().nullish(),
  OfficeHolders: z.array(officeHolderSchema).optional(),
})

type PersonIdentityRow = z.infer<typeof personIdentitySchema>
type PersonSubject = z.infer<typeof personSubjectSchema>
type PersonOfficeHolder = z.infer<typeof officeHolderSchema>

export interface PersonIdentity {
  fullName: string | null
  // Null when the person has no slug on record, which is the only case where a
  // public page cannot be addressed.
  profileUrl: string | null
}

/**
 * Reads about a canonical person from election-db, in process.
 *
 * Two jobs, both keyed off the civics person spine: resolving the public
 * `/people/...` URL an operator was handed into the personId the takedown
 * endpoints use, and resolving a personId to the contact email the CRM needs.
 *
 * The URL resolution, in detail:
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
    private readonly persons: PersonsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PersonLookupService.name)
  }

  async lookup(query: string): Promise<PersonLookupResponse | null> {
    const slug = this.extractSlug(query)
    if (!slug) return null

    // A malformed slug used to be rejected by the route's validation pipe as a
    // 400, which this service reported as "no such person" rather than as an
    // outage. In process there is no pipe, so the route's own param schema
    // runs here and keeps that outcome.
    if (!getPersonBySlugParamsSchema.safeParse({ slug }).success) return null

    let person: PersonSubject | undefined
    try {
      person = personSubjectSchema.parse(
        await this.persons.getPersonBySlug(slug),
      )
    } catch (error) {
      // An unknown slug throws NotFoundException where the route 404'd. That
      // means "no such person" to an operator pasting a URL, and surfacing it
      // as a 502 would read as an outage rather than a typo.
      if (error instanceof NotFoundException) return null
      this.logger.error({ err: error, slug }, 'Person slug lookup failed')
      throw new BadGatewayException('Failed to resolve person')
    }

    if (!person?.id) return null

    return PersonLookupResponseSchema.parse({
      personId: person.id,
      fullName: this.displayName(person),
      state: person.state ?? null,
      office: this.currentOffice(person.OfficeHolders),
    })
  }

  /**
   * The person's contact email, for resolving their HubSpot contact.
   *
   * `Person.email` is PII that every other person read omits, because those
   * responses are rendered onto a public page. This one read returns the
   * address and nothing else. Do not widen it into a general person read — the
   * narrowness is the safeguard.
   *
   * Null, never a throw, for every "we can't tell you" case: no such person,
   * no address on file, the read failing. The only caller is a detached CRM
   * side-effect of a public form submission, so a failure here must cost the
   * CRM signal and nothing else — and the alternative to an address is not an
   * error, it is simply not sending an event we cannot route.
   */
  async resolveContactEmail(personId: string): Promise<string | null> {
    try {
      const { email } = await this.persons.getContactEmail(personId)
      return email?.trim() || null
    } catch (error) {
      // NotFoundException is "no such person", which is a normal outcome here
      // rather than an incident: the marketing page can outlive a person the
      // spine has since re-keyed.
      if (error instanceof NotFoundException) return null
      // Message only, deliberately NOT the error object: this read's success
      // value IS the address, so an error that happens to carry the row would
      // otherwise be a latent way to put a candidate's email in the logs.
      this.logger.error(
        {
          personId,
          reason: error instanceof Error ? error.message : String(error),
        },
        'Person contact email lookup failed',
      )
      return null
    }
  }

  /**
   * Batch-resolves personIds to the name and public URL of their page, for the
   * admin takedown log. The removal table stores nothing but the civics UUID,
   * which is unreadable to the operator reviewing what has been taken down —
   * they need to see whose page it is and be able to open it.
   *
   * Best-effort: a failed read degrades a row to its personId rather than
   * failing the whole list, which is the operator's only view of active
   * takedowns.
   */
  async resolveIdentities(
    personIds: string[],
  ): Promise<Map<string, PersonIdentity>> {
    const identities = new Map<string, PersonIdentity>()
    if (!personIds.length) return identities

    const unique = [...new Set(personIds)]
    for (let i = 0; i < unique.length; i += IDENTITY_BATCH_SIZE) {
      const batch = unique.slice(i, i + IDENTITY_BATCH_SIZE)
      try {
        const rows = await this.persons.getPersons({
          ids: batch,
          columns: IDENTITY_COLUMNS,
          includeOfficeHolders: false,
          includeCandidacies: false,
        })
        for (const row of rows) {
          const person = personIdentitySchema.parse(row)
          identities.set(person.id, {
            fullName: this.displayName(person),
            profileUrl: this.profileUrl(person),
          })
        }
      } catch (error) {
        this.logger.error(
          { err: error, count: batch.length },
          'Person identity batch lookup failed',
        )
      }
    }

    return identities
  }

  // Mirrors the public route the marketing site serves:
  // /people/<base-slug>-<first 8 hex of the person id>. The suffix is what
  // actually resolves the page (slugs are not unique), so both halves matter.
  private profileUrl(person: PersonIdentityRow): string | null {
    if (!person.slug) return null
    return `${WEBAPP_ROOT}/people/${person.slug}-${person.id.slice(0, 8)}`
  }

  private extractSlug(query: string): string | null {
    const trimmed = query.trim()
    if (!trimmed) return null
    // Accept a bare slug as well as a full or relative URL, because ops paste
    // whichever one the request happened to quote.
    return (PEOPLE_PATH.exec(trimmed)?.[1] ?? trimmed).replace(/\/+$/, '')
  }

  private displayName(person: PersonIdentityRow): string | null {
    const composed = [person.firstName, person.lastName]
      .filter(Boolean)
      .join(' ')
    return person.fullName ?? (composed || null)
  }

  // The office is shown purely to help the operator recognise the person, so a
  // current term wins over a past one and a missing title is not an error.
  private currentOffice(
    officeHolders: PersonOfficeHolder[] | undefined,
  ): string | null {
    if (!officeHolders?.length) return null
    const current = officeHolders.find((held) => held.isCurrent)
    const chosen = current ?? officeHolders[0]
    return chosen?.officeTitle ?? chosen?.positionName ?? null
  }
}
