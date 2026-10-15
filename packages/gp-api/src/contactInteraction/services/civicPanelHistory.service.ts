import { BadRequestException, Injectable } from '@nestjs/common'
import { addDays } from 'date-fns'
import {
  CivicPanelStatus,
  ContactStatusField,
  ContactStatusSource,
  Prisma,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { MAX_RESOLVED_ID_SET_SIZE } from './activityConditionResolution.service'

// An inclusive span of calendar days, YYYY-MM-DD in UTC. Either end open.
export interface DayRange {
  from?: string | null
  to?: string | null
}

export const dayStart = (day: string): Date => new Date(`${day}T00:00:00.000Z`)

// The day after `to`, so a range ending on Oct 9 holds all of Oct 9.
const dayEndExclusive = (day: string): Date => addDays(dayStart(day), 1)

export const hasDayRange = (range: DayRange): boolean =>
  Boolean(range.from) || Boolean(range.to)

export interface LatestCivicPanelEvent {
  toValue: CivicPanelStatus
  source: ContactStatusSource
  createdAt: Date
}

// The civic panel's history, read for the list filters and the person
// record: who joined how and when (contact_status_event, the append-only log),
// who has ever been invited, and the latest event on one person. The panel's
// standing membership stays ContactStatusService.personIdsByFieldValue.
@Injectable()
export class CivicPanelHistoryService extends createPrismaBase(
  MODELS.ContactStatusEvent,
) {
  // Current members whose most recent join matches: its source is one of
  // `sources` (any, when empty) and it landed inside `joined`. Someone who
  // joined, left and rejoined is judged by the rejoin; someone who left is
  // not a member, so never matches.
  async memberIdsByLatestJoin(
    organizationSlug: string,
    sources: ContactStatusSource[],
    joined: DayRange,
  ): Promise<string[]> {
    const conditions: Prisma.Sql[] = []
    if (sources.length > 0) {
      conditions.push(
        Prisma.sql`latest.source::text IN (${Prisma.join(sources)})`,
      )
    }
    if (joined.from) {
      conditions.push(Prisma.sql`latest.created_at >= ${dayStart(joined.from)}`)
    }
    if (joined.to) {
      conditions.push(
        Prisma.sql`latest.created_at < ${dayEndExclusive(joined.to)}`,
      )
    }
    const rows = await this.client.$queryRaw<{ personId: string }[]>(Prisma.sql`
      SELECT latest.person_id AS "personId"
      FROM (
        SELECT DISTINCT ON (person_id) person_id, source, created_at
        FROM contact_status_event
        WHERE organization_slug = ${organizationSlug}
          AND field::text = ${ContactStatusField.civic_panel}
          AND to_value = ${CivicPanelStatus.member}
        ORDER BY person_id, created_at DESC
      ) latest
      JOIN contact_current_status current
        ON current.organization_slug = ${organizationSlug}
        AND current.person_id = latest.person_id
        AND current.field::text = ${ContactStatusField.civic_panel}
        AND current.value = ${CivicPanelStatus.member}
      ${conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty}
    `)
    this.assertUnderCap(organizationSlug, rows.length)
    return rows.map((row) => row.personId)
  }

  // Everyone the office has ever invited onto the panel, or who is on it or
  // left it: a civic_panel status row (only an event writes one), a recipient
  // of a send that asked them to join, or anyone asked the join question at
  // a door or on a call, whatever they answered. "Never invited" is
  // everyone else.
  async invitedPersonIds(organizationSlug: string): Promise<string[]> {
    const rows = await this.client.$queryRaw<{ personId: string }[]>(Prisma.sql`
      SELECT person_id AS "personId" FROM contact_current_status
      WHERE organization_slug = ${organizationSlug}
        AND field::text = ${ContactStatusField.civic_panel}
      UNION
      SELECT recipient.person_id FROM outreach_text_recipient recipient
      JOIN outreach ON outreach.id = recipient.outreach_id
      WHERE recipient.organization_slug = ${organizationSlug}
        AND outreach.asks_to_join_civic_panel
      UNION
      SELECT text.person_id FROM contact_interaction_text text
      JOIN outreach ON outreach.id = text.outreach_id
      WHERE text.organization_slug = ${organizationSlug}
        AND outreach.asks_to_join_civic_panel
      UNION
      SELECT person_id FROM contact_interaction_door_knock
      WHERE organization_slug = ${organizationSlug}
        AND join_civic_panel IS NOT NULL
      UNION
      SELECT person_id FROM contact_interaction_phone_banking
      WHERE organization_slug = ${organizationSlug}
        AND join_civic_panel IS NOT NULL
    `)
    this.assertUnderCap(organizationSlug, rows.length)
    return rows.map((row) => row.personId)
  }

  async latestEvent(
    organizationSlug: string,
    personId: string,
  ): Promise<LatestCivicPanelEvent | null> {
    const event = await this.model.findFirst({
      where: {
        organizationSlug,
        personId,
        field: ContactStatusField.civic_panel,
      },
      orderBy: { createdAt: 'desc' },
      select: { toValue: true, source: true, createdAt: true },
    })
    if (!event) return null
    const toValue =
      event.toValue === CivicPanelStatus.member
        ? CivicPanelStatus.member
        : CivicPanelStatus.left
    return { toValue, source: event.source, createdAt: event.createdAt }
  }

  private assertUnderCap(organizationSlug: string, size: number): void {
    if (size <= MAX_RESOLVED_ID_SET_SIZE) return
    this.logger.warn(
      { organizationSlug, size, cap: MAX_RESOLVED_ID_SET_SIZE },
      'civic panel filter resolved too many people',
    )
    throw new BadRequestException(
      'This filter resolves too many people to apply directly — narrow ' +
        'the civic panel selection.',
    )
  }
}
