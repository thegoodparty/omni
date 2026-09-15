import { addDays } from 'date-fns'
import { describe, expect, it } from 'vitest'
import { DashboardCardType, Poll, PollConfidence } from '../../generated/prisma'
import { useTestService } from '@/test-service'
import { DashboardCardsService } from '../services/dashboardCards.service'

const service = useTestService()

const sync = () => service.app.get(DashboardCardsService)

const seedElectedOffice = async (orgSlug: string) => {
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  return service.prisma.electedOffice.create({
    data: { organizationSlug: orgSlug, userId: service.user.id },
  })
}

const COMPLETED = new Date('2026-09-15T12:00:00.000Z')

const seedPoll = (
  electedOfficeId: string | null,
  over: Partial<Poll> = {},
): Promise<Poll> =>
  service.prisma.poll.create({
    data: {
      name: 'Should we fund the transit shortfall?',
      messageContent: 'Reply YES or NO',
      targetAudienceSize: 4000,
      scheduledDate: new Date('2026-09-01T00:00:00.000Z'),
      estimatedCompletionDate: new Date('2026-09-14T00:00:00.000Z'),
      isCompleted: true,
      completedDate: COMPLETED,
      responseCount: 1240,
      confidence: PollConfidence.HIGH,
      electedOfficeId,
      ...over,
    },
  })

describe('DashboardCardsService.syncFromPoll', () => {
  it('creates a poll_result card pointing at the poll, due a week out', async () => {
    const eo = await seedElectedOffice('eo-poll-card-create')
    const poll = await seedPoll(eo.id)

    await sync().syncFromPoll(poll)

    const card = await service.prisma.dashboardCard.findFirstOrThrow({
      where: { electedOfficeId: eo.id },
    })
    expect(card.type).toBe(DashboardCardType.poll_result)
    expect(card.sourceExternalId).toBe(poll.id)
    expect(card.title).toBe('Should we fund the transit shortfall?')
    expect(card.summary).toContain('1,240 responses')
    expect(card.summary).toContain('high confidence')
    expect(card.ctaHref).toBe(`/dashboard/polls/${poll.id}`)
    // A finished poll has no deadline of its own, so it rides the same fixed
    // window a community issue does. Without a future dueDate it would land in
    // the `missed` bucket and never reach the inbox.
    expect(card.dueDate).toEqual(addDays(COMPLETED, 7))
  })

  it('is idempotent against a redelivered completion', async () => {
    const eo = await seedElectedOffice('eo-poll-card-twice')
    const poll = await seedPoll(eo.id)

    await sync().syncFromPoll(poll)
    await sync().syncFromPoll(poll)

    expect(
      await service.prisma.dashboardCard.count({
        where: { electedOfficeId: eo.id },
      }),
    ).toBe(1)
  })

  it('does nothing for a poll that has not completed', async () => {
    const eo = await seedElectedOffice('eo-poll-card-open')
    const poll = await seedPoll(eo.id, {
      isCompleted: false,
      completedDate: null,
      responseCount: null,
      confidence: null,
    })

    await sync().syncFromPoll(poll)

    expect(
      await service.prisma.dashboardCard.count({
        where: { electedOfficeId: eo.id },
      }),
    ).toBe(0)
  })

  // Polls exist on the Win side too, where electedOfficeId is null and there
  // is no inbox to put a card in.
  it('does nothing for a poll with no elected office', async () => {
    const poll = await seedPoll(null)

    await sync().syncFromPoll(poll)

    expect(await service.prisma.dashboardCard.count()).toBe(0)
  })

  it('reads as singular for a single response', async () => {
    const eo = await seedElectedOffice('eo-poll-card-one')
    const poll = await seedPoll(eo.id, { responseCount: 1 })

    await sync().syncFromPoll(poll)

    const card = await service.prisma.dashboardCard.findFirstOrThrow({
      where: { electedOfficeId: eo.id },
    })
    expect(card.summary).toContain('1 response is in')
  })
})
