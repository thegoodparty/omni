import { ContactInteractionDoorKnockService } from '@/contactInteraction/services/contactInteractionDoorKnock.service'
import { ContactInteractionRobocallService } from '@/contactInteraction/services/contactInteractionRobocall.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { PollIndividualMessageService } from '@/polls/services/pollIndividualMessage.service'
import { VoterOutreachActivityService } from '@/voterOutreachActivity/services/voterOutreachActivity.service'
import { Injectable } from '@nestjs/common'
import {
  Poll,
  PollIndividualMessage,
  PollIndividualMessageSender,
  Prisma,
} from '../generated/prisma'
import { compareDesc, isValid, parseISO } from 'date-fns'
import { IndividualActivityInput } from './contactEngagement.schema'
import {
  ConstituentActivity,
  ConstituentActivityEventType,
  ConstituentActivityType,
  ConstituentIssue,
  DoorKnockConstituentActivity,
  GetConstituentIssuesResponse,
  GetIndividualActivitiesResponse,
  OutreachConstituentActivity,
  PollConstituentActivity,
  RobocallConstituentActivity,
  TextConstituentActivity,
} from './contactEngagement.types'

type PollIndividualMessageWithPoll = PollIndividualMessage & { poll: Poll }

// Every union variant carries a per-type id under a different field name.
// This is the tiebreak for same-timestamp rows (e.g. two Win outreach
// attributions from a date-only picker land on the exact same midnight
// occurredAt) — without it, sorting/cursoring on date alone treats same-day
// rows as interchangeable and the cursor can resume on the wrong one.
const activityId = (activity: ConstituentActivity): string => {
  switch (activity.type) {
    case ConstituentActivityType.POLL_INTERACTIONS:
      return activity.data.pollId
    case ConstituentActivityType.OUTREACH:
      return String(activity.data.activityId)
    case ConstituentActivityType.DOOR_KNOCK:
    case ConstituentActivityType.TEXT:
    case ConstituentActivityType.ROBOCALL:
      return activity.data.activityId
  }
}

// Opaque to the client — round-tripped verbatim as the `after` param. Encodes
// enough of the sort key to resume exactly where the previous page ended,
// even when multiple rows share the same date.
const cursorKey = (activity: ConstituentActivity): string =>
  `${activity.date}|${activity.type}|${activityId(activity)}`

@Injectable()
export class ContactEngagementService {
  constructor(
    private readonly pollIndividualMessage: PollIndividualMessageService,
    private readonly voterOutreachActivity: VoterOutreachActivityService,
    private readonly contactInteractionDoorKnock: ContactInteractionDoorKnockService,
    private readonly contactInteractionText: ContactInteractionTextService,
    private readonly contactInteractionRobocall: ContactInteractionRobocallService,
  ) {}

  async getIndividualActivities(
    input: IndividualActivityInput,
  ): Promise<GetIndividualActivitiesResponse> {
    const {
      personId,
      organizationSlug,
      electedOfficeId,
      campaignId,
      lalVoterId,
      take,
      after,
    } = input
    const limit = take ?? 20

    // Cursor is `${date}|${type}|${id}`; only the date component bounds the
    // per-source fetches below. A garbage/foreign cursor whose date half
    // doesn't parse falls back to the page-1 window (cursorDate: null) —
    // the composite `findIndex` below then correctly finds no match and
    // returns an empty page, rather than handing an Invalid Date to Prisma.
    const cursorDatePart = after?.split('|')[0]
    const parsedCursorDate = cursorDatePart ? parseISO(cursorDatePart) : null
    const cursorDate =
      parsedCursorDate && isValid(parsedCursorDate) ? parsedCursorDate : null

    const orderBy = [
      { occurredAt: Prisma.SortOrder.desc },
      { id: Prisma.SortOrder.desc },
    ]

    // Bounds a union source to the window this page can actually need: with
    // no cursor (page 1), a source's own top `limit + 1` rows — in a merge
    // of sorted sources, a row ranked inside the global top N can't be
    // ranked past N within its own source. Resuming past a cursor, the same
    // argument applies to each source's remaining (not-yet-shown) rows, so
    // `fetchBefore` asks for `occurredAt < cursorDate` bounded the same way.
    // The cursor can sit inside a same-instant tie group though, so
    // `fetchAtCursor` (occurredAt = cursorDate) is unbounded — a person's
    // same-instant row count is naturally small, and the full group has to
    // be present for the merge sort/cursor to place rows on the correct
    // side of it.
    const fetchWindow = async <Row>(
      fetchBefore: (take: number) => Promise<Row[]>,
      fetchAtCursor: (() => Promise<Row[]>) | null,
    ): Promise<Row[]> => {
      if (!fetchAtCursor) {
        return fetchBefore(limit + 1)
      }
      const [before, atCursor] = await Promise.all([
        fetchBefore(limit + 1),
        fetchAtCursor(),
      ])
      return [...before, ...atCursor]
    }

    const [doorKnocks, texts, robocalls] = await Promise.all([
      fetchWindow(
        (windowTake) =>
          this.contactInteractionDoorKnock.findMany({
            where: {
              organizationSlug,
              personId,
              ...(cursorDate ? { occurredAt: { lt: cursorDate } } : {}),
            },
            orderBy,
            take: windowTake,
          }),
        cursorDate
          ? () =>
              this.contactInteractionDoorKnock.findMany({
                where: { organizationSlug, personId, occurredAt: cursorDate },
                orderBy,
              })
          : null,
      ),
      fetchWindow(
        (windowTake) =>
          this.contactInteractionText.findMany({
            where: {
              organizationSlug,
              personId,
              ...(cursorDate ? { occurredAt: { lt: cursorDate } } : {}),
            },
            orderBy,
            take: windowTake,
          }),
        cursorDate
          ? () =>
              this.contactInteractionText.findMany({
                where: { organizationSlug, personId, occurredAt: cursorDate },
                orderBy,
              })
          : null,
      ),
      fetchWindow(
        (windowTake) =>
          this.contactInteractionRobocall.findMany({
            where: {
              organizationSlug,
              personId,
              ...(cursorDate ? { occurredAt: { lt: cursorDate } } : {}),
            },
            orderBy,
            take: windowTake,
          }),
        cursorDate
          ? () =>
              this.contactInteractionRobocall.findMany({
                where: { organizationSlug, personId, occurredAt: cursorDate },
                orderBy,
              })
          : null,
      ),
    ])

    // Poll interactions only exist in the Serve (elected office) context.
    // Legacy outreach rows only join the union for Win, and only when the
    // client passes the durable lalVoterId (the sunset-compatibility path —
    // omitting it is not an error, it just means no legacy rows). Poll
    // grouping fetches every message unbounded, but its output is one row
    // per distinct poll — bounded by how many polls this person has ever
    // been sent, not by message volume, so it doesn't need this windowing.
    const pollActivities = electedOfficeId
      ? await this.getPollActivities(electedOfficeId, personId)
      : []
    const outreachActivities =
      lalVoterId && campaignId !== undefined
        ? await fetchWindow(
            (windowTake) =>
              this.voterOutreachActivity.findMany({
                where: {
                  campaignId,
                  lalVoterId,
                  ...(cursorDate ? { occurredAt: { lt: cursorDate } } : {}),
                },
                orderBy,
                take: windowTake,
              }),
            cursorDate
              ? () =>
                  this.voterOutreachActivity.findMany({
                    where: { campaignId, lalVoterId, occurredAt: cursorDate },
                    orderBy,
                  })
              : null,
          )
        : []

    const doorKnockActivities: DoorKnockConstituentActivity[] = doorKnocks.map(
      (activity) => ({
        type: ConstituentActivityType.DOOR_KNOCK,
        date: activity.occurredAt.toISOString(),
        data: {
          activityId: activity.id,
          outcome: activity.outcome,
          supportAnswer: activity.supportAnswer,
          note: activity.note,
          manual: activity.manual,
        },
      }),
    )

    const textActivities: TextConstituentActivity[] = texts.map((activity) => ({
      type: ConstituentActivityType.TEXT,
      date: activity.occurredAt.toISOString(),
      data: {
        activityId: activity.id,
        respondedAt: activity.respondedAt?.toISOString() ?? null,
        optedOutAt: activity.optedOutAt?.toISOString() ?? null,
        note: activity.note,
        manual: activity.manual,
        outreachId: activity.outreachId,
      },
    }))

    const robocallActivities: RobocallConstituentActivity[] = robocalls.map(
      (activity) => ({
        type: ConstituentActivityType.ROBOCALL,
        date: activity.occurredAt.toISOString(),
        data: {
          activityId: activity.id,
          answeredAt: activity.answeredAt?.toISOString() ?? null,
          voicemailLeftAt: activity.voicemailLeftAt?.toISOString() ?? null,
          note: activity.note,
          manual: activity.manual,
          outreachId: activity.outreachId,
        },
      }),
    )

    const outreachConstituentActivities: OutreachConstituentActivity[] =
      outreachActivities.map((activity) => ({
        type: ConstituentActivityType.OUTREACH,
        date: activity.occurredAt.toISOString(),
        data: {
          activityId: activity.id,
          outreachType: activity.outreachType,
          attributionSource: activity.attributionSource,
        },
      }))

    const allActivities: ConstituentActivity[] = [
      ...pollActivities,
      ...outreachConstituentActivities,
      ...doorKnockActivities,
      ...textActivities,
      ...robocallActivities,
    ]
    // date desc, then type/id as an explicit tiebreak — same-day Win outreach
    // attributions (occurredAt from a date-only picker) can be byte-identical,
    // and sorting on date alone leaves their relative order undefined, which
    // breaks the cursor below.
    allActivities.sort((a, b) => {
      const dateOrder = compareDesc(parseISO(a.date), parseISO(b.date))
      if (dateOrder !== 0) return dateOrder
      if (a.type !== b.type) return a.type.localeCompare(b.type)
      // OUTREACH ids are VoterOutreachActivity's numeric autoincrement id;
      // string-comparing them ('10' < '9') disagrees with the DB's numeric
      // id-desc order and desyncs the cursor from a tie group that straddles
      // a page boundary.
      if (a.type === ConstituentActivityType.OUTREACH) {
        return Number(activityId(b)) - Number(activityId(a))
      }
      return activityId(a).localeCompare(activityId(b))
    })

    // The cursor is a composite of the full sort key (date, type, id) rather
    // than just the date, so resuming lands on the exact row the previous
    // page ended on instead of the first row of a same-date tie group. It's
    // opaque to the client — round-tripped verbatim as `after`.
    const afterIndex = after
      ? allActivities.findIndex((activity) => cursorKey(activity) === after)
      : null
    // A cursor matching no row (its activity was deleted between requests,
    // or it's a stale/foreign cursor) must not restart from page 1 — that
    // would re-serve already-seen rows forever in infinite scroll. Treat a
    // miss as "nothing more" rather than "start over".
    const startIndex =
      afterIndex === null
        ? 0
        : afterIndex === -1
          ? allActivities.length
          : afterIndex + 1
    const page = allActivities.slice(startIndex, startIndex + limit + 1)
    const results = page.slice(0, limit)
    const lastResult = results[results.length - 1]
    const nextCursor =
      page.length > limit && lastResult ? cursorKey(lastResult) : null

    return { nextCursor, results }
  }

  private async getPollActivities(
    electedOfficeId: string,
    personId: string,
  ): Promise<PollConstituentActivity[]> {
    const messages: PollIndividualMessageWithPoll[] =
      await this.pollIndividualMessage.findMany({
        where: {
          electedOfficeId,
          personId,
        },
        include: {
          poll: true,
        },
        orderBy: { sentAt: Prisma.SortOrder.desc },
      })

    const messagesByPollId = new Map<string, PollIndividualMessageWithPoll[]>()
    for (const message of messages) {
      const key = String(message.pollId)
      const list = messagesByPollId.get(key) ?? []
      list.push(message)
      messagesByPollId.set(key, list)
    }

    const pollActivities: PollConstituentActivity[] = []
    for (const [, pollMessages] of messagesByPollId) {
      const sortedBySentAt = [...pollMessages].sort((a, b) =>
        compareDesc(a.sentAt, b.sentAt),
      )
      const mostRecent = sortedBySentAt[0]
      if (!mostRecent) continue
      const events = sortedBySentAt.map((msg) => {
        const eventType =
          msg.sender === PollIndividualMessageSender.ELECTED_OFFICIAL
            ? ConstituentActivityEventType.SENT
            : msg.isOptOut
              ? ConstituentActivityEventType.OPTED_OUT
              : ConstituentActivityEventType.RESPONDED
        return {
          type: eventType,
          date: msg.sentAt.toISOString(),
        }
      })
      pollActivities.push({
        type: ConstituentActivityType.POLL_INTERACTIONS,
        date: mostRecent.sentAt.toISOString(),
        data: {
          pollId: mostRecent.pollId,
          pollTitle: mostRecent.poll.name,
          events: events.reverse(),
        },
      })
    }
    return pollActivities
  }

  async getConstituentIssues(
    personId: string,
    electedOfficeId: string,
    take: number,
    after: string | undefined,
  ): Promise<GetConstituentIssuesResponse> {
    const skip = after ? Math.max(0, parseInt(after, 10) || 0) : 0
    // oversample by 1 to check if there are more messages
    const messageLimit = Math.max(1, take) + 1
    const messages = await this.pollIndividualMessage.findMany({
      where: {
        personId,
        electedOfficeId,
        sender: 'CONSTITUENT',
        pollIssues: { some: {} },
      },
      include: {
        pollIssues: true,
        poll: { select: { id: true, name: true } },
      },
      orderBy: { sentAt: 'desc' },
      skip,
      take: messageLimit,
    })
    const hasMore = messages.length > take
    const nextCursor = hasMore ? String(skip + take) : null
    //split off the oversampled message
    const pageMessages = hasMore ? messages.slice(0, take) : messages
    const results: ConstituentIssue[] = []
    for (const msg of pageMessages) {
      const date = msg.sentAt.toISOString()
      for (const issue of msg.pollIssues) {
        results.push({
          issueTitle: issue.title,
          issueSummary: issue.summary ?? '',
          pollTitle: msg.poll.name,
          pollId: msg.poll.id,
          date,
        })
      }
    }
    return {
      nextCursor,
      results,
    }
  }
}
