import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, differenceInCalendarDays } from 'date-fns'
import {
  DashboardCardType,
  OutreachStatus,
  OutreachType,
  PrioritySource,
  SynthesisRunStatus,
  SynthesisScope,
} from '../../generated/prisma'
import { useTestService } from '@/test-service'
import { FeaturesService } from '@/features/services/features.service'
import { PriorityResultsService } from '@/priorities/services/priorityResults.service'
import type {
  DashboardCardsResponse,
  PriorityReadStatus,
} from '@goodparty_org/contracts'

const service = useTestService()

const isFeatureEnabled = vi.fn()
const readStatuses = vi.fn()

const readOf = (
  status: PriorityReadStatus['status'],
  overrides: Partial<PriorityReadStatus> = {},
): PriorityReadStatus => ({
  answers: 40,
  needed: 80,
  groupsHeard: 5,
  groupsTotal: 12,
  good: status === 'representative',
  status,
  underrepresented: [],
  checkOut: true,
  ...overrides,
})

// The read is a model fit over the district; the card only needs its status.
const readIs = (read: PriorityReadStatus) =>
  readStatuses.mockImplementation((_slug: string, ids: string[]) =>
    Promise.resolve(new Map(ids.map((id) => [id, read]))),
  )

beforeEach(() => {
  isFeatureEnabled.mockReset().mockResolvedValue(true)
  readStatuses.mockReset()
  readIs(readOf('notYetRepresentative'))
  vi.spyOn(
    service.app.get(FeaturesService),
    'isFeatureEnabled',
  ).mockImplementation(isFeatureEnabled)
  vi.spyOn(
    service.app.get(PriorityResultsService),
    'readStatuses',
  ).mockImplementation(readStatuses)
})

const seedOffice = async (orgSlug: string) => {
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  const electedOffice = await service.prisma.electedOffice.create({
    data: { organizationSlug: orgSlug, userId: service.user.id },
  })
  const priority = await service.prisma.priority.create({
    data: {
      electedOfficeId: electedOffice.id,
      title: 'Downtown parking',
      description: 'Not enough of it.',
      source: PrioritySource.user_stated,
    },
  })
  return { electedOffice, priority }
}

const seedSend = (
  organizationSlug: string,
  data: {
    status?: OutreachStatus
    priorityId?: string | null
    reportBackForOutreachId?: number
  } = {},
) =>
  service.prisma.outreach.create({
    data: {
      organizationSlug,
      campaignId: null,
      outreachType: OutreachType.text,
      status: data.status ?? OutreachStatus.completed,
      priorityId: data.priorityId ?? null,
      reportBackForOutreachId: data.reportBackForOutreachId ?? null,
      scheduledLocalDate: '2026-10-05',
      message: 'Hi, this is Alex.',
    },
  })

const listCards = async (orgSlug: string, bucket = 'active') => {
  const res = await service.client.get<DashboardCardsResponse>(
    `/v1/dashboard/cards?bucket=${bucket}`,
    { headers: { 'x-organization-slug': orgSlug } },
  )
  expect(res.status).toBe(200)
  return res.data.cards.filter((card) => card.type === 'report_back')
}

describe("the Chief of Staff's report back card", () => {
  it('appears once a priority text has its replies in, one card for the priority', async () => {
    const slug = 'eo-report-back-appears'
    const { priority } = await seedOffice(slug)
    await seedSend(slug, { priorityId: priority.id })
    const latest = await seedSend(slug, { priorityId: priority.id })

    const [card, ...rest] = await listCards(slug)

    expect(rest).toHaveLength(0)
    expect(card).toMatchObject({
      title: 'Show people their voice counted on Downtown parking',
      summary:
        'A few groups need more answers. Tell everyone who answered what you heard so far.',
      ctaLabel: 'Report back',
      ctaHref: `/dashboard/priorities/${priority.id}?reportBack=${latest.id}`,
      sourceExternalId: priority.id,
      sourceItemId: 'notYetRepresentative',
    })
    expect(differenceInCalendarDays(new Date(card!.dueDate), new Date())).toBe(
      14,
    )
  })

  it('says what is next when the read is good', async () => {
    const slug = 'eo-report-back-good'
    const { priority } = await seedOffice(slug)
    await seedSend(slug, { priorityId: priority.id })
    readIs(readOf('representative'))

    const [card] = await listCards(slug)

    expect(card?.summary).toBe(
      'Every group heard. Tell everyone who answered what you heard.',
    )
  })

  it('waits while the replies are still being summarized', async () => {
    const slug = 'eo-report-back-summarizing'
    const { priority } = await seedOffice(slug)
    const send = await seedSend(slug, { priorityId: priority.id })
    const run = await service.prisma.feedbackSynthesisRun.create({
      data: {
        organizationSlug: slug,
        scope: SynthesisScope.effort,
        outreachId: send.id,
        status: SynthesisRunStatus.running,
        activeKey: `${slug}:${send.id}`,
        conversations: 10,
        memos: 10,
        confirmed: 10,
        engine: 'mock',
      },
    })

    expect(await listCards(slug)).toHaveLength(0)

    await service.prisma.feedbackSynthesisRun.update({
      where: { id: run.id },
      data: {
        status: SynthesisRunStatus.completed,
        activeKey: null,
        completedAt: new Date(),
      },
    })
    expect(await listCards(slug)).toHaveLength(1)
  })

  it('does not appear before the results land, without answers, or for a send off a priority', async () => {
    const slug = 'eo-report-back-not-yet'
    const { priority } = await seedOffice(slug)
    await seedSend(slug, {
      priorityId: priority.id,
      status: OutreachStatus.in_progress,
    })
    await seedSend(slug, { priorityId: null })
    expect(await listCards(slug)).toHaveLength(0)

    await seedSend(slug, { priorityId: priority.id })
    readIs(readOf('tooEarly', { answers: 0 }))
    expect(await listCards(slug)).toHaveLength(0)
  })

  it('never appears for a report back itself', async () => {
    const slug = 'eo-report-back-of-a-report-back'
    const { electedOffice, priority } = await seedOffice(slug)
    const asked = await seedSend(slug, { priorityId: priority.id })
    await seedSend(slug, {
      priorityId: priority.id,
      reportBackForOutreachId: asked.id,
    })

    await listCards(slug)
    const rows = await service.prisma.dashboardCard.findMany({
      where: {
        electedOfficeId: electedOffice.id,
        type: DashboardCardType.report_back,
      },
      select: { sourceExternalId: true },
    })

    expect(rows).toEqual([{ sourceExternalId: priority.id }])
  })

  it('is done once the report back goes out past checkout', async () => {
    const slug = 'eo-report-back-sent'
    const { electedOffice, priority } = await seedOffice(slug)
    const asked = await seedSend(slug, { priorityId: priority.id })
    expect(await listCards(slug)).toHaveLength(1)

    const reportBack = await seedSend(slug, {
      reportBackForOutreachId: asked.id,
      status: OutreachStatus.pending_payment,
    })
    expect(await listCards(slug)).toHaveLength(1)

    await service.prisma.outreach.update({
      where: { id: reportBack.id },
      data: { status: OutreachStatus.pending },
    })
    expect(await listCards(slug)).toHaveLength(0)
    const [done] = await listCards(slug, 'done')
    expect(done?.sourceExternalId).toBe(priority.id)
    const rows = await service.prisma.dashboardCard.count({
      where: {
        electedOfficeId: electedOffice.id,
        type: DashboardCardType.report_back,
      },
    })
    expect(rows).toBe(1)
  })

  it('shows a new card when the priority read status changes, and drops the stale open one', async () => {
    const slug = 'eo-report-back-status-change'
    const { electedOffice, priority } = await seedOffice(slug)
    const asked = await seedSend(slug, { priorityId: priority.id })
    expect(await listCards(slug)).toHaveLength(1)

    readIs(readOf('gettingClose'))
    const [next, ...rest] = await listCards(slug)
    expect(rest).toHaveLength(0)
    expect(next).toMatchObject({
      sourceExternalId: priority.id,
      sourceItemId: 'gettingClose',
      summary:
        'Still unsure what some groups think. Tell everyone who answered what you heard so far.',
    })
    expect(
      await service.prisma.dashboardCard.count({
        where: {
          electedOfficeId: electedOffice.id,
          type: DashboardCardType.report_back,
        },
      }),
    ).toBe(1)

    await seedSend(slug, {
      reportBackForOutreachId: asked.id,
      status: OutreachStatus.pending,
    })
    expect(await listCards(slug)).toHaveLength(0)
    readIs(readOf('representative'))
    const [again] = await listCards(slug)
    expect(again?.sourceItemId).toBe('representative')
    expect(await listCards(slug, 'done')).toHaveLength(1)
  })

  it('replaces the card an earlier build made for each send', async () => {
    const slug = 'eo-report-back-legacy'
    const { electedOffice, priority } = await seedOffice(slug)
    const send = await seedSend(slug, { priorityId: priority.id })
    await service.prisma.dashboardCard.create({
      data: {
        electedOfficeId: electedOffice.id,
        type: DashboardCardType.report_back,
        sourceExternalId: String(send.id),
        sourceItemId: null,
        title: 'Old',
        summary: 'Old',
        ctaLabel: 'Old',
        ctaHref: '/old',
        dueDate: addDays(new Date(), 3),
      },
    })

    const cards = await listCards(slug)

    expect(cards.map((card) => card.sourceExternalId)).toEqual([priority.id])
  })

  it('takes Show in 3 days, Not for me and Bring it back', async () => {
    const slug = 'eo-report-back-skip'
    const { priority } = await seedOffice(slug)
    await seedSend(slug, { priorityId: priority.id })
    const [card] = await listCards(slug)
    const headers = { 'x-organization-slug': slug }

    await service.client.put(`/v1/dashboard/cards/${card!.id}/snooze`, null, {
      headers,
    })
    expect(await listCards(slug)).toHaveLength(0)
    await service.prisma.dashboardCard.update({
      where: { id: card!.id },
      data: { snoozedUntil: addDays(new Date(), -1) },
    })
    expect(await listCards(slug)).toHaveLength(1)

    await service.client.put(`/v1/dashboard/cards/${card!.id}/dismiss`, null, {
      headers,
    })
    expect(await listCards(slug)).toHaveLength(0)
    expect(await listCards(slug, 'skipped')).toHaveLength(1)

    await service.client.put(`/v1/dashboard/cards/${card!.id}/restore`, null, {
      headers,
    })
    expect(await listCards(slug)).toHaveLength(1)
  })

  it('rewrites old words on a card it already made, keeping its state', async () => {
    const slug = 'eo-report-back-old-words'
    const { electedOffice, priority } = await seedOffice(slug)
    const send = await seedSend(slug, { priorityId: priority.id })
    await listCards(slug)
    const skippedAt = new Date('2026-10-01T00:00:00Z')
    const where = {
      electedOfficeId: electedOffice.id,
      type: DashboardCardType.report_back,
      sourceExternalId: priority.id,
    }
    await service.prisma.dashboardCard.updateMany({
      where,
      data: {
        title: 'Report back on Downtown parking',
        summary: 'Tell people what you heard.',
        ctaLabel: 'Start',
        ctaHref: '/dashboard/priorities',
        dismissedAt: skippedAt,
      },
    })

    await listCards(slug)

    const card = await service.prisma.dashboardCard.findFirstOrThrow({ where })
    expect(card).toMatchObject({
      title: 'Show people their voice counted on Downtown parking',
      summary:
        'A few groups need more answers. Tell everyone who answered what you heard so far.',
      ctaLabel: 'Report back',
      ctaHref: `/dashboard/priorities/${priority.id}?reportBack=${send.id}`,
    })
    expect(card.dismissedAt).toEqual(skippedAt)
    expect(card.completedAt).toBeNull()
  })

  it('stays away with the flag off', async () => {
    const slug = 'eo-report-back-flag-off'
    const { electedOffice, priority } = await seedOffice(slug)
    await seedSend(slug, { priorityId: priority.id })
    isFeatureEnabled.mockResolvedValue(false)

    expect(await listCards(slug)).toHaveLength(0)
    expect(
      await service.prisma.dashboardCard.count({
        where: { electedOfficeId: electedOffice.id },
      }),
    ).toBe(0)

    isFeatureEnabled.mockResolvedValue(true)
    await listCards(slug)
    isFeatureEnabled.mockResolvedValue(false)
    expect(await listCards(slug)).toHaveLength(0)
  })
})
