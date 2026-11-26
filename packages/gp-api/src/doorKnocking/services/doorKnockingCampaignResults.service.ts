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
import {
  campaignEnvelopeScope,
  campaignTurfScope,
} from '../utils/turfScope.util'

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

const turfPersonKey = (turfId: number, personId: string) =>
  `${turfId}|${personId}`

@Injectable()
export class DoorKnockingCampaignResultsService extends createPrismaBase(
  MODELS.ContactInteractionDoorKnock,
) {
  // Counted by door, not person: a household is one knock, so a door reads
  // Answered when anybody behind it answered and counts toward an answer when
  // anybody behind it gave it. Each person contributes their latest knock on
  // each turf of this campaign.
  async forCampaign(
    anchorId: number,
    organizationSlug: string,
  ): Promise<DoorKnockingCampaignResults> {
    const envelopes = await this.client.outreach.count({
      where: campaignEnvelopeScope(anchorId, organizationSlug),
    })
    if (envelopes === 0) {
      throw new NotFoundException('Campaign not found')
    }
    // The campaign's live turfs, the same set its drawer lists. A knock is
    // counted against the turf it was logged under and nowhere else, so a
    // resident on two overlapping turfs is not one knock counted twice.
    const turfs = await this.client.doorKnockingTurf.findMany({
      where: campaignTurfScope(anchorId, organizationSlug),
      select: { id: true, outreach: { select: { id: true, createdAt: true } } },
      orderBy: { id: 'asc' },
    })
    const turfByEnvelope = new Map<number, number>()
    for (const turf of turfs) {
      if (turf.outreach) turfByEnvelope.set(turf.outreach.id, turf.id)
    }

    const targets = await this.client.doorKnockingStopTarget.findMany({
      where: { stop: { doorKnockingTurfId: { in: turfs.map((t) => t.id) } } },
      select: {
        personId: true,
        addressKey: true,
        doorKnockingStopId: true,
        stop: { select: { doorKnockingTurfId: true } },
      },
    })
    const doorsByTurfPerson = new Map<string, Set<string>>()
    const firstTurfByPerson = new Map<string, number>()
    for (const target of targets) {
      const turfId = target.stop.doorKnockingTurfId
      const key = turfPersonKey(turfId, target.personId)
      const doors = doorsByTurfPerson.get(key) ?? new Set<string>()
      doors.add(doorKey(target.doorKnockingStopId, target.addressKey))
      doorsByTurfPerson.set(key, doors)
      const first = firstTurfByPerson.get(target.personId)
      if (first === undefined || turfId < first) {
        firstTurfByPerson.set(target.personId, turfId)
      }
    }

    // Knocks logged before the envelope id was stored carry none, so those
    // are matched on a resident of this campaign knocked after it began, and
    // counted on that resident's first turf only.
    const startedAt = turfs.flatMap((turf) =>
      turf.outreach ? [turf.outreach.createdAt] : [],
    )
    const knocks =
      turfs.length === 0
        ? []
        : await this.model.findMany({
            where: {
              organizationSlug,
              OR: [
                { outreachId: { in: [...turfByEnvelope.keys()] } },
                {
                  outreachId: null,
                  personId: { in: [...firstTurfByPerson.keys()] },
                  occurredAt: { gte: min(startedAt) },
                },
              ],
            },
            select: {
              personId: true,
              outreachId: true,
              outcome: true,
              supportAnswer: true,
              willVote: true,
              followUp: true,
              occurredAt: true,
            },
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          })

    const latestByTurfPerson = new Map<string, LatestKnock>()
    for (const { personId, outreachId, ...knock } of knocks) {
      const turfId =
        outreachId === null
          ? firstTurfByPerson.get(personId)
          : turfByEnvelope.get(outreachId)
      if (turfId === undefined) continue
      const key = turfPersonKey(turfId, personId)
      if (!latestByTurfPerson.has(key)) latestByTurfPerson.set(key, knock)
    }

    const knocksByDoor = new Map<string, LatestKnock[]>()
    for (const [key, knock] of latestByTurfPerson) {
      for (const door of doorsByTurfPerson.get(key) ?? []) {
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
