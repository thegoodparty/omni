import { Injectable, NotFoundException } from '@nestjs/common'
import { isAfter, min } from 'date-fns'
import type { DoorKnockingCampaignResults } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  DoorKnockOutcome,
  FollowUpAnswer,
  SupportAnswer,
  WillVoteAnswer,
} from '../../generated/prisma'
import { campaignEnvelopeScope } from '../utils/turfScope.util'

type LatestKnock = {
  outcome: DoorKnockOutcome
  supportAnswer: SupportAnswer | null
  willVote: WillVoteAnswer | null
  followUp: FollowUpAnswer | null
  occurredAt: Date
}

// The same door key DoorKnockingTurfCountsService uses, so "a door" here is
// the door the rail counts.
const doorKey = (stopId: number, addressKey: string) =>
  `${stopId}|${addressKey}`

@Injectable()
export class DoorKnockingCampaignResultsService extends createPrismaBase(
  MODELS.ContactInteractionDoorKnock,
) {
  // Counted by door, not person: a household is one knock, so a door reads
  // Answered when anybody behind it answered and counts toward an answer when
  // anybody behind it gave it. Each person contributes their latest knock on
  // this campaign.
  async forCampaign(
    anchorId: number,
    organizationSlug: string,
  ): Promise<DoorKnockingCampaignResults> {
    const envelopes = await this.client.outreach.findMany({
      where: campaignEnvelopeScope(anchorId, organizationSlug),
      select: { id: true, doorKnockingTurfId: true, createdAt: true },
    })
    if (envelopes.length === 0) {
      throw new NotFoundException('Campaign not found')
    }
    const turfIds = envelopes.flatMap((envelope) =>
      envelope.doorKnockingTurfId === null ? [] : [envelope.doorKnockingTurfId],
    )

    const targets = await this.client.doorKnockingStopTarget.findMany({
      where: { stop: { doorKnockingTurfId: { in: turfIds } } },
      select: { personId: true, addressKey: true, doorKnockingStopId: true },
    })
    const doorsByPerson = new Map<string, Set<string>>()
    for (const target of targets) {
      const doors = doorsByPerson.get(target.personId) ?? new Set<string>()
      doors.add(doorKey(target.doorKnockingStopId, target.addressKey))
      doorsByPerson.set(target.personId, doors)
    }

    // Knocks logged before the envelope id was stored carry none, so those
    // are matched on a resident of this campaign knocked after it began.
    const knocks = await this.model.findMany({
      where: {
        organizationSlug,
        OR: [
          { outreachId: { in: envelopes.map((envelope) => envelope.id) } },
          {
            outreachId: null,
            personId: { in: [...doorsByPerson.keys()] },
            occurredAt: {
              gte: min(envelopes.map((envelope) => envelope.createdAt)),
            },
          },
        ],
      },
      select: {
        personId: true,
        outcome: true,
        supportAnswer: true,
        willVote: true,
        followUp: true,
        occurredAt: true,
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    })

    const latestByPerson = new Map<string, LatestKnock>()
    for (const { personId, ...knock } of knocks) {
      if (!latestByPerson.has(personId)) latestByPerson.set(personId, knock)
    }

    const knocksByDoor = new Map<string, LatestKnock[]>()
    for (const [personId, knock] of latestByPerson) {
      for (const door of doorsByPerson.get(personId) ?? []) {
        knocksByDoor.set(door, [...(knocksByDoor.get(door) ?? []), knock])
      }
    }

    const results: DoorKnockingCampaignResults = {
      doorsKnocked: knocksByDoor.size,
      byOutcome: {
        [DoorKnockOutcome.answered]: 0,
        [DoorKnockOutcome.not_home]: 0,
        [DoorKnockOutcome.refused_to_engage]: 0,
        [DoorKnockOutcome.inaccessible]: 0,
        [DoorKnockOutcome.not_a_voter]: 0,
      },
      bySupport: {
        [SupportAnswer.supporter]: 0,
        [SupportAnswer.unsure]: 0,
        [SupportAnswer.non_supporter]: 0,
      },
      byWillVote: {
        [WillVoteAnswer.yes]: 0,
        [WillVoteAnswer.no]: 0,
        [WillVoteAnswer.unsure]: 0,
        [WillVoteAnswer.already_voted]: 0,
      },
      byFollowUp: {
        [FollowUpAnswer.yes]: 0,
        [FollowUpAnswer.no]: 0,
      },
    }
    for (const doorKnocks of knocksByDoor.values()) {
      const latest = doorKnocks.reduce((a, b) =>
        isAfter(b.occurredAt, a.occurredAt) ? b : a,
      )
      const outcome = doorKnocks.some(
        (knock) => knock.outcome === DoorKnockOutcome.answered,
      )
        ? DoorKnockOutcome.answered
        : latest.outcome
      results.byOutcome[outcome] += 1
      for (const answer of new Set(doorKnocks.map((k) => k.supportAnswer))) {
        if (answer) results.bySupport[answer] += 1
      }
      for (const answer of new Set(doorKnocks.map((k) => k.willVote))) {
        if (answer) results.byWillVote[answer] += 1
      }
      for (const answer of new Set(doorKnocks.map((k) => k.followUp))) {
        if (answer) results.byFollowUp[answer] += 1
      }
    }
    return results
  }
}
