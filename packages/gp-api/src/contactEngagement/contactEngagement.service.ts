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

    const [doorKnocks, texts, robocalls, notes] = await Promise.all([
      this.contactInteractionDoorKnock.findMany({
        where: { organizationSlug, personId },
      }),
      this.contactInteractionText.findMany({
        where: { organizationSlug, personId },
      }),
      this.contactInteractionRobocall.findMany({
        where: { organizationSlug, personId },
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
    allActivities.sort((a, b) =>
      compareDesc(parseISO(a.date), parseISO(b.date)),
    )

    // The cursor is the sort key itself (the ISO date string of the previous
    // page's last row) rather than a per-type id — the union has no id shared
    // across heterogeneous entry types.
    const startIndex = after
      ? allActivities.findIndex((activity) => activity.date === after) + 1
      : 0
    const page = allActivities.slice(startIndex, startIndex + limit + 1)
    const results = page.slice(0, limit)
    const nextCursor =
      page.length > limit ? (results[results.length - 1]?.date ?? null) : null

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
