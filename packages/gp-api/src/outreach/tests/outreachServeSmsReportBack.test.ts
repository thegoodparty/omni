import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { addBusinessDays, format } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CIVIC_PANEL_JOIN_LINE, type Person } from '@goodparty_org/contracts'
import { ContactsService } from '@/contacts/services/contacts.service'
import { FeaturesService } from '@/features/services/features.service'
import { useTestService } from '@/test-service'
import {
  OutreachStatus,
  OutreachType,
  PrioritySource,
} from '../../generated/prisma'
import { OutreachReportBackService } from '../services/outreachReportBack.service'
import { OutreachServeSmsPurchaseHandlerService } from '../services/outreachServeSmsPurchase.service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from 'src/vendors/segment/segment.types'

const service = useTestService()

const person = (n: number): Person =>
  ({
    id: randomUUID(),
    firstName: 'Jane',
    lastName: `Resident ${n}`,
    cellPhone: `30755500${String(n).padStart(2, '0')}`,
    address: { line1: `${n} Main St` },
  }) as Person

// A report back is a text to the people an earlier priority text asked. It
// is marked as such on the row, which is what keeps it from being read as
// another ask.
describe('a Serve text that reports back', () => {
  let slug: string
  let priorityId: string
  let filterId: number
  let askedId: number
  const isFeatureEnabled = vi.fn()

  beforeEach(async () => {
    slug = `eo-rb-${Date.now()}-${Math.random().toString(36).slice(2)}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    const office = await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: slug },
    })
    priorityId = (
      await service.prisma.priority.create({
        data: {
          electedOfficeId: office.id,
          title: 'Downtown parking',
          description: 'Not enough of it.',
          source: PrioritySource.user_stated,
        },
      })
    ).id
    askedId = (
      await service.prisma.outreach.create({
        data: {
          organizationSlug: slug,
          campaignId: null,
          outreachType: OutreachType.text,
          status: OutreachStatus.completed,
          priorityId,
        },
      })
    ).id
    filterId = (
      await service.prisma.voterFileFilter.create({
        data: { organizationSlug: slug, name: 'Everyone you texted' },
      })
    ).id

    isFeatureEnabled.mockReset().mockResolvedValue(true)
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockImplementation(isFeatureEnabled)
    vi.spyOn(
      service.app.get(ContactsService),
      'findContactsForFilter',
    ).mockResolvedValue({
      people: Array.from({ length: 30 }, (_, n) => person(n)),
      pagination: {
        totalResults: 30,
        currentPage: 1,
        pageSize: 1000,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })
  })

  const create = (body: Record<string, unknown> = {}) =>
    service.client.post(
      '/v1/outreach/serve/sms',
      {
        name: 'Parking report back',
        message:
          'this is Bryan, your City Council Member. Thanks for answering.\n\nReply STOP to opt out.',
        imageUrl: 'https://assets.test/header.png',
        scheduledLocalDate: format(
          addBusinessDays(new Date(), 5),
          'yyyy-MM-dd',
        ),
        voterFileFilterId: filterId,
        reportBackForOutreachId: askedId,
        ...body,
      },
      { headers: { 'x-organization-slug': slug } },
    )

  it('marks the draft as a report back on the send it answers', async () => {
    const response = await create()

    expect(response.status).toBe(HttpStatus.CREATED)
    const row = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: response.data.outreachId },
    })
    expect(row.reportBackForOutreachId).toBe(askedId)
    expect(row.priorityId).toBeNull()
    expect(row.asksToJoinCivicPanel).toBe(false)
  })

  it('refuses the civic panel join line', async () => {
    const response = await create({
      message: `this is Bryan, your City Council Member.\n\n${CIVIC_PANEL_JOIN_LINE}\n\nReply STOP to opt out.`,
    })

    expect(response.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('refuses a priority or a check of its own', async () => {
    const response = await create({ priorityId })

    expect(response.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('refuses a send whose replies are not in yet', async () => {
    await service.prisma.outreach.update({
      where: { id: askedId },
      data: { status: OutreachStatus.in_progress },
    })

    expect((await create()).status).toBe(HttpStatus.BAD_REQUEST)
  })

  // Re-entering the flow makes a fresh draft, so drafts are allowed; once
  // one is paid, no other draft may be created or bought.
  it('lets one report back on a send go out', async () => {
    const first = await create()
    const second = await create()
    expect(second.status).toBe(HttpStatus.CREATED)
    await service.prisma.outreach.update({
      where: { id: first.data.outreachId },
      data: { status: OutreachStatus.pending },
    })

    expect((await create()).status).toBe(HttpStatus.BAD_REQUEST)
    await expect(
      service.app.get(OutreachServeSmsPurchaseHandlerService).validatePurchase({
        outreachId: second.data.outreachId,
        organizationSlug: slug,
      }),
    ).rejects.toThrow(/already went out/)
  })

  // One entry per priority, anchored on its latest text, counting everyone
  // who answered on any channel once.
  it('reads one entry per priority, counting each person who answered once', async () => {
    const office = await service.prisma.electedOffice.findFirstOrThrow({
      where: { organizationSlug: slug },
    })
    const laterId = (
      await service.prisma.outreach.create({
        data: {
          organizationSlug: slug,
          campaignId: null,
          outreachType: OutreachType.text,
          status: OutreachStatus.completed,
          priorityId,
        },
      })
    ).id
    const [a, b] = [randomUUID(), randomUUID()]
    for (const [outreachId, personId] of [
      [askedId, a],
      [laterId, a],
      [laterId, b],
    ] as const) {
      await service.prisma.pollIndividualMessage.create({
        data: {
          id: randomUUID(),
          personId,
          sentAt: new Date(),
          sender: 'CONSTITUENT',
          isOptOut: false,
          outreachId,
        },
      })
    }

    const sends = await service.app
      .get(OutreachReportBackService)
      .listForOffice(slug, office.id)

    expect(sends).toHaveLength(1)
    expect(sends[0]).toMatchObject({
      outreachId: laterId,
      priorityId,
      audience: 'Everyone who answered about Downtown parking',
      answered: 2,
      canReach: 2,
      reportBack: null,
    })
  })

  it('counts only the answerers a text can reach as canReach', async () => {
    const office = await service.prisma.electedOffice.findFirstOrThrow({
      where: { organizationSlug: slug },
    })
    for (const personId of [randomUUID(), randomUUID()]) {
      await service.prisma.pollIndividualMessage.create({
        data: {
          id: randomUUID(),
          personId,
          sentAt: new Date(),
          sender: 'CONSTITUENT',
          isOptOut: false,
          outreachId: askedId,
        },
      })
    }
    const countByGroupWithin = vi
      .spyOn(service.app.get(ContactsService), 'countByGroupWithin')
      .mockResolvedValue([{ count: 1 }] as never)

    const [send] = await service.app
      .get(OutreachReportBackService)
      .listForOffice(slug, office.id)

    expect(countByGroupWithin).toHaveBeenCalledWith(
      expect.anything(),
      { hasCellPhone: true },
      expect.any(Array),
    )
    expect(send).toMatchObject({ answered: 2, canReach: 1 })
  })

  // The priority's read changing makes a new card, which is a new reason to
  // tell people what was heard.
  it('lets another go out once the priority read changes', async () => {
    const first = await create()
    await service.prisma.outreach.update({
      where: { id: first.data.outreachId },
      data: { status: OutreachStatus.pending },
    })
    expect((await create()).status).toBe(HttpStatus.BAD_REQUEST)

    const electedOffice = await service.prisma.electedOffice.findFirstOrThrow({
      where: { organizationSlug: slug },
    })
    await service.prisma.dashboardCard.create({
      data: {
        electedOfficeId: electedOffice.id,
        type: 'report_back',
        sourceExternalId: priorityId,
        sourceItemId: 'representative',
        title: 'New read',
        summary: 'New read',
        ctaLabel: 'Report back',
        ctaHref: '/x',
        dueDate: new Date(),
      },
    })

    expect((await create()).status).toBe(HttpStatus.CREATED)
  })

  // A new draft supersedes the unpaid one before it, so a stale draft left
  // open in another tab cannot reach checkout.
  it('leaves one payable draft per send', async () => {
    const first = await create()
    const second = await create()
    const purchase = service.app.get(OutreachServeSmsPurchaseHandlerService)

    await expect(
      purchase.validatePurchase({
        outreachId: first.data.outreachId,
        organizationSlug: slug,
      }),
    ).rejects.toThrow(/not awaiting payment/)
    await expect(
      purchase.validatePurchase({
        outreachId: second.data.outreachId,
        organizationSlug: slug,
      }),
    ).resolves.toBeUndefined()
  })

  // Two drafts that both reached checkout and were paid at once: the first
  // claim sends, the second is canceled before anything goes out and its
  // payment refunded.
  it('sends only the first of two report backs paid at once', async () => {
    vi.spyOn(
      service.app.get(QueueProducerService),
      'sendMessage',
    ).mockResolvedValue(undefined)
    const stripe = service.app.get(StripeService)
    vi.spyOn(stripe, 'retrieveCheckoutSession').mockResolvedValue({
      payment_intent: 'pi_second',
    } as never)
    const refund = vi
      .spyOn(stripe, 'refundPaymentIntent')
      .mockResolvedValue({} as never)
    const draft = () =>
      service.prisma.outreach.create({
        data: {
          organizationSlug: slug,
          campaignId: null,
          outreachType: OutreachType.text,
          status: OutreachStatus.pending_payment,
          textCount: 30,
          reportBackForOutreachId: askedId,
        },
      })
    const first = await draft()
    const second = await draft()
    const purchase = service.app.get(OutreachServeSmsPurchaseHandlerService)
    const metadata = (id: number) => ({
      outreachId: id,
      organizationSlug: slug,
    })

    await purchase.executePostPurchase('cs_first', metadata(first.id))
    await expect(
      purchase.executePostPurchase('cs_second', metadata(second.id)),
    ).rejects.toThrow(/already went out/)

    const rows = await service.prisma.outreach.findMany({
      where: { reportBackForOutreachId: askedId },
      orderBy: { id: 'asc' },
      select: { status: true, stripeCheckoutSessionId: true },
    })
    expect(rows).toEqual([
      { status: OutreachStatus.pending, stripeCheckoutSessionId: 'cs_first' },
      {
        status: OutreachStatus.canceled,
        stripeCheckoutSessionId: 'cs_second',
      },
    ])
    expect(refund).toHaveBeenCalledTimes(1)
    expect(refund).toHaveBeenCalledWith(
      'pi_second',
      'outreach-cancel-pi_second',
    )
  })

  it('records the report back once it is paid for and queued, once', async () => {
    vi.spyOn(
      service.app.get(QueueProducerService),
      'sendMessage',
    ).mockResolvedValue(undefined)
    const track = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue(undefined as never)
    const draft = await service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        campaignId: null,
        outreachType: OutreachType.text,
        status: OutreachStatus.pending_payment,
        textCount: 30,
        reportBackForOutreachId: askedId,
      },
    })
    const purchase = service.app.get(OutreachServeSmsPurchaseHandlerService)
    const metadata = { outreachId: draft.id, organizationSlug: slug }

    await purchase.executePostPurchase('cs_rb', metadata)
    await purchase.executePostPurchase('cs_rb', metadata)

    const sent = () =>
      track.mock.calls.filter(
        ([, event]) => event === EVENTS.Priorities.ReportBackSent,
      )
    await vi.waitFor(() => expect(sent()).toHaveLength(1))
    expect(sent()[0]?.[2]).toEqual({
      organizationSlug: slug,
      answeredCount: 0,
      themesShared: 0,
      channel: 'text',
    })
  })

  it('refuses a report back on a report back', async () => {
    const first = await create()
    await service.prisma.outreach.update({
      where: { id: first.data.outreachId },
      data: { status: OutreachStatus.completed },
    })

    const response = await create({
      reportBackForOutreachId: first.data.outreachId,
    })

    expect(response.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('is not found with serve-citizen-panels off', async () => {
    isFeatureEnabled.mockImplementation(
      async ({ feature }: { feature: string }) =>
        feature !== 'serve-citizen-panels',
    )

    expect((await create()).status).toBe(HttpStatus.NOT_FOUND)
  })
})
