import { Injectable } from '@nestjs/common'
import {
  resolveContactStatusLabel,
  RouteTargetActivity,
  ROUTE_TARGET_ACTIVITY_LIMIT,
} from '@goodparty_org/contracts'
import { compareDesc, parseISO } from 'date-fns'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  ContactStatusField,
  ContactStatusSource,
  DoorKnockOutcome,
  PhoneBankCallOutcome,
  Prisma,
  SupportAnswer,
  WillVoteAnswer,
} from '../../generated/prisma'

type BaseRow = { personId: string; occurredAt: Date; id: string }

type DoorKnockRow = BaseRow & {
  outcome: DoorKnockOutcome
  supportAnswer: SupportAnswer | null
  note: string | null
  manual: boolean
}

type TextRow = BaseRow & {
  respondedAt: Date | null
  optedOutAt: Date | null
  note: string | null
  manual: boolean
  outreachId: number | null
}

type RobocallRow = BaseRow & {
  answeredAt: Date | null
  voicemailLeftAt: Date | null
  note: string | null
  manual: boolean
  outreachId: number | null
}

type PhoneBankingRow = BaseRow & {
  outcome: PhoneBankCallOutcome
  supportAnswer: SupportAnswer | null
  willVote: WillVoteAnswer | null
  note: string | null
  manual: boolean
  actorUserId: number | null
  actorFirstName: string | null
  actorLastName: string | null
}

type StatusEventRow = BaseRow & {
  field: ContactStatusField
  fromValue: string | null
  toValue: string
  source: ContactStatusSource
  actorUserId: number | null
  actorFirstName: string | null
  actorLastName: string | null
}

// Newest first, id descending as the tiebreak — the same sort key the CRM
// feed uses, so a person's rows can't order one way in Contacts and another
// at the door.
const RANK_OVER = Prisma.sql`
  ROW_NUMBER() OVER (
    PARTITION BY person_id ORDER BY occurred_at DESC, id DESC
  )
`

const composeActorName = (
  firstName: string | null,
  lastName: string | null,
): string | null => [firstName, lastName].filter(Boolean).join(' ') || null

@Injectable()
export class DoorKnockingActivityService extends createPrismaBase(
  MODELS.ContactInteractionDoorKnock,
) {
  // ADR 0009. Per-resident outreach history for the targets on one route,
  // capped at ROUTE_TARGET_ACTIVITY_LIMIT rows each.
  //
  // The cap is applied in SQL rather than after the fetch, and that is the
  // point of the window function. An org that has texted these people through
  // fifty outreach launches has fifty rows per person per channel; reading
  // them all into Node to keep five would put the route serve — the read
  // behind every walk open and every map open — at the mercy of how much
  // outreach the campaign has run.
  //
  // Every branch is served by that table's
  // (organization_slug, person_id, occurred_at) index.
  async historyByPersonId(
    organizationSlug: string,
    personIds: string[],
  ): Promise<Map<string, RouteTargetActivity[]>> {
    if (personIds.length === 0) return new Map()

    const ids = Prisma.join(personIds)
    const [doorKnocks, texts, robocalls, phoneBankings, statusEvents] =
      await Promise.all([
        this.client.$queryRaw<DoorKnockRow[]>(Prisma.sql`
          SELECT person_id AS "personId", occurred_at AS "occurredAt", id,
                 outcome, support_answer AS "supportAnswer", note, manual
          FROM (
            SELECT *, ${RANK_OVER} AS rank
            FROM contact_interaction_door_knock
            WHERE organization_slug = ${organizationSlug}
              AND person_id IN (${ids})
          ) ranked
          WHERE rank <= ${ROUTE_TARGET_ACTIVITY_LIMIT}
        `),
        this.client.$queryRaw<TextRow[]>(Prisma.sql`
          SELECT person_id AS "personId", occurred_at AS "occurredAt", id,
                 responded_at AS "respondedAt", opted_out_at AS "optedOutAt",
                 note, manual, outreach_id AS "outreachId"
          FROM (
            SELECT *, ${RANK_OVER} AS rank
            FROM contact_interaction_text
            WHERE organization_slug = ${organizationSlug}
              AND person_id IN (${ids})
          ) ranked
          WHERE rank <= ${ROUTE_TARGET_ACTIVITY_LIMIT}
        `),
        this.client.$queryRaw<RobocallRow[]>(Prisma.sql`
          SELECT person_id AS "personId", occurred_at AS "occurredAt", id,
                 answered_at AS "answeredAt",
                 voicemail_left_at AS "voicemailLeftAt",
                 note, manual, outreach_id AS "outreachId"
          FROM (
            SELECT *, ${RANK_OVER} AS rank
            FROM contact_interaction_robocall
            WHERE organization_slug = ${organizationSlug}
              AND person_id IN (${ids})
          ) ranked
          WHERE rank <= ${ROUTE_TARGET_ACTIVITY_LIMIT}
        `),
        this.client.$queryRaw<PhoneBankingRow[]>(Prisma.sql`
          SELECT ranked."personId", ranked."occurredAt", ranked.id,
                 ranked.outcome, ranked."supportAnswer",
                 ranked."willVote", ranked.note, ranked.manual,
                 ranked.actor_user_id AS "actorUserId",
                 "user".first_name AS "actorFirstName",
                 "user".last_name AS "actorLastName"
          FROM (
            SELECT person_id AS "personId", occurred_at AS "occurredAt", id,
                   outcome, support_answer AS "supportAnswer",
                   will_vote AS "willVote", note, manual, actor_user_id,
                   ${RANK_OVER} AS rank
            FROM contact_interaction_phone_banking
            WHERE organization_slug = ${organizationSlug}
              AND person_id IN (${ids})
          ) ranked
          LEFT JOIN "user" ON "user".id = ranked.actor_user_id
          WHERE ranked.rank <= ${ROUTE_TARGET_ACTIVITY_LIMIT}
        `),
        // ContactStatusEvent has no occurred_at — the append-only write time
        // is the event time, so created_at is aliased into the shared sort
        // key rather than the window being written differently.
        this.client.$queryRaw<StatusEventRow[]>(Prisma.sql`
          SELECT ranked."personId", ranked."occurredAt", ranked.id,
                 ranked.field, ranked."fromValue", ranked."toValue",
                 ranked.source, ranked."actorUserId",
                 "user".first_name AS "actorFirstName",
                 "user".last_name AS "actorLastName"
          FROM (
            SELECT person_id AS "personId", created_at AS "occurredAt", id,
                   field, from_value AS "fromValue", to_value AS "toValue",
                   source, actor_user_id AS "actorUserId",
                   ROW_NUMBER() OVER (
                     PARTITION BY person_id ORDER BY created_at DESC, id DESC
                   ) AS rank
            FROM contact_status_event
            WHERE organization_slug = ${organizationSlug}
              AND person_id IN (${ids})
          ) ranked
          LEFT JOIN "user" ON "user".id = ranked."actorUserId"
          WHERE ranked.rank <= ${ROUTE_TARGET_ACTIVITY_LIMIT}
        `),
      ])

    const activities: [string, RouteTargetActivity][] = [
      ...doorKnocks.map((row): [string, RouteTargetActivity] => [
        row.personId,
        {
          type: 'DOOR_KNOCK',
          date: row.occurredAt.toISOString(),
          data: {
            activityId: row.id,
            outcome: row.outcome,
            supportAnswer: row.supportAnswer,
            note: row.note,
            manual: row.manual,
          },
        },
      ]),
      ...texts.map((row): [string, RouteTargetActivity] => [
        row.personId,
        {
          type: 'TEXT',
          date: row.occurredAt.toISOString(),
          data: {
            activityId: row.id,
            respondedAt: row.respondedAt?.toISOString() ?? null,
            optedOutAt: row.optedOutAt?.toISOString() ?? null,
            note: row.note,
            manual: row.manual,
            outreachId: row.outreachId,
          },
        },
      ]),
      ...robocalls.map((row): [string, RouteTargetActivity] => [
        row.personId,
        {
          type: 'ROBOCALL',
          date: row.occurredAt.toISOString(),
          data: {
            activityId: row.id,
            answeredAt: row.answeredAt?.toISOString() ?? null,
            voicemailLeftAt: row.voicemailLeftAt?.toISOString() ?? null,
            note: row.note,
            manual: row.manual,
            outreachId: row.outreachId,
          },
        },
      ]),
      ...phoneBankings.map((row): [string, RouteTargetActivity] => [
        row.personId,
        {
          type: 'PHONE_BANKING',
          date: row.occurredAt.toISOString(),
          data: {
            activityId: row.id,
            outcome: row.outcome,
            supportAnswer: row.supportAnswer,
            willVote: row.willVote,
            note: row.note,
            manual: row.manual,
            actorName: composeActorName(row.actorFirstName, row.actorLastName),
            actorUserId: row.actorUserId,
          },
        },
      ]),
      ...statusEvents.map((row): [string, RouteTargetActivity] => [
        row.personId,
        {
          type: 'STATUS_CHANGE',
          date: row.occurredAt.toISOString(),
          data: {
            activityId: row.id,
            field: row.field,
            fromLabel:
              row.fromValue === null
                ? null
                : resolveContactStatusLabel(row.field, row.fromValue),
            toLabel: resolveContactStatusLabel(row.field, row.toValue),
            actorName: composeActorName(row.actorFirstName, row.actorLastName),
            actorUserId: row.actorUserId,
            source: row.source,
          },
        },
      ]),
    ]

    const byPersonId = new Map<string, RouteTargetActivity[]>()
    for (const [personId, activity] of activities) {
      const group = byPersonId.get(personId) ?? []
      group.push(activity)
      byPersonId.set(personId, group)
    }

    // Each source contributed its own top N, so the global top N is a subset
    // of their union — re-capping after the merge is exact, not approximate.
    // Same-instant rows break on type then id, the tiebreak the CRM feed
    // already uses, so one person's history can't order one way in Contacts
    // and another at the door.
    for (const [personId, group] of byPersonId) {
      group.sort(
        (a, b) =>
          compareDesc(parseISO(a.date), parseISO(b.date)) ||
          a.type.localeCompare(b.type) ||
          a.data.activityId.localeCompare(b.data.activityId),
      )
      byPersonId.set(personId, group.slice(0, ROUTE_TARGET_ACTIVITY_LIMIT))
    }
    return byPersonId
  }
}
