import { Injectable } from '@nestjs/common'
import { Prisma, WillVoteAnswer } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

// The campaign's election dates as `details` stores them, YYYY-MM-DD.
type ElectionDates = {
  electionDate?: string | null
  primaryElectionDate?: string | null
}

// An election resets the flag at noon UTC the day after it: by then election
// day is over everywhere in the US, territories included (8am Eastern, 2am
// Hawaii, 1am American Samoa). UTC midnight would be 5pm Pacific on election
// day itself, clearing the flag mid-GOTV and pushing primary-night answers
// into the general.
const RESET_AFTER_ELECTION_DATE_MS = 36 * 60 * 60 * 1000

// Where "this election" starts: the reset after the latest of the campaign's
// election dates that is already behind us. A primary voter who said "already
// voted" in August has not voted in November, so answers from before that
// boundary must not count. No past date means no boundary. Runoffs are not on
// the campaign, so a runoff after a general still sees general-season answers.
export const votedWindowStart = (
  dates: ElectionDates | null | undefined,
  now: Date = new Date(),
): Date | null => {
  const latest = [dates?.primaryElectionDate, dates?.electionDate]
    .filter((date): date is string => Boolean(date))
    .map(
      (date) =>
        Date.parse(`${date.slice(0, 10)}T00:00:00.000Z`) +
        RESET_AFTER_ELECTION_DATE_MS,
    )
    .filter((reset) => reset <= now.getTime())
    .sort((a, b) => a - b)
    .at(-1)
  return latest === undefined ? null : new Date(latest)
}

// The Voted flag (Win only): true when the person's MOST RECENT will-vote
// answer this election, on any channel that asks it, is `already_voted`.
//
// Recency only, unlike SupportStatusService's firmness ranking (Nigel,
// 2026-10-21): a later Yes / No / Unsure flips the flag back, which is also how
// a mis-tapped "Already voted" gets corrected, since there is no manual
// override for this flag. Rows with no will-vote answer (not home, refused,
// a manual log) carry nothing and are skipped, so they never reset it.
//
// Derived on every read and never stored, for the reason support status is:
// a corrected answer takes effect on the next read, and the election window
// is just a WHERE clause. The CTE is the extension point: a future channel
// that asks the question joins the UNION ALL.
@Injectable()
export class VotedStatusService extends createPrismaBase(
  MODELS.ContactInteractionDoorKnock,
) {
  // Serve offices never ask the question, so nobody there has voted as far as
  // this flag knows. Explicit, rather than trusting the tables to be empty.
  private isServe(organizationSlug: string): boolean {
    return organizationSlug.startsWith('eo-')
  }

  async windowStart(organizationSlug: string): Promise<Date | null> {
    const campaign = await this.client.campaign.findUnique({
      where: { organizationSlug },
      select: { details: true },
    })
    return votedWindowStart(campaign?.details)
  }

  // Everyone whose flag is true. The filter's "Already voted" is this set, and
  // its "Unknown" is everyone outside it.
  async votedPersonIds(organizationSlug: string): Promise<string[]> {
    if (this.isServe(organizationSlug)) return []
    const since = await this.windowStart(organizationSlug)
    const rows = await this.client.$queryRaw<{ personId: string }[]>(
      Prisma.sql`
        SELECT "personId"
        FROM (${this.latestWillVoteSql(organizationSlug, since, Prisma.empty)}) latest
        WHERE latest.will_vote = ${WillVoteAnswer.already_voted}
      `,
    )
    return rows.map((row) => row.personId)
  }

  // The flag for each requested person, false for anyone with no answer.
  async votedForPeople(
    organizationSlug: string,
    personIds: string[],
  ): Promise<Map<string, boolean>> {
    if (personIds.length === 0) return new Map()
    if (this.isServe(organizationSlug)) {
      return new Map(personIds.map((personId) => [personId, false]))
    }
    const since = await this.windowStart(organizationSlug)
    const rows = await this.client.$queryRaw<
      { personId: string; will_vote: string }[]
    >(
      this.latestWillVoteSql(
        organizationSlug,
        since,
        Prisma.sql`AND person_id IN (${Prisma.join(personIds)})`,
      ),
    )
    const voted = new Set(
      rows
        .filter((row) => row.will_vote === WillVoteAnswer.already_voted)
        .map((row) => row.personId),
    )
    return new Map(personIds.map((personId) => [personId, voted.has(personId)]))
  }

  // One row per person: their latest will-vote answer since `since`.
  // `id DESC` settles identical occurred_at values deterministically.
  private latestWillVoteSql(
    organizationSlug: string,
    since: Date | null,
    personFilter: Prisma.Sql,
  ): Prisma.Sql {
    const window = since
      ? Prisma.sql`AND occurred_at >= ${since}`
      : Prisma.empty
    return Prisma.sql`
      WITH interaction AS (
        SELECT person_id, occurred_at, id, will_vote::text AS will_vote
        FROM contact_interaction_door_knock
        WHERE organization_slug = ${organizationSlug}
          AND will_vote IS NOT NULL ${window} ${personFilter}
        UNION ALL
        SELECT person_id, occurred_at, id, will_vote::text AS will_vote
        FROM contact_interaction_phone_banking
        WHERE organization_slug = ${organizationSlug}
          AND will_vote IS NOT NULL ${window} ${personFilter}
      )
      SELECT DISTINCT ON (person_id) person_id AS "personId", will_vote
      FROM interaction
      ORDER BY person_id, occurred_at DESC, id DESC
    `
  }
}
