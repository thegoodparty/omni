/**
 * Robocall prepay-on-estimate purchase flow (draft-first, server-derived).
 *
 * Contract under test:
 *   - POST /v1/outreach/robocall persists a pending_payment spine + satellite
 *     BEFORE checkout and returns the SERVER-derived landline count + amount.
 *   - The billable count comes from the audience (voterFileFilterId) with the
 *     landline dimension forced — never a client-supplied count.
 *   - calculateAmount re-derives the amount live at checkout (the snapshot
 *     persisted at draft is not trusted for billing).
 *   - The Stripe checkout session carries the amount + outreachId metadata.
 *   - The payment webhook finalizes pending_payment -> paid, idempotently, and
 *     fails loud on an unknown/foreign draft.
 */

import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { PeopleListResponse } from '@/contacts/schemas/person.schema'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { PurchaseService } from '@/payments/services/purchase.service'
import { PurchaseType } from '@/payments/purchase.types'
import { calcRobocallAmountInCents } from '@/shared/util/robocallPricing.util'
import { OutreachStatus, OutreachType } from '../../generated/prisma'
import { OutreachRobocallService } from '../services/outreachRobocall.service'
import { OutreachRobocallPurchaseService } from '../services/outreachRobocallPurchase.service'

const service = useTestService()

const findContactsForFilter = vi.fn()
const createCustomCheckoutSession = vi.fn()

let orgSlug: string
let filterId: number

const CAMPAIGN_ID = 998

const peopleListWithTotal = (totalResults: number): PeopleListResponse => ({
  people: [],
  pagination: {
    totalResults,
    currentPage: 1,
    pageSize: 1,
    totalPages: totalResults > 0 ? 1 : 0,
    hasNextPage: false,
    hasPreviousPage: false,
  },
})

beforeEach(async () => {
  const contacts = service.app.get(ContactsService)
  vi.spyOn(contacts, 'findContactsForFilter').mockImplementation(
    findContactsForFilter,
  )
  const stripe = service.app.get(StripeService)
  vi.spyOn(stripe, 'createCustomCheckoutSession').mockImplementation(
    createCustomCheckoutSession,
  )

  createCustomCheckoutSession.mockResolvedValue({
    id: 'cs_test_robocall',
    clientSecret: 'cs_secret_robocall',
    amount: 0,
  })

  orgSlug = `campaign-${CAMPAIGN_ID}`

  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })

  await service.prisma.campaign.create({
    data: {
      id: CAMPAIGN_ID,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe',
      isPro: true,
      details: { state: 'TX', zip: '78634' },
      data: {},
      aiContent: {},
    },
  })

  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug: orgSlug, name: 'saved list' },
  })
  filterId = filter.id
})

const orgHeaders = () => ({ headers: { 'x-organization-slug': orgSlug } })

const validDraftBody = () => ({
  voterFileFilterId: filterId,
  audioKey: `robocall/${CAMPAIGN_ID}/clip.webm`,
  callbackNumber: '+15125550123',
  scheduledAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  script: 'This is Jane Doe. Paid for by Jane for Council, 512-555-0123.',
})

const postDraft = (body: object) =>
  service.client.post('/v1/outreach/robocall', body, orgHeaders())

describe('POST /v1/outreach/robocall — draft-first create', () => {
  it('persists a pending_payment spine + satellite with the server count', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))

    const res = await postDraft(validDraftBody())

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      outreachId: expect.any(Number),
      billableCount: 500,
      amountInCents: calcRobocallAmountInCents(500),
    })

    // The count is derived with the landline dimension forced on.
    expect(findContactsForFilter).toHaveBeenCalledWith(
      expect.objectContaining({ hasLandline: true }),
      { resultsPerPage: 1, page: 1 },
      expect.objectContaining({ slug: orgSlug }),
    )

    const spine = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: res.data.outreachId },
      include: { robocall: true },
    })
    expect(spine.outreachType).toBe(OutreachType.robocall)
    expect(spine.status).toBe(OutreachStatus.pending_payment)
    expect(spine.voterFileFilterId).toBe(filterId)
    expect(spine.robocall).toMatchObject({
      audioKey: `robocall/${CAMPAIGN_ID}/clip.webm`,
      callbackNumber: '+15125550123',
      billableCount: 500,
      amountInCents: calcRobocallAmountInCents(500),
    })
  })

  it('hides the unpaid draft from the outreach listing', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))
    await postDraft(validDraftBody())

    const list = await service.client.get('/v1/outreach', {
      params: { campaignId: CAMPAIGN_ID },
      ...orgHeaders(),
    })
    expect(list.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('rejects an audioKey from another campaign', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))

    const res = await postDraft({
      ...validDraftBody(),
      audioKey: 'robocall/12345/clip.webm',
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    const rows = await service.prisma.outreach.count({
      where: { campaignId: CAMPAIGN_ID },
    })
    expect(rows).toBe(0)
  })

  it('rejects a filter that is not the org’s', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))

    const res = await postDraft({
      ...validDraftBody(),
      voterFileFilterId: filterId + 9999,
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  // A zero-landline audience derives a 0 amount, which the payments
  // free-checkout path (amount === 0) would settle as a free "paid" robocall
  // with no Stripe charge. Reject it before any draft is persisted.
  it('rejects an audience with no reachable landlines', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(0))

    const res = await postDraft(validDraftBody())

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    const rows = await service.prisma.outreach.count({
      where: { campaignId: CAMPAIGN_ID },
    })
    expect(rows).toBe(0)
  })

  // A past send time can never dial at CallHub, so a paid draft on it would be
  // money taken for a robocall that never sends — reject before any DB write.
  it('rejects a scheduledAt in the past', async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))

    const res = await postDraft({
      ...validDraftBody(),
      scheduledAt: new Date(Date.now() - 86_400_000).toISOString(),
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    const rows = await service.prisma.outreach.count({
      where: { campaignId: CAMPAIGN_ID },
    })
    expect(rows).toBe(0)
  })
})

describe('robocall purchase handler — server-derived billing', () => {
  const draftARow = async (snapshotCount: number) => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(snapshotCount))
    const res = await postDraft(validDraftBody())
    return res.data.outreachId as number
  }

  it('calculateAmount re-derives live and ignores the persisted snapshot', async () => {
    // Draft persisted a 500-count snapshot...
    const outreachId = await draftARow(500)

    // ...but the audience now resolves to a different landline count.
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(4321))

    const handler = service.app.get(OutreachRobocallPurchaseService)
    const amount = await handler.calculateAmount({
      outreachId,
      campaignId: CAMPAIGN_ID,
    })

    expect(amount).toBe(calcRobocallAmountInCents(4321))
  })

  it('calculateAmount rejects an audience that emptied to zero landlines', async () => {
    const outreachId = await draftARow(500)

    // The audience now resolves to no landlines — a 0 amount here would slip
    // through the payments free-checkout path, so it must throw instead.
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(0))

    const handler = service.app.get(OutreachRobocallPurchaseService)
    await expect(
      handler.calculateAmount({ outreachId, campaignId: CAMPAIGN_ID }),
    ).rejects.toThrow()
  })

  it('both checkout gates reject a draft with a lapsed or missing schedule', async () => {
    const outreachId = await draftARow(500)
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))
    const handler = service.app.get(OutreachRobocallPurchaseService)

    // The create-time guard forces a future date; simulate the schedule
    // lapsing while the buyer sits on the checkout page.
    await service.prisma.outreach.update({
      where: { id: outreachId },
      data: { date: new Date(Date.now() - 3_600_000) },
    })
    await expect(
      handler.calculateAmount({ outreachId, campaignId: CAMPAIGN_ID }),
    ).rejects.toThrow()
    await expect(
      handler.validatePurchase({ outreachId, campaignId: CAMPAIGN_ID }),
    ).rejects.toThrow()

    // A null date is a corrupt draft (the spine's date is nullable) — it must
    // be rejected, not short-circuit the guard into a pass.
    await service.prisma.outreach.update({
      where: { id: outreachId },
      data: { date: null },
    })
    await expect(
      handler.validatePurchase({ outreachId, campaignId: CAMPAIGN_ID }),
    ).rejects.toThrow()
  })

  it('createCheckoutSession bills the derived amount and carries outreachId', async () => {
    const outreachId = await draftARow(1000)
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(1000))
    createCustomCheckoutSession.mockResolvedValue({
      id: 'cs_test_robocall',
      clientSecret: 'cs_secret_robocall',
      amount: calcRobocallAmountInCents(1000),
    })

    const purchases = service.app.get(PurchaseService)
    await purchases.createCheckoutSession({
      user: service.user,
      dto: { type: PurchaseType.ROBOCALL, metadata: { outreachId } },
      metadata: { campaignId: CAMPAIGN_ID, organizationSlug: orgSlug },
    })

    expect(createCustomCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: service.user.id }),
      expect.objectContaining({
        purchaseType: PurchaseType.ROBOCALL,
        amount: calcRobocallAmountInCents(1000),
        productName: 'Robocall',
        metadata: expect.objectContaining({
          outreachId,
          campaignId: CAMPAIGN_ID,
        }),
      }),
    )
  })

  it('validatePurchase rejects an unknown draft and a re-checkout of a paid one', async () => {
    const outreachId = await draftARow(500)
    const handler = service.app.get(OutreachRobocallPurchaseService)

    await expect(
      handler.validatePurchase({
        outreachId: outreachId + 9999,
        campaignId: CAMPAIGN_ID,
      }),
    ).rejects.toThrow()

    await service.prisma.outreach.update({
      where: { id: outreachId },
      data: { status: OutreachStatus.paid },
    })
    await expect(
      handler.validatePurchase({ outreachId, campaignId: CAMPAIGN_ID }),
    ).rejects.toThrow()
  })
})

describe('robocall purchase finalize — webhook', () => {
  const draftARow = async () => {
    findContactsForFilter.mockResolvedValue(peopleListWithTotal(500))
    const res = await postDraft(validDraftBody())
    return res.data.outreachId as number
  }

  it('claims pending_payment -> paid and no-ops on repeat', async () => {
    const outreachId = await draftARow()
    const robocall = service.app.get(OutreachRobocallService)

    await robocall.finalizeRobocallPurchase(outreachId, CAMPAIGN_ID)
    const paid = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreachId },
    })
    expect(paid.status).toBe(OutreachStatus.paid)

    // Idempotent: a replayed webhook is a no-op, not a throw.
    await expect(
      robocall.finalizeRobocallPurchase(outreachId, CAMPAIGN_ID),
    ).resolves.toBeUndefined()
  })

  it('throws for a missing draft or one owned by another campaign', async () => {
    const outreachId = await draftARow()
    const robocall = service.app.get(OutreachRobocallService)

    await expect(
      robocall.finalizeRobocallPurchase(outreachId, CAMPAIGN_ID + 1),
    ).rejects.toThrow()
    await expect(
      robocall.finalizeRobocallPurchase(outreachId + 9999, CAMPAIGN_ID),
    ).rejects.toThrow()

    const stillDraft = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreachId },
    })
    expect(stillDraft.status).toBe(OutreachStatus.pending_payment)
  })

  it('executePostPurchase throws on unparseable metadata, then finalizes a valid one', async () => {
    const outreachId = await draftARow()
    const handler = service.app.get(OutreachRobocallPurchaseService)

    // Corrupt ROBOCALL metadata must throw so completeCheckoutSession does not
    // stamp its idempotency marker — otherwise Stripe stops retrying and the
    // draft is stuck pending_payment with no recovery path.
    await expect(
      handler.executePostPurchase('pi_test', { purchaseType: 'TEXT' }),
    ).rejects.toThrow()

    await handler.executePostPurchase('pi_test', {
      outreachId: String(outreachId),
      campaignId: String(CAMPAIGN_ID),
    })
    const paid = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreachId },
    })
    expect(paid.status).toBe(OutreachStatus.paid)
  })
})
