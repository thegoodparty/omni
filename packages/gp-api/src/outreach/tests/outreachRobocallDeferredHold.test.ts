import { randomUUID } from 'node:crypto'
import { BadRequestException, HttpStatus } from '@nestjs/common'
import { addDays, getUnixTime } from 'date-fns'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Stripe from 'stripe'
import { useTestService } from '@/test-service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { OutreachRobocallService } from '@/outreach/services/outreachRobocall.service'
import {
  OutreachRobocallHoldService,
  RobocallCardError,
} from '@/outreach/services/outreachRobocallHold.service'
import { OutreachRobocallDeferredHoldService } from '@/outreach/services/outreachRobocallDeferredHold.service'
import { HubspotSingleSendService } from '@/crm/hubspotSingleSend.service'
import { EVENTS } from '@/vendors/segment/segment.types'
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
let trackSpy: ReturnType<typeof vi.spyOn>
let singleSendSpy: ReturnType<typeof vi.spyOn>

afterEach(() => {
  vi.unstubAllEnvs()
})

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
  trackSpy = vi
    .spyOn(service.app.get(AnalyticsService), 'track')
    .mockResolvedValue(undefined as never)
  singleSendSpy = vi
    .spyOn(service.app.get(HubspotSingleSendService), 'sendSingleSend')
    .mockResolvedValue(undefined as never)

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

  it('persist is pending_payment-guarded: never clobbers an advanced row', async () => {
    // Proves the defer-persist is a CAS on settleState = pending_payment. If a
    // concurrent request advances the row (here pre-set to authorized) while the
    // two async Stripe validations run, the persist must not overwrite the card
    // on the already-authorized row — AND the return must report the row's live
    // state, not a stale 'deferred' that would claim no hold exists when one does.
    const outreachId = await createDraft({
      sendInDays: 10,
      settleState: RobocallSettleState.authorized,
      paymentMethodId: 'pm_existing',
      stripeCustomerId: 'cus_test',
      authorizedAmountInCents: 450,
      authorizationIntentId: 'pi_existing',
    })
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_new',
      customer: 'cus_test',
      type: 'card',
    })

    const res = await postAuthorize(outreachId, 'pm_new')

    expect(res.status).toBe(HttpStatus.CREATED)
    // The persist CAS matched 0 rows, so the response reflects the live state
    // (authorized + its frozen amount), never a stale 'deferred'.
    expect(res.data).toEqual({
      status: 'authorized',
      settleState: RobocallSettleState.authorized,
      authorizedAmountInCents: 450,
    })
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
    // The authorized row's card is left intact — 'pm_new' never overwrote it.
    const satellite = await readSatellite(outreachId)
    expect(satellite.paymentMethodId).toBe('pm_existing')
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
  })
})

describe('OutreachRobocallDeferredHoldService.sweepDeferredHolds (prod)', () => {
  const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT

  beforeEach(() => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
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
    // The sweep passes NO paymentMethodId — authorizeHold sources the card from
    // the row it claimed, so the sweep can't bill a stale snapshot.
    expect(authorizeSpy.mock.calls[0]?.[4]).toBeUndefined()
    // The hold is placed against the row's persisted card.
    expect(paymentIntentsCreate.mock.calls[0]?.[0]?.payment_method).toBe('pm_1')
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
    expect(satellite.authorizationIntentId).toBe('pi_hold_1')
    expect(satellite.paymentMethodId).toBe('pm_1')
  })

  it('bills the row current card, not the pre-claim snapshot', async () => {
    const outreachId = await createDraft({
      sendInDays: 2,
      paymentMethodId: 'pm_old',
      stripeCustomerId: 'cus_test',
    })
    // A concurrent re-authorize replaces the persisted card AFTER the sweep's
    // findMany snapshot but before the placement re-read. Injected via the
    // post-claim deriveBillableCount (which runs after the claim, before the
    // re-read) so the re-read observes the NEW card the candidate just chose.
    deriveSpy.mockImplementation(async () => {
      await service.prisma.outreachRobocall.updateMany({
        where: { outreachId },
        data: { paymentMethodId: 'pm_new' },
      })
      return 100
    })
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_new',
      customer: 'cus_test',
      type: 'card',
    })
    paymentIntentsCreate.mockResolvedValue({
      id: 'pi_hold_new',
      status: 'requires_capture',
      capture_before: captureBeforeUnix(),
    })

    await deferred.sweepDeferredHolds()

    // The hold (and the retrieve validation) use the RE-READ card, never the
    // stale 'pm_old' snapshot the sweep selected.
    expect(paymentMethodsRetrieve).toHaveBeenCalledWith('pm_new')
    expect(paymentIntentsCreate.mock.calls[0]?.[0]?.payment_method).toBe(
      'pm_new',
    )
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
    expect(satellite.paymentMethodId).toBe('pm_new')
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

  it('escalates a stale/invalid persisted card to hold_failed and stops retrying', async () => {
    const outreachId = await createDraft({
      sendInDays: 2,
      paymentMethodId: 'pm_stale',
      stripeCustomerId: 'cus_test',
    })
    deriveSpy.mockResolvedValue(100)
    // The card the candidate chose at schedule time no longer belongs to the
    // customer (detached / re-vaulted), so authorizeHold's validation hits a
    // RobocallCardError and — on the deferred path — escalates it to hold_failed
    // ATOMICALLY inside authorizeHold (returns hold_failed, does not throw), with
    // no separate sweep-level escalation call that could independently fail.
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_stale',
      customer: 'cus_other',
      type: 'card',
    })

    await deferred.sweepDeferredHolds()

    // No hold is placed against a wrong/stale card, and the draft is escalated
    // to hold_failed (leaves the pending_payment candidate set) with a single
    // HoldFailed milestone so the absent candidate is emailed to fix their card.
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.hold_failed)
    expect(satellite.authorizationIntentId).toBeNull()
    expect(trackSpy).toHaveBeenCalledTimes(1)
    expect(trackSpy.mock.calls[0]?.[1]).toBe(EVENTS.Robocall.HoldFailed)

    // A second sweep must not re-select or re-notify: hold_failed is out of the
    // pending_payment candidate set, so no daily retry storm on a dead card.
    await deferred.sweepDeferredHolds()
    expect(authorizeSpy).toHaveBeenCalledTimes(1)
    expect(trackSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT escalate a zero-audience failure; stays pending_payment', async () => {
    const outreachId = await createDraft({
      sendInDays: 2,
      paymentMethodId: 'pm_1',
      stripeCustomerId: 'cus_test',
    })
    // A zero-reachable-landline audience makes assertReachableCount throw a
    // plain BadRequestException (NOT a card problem). The sweep must not
    // terminate the run: no hold_failed, no HoldFailed email — the draft stays
    // pending_payment and is re-selectable next pass.
    deriveSpy.mockResolvedValue(0)

    await deferred.sweepDeferredHolds()

    expect(paymentIntentsCreate).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
    expect(trackSpy).not.toHaveBeenCalled()

    // Still a candidate on the next sweep — nothing terminated it.
    await deferred.sweepDeferredHolds()
    expect(authorizeSpy).toHaveBeenCalledTimes(2)
  })

  it('does NOT escalate a transient infra failure; stays pending_payment', async () => {
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
    // A non-decline Stripe/infra error is a transient 502 in authorizeHold — it
    // reverts to pending_payment and rethrows. The sweep must NOT terminate the
    // run: no hold_failed, no HoldFailed; the draft retries next pass.
    paymentIntentsCreate.mockRejectedValue(new Error('network down'))

    await deferred.sweepDeferredHolds()

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
    expect(trackSpy).not.toHaveBeenCalled()

    // Re-selectable next pass — nothing terminated it.
    await deferred.sweepDeferredHolds()
    expect(authorizeSpy).toHaveBeenCalledTimes(2)
  })

  it('reschedule-race defer branch throws a non-card error (not escalated)', async () => {
    // The sweep calls authorizeHold with NO paymentMethodId. If a reschedule
    // pushed the send back out of the window between the sweep's findMany and
    // authorizeHold's read, the defer branch fires with no PM and throws the
    // plain "payment method required" BadRequestException — NOT a
    // RobocallCardError. The sweep classifier keys on RobocallCardError, so this
    // is rethrown (logged, retried), never escalated to hold_failed. Exercised
    // directly on an out-of-window draft: the same defer branch the race hits.
    const holds = service.app.get(OutreachRobocallHoldService)
    const outreachId = await createDraft({
      sendInDays: 10,
      paymentMethodId: 'pm_1',
      stripeCustomerId: 'cus_test',
    })
    const user = await service.prisma.user.findUniqueOrThrow({
      where: { id: service.user.id },
    })
    const organization = await service.prisma.organization.findUniqueOrThrow({
      where: { slug: orgSlug },
    })

    const error = await holds
      .authorizeHold(user, campaign, organization, outreachId)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(BadRequestException)
    expect(error).not.toBeInstanceOf(RobocallCardError)
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
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

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
  })

  it('no-ops off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
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

describe('OutreachRobocallDeferredHoldService.sweepExpiredDeferred (prod)', () => {
  const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT

  beforeEach(() => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
  })

  it('cancels a deferred draft whose send passed', async () => {
    const outreachId = await createDraft({
      sendInDays: -1,
      paymentMethodId: 'pm_1',
      stripeCustomerId: 'cus_test',
    })
    // A card-saved deferred draft is visible in history (spine `pending`) from
    // the pay step; canceling must hide it, not leave it as "In review".
    await service.prisma.outreach.update({
      where: { id: outreachId },
      data: { status: 'pending' },
    })

    await deferred.sweepExpiredDeferred()

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.cancelled)
    const spine = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreachId },
    })
    expect(spine.status).toBe('canceled')
    // The absent candidate is told the run was canceled — exactly once.
    expect(trackSpy).toHaveBeenCalledTimes(1)
    expect(trackSpy.mock.calls[0]?.[1]).toBe(EVENTS.Robocall.Canceled)
    expect(trackSpy.mock.calls[0]?.[4]).toBe(`${outreachId}:canceled`)
    // HUBSPOT_ROBOCALL_CANCELED_EMAIL_ID unset by default — no single-send.
    expect(singleSendSpy).not.toHaveBeenCalled()
  })

  it('sends the Canceled single-send email with the missed send date, even if the send itself fails', async () => {
    vi.stubEnv('HUBSPOT_ROBOCALL_CANCELED_EMAIL_ID', '4248')
    singleSendSpy.mockRejectedValue(new Error('hubspot down'))
    const outreachId = await createDraft({
      sendInDays: -1,
      paymentMethodId: 'pm_1',
      stripeCustomerId: 'cus_test',
    })
    const scheduledAt = (
      await service.prisma.outreach.findUniqueOrThrow({
        where: { id: outreachId },
      })
    ).date!.toISOString()

    await deferred.sweepExpiredDeferred()

    // A HubSpot failure must not corrupt the already-committed cancel.
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.cancelled)
    expect(singleSendSpy).toHaveBeenCalledTimes(1)
    expect(singleSendSpy).toHaveBeenCalledWith({
      emailId: 4248,
      to: service.user.email,
      customProperties: {
        outreach_id: String(outreachId),
        scheduled_at: scheduledAt,
      },
    })
  })

  it('does not cancel a deferred draft still in the window', async () => {
    const outreachId = await createDraft({
      sendInDays: 2,
      paymentMethodId: 'pm_1',
      stripeCustomerId: 'cus_test',
    })

    await deferred.sweepExpiredDeferred()

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
    expect(trackSpy).not.toHaveBeenCalled()
  })

  it('cancels once under a concurrent double-run (CAS)', async () => {
    const outreachId = await createDraft({
      sendInDays: -1,
      paymentMethodId: 'pm_1',
      stripeCustomerId: 'cus_test',
    })

    await Promise.all([
      deferred.sweepExpiredDeferred(),
      deferred.sweepExpiredDeferred(),
    ])

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.cancelled)
    // The single-owner CAS elects one canceller, so the email fires exactly once.
    expect(trackSpy).toHaveBeenCalledTimes(1)
  })
})

describe('OutreachRobocallDeferredHoldService.sweepExpiredDeferred guard', () => {
  const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
  })

  it('no-ops off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    const outreachId = await createDraft({
      sendInDays: -1,
      paymentMethodId: 'pm_1',
      stripeCustomerId: 'cus_test',
    })

    await deferred.sweepExpiredDeferred()

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
    expect(trackSpy).not.toHaveBeenCalled()
  })
})
