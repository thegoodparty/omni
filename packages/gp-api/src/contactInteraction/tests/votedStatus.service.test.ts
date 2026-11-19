import { useTestService } from '@/test-service'
import { DoorKnockOutcome, WillVoteAnswer } from '@/generated/prisma'
import { beforeEach, describe, expect, it } from 'vitest'
import { ContactInteractionDoorKnockService } from '../services/contactInteractionDoorKnock.service'
import { VotedStatusService } from '../services/votedStatus.service'

const service = useTestService()

describe('VotedStatusService', () => {
  let doorKnocks: ContactInteractionDoorKnockService
  let voted: VotedStatusService

  const seedCampaign = async (
    slug: string,
    details: Record<string, string> = {},
  ) => {
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        organizationSlug: slug,
        userId: service.user.id,
        slug: `voted-${slug}`,
        details,
      },
    })
    return slug
  }

  const knock = (
    organizationSlug: string,
    personId: string,
    occurredAt: Date,
    willVote?: WillVoteAnswer,
  ) =>
    doorKnocks.create({
      organizationSlug,
      personId,
      occurredAt,
      outcome: willVote ? DoorKnockOutcome.answered : DoorKnockOutcome.not_home,
      willVote,
      manual: true,
    })

  beforeEach(() => {
    doorKnocks = service.app.get(ContactInteractionDoorKnockService)
    voted = service.app.get(VotedStatusService)
  })

  it('counts a person whose latest answer is already voted', async () => {
    const org = await seedCampaign('voted-latest')
    await knock(org, 'p-1', new Date('2026-10-01'), WillVoteAnswer.yes)
    await knock(
      org,
      'p-1',
      new Date('2026-10-10'),
      WillVoteAnswer.already_voted,
    )

    expect(await voted.votedPersonIds(org)).toEqual(['p-1'])
  })

  it('lets a later answer flip it back', async () => {
    const org = await seedCampaign('voted-flip')
    await knock(
      org,
      'p-1',
      new Date('2026-10-01'),
      WillVoteAnswer.already_voted,
    )
    await knock(org, 'p-1', new Date('2026-10-10'), WillVoteAnswer.yes)

    expect(await voted.votedPersonIds(org)).toEqual([])
  })

  it('ignores a later door with no answer', async () => {
    const org = await seedCampaign('voted-no-answer')
    await knock(
      org,
      'p-1',
      new Date('2026-10-01'),
      WillVoteAnswer.already_voted,
    )
    await knock(org, 'p-1', new Date('2026-10-10'))

    expect(await voted.votedPersonIds(org)).toEqual(['p-1'])
  })

  it('reads the answer from a phone call too', async () => {
    const org = await seedCampaign('voted-phone')
    await service.prisma.contactInteractionPhoneBanking.create({
      data: {
        organizationSlug: org,
        personId: 'p-1',
        occurredAt: new Date('2026-10-10'),
        outcome: 'answered',
        willVote: WillVoteAnswer.already_voted,
      },
    })

    expect(await voted.votedPersonIds(org)).toEqual(['p-1'])
  })

  it('drops answers from before the last election that passed', async () => {
    const org = await seedCampaign('voted-window', {
      primaryElectionDate: '2026-08-04',
      electionDate: '2099-11-03',
    })
    await knock(
      org,
      'p-1',
      new Date('2026-08-01'),
      WillVoteAnswer.already_voted,
    )
    await knock(
      org,
      'p-2',
      new Date('2026-10-10'),
      WillVoteAnswer.already_voted,
    )

    expect(await voted.votedPersonIds(org)).toEqual(['p-2'])
  })

  it('reports false for anyone without an already-voted answer', async () => {
    const org = await seedCampaign('voted-for-people')
    await knock(
      org,
      'p-1',
      new Date('2026-10-10'),
      WillVoteAnswer.already_voted,
    )

    const flags = await voted.votedForPeople(org, ['p-1', 'p-2'])
    expect(flags.get('p-1')).toBe(true)
    expect(flags.get('p-2')).toBe(false)
  })
})
