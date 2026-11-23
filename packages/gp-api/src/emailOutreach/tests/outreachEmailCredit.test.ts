import { HttpStatus } from '@nestjs/common'
import { addDays, subMinutes } from 'date-fns'
import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsService } from '@/analytics/analytics.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { FeaturesService } from '@/features/services/features.service'
import { PaymentHoldsService } from '@/paymentHolds/services/paymentHolds.service'
import { WIN_PER_CAMPAIGN_PRICING_FLAG } from '@/shared/util/winPerCampaignPricingFlag.util'
import { useTestService } from '@/test-service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import {
  OutreachEmailRecipientStatus,
  OutreachHoldState,
  OutreachStatus,
} from '../../generated/prisma'
import { OutreachDraftService } from '@/outreach/services/outreachDraft.service'
import { OutreachEmailLifecycleService } from '../services/outreachEmailLifecycle.service'
import { OutreachEmailAdminService } from '../services/outreachEmailAdmin.service'
import { SesService } from '../services/ses.service'
import {
  createEmailOrgs,
  createHold,
  createSend,
  createSender,
  EmailFixtureOrgs,
  emails,
  stubAudienceFromRecipients,
} from './emailSendFixtures'

const service = useTestService()

const { StripeInvalidRequestError } = Stripe.errors

const saveCardAndPlan = vi.fn()
const capture = vi.fn()

let orgs: EmailFixtureOrgs
let featureSpy: ReturnType<typeof vi.spyOn>

const setBalance = (outreachCreditCents: number) =>
  service.prisma.campaign.update({
    where: { id: orgs.campaignId },
    data: { outreachCreditCents },
  })

const balance = async () =>
  (
    await service.prisma.campaign.findUniqueOrThrow({
      where: { id: orgs.campaignId },
    })
  ).outreachCreditCents

const spine = (outreachId: number) =>
  service.prisma.outreach.findUniqueOrThrow({ where: { id: outreachId } })

beforeEach(async () => {
  stubAudienceFromRecipients(service.app.get(ContactsService), service.prisma)
  saveCardAndPlan.mockReset().mockResolvedValue({ outcome: 'scheduled' })
  capture.mockReset().mockImplementation(
    async (id: string, amount: number) =>
      ({
        id,
        object: 'payment_intent',
        status: 'succeeded',
        amount_received: amount,
      }) as Stripe.Response<Stripe.PaymentIntent>,
  )
  vi.spyOn(
    service.app.get(PaymentHoldsService),
    'saveCardAndPlan',
  ).mockImplementation(saveCardAndPlan)
  vi.spyOn(
    service.app.get(StripeService),
    'capturePaymentIntent',
  ).mockImplementation(capture)
  vi.spyOn(service.app.get(StripeService), 'cancelHold').mockResolvedValue(
    undefined,
  )
  vi.spyOn(service.app.get(AnalyticsService), 'track').mockResolvedValue(
    undefined as never,
  )
  vi.spyOn(service.app.get(SesService), 'deleteTemplate').mockResolvedValue()
  featureSpy = vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockResolvedValue(true)
  orgs = await createEmailOrgs(service.prisma, service.user.id)
  await setBalance(17500)
})

const confirm = (outreachId: number) =>
  service.client.post(
    `/v1/outreach/email/${outreachId}/confirm`,
    { paymentMethodId: 'pm_1' },
    {
      headers: { 'x-organization-slug': orgs.winSlug },
      validateStatus: () => true,
    },
  )

const draftSend = async (count: number) => {
  const sender = await createSender(service.prisma, orgs.winSlug)
  return createSend(service.prisma, {
    organizationSlug: orgs.winSlug,
    campaignId: orgs.campaignId,
    senderId: sender.id,
    emails: emails(count),
    date: addDays(new Date(), 5),
  })
}

describe('email confirm with outreach credit', () => {
  it('saves no card and holds nothing when credit covers the price', async () => {
    const { outreachId } = await draftSend(3)

    const res = await confirm(outreachId)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(saveCardAndPlan).not.toHaveBeenCalled()
    expect(
      await service.prisma.outreachPaymentHold.count({ where: { outreachId } }),
    ).toBe(0)
    const row = await spine(outreachId)
    expect(row.status).toBe(OutreachStatus.pending)
    expect(row.creditReservedCents).toBe(50)
    expect(await balance()).toBe(17450)
  })

  it('holds only the remainder when credit covers part of the price', async () => {
    await setBalance(100)
    const { outreachId } = await draftSend(400)

    await confirm(outreachId)

    expect(saveCardAndPlan).toHaveBeenCalledWith(
      expect.objectContaining({ outreachId, estimateCents: 300 }),
    )
    expect((await spine(outreachId)).creditReservedCents).toBe(100)
    expect(await balance()).toBe(0)
  })

  it('holds the full price and draws no credit with the flag off', async () => {
    featureSpy.mockImplementation(
      async ({ feature }: { feature: string }) =>
        feature !== WIN_PER_CAMPAIGN_PRICING_FLAG,
    )
    const { outreachId } = await draftSend(3)

    await confirm(outreachId)

    expect(saveCardAndPlan).toHaveBeenCalledWith(
      expect.objectContaining({ estimateCents: 50 }),
    )
    expect((await spine(outreachId)).creditReservedCents).toBe(0)
    expect(await balance()).toBe(17500)
  })

  it('returns the whole reserve when the send is canceled before it starts', async () => {
    const { outreachId } = await draftSend(3)
    await confirm(outreachId)
    expect(await balance()).toBe(17450)

    const res = await service.client.post(
      `/v1/outreach/email/${outreachId}/cancel`,
      {},
      { headers: { 'x-organization-slug': orgs.winSlug } },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(await balance()).toBe(17500)
    expect((await spine(outreachId)).creditSettledAt).not.toBeNull()
  })
})

describe('email draft with a reserve', () => {
  it('returns the reserve when a declined draft is deleted', async () => {
    const { outreachId } = await draftSend(3)
    await confirm(outreachId)
    await service.prisma.outreach.update({
      where: { id: outreachId },
      data: { status: OutreachStatus.draft },
    })
    expect(await balance()).toBe(17450)

    const row = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreachId },
      include: { robocall: true, email: { select: { imageUrl: true } } },
    })
    await service.app.get(OutreachDraftService).deleteDraftRow(row)

    expect(await balance()).toBe(17500)
  })

  it('keeps the reserve when the draft was converted before the delete', async () => {
    const { outreachId } = await draftSend(3)
    await confirm(outreachId)
    const row = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreachId },
      include: { robocall: true, email: { select: { imageUrl: true } } },
    })

    await service.app.get(OutreachDraftService).deleteDraftRow(row)

    expect(await balance()).toBe(17450)
    expect((await spine(outreachId)).creditSettledAt).toBeNull()
  })
})

describe('email send with outreach credit', () => {
  const lifecycle = () => service.app.get(OutreachEmailLifecycleService)

  // A send already confirmed with `reserved` cents of credit drawn, `sent` of
  // `total` recipients delivered half an hour ago and the rest failed.
  const finishedSend = async ({
    total,
    sent,
    reserved,
    hold,
  }: {
    total: number
    sent: number
    reserved: number
    hold?: { authorizedCents: number }
  }) => {
    const sender = await createSender(service.prisma, orgs.winSlug)
    const send = await createSend(service.prisma, {
      organizationSlug: orgs.winSlug,
      campaignId: orgs.campaignId,
      senderId: sender.id,
      emails: emails(total),
      status: OutreachStatus.in_progress,
      recipientCap: total,
      prepared: true,
    })
    const recipients = await service.prisma.outreachEmailRecipient.findMany({
      where: { outreachEmailId: send.outreachEmailId },
      orderBy: { id: 'asc' },
    })
    await service.prisma.outreachEmailRecipient.updateMany({
      where: { id: { in: recipients.slice(0, sent).map((r) => r.id) } },
      data: {
        status: OutreachEmailRecipientStatus.sent,
        sentAt: subMinutes(new Date(), 30),
      },
    })
    await service.prisma.outreachEmailRecipient.updateMany({
      where: { id: { in: recipients.slice(sent).map((r) => r.id) } },
      data: { status: OutreachEmailRecipientStatus.failed },
    })
    await service.prisma.outreachEmail.update({
      where: { id: send.outreachEmailId },
      data: { sentCount: sent },
    })
    await service.prisma.outreach.update({
      where: { id: send.outreachId },
      data: { creditReservedCents: reserved },
    })
    await setBalance(0)
    if (hold) {
      const row = await createHold(
        service.prisma,
        send.outreachId,
        OutreachHoldState.held,
      )
      await service.prisma.outreachPaymentHold.update({
        where: { id: row.id },
        data: { authorizedCents: hold.authorizedCents },
      })
    }
    return send
  }

  it('starts a fully covered send that has no hold', async () => {
    const sender = await createSender(service.prisma, orgs.winSlug)
    const { outreachId } = await createSend(service.prisma, {
      organizationSlug: orgs.winSlug,
      campaignId: orgs.campaignId,
      senderId: sender.id,
      emails: emails(3),
      status: OutreachStatus.pending,
      date: subMinutes(new Date(), 1),
      recipientCap: 3,
    })
    await service.prisma.outreach.update({
      where: { id: outreachId },
      data: { creditReservedCents: 50 },
    })

    await lifecycle().startDueSends()

    expect((await spine(outreachId)).status).toBe(OutreachStatus.in_progress)
  })

  it('lets staff cancel a covered send, then settles its credit', async () => {
    const { outreachId } = await finishedSend({
      total: 3,
      sent: 0,
      reserved: 50,
    })
    await service.prisma.outreachEmail.update({
      where: { outreachId },
      data: { preparedAt: null },
    })

    await service.app.get(OutreachEmailAdminService).cancel(outreachId)
    await service.prisma.outreachEmail.update({
      where: { outreachId },
      data: { preparedAt: new Date() },
    })
    await lifecycle().settleFinishedSends()

    expect(await balance()).toBe(50)
  })

  it('returns the reserve when a send fails to start', async () => {
    const sender = await createSender(service.prisma, orgs.winSlug)
    const { outreachId } = await createSend(service.prisma, {
      organizationSlug: orgs.winSlug,
      campaignId: orgs.campaignId,
      senderId: sender.id,
      emails: emails(3),
      status: OutreachStatus.pending,
      date: subMinutes(new Date(), 1),
      recipientCap: 3,
    })
    await service.prisma.outreach.update({
      where: { id: outreachId },
      data: { creditReservedCents: 50 },
    })
    await setBalance(0)
    await createHold(service.prisma, outreachId, OutreachHoldState.released)

    await lifecycle().startDueSends()

    expect((await spine(outreachId)).status).toBe(OutreachStatus.failed)
    expect(await balance()).toBe(50)
  })

  it('fails a send with no hold and no credit, as before', async () => {
    const sender = await createSender(service.prisma, orgs.winSlug)
    const { outreachId } = await createSend(service.prisma, {
      organizationSlug: orgs.winSlug,
      campaignId: orgs.campaignId,
      senderId: sender.id,
      emails: emails(3),
      status: OutreachStatus.pending,
      date: subMinutes(new Date(), 1),
      recipientCap: 3,
    })

    await lifecycle().startDueSends()

    expect((await spine(outreachId)).status).toBe(OutreachStatus.failed)
  })

  it('settles a fully covered send to what sent and returns the rest', async () => {
    const { outreachId } = await finishedSend({
      total: 400,
      sent: 100,
      reserved: 400,
    })

    await lifecycle().settleFinishedSends()

    expect(capture).not.toHaveBeenCalled()
    expect(await balance()).toBe(300)
    expect((await spine(outreachId)).status).toBe(OutreachStatus.completed)
    expect((await spine(outreachId)).creditSettledAt).not.toBeNull()
  })

  it('returns the whole reserve of a covered send that sent nothing', async () => {
    const { outreachId } = await finishedSend({
      total: 3,
      sent: 0,
      reserved: 50,
    })

    await lifecycle().settleFinishedSends()

    expect(await balance()).toBe(50)
    expect((await spine(outreachId)).status).toBe(OutreachStatus.canceled)
  })

  it('captures the card for what credit did not cover on a partly covered send', async () => {
    const { outreachId } = await finishedSend({
      total: 400,
      sent: 400,
      reserved: 100,
      hold: { authorizedCents: 300 },
    })

    await service.app.get(PaymentHoldsService).settle({ outreachId })

    expect(capture).toHaveBeenCalledWith(
      expect.any(String),
      300,
      expect.any(String),
    )
    expect(await balance()).toBe(0)
    expect((await spine(outreachId)).creditSettledAt).not.toBeNull()
  })

  it('captures less than authorized when the send cost less than the estimate', async () => {
    const { outreachId } = await finishedSend({
      total: 400,
      sent: 150,
      reserved: 100,
      hold: { authorizedCents: 300 },
    })

    await service.app.get(PaymentHoldsService).settle({ outreachId })

    expect(capture).toHaveBeenCalledWith(
      expect.any(String),
      50,
      expect.any(String),
    )
    expect(await balance()).toBe(0)
  })

  it('voids the hold and returns the unused credit when credit covers what sent', async () => {
    const { outreachId } = await finishedSend({
      total: 400,
      sent: 80,
      reserved: 100,
      hold: { authorizedCents: 300 },
    })

    await service.app.get(PaymentHoldsService).settle({ outreachId })

    expect(capture).not.toHaveBeenCalled()
    expect(await balance()).toBe(20)
    expect(
      (
        await service.prisma.outreachPaymentHold.findUniqueOrThrow({
          where: { outreachId },
        })
      ).state,
    ).toBe(OutreachHoldState.released)
  })

  it.each([130, 149])(
    'forgives a card remainder under 50 cents instead of capturing it (%i sent)',
    async (sent) => {
      // Stripe refuses a charge under its minimum: the capture it would get
      // here is the one production raises amount_too_small for.
      capture.mockRejectedValue(
        new StripeInvalidRequestError({
          type: 'invalid_request_error',
          code: 'amount_too_small',
          message: 'Amount must be at least 50 cents.',
        }),
      )
      const { outreachId } = await finishedSend({
        total: 400,
        sent,
        reserved: 100,
        hold: { authorizedCents: 300 },
      })

      await service.app.get(PaymentHoldsService).settle({ outreachId })

      expect(capture).not.toHaveBeenCalled()
      expect(await balance()).toBe(0)
      expect((await spine(outreachId)).creditSettledAt).not.toBeNull()
      expect(
        await service.prisma.outreachPaymentHold.findUniqueOrThrow({
          where: { outreachId },
        }),
      ).toMatchObject({ state: OutreachHoldState.released, capturedCents: 0 })
    },
  )

  it('captures as today for a send with no reserve', async () => {
    const { outreachId } = await finishedSend({
      total: 400,
      sent: 400,
      reserved: 0,
      hold: { authorizedCents: 400 },
    })

    await service.app.get(PaymentHoldsService).settle({ outreachId })

    expect(capture).toHaveBeenCalledWith(
      expect.any(String),
      400,
      expect.any(String),
    )
    expect((await spine(outreachId)).creditSettledAt).toBeNull()
  })
})
