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
  GetCampaignActivitiesResponse,
  GetConstituentIssuesResponse,
  GetIndividualActivitiesResponse,
  OutreachConstituentActivity,
} from './contactEngagement.types'

type PollIndividualMessageWithPoll = PollIndividualMessage & { poll: Poll }

type CampaignActivityInput = {
  campaignId: number
  lalVoterId: string
  take?: number
  after?: string
}

@Injectable()
export class ContactEngagementService {
  constructor(
    private readonly pollIndividualMessage: PollIndividualMessageService,
    private readonly voterOutreachActivity: VoterOutreachActivityService,
  ) {}

  async getCampaignActivities(
    input: CampaignActivityInput,
  ): Promise<GetCampaignActivitiesResponse> {
    const { campaignId, lalVoterId, take, after } = input
    const limit = take ?? 20

    // Oversample by 1 to detect a next page. Pagination is bounded at the DB
    // via cursor; a stale/foreign `after` matches no row and yields an empty
    // page (no in-memory reset, so no infinite-loop on a bad cursor).
    const activities = await this.voterOutreachActivity.getActivityForVoter(
      campaignId,
      lalVoterId,
      limit + 1,
      after,
    )

    const page = activities.slice(0, limit)
    const results: OutreachConstituentActivity[] = page.map((activity) => ({
      type: ConstituentActivityType.OUTREACH,
      date: activity.occurredAt.toISOString(),
      data: {
        activityId: activity.id,
        outreachType: activity.outreachType,
        attributionSource: activity.attributionSource,
      },
    }))
    const nextCursor =
      activities.length > limit
        ? (results[results.length - 1]?.data.activityId.toString() ?? null)
        : null

    return { nextCursor, results }
  }

  async getIndividualActivities(
    input: IndividualActivityInput,
  ): Promise<GetIndividualActivitiesResponse> {
    const { personId, take, after, electedOfficeId } = input
    const limit = take ?? 20

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

    const allActivities: ConstituentActivity[] = []
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
      allActivities.push({
        type: ConstituentActivityType.POLL_INTERACTIONS,
        date: mostRecent.sentAt.toISOString(),
        data: {
          pollId: mostRecent.pollId,
          pollTitle: mostRecent.poll.name,
          events: events.reverse(),
        },
      })
    }
    allActivities.sort((a, b) =>
      compareDesc(parseISO(a.date), parseISO(b.date)),
    )

    const startIndex = after
      ? allActivities.findIndex((a) => a.data.pollId === after) + 1
      : 0
    const page = allActivities.slice(startIndex, startIndex + limit + 1)
    const results = page.slice(0, limit)
    const nextCursor =
      page.length > limit
        ? (results[results.length - 1]?.data.pollId ?? null)
        : null

    return { nextCursor, results }
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
