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
import type { DashboardCardsResponse } from '@goodparty_org/contracts'

const service = useTestService()

const isFeatureEnabled = vi.fn()

beforeEach(() => {
  isFeatureEnabled.mockReset().mockResolvedValue(true)
  vi.spyOn(
    service.app.get(FeaturesService),
    'isFeatureEnabled',
  ).mockImplementation(isFeatureEnabled)
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
  it("appears once a priority text's replies are in, due in 14 days", async () => {
    const slug = 'eo-report-back-appears'
    const { priority } = await seedOffice(slug)
    const send = await seedSend(slug, { priorityId: priority.id })

    const [card, ...rest] = await listCards(slug)

    expect(rest).toHaveLength(0)
    expect(card).toMatchObject({
      title: 'Show people their voice counted on Downtown parking',
      ctaLabel: 'Report back',
      ctaHref: `/dashboard/priorities/${priority.id}?reportBack=${send.id}`,
      sourceExternalId: String(send.id),
    })
    expect(differenceInCalendarDays(new Date(card!.dueDate), new Date())).toBe(
      14,
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

  it('does not appear before the results land, or for a send off a priority', async () => {
    const slug = 'eo-report-back-not-yet'
    const { priority } = await seedOffice(slug)
    await seedSend(slug, {
      priorityId: priority.id,
      status: OutreachStatus.in_progress,
    })
    await seedSend(slug, { priorityId: null })

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

    expect(rows).toEqual([{ sourceExternalId: String(asked.id) }])
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
    expect(done?.sourceExternalId).toBe(String(asked.id))
    const rows = await service.prisma.dashboardCard.count({
      where: {
        electedOfficeId: electedOffice.id,
        type: DashboardCardType.report_back,
      },
    })
    expect(rows).toBe(1)
  })

  it('is done on its first read when the report back already went out', async () => {
    const slug = 'eo-report-back-sent-first'
    const { priority } = await seedOffice(slug)
    const asked = await seedSend(slug, { priorityId: priority.id })
    await seedSend(slug, {
      reportBackForOutreachId: asked.id,
      status: OutreachStatus.pending,
    })

    expect(await listCards(slug)).toHaveLength(0)
    const [done] = await listCards(slug, 'done')
    expect(done?.sourceExternalId).toBe(String(asked.id))
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
