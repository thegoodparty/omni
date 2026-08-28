import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { addDays, getUnixTime } from 'date-fns'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Stripe from 'stripe'
import { useTestService } from '@/test-service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { OutreachRobocallService } from '@/outreach/services/outreachRobocall.service'
import { OutreachRobocallHoldService } from '@/outreach/services/outreachRobocallHold.service'
import { OutreachRobocallDeferredHoldService } from '@/outreach/services/outreachRobocallDeferredHold.service'
import { Campaign, RobocallSettleState } from '../../generated/prisma'

const service = useTestService()

const paymentIntentsCreate = vi.fn()
const paymentIntentsCancel = vi.fn()
const paymentMethodsRetrieve = vi.fn()

let campaign: Campaign
let orgSlug: string
let filterId: number
let deferred: OutreachRobocallDeferredHoldService
let deriveSpy: ReturnType<typeof vi.spyOn>
let authorizeSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  const stripe = service.app.get(StripeService)
  const stripeClient = (stripe as unknown as { stripe: Stripe }).stripe
  vi.spyOn(stripeClient.paymentIntents, 'create').mockImplementation(
    paymentIntentsCreate,
  )
  vi.spyOn(stripeClient.paymentIntents, 'cancel').mockImplementation(
    paymentIntentsCancel,
  )
  vi.spyOn(stripeClient.paymentMethods, 'retrieve').mockImplementation(
    paymentMethodsRetrieve,
  )

  deferred = service.app.get(OutreachRobocallDeferredHoldService)
  deriveSpy = vi.spyOn(
    service.app.get(OutreachRobocallService),
    'deriveBillableCount',
  )
  authorizeSpy = vi.spyOn(
    service.app.get(OutreachRobocallHoldService),
    'authorizeHold',
  )
  vi.spyOn(service.app.get(AnalyticsService), 'track').mockResolvedValue(
    undefined as never,
  )

  const campaignId = 996
  orgSlug = `campaign-${campaignId}`

  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  campaign = await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe',
      isPro: true,
      details: { state: 'TX', city: 'Georgetown', zip: '78634' },
      data: {},
      aiContent: {},
    },
  })
  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug: orgSlug },
  })
  filterId = filter.id

  await service.prisma.user.update({
    where: { id: service.user.id },
    data: { metaData: { customerId: 'cus_test' } },
  })
})

const orgHeaders = () => ({ headers: { 'x-organization-slug': orgSlug } })

const createDraft = async ({
  sendInDays = 2,
  settleState = RobocallSettleState.pending_payment,
  paymentMethodId,
  stripeCustomerId,
  authorizedAmountInCents,
  authorizationIntentId,
}: {
  sendInDays?: number
  settleState?: RobocallSettleState
  paymentMethodId?: string
  stripeCustomerId?: string
  authorizedAmountInCents?: number
  authorizationIntentId?: string
} = {}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: 'pending_payment',
      date: addDays(new Date(), sendInDays),
      voterFileFilterId: filterId,
    },
  })
  await service.prisma.outreachRobocall.create({
    data: {
      outreachId: spine.id,
      audioKey: `robocall/996/${randomUUID()}.webm`,
      callbackNumber: '+15125550123',
      billableCount: 100,
      amountInCents: 450,
      settleState,
      ...(paymentMethodId ? { paymentMethodId } : {}),
      ...(stripeCustomerId ? { stripeCustomerId } : {}),
      ...(authorizedAmountInCents != null ? { authorizedAmountInCents } : {}),
      ...(authorizationIntentId ? { authorizationIntentId } : {}),
    },
  })
  return spine.id
}

const postAuthorize = (outreachId: number, paymentMethodId = 'pm_1') =>
  service.client.post(
    `/v1/outreach/robocall/${outreachId}/authorize`,
    { paymentMethodId },
    orgHeaders(),
  )

const readSatellite = (outreachId: number) =>
  service.prisma.outreachRobocall.findUniqueOrThrow({ where: { outreachId } })

const captureBeforeUnix = () => getUnixTime(addDays(new Date(), 7))

const mockHoldPlaced = () => {
  deriveSpy.mockResolvedValue(100)
  paymentMethodsRetrieve.mockResolvedValue({
    id: 'pm_1',
    customer: 'cus_test',
    type: 'card',
  })
  paymentIntentsCreate.mockResolvedValue({
    id: 'pi_hold_1',
    status: 'requires_capture',
    capture_before: captureBeforeUnix(),
  })
}

describe('authorize defers and persists the chosen card', () => {
  it('persists paymentMethodId + stripeCustomerId and places no hold', async () => {
    const outreachId = await createDraft({ sendInDays: 10 })
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_1',
      customer: 'cus_test',
      type: 'card',
    })

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.status).toBe('deferred')
    expect(paymentIntentsCreate).not.toHaveBeenCalled()

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
    expect(satellite.paymentMethodId).toBe('pm_1')
    expect(satellite.stripeCustomerId).toBe('cus_test')
  })

  it('rejects a PM on another customer and persists nothing', async () => {
    const outreachId = await createDraft({ sendInDays: 10 })
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_1',
      customer: 'cus_other',
      type: 'card',
    })

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.paymentMethodId).toBeNull()
    expect(satellite.stripeCustomerId).toBeNull()
  })

  it('rejects a non-card PM and persists nothing', async () => {
    const outreachId = await createDraft({ sendInDays: 10 })
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_bank',
      customer: 'cus_test',
      type: 'us_bank_account',
    })

    const res = await postAuthorize(outreachId, 'pm_bank')

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.paymentMethodId).toBeNull()
    expect(satellite.stripeCustomerId).toBeNull()
  })
})

describe('OutreachRobocallDeferredHoldService.sweepDeferredHolds (prod)', () => {
  const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT
  const originalFlag = process.env.ROBOCALL_DEFERRED_HOLD_ENABLED

  beforeEach(() => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
    process.env.ROBOCALL_DEFERRED_HOLD_ENABLED = 'true'
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
    if (originalFlag === undefined) {
      delete process.env.ROBOCALL_DEFERRED_HOLD_ENABLED
    } else {
      process.env.ROBOCALL_DEFERRED_HOLD_ENABLED = originalFlag
    }
  })

  it('places a hold for an in-window draft with a persisted card', async () => {
    const outreachId = await createDraft({
      sendInDays: 2,
      paymentMethodId: 'pm_1',
      stripeCustomerId: 'cus_test',
    })
    mockHoldPlaced()

    await deferred.sweepDeferredHolds()

    expect(authorizeSpy).toHaveBeenCalledTimes(1)
    expect(paymentIntentsCreate).toHaveBeenCalledTimes(1)
    // authorizeHold is called with the persisted card, never a guessed default.
    expect(authorizeSpy.mock.calls[0]?.[4]).toBe('pm_1')
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
    expect(satellite.authorizationIntentId).toBe('pi_hold_1')
  })

  it('skips a draft with no card, out-of-window, or already authorized', async () => {
    await createDraft({ sendInDays: 2 })
    await createDraft({
      sendInDays: 10,
      paymentMethodId: 'pm_1',
      stripeCustomerId: 'cus_test',
    })
    await createDraft({
      sendInDays: 2,
      settleState: RobocallSettleState.authorized,
      paymentMethodId: 'pm_1',
      stripeCustomerId: 'cus_test',
      authorizedAmountInCents: 450,
      authorizationIntentId: 'pi_existing',
    })
    mockHoldPlaced()

    await deferred.sweepDeferredHolds()

    expect(authorizeSpy).not.toHaveBeenCalled()
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('places no hold when the persisted card is stale/invalid at sweep time', async () => {
    const outreachId = await createDraft({
      sendInDays: 2,
      paymentMethodId: 'pm_1',
      stripeCustomerId: 'cus_test',
    })
    deriveSpy.mockResolvedValue(100)
    // The card the candidate chose at schedule time no longer belongs to the
    // customer (detached / re-vaulted), so authorizeHold's validation fails.
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_1',
      customer: 'cus_other',
      type: 'card',
    })

    await deferred.sweepDeferredHolds()

    // No hold is ever placed against a wrong/stale card, and the draft is left
    // in pending_payment (reverted by authorizeHold), never authorized.
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
    expect(satellite.authorizationIntentId).toBeNull()
  })

  it('marks a declined draft hold_failed and does not retry it next sweep', async () => {
    const outreachId = await createDraft({
      sendInDays: 2,
      paymentMethodId: 'pm_1',
      stripeCustomerId: 'cus_test',
    })
    deriveSpy.mockResolvedValue(100)
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_1',
      customer: 'cus_test',
      type: 'card',
    })
    paymentIntentsCreate.mockRejectedValue(
      new Stripe.errors.StripeCardError({
        type: 'card_error',
        message: 'Your card was declined.',
        code: 'card_declined',
      }),
    )

    await deferred.sweepDeferredHolds()

    // A decline is a business outcome: the draft lands in hold_failed, not a
    // stranded pending_payment that the sweep would keep retrying.
    expect(authorizeSpy).toHaveBeenCalledTimes(1)
    expect(paymentIntentsCreate).toHaveBeenCalledTimes(1)
    const afterFirst = await readSatellite(outreachId)
    expect(afterFirst.settleState).toBe(RobocallSettleState.hold_failed)

    // A hold_failed draft is no longer pending_payment, so the candidate query
    // excludes it — no daily retry storm on a declined card.
    await deferred.sweepDeferredHolds()
    expect(authorizeSpy).toHaveBeenCalledTimes(1)
    expect(paymentIntentsCreate).toHaveBeenCalledTimes(1)
  })

  it('is idempotent: a second sweep does not double-place', async () => {
    await createDraft({
      sendInDays: 2,
      paymentMethodId: 'pm_1',
      stripeCustomerId: 'cus_test',
    })
    mockHoldPlaced()

    await deferred.sweepDeferredHolds()
    // The now-authorized draft leaves the pending_payment candidate set, so the
    // second sweep selects it no more and places no second hold.
    await deferred.sweepDeferredHolds()

    expect(authorizeSpy).toHaveBeenCalledTimes(1)
    expect(paymentIntentsCreate).toHaveBeenCalledTimes(1)
  })
})

describe('OutreachRobocallDeferredHoldService.sweepDeferredHolds guard', () => {
  const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT
  const originalFlag = process.env.ROBOCALL_DEFERRED_HOLD_ENABLED

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
    if (originalFlag === undefined) {
      delete process.env.ROBOCALL_DEFERRED_HOLD_ENABLED
    } else {
      process.env.ROBOCALL_DEFERRED_HOLD_ENABLED = originalFlag
    }
  })

  it('no-ops off prod even with the flag on', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    process.env.ROBOCALL_DEFERRED_HOLD_ENABLED = 'true'
    await createDraft({
      sendInDays: 2,
      paymentMethodId: 'pm_1',
      stripeCustomerId: 'cus_test',
    })

    await deferred.sweepDeferredHolds()

    expect(authorizeSpy).not.toHaveBeenCalled()
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('no-ops on prod when the kill-switch is off', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
    delete process.env.ROBOCALL_DEFERRED_HOLD_ENABLED
    await createDraft({
      sendInDays: 2,
      paymentMethodId: 'pm_1',
      stripeCustomerId: 'cus_test',
    })

    await deferred.sweepDeferredHolds()

    expect(authorizeSpy).not.toHaveBeenCalled()
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
  })
})
