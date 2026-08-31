import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { Prisma } from '../generated/prisma'

// Fields on Candidacy that the gp-data-platform mart fills from the BallotReady
// *person* rather than the race (see m_election_api__candidacy: image/about/urls
// come off the BR person, and email/website_url off the person-grain civics
// contact). A removal blanks exactly these and leaves the race-sourced fields —
// name, party, office, election dates — so the roster still shows a real
// candidate ran, without republishing anything about them.
export const PERSON_SOURCED_CANDIDACY_FIELDS = [
  'image',
  'about',
  'urls',
  'websiteUrl',
  'email',
] satisfies (keyof typeof Prisma.CandidacyScalarFieldEnum)[]

// The same idea on Person. Name parts, slug, state and isPledged stay: the page
// keeps a crawlable spine on removal, and is_pledged is a factual flag about a
// pledge they took, not content about them.
export const PERSON_SOURCED_PERSON_FIELDS = [
  'bioText',
  'headshotUrl',
  'websiteUrl',
  'linkedinUrl',
  'facebookUrl',
  'twitterUrl',
  'instagramUrl',
  'email',
  'phone',
  'degrees',
  'experiences',
] satisfies (keyof typeof Prisma.PersonScalarFieldEnum)[]

// `urls` is a non-nullable String[]; emptying it is the blank value, not null.
const ARRAY_VALUED_FIELDS = new Set<string>(['urls'])

const blankValueFor = (field: string) =>
  ARRAY_VALUED_FIELDS.has(field) ? [] : null

/**
 * Blanks `fields` on one already-known-removed row, in place. Only touches
 * properties the row carries, so a narrowed `?columns=` response keeps its
 * shape. Exported for callers that resolve the removal set themselves and blank
 * across a nested shape (see persons.service).
 */
export const blankPersonSourcedFields = (
  row: Record<string, unknown>,
  fields: readonly string[],
) => {
  for (const field of fields) {
    if (field in row) row[field] = blankValueFor(field)
  }
}

@Injectable()
export class PersonRemovalsService extends createPrismaBase(
  MODELS.PersonRemoval,
) {
  /**
   * Removed ids among the ones asked about. Scoped to the caller's ids rather
   * than loading the whole table so the cost tracks the response, and returns a
   * Set so callers can test per row.
   */
  async findRemovedPersonIds(personIds: string[]): Promise<Set<string>> {
    const unique = [...new Set(personIds.filter(Boolean))]
    if (unique.length === 0) return new Set()

    const rows = await this.model.findMany({
      where: { personId: { in: unique } },
      select: { personId: true },
    })
    return new Set(rows.map((row) => row.personId))
  }

  /**
   * Blanks the person-sourced fields on rows belonging to a removed person.
   * `idKey` is the property carrying the person id — `personId` on a candidacy,
   * `id` on a person, since Person.id *is* the canonical person id.
   *
   * Only touches properties the row actually carries, so a narrowed `?columns=`
   * response is unaffected in shape. Rows with no id under `idKey` cannot be
   * attributed and are left alone; callers that expose any of these fields are
   * responsible for selecting the id (see candidacies.service).
   */
  async blankRemovedPersonFields<T extends Record<string, unknown>>(
    rows: T[],
    fields: readonly string[],
    idKey: 'personId' | 'id',
  ): Promise<T[]> {
    if (rows.length === 0) return rows

    const ids = rows
      .map((row) => row[idKey])
      .filter((id): id is string => typeof id === 'string')
    const removed = await this.findRemovedPersonIds(ids)
    if (removed.size === 0) return rows

    for (const row of rows) {
      const id = row[idKey]
      if (typeof id !== 'string' || !removed.has(id)) continue
      blankPersonSourcedFields(row, fields)
    }
    return rows
  }

  setRemoval(personId: string, reason?: string) {
    return this.model.upsert({
      where: { personId },
      create: { personId, reason: reason ?? null },
      update: { reason: reason ?? null },
    })
  }

  async clearRemoval(personId: string): Promise<boolean> {
    const { count } = await this.model.deleteMany({ where: { personId } })
    return count > 0
  }
}
