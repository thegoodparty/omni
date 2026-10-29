import { BadRequestException, HttpStatus } from '@nestjs/common'
import { addDays } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsService } from '@/analytics/analytics.service'
import { PaymentHoldsService } from '@/paymentHolds/services/paymentHolds.service'
import { useTestService } from '@/test-service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { OutreachHoldState, OutreachStatus } from '../../generated/prisma'
import {
  createEmailOrgs,
  createHold,
  createSend,
  createSender,
  EmailFixtureOrgs,
  emails,
} from './emailSendFixtures'

const service = useTestService()

const saveCardAndPlan = vi.fn()
const release = vi.fn()
const track = vi.fn()

let orgs: EmailFixtureOrgs

beforeEach(async () => {
  saveCardAndPlan.mockReset()
  release.mockReset().mockResolvedValue(undefined)
  track.mockReset().mockResolvedValue(undefined)
  const holds = service.app.get(PaymentHoldsService)
  vi.spyOn(holds, 'saveCardAndPlan').mockImplementation(saveCardAndPlan)
  vi.spyOn(holds, 'release').mockImplementation(release)
  vi.spyOn(service.app.get(AnalyticsService), 'track').mockImplementation(track)
  orgs = await createEmailOrgs(service.prisma, service.user.id)
})

const winHeaders = () => ({ 'x-organization-slug': orgs.winSlug })
const serveHeaders = () => ({ 'x-organization-slug': orgs.officeSlug })

const post = (path: string, body: object, headers: Record<string, string>) =>
  service.client.post(path, body, { headers, validateStatus: () => true })

const winSend = async (
  overrides: Partial<Parameters<typeof createSend>[1]> = {},
  senderOverrides: Parameters<typeof createSender>[2] = {},
) => {
  const sender = await createSender(
    service.prisma,
    orgs.winSlug,
    senderOverrides,
  )
  const send = await createSend(service.prisma, {
    organizationSlug: orgs.winSlug,
    campaignId: orgs.campaignId,
    senderId: sender.id,
    emails: emails(3),
    date: addDays(new Date(), 5),
    ...overrides,
  })
  return { sender, ...send }
}

describe('POST /v1/outreach/email/:id/confirm', () => {
  it('freezes the cap, prices it, and confirms a held send', async () => {
    saveCardAndPlan.mockResolvedValue({
      outcome: 'scheduled',
    })
    const { outreachId, outreachEmailId } = await winSend()

    const res = await post(
      `/v1/outreach/email/${outreachId}/confirm`,
      { paymentMethodId: 'pm_1' },
      winHeaders(),
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toMatchObject({
      outcome: 'scheduled',
      email: { status: 'pending', recipientCap: 3, estimate: null },
    })
    expect(saveCardAndPlan).toHaveBeenCalledWith({
      outreachId,
      userId: service.user.id,
      paymentMethodId: 'pm_1',
      estimateCents: 50,
    })
    const row = await service.prisma.outreachEmail.findUniqueOrThrow({
      where: { id: outreachEmailId },
    })
    expect(row.recipientCap).toBe(3)
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Email.SendCompleted,
      expect.objectContaining({
        mode: 'win',
        recipientCount: 3,
        recipientCap: 3,
        priceCents: 50,
        capped: false,
      }),
    )
  })

  it('takes off the cap other unfinished sends reserved', async () => {
    saveCardAndPlan.mockResolvedValue({ outcome: 'scheduled' })
    const { sender } = await winSend()
    await createSend(service.prisma, {
      organizationSlug: orgs.winSlug,
      campaignId: orgs.campaignId,
      senderId: sender.id,
      emails: [],
      status: OutreachStatus.pending,
      recipientCap: 998,
    })
    const second = await createSend(service.prisma, {
      organizationSlug: orgs.winSlug,
      campaignId: orgs.campaignId,
      senderId: sender.id,
      emails: emails(5),
      date: addDays(new Date(), 5),
    })

    const draft = await service.client.get(
      `/v1/outreach/email/${second.outreachId}`,
      { headers: winHeaders() },
    )
    expect(draft.data.estimate).toEqual({
      warmingCap: 1000,
      recipientCap: 2,
      priceCents: 50,
    })

    const res = await post(
      `/v1/outreach/email/${second.outreachId}/confirm`,
      { paymentMethodId: 'pm_1' },
      winHeaders(),
    )
    expect(res.data.email.recipientCap).toBe(2)
    expect(res.data.email.recipientCount).toBe(5)
  })

  it('refuses when other sends use the whole warming step', async () => {
    const { sender } = await winSend()
    await createSend(service.prisma, {
      organizationSlug: orgs.winSlug,
      campaignId: orgs.campaignId,
      senderId: sender.id,
      emails: [],
      status: OutreachStatus.in_progress,
      recipientCap: 1000,
    })
    const second = await createSend(service.prisma, {
      organizationSlug: orgs.winSlug,
      campaignId: orgs.campaignId,
      senderId: sender.id,
      emails: emails(2),
      date: addDays(new Date(), 5),
    })
    const res = await post(
      `/v1/outreach/email/${second.outreachId}/confirm`,
      { paymentMethodId: 'pm_1' },
      winHeaders(),
    )
    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(saveCardAndPlan).not.toHaveBeenCalled()
  })

  it('requires Pro on Win', async () => {
    const notPro = await createEmailOrgs(service.prisma, service.user.id, {
      isPro: false,
    })
    const sender = await createSender(service.prisma, notPro.winSlug)
    const send = await createSend(service.prisma, {
      organizationSlug: notPro.winSlug,
      campaignId: notPro.campaignId,
      senderId: sender.id,
      emails: emails(2),
    })
    const res = await post(
      `/v1/outreach/email/${send.outreachId}/confirm`,
      { paymentMethodId: 'pm_1' },
      { 'x-organization-slug': notPro.winSlug },
    )
    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('requires consent and at least one recipient', async () => {
    const noConsent = await winSend({ consent: false })
    expect(
      (
        await post(
          `/v1/outreach/email/${noConsent.outreachId}/confirm`,
          { paymentMethodId: 'pm_1' },
          winHeaders(),
        )
      ).status,
    ).toBe(HttpStatus.BAD_REQUEST)

    const empty = await winSend({ emails: [] })
    expect(
      (
        await post(
          `/v1/outreach/email/${empty.outreachId}/confirm`,
          { paymentMethodId: 'pm_1' },
          winHeaders(),
        )
      ).status,
    ).toBe(HttpStatus.BAD_REQUEST)
    expect(saveCardAndPlan).not.toHaveBeenCalled()
  })

  it('keeps a declined send a draft, then confirms it once the card works', async () => {
    saveCardAndPlan.mockResolvedValueOnce({
      outcome: 'declined',
      declineCode: 'insufficient_funds',
    })
    const { outreachId, outreachEmailId } = await winSend()

    const declined = await post(
      `/v1/outreach/email/${outreachId}/confirm`,
      { paymentMethodId: 'pm_1' },
      winHeaders(),
    )
    expect(declined.status).toBe(HttpStatus.PAYMENT_REQUIRED)
    expect(declined.data).toMatchObject({ declineCode: 'insufficient_funds' })
    const outreach = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreachId },
    })
    expect(outreach.status).toBe(OutreachStatus.draft)
    const email = await service.prisma.outreachEmail.findUniqueOrThrow({
      where: { id: outreachEmailId },
    })
    expect(email.recipientCap).toBeNull()
    expect(track).not.toHaveBeenCalled()

    saveCardAndPlan.mockResolvedValueOnce({
      outcome: 'held',
      captureBefore: addDays(new Date(), 4),
    })
    const retried = await post(
      `/v1/outreach/email/${outreachId}/confirm`,
      { paymentMethodId: 'pm_2' },
      winHeaders(),
    )
    expect(retried.data).toMatchObject({
      outcome: 'held',
      email: { status: 'pending' },
    })
    expect(track).toHaveBeenCalledTimes(1)
  })

  it('returns the draft to editing when the hold module refuses before holding', async () => {
    saveCardAndPlan.mockRejectedValue(
      new BadRequestException('This card belongs to another customer'),
    )
    const { outreachId, outreachEmailId } = await winSend()
    const res = await post(
      `/v1/outreach/email/${outreachId}/confirm`,
      { paymentMethodId: 'pm_1' },
      winHeaders(),
    )
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    const outreach = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreachId },
    })
    expect(outreach.status).toBe(OutreachStatus.draft)
    const email = await service.prisma.outreachEmail.findUniqueOrThrow({
      where: { id: outreachEmailId },
    })
    expect(email.recipientCap).toBeNull()
  })

  it('sends a dateless draft a minute out', async () => {
    saveCardAndPlan.mockResolvedValue({
      outcome: 'held',
      captureBefore: addDays(new Date(), 4),
    })
    const { outreachId } = await winSend({ date: null })
    await post(
      `/v1/outreach/email/${outreachId}/confirm`,
      { paymentMethodId: 'pm_1' },
      winHeaders(),
    )
    const outreach = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreachId },
    })
    expect(outreach.date).not.toBeNull()
    expect(outreach.date?.getTime()).toBeGreaterThan(Date.now())
  })

  it('confirms a Serve send without Pro', async () => {
    saveCardAndPlan.mockResolvedValue({ outcome: 'scheduled' })
    const sender = await createSender(service.prisma, orgs.officeSlug)
    const { outreachId } = await createSend(service.prisma, {
      organizationSlug: orgs.officeSlug,
      campaignId: null,
      senderId: sender.id,
      emails: emails(2),
      date: addDays(new Date(), 5),
    })
    const res = await post(
      `/v1/outreach/serve/email/${outreachId}/confirm`,
      { paymentMethodId: 'pm_1' },
      serveHeaders(),
    )
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.email.status).toBe('pending')

    const crossProduct = await post(
      `/v1/outreach/email/${outreachId}/confirm`,
      { paymentMethodId: 'pm_1' },
      winHeaders(),
    )
    expect(crossProduct.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('POST /v1/outreach/email/:id/cancel', () => {
  it('cancels a scheduled send and releases its hold', async () => {
    const { outreachId } = await winSend({ status: OutreachStatus.pending })
    await createHold(service.prisma, outreachId, OutreachHoldState.scheduled)
    const res = await post(
      `/v1/outreach/email/${outreachId}/cancel`,
      {},
      winHeaders(),
    )
    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.status).toBe('canceled')
    expect(release).toHaveBeenCalledWith({ outreachId })
  })

  it('marks a running send stopping for the settle sweep', async () => {
    const sender = await createSender(service.prisma, orgs.officeSlug)
    const { outreachId } = await createSend(service.prisma, {
      organizationSlug: orgs.officeSlug,
      campaignId: null,
      senderId: sender.id,
      emails: emails(2),
      status: OutreachStatus.in_progress,
      prepared: true,
    })
    const res = await post(
      `/v1/outreach/serve/email/${outreachId}/cancel`,
      {},
      serveHeaders(),
    )
    expect(res.data).toMatchObject({ status: 'in_progress', stopping: true })
    expect(release).not.toHaveBeenCalled()
  })

  it('refuses a draft or a finished send', async () => {
    const { outreachId } = await winSend()
    const res = await post(
      `/v1/outreach/email/${outreachId}/cancel`,
      {},
      winHeaders(),
    )
    expect(res.status).toBe(HttpStatus.CONFLICT)
  })
})
