import { ContactInteractionDoorKnockService } from '@/contactInteraction/services/contactInteractionDoorKnock.service'
import { ContactInteractionRobocallService } from '@/contactInteraction/services/contactInteractionRobocall.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { ContactNoteService } from '@/contactNote/services/contactNote.service'
import { PollIndividualMessageService } from '@/polls/services/pollIndividualMessage.service'
import { VoterOutreachActivityService } from '@/voterOutreachActivity/services/voterOutreachActivity.service'
import { Injectable } from '@nestjs/common'
import {
  Poll,
  PollIndividualMessage,
  PollIndividualMessageSender,
  Prisma,
} from '../generated/prisma'
import { compareDesc, parseISO } from 'date-fns'
import { IndividualActivityInput } from './contactEngagement.schema'
import {
  ConstituentActivity,
  ConstituentActivityEventType,
  ConstituentActivityType,
  ConstituentIssue,
  DoorKnockConstituentActivity,
  GetConstituentIssuesResponse,
  GetIndividualActivitiesResponse,
  NoteConstituentActivity,
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
    case ConstituentActivityType.NOTE:
      return activity.data.noteId
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
    private readonly contactNote: ContactNoteService,
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

    // The id tiebreak is applied in the merge sort below; this orderBy keeps
    // each source's own fetch order stable/deterministic across requests.
    const interactionOrderBy = [
      { occurredAt: Prisma.SortOrder.desc },
      { id: Prisma.SortOrder.desc },
    ]
    const [doorKnocks, texts, robocalls, notes] = await Promise.all([
      this.contactInteractionDoorKnock.findMany({
        where: { organizationSlug, personId },
        orderBy: interactionOrderBy,
      }),
      this.contactInteractionText.findMany({
        where: { organizationSlug, personId },
        orderBy: interactionOrderBy,
      }),
      this.contactInteractionRobocall.findMany({
        where: { organizationSlug, personId },
        orderBy: interactionOrderBy,
      }),
      this.contactNote.listForPerson(organizationSlug, personId),
    ])

    // Poll interactions only exist in the Serve (elected office) context.
    // Legacy outreach rows only join the union for Win, and only when the
    // client passes the durable lalVoterId (the sunset-compatibility path —
    // omitting it is not an error, it just means no legacy rows).
    const pollActivities = electedOfficeId
      ? await this.getPollActivities(electedOfficeId, personId)
      : []
    const outreachActivities =
      lalVoterId && campaignId !== undefined
        ? await this.voterOutreachActivity.getActivityForVoter(
            campaignId,
            lalVoterId,
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

    const noteActivities: NoteConstituentActivity[] = notes.map((note) => ({
      type: ConstituentActivityType.NOTE,
      date: note.createdAt.toISOString(),
      data: {
        noteId: note.id,
        body: note.body,
        createdAt: note.createdAt.toISOString(),
        updatedAt: note.updatedAt.toISOString(),
      },
    }))

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
      ...noteActivities,
    ]
    // date desc, then type/id as an explicit tiebreak — same-day Win outreach
    // attributions (occurredAt from a date-only picker) can be byte-identical,
    // and sorting on date alone leaves their relative order undefined, which
    // breaks the cursor below.
    allActivities.sort((a, b) => {
      const dateOrder = compareDesc(parseISO(a.date), parseISO(b.date))
      if (dateOrder !== 0) return dateOrder
      if (a.type !== b.type) return a.type.localeCompare(b.type)
      return activityId(a).localeCompare(activityId(b))
    })

    // The cursor is a composite of the full sort key (date, type, id) rather
    // than just the date, so resuming lands on the exact row the previous
    // page ended on instead of the first row of a same-date tie group. It's
    // opaque to the client — round-tripped verbatim as `after`.
    const startIndex = after
      ? allActivities.findIndex((activity) => cursorKey(activity) === after) + 1
      : 0
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
