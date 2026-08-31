import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { addDays, getUnixTime } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Stripe from 'stripe'
import { useTestService } from '@/test-service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { OutreachRobocallService } from '@/outreach/services/outreachRobocall.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { Campaign, RobocallSettleState } from '../../generated/prisma'

const service = useTestService()

const paymentIntentsCreate = vi.fn()
const paymentIntentsCancel = vi.fn()
const paymentMethodsRetrieve = vi.fn()

let campaign: Campaign
let orgSlug: string
let filterId: number
let deriveSpy: ReturnType<typeof vi.spyOn>
let trackSpy: ReturnType<typeof vi.spyOn>

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

  deriveSpy = vi.spyOn(
    service.app.get(OutreachRobocallService),
    'deriveBillableCount',
  )
  trackSpy = vi
    .spyOn(service.app.get(AnalyticsService), 'track')
    .mockResolvedValue(undefined as never)

  const campaignId = 997
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
  payAttempt = 0,
  authorizedAmountInCents,
  authorizationIntentId,
  paymentMethodId,
  stripeCustomerId,
}: {
  sendInDays?: number
  settleState?: RobocallSettleState
  payAttempt?: number
  authorizedAmountInCents?: number
  authorizationIntentId?: string
  paymentMethodId?: string
  stripeCustomerId?: string
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
      audioKey: `robocall/997/${randomUUID()}.webm`,
      callbackNumber: '+15125550123',
      billableCount: 100,
      amountInCents: 450,
      settleState,
      payAttempt,
      ...(authorizedAmountInCents != null ? { authorizedAmountInCents } : {}),
      ...(authorizationIntentId ? { authorizationIntentId } : {}),
      ...(paymentMethodId ? { paymentMethodId } : {}),
      ...(stripeCustomerId ? { stripeCustomerId } : {}),
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

const readSpine = (outreachId: number) =>
  service.prisma.outreach.findUniqueOrThrow({ where: { id: outreachId } })

// A capture deadline comfortably past send + run + settle margin.
const captureBeforeUnix = () => getUnixTime(addDays(new Date(), 7))

describe('POST /v1/outreach/robocall/:outreachId/authorize', () => {
  it('places an off-session manual-capture hold and persists the satellite', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
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

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      status: 'authorized',
      settleState: RobocallSettleState.authorized,
      authorizedAmountInCents: 450,
    })

    const createArgs = paymentIntentsCreate.mock.calls[0]
    expect(createArgs?.[0]).toMatchObject({
      amount: 450,
      currency: 'usd',
      customer: 'cus_test',
      payment_method: 'pm_1',
      capture_method: 'manual',
      confirm: true,
      off_session: true,
    })
    expect(createArgs?.[1]?.idempotencyKey).toBe(
      `robocall-hold-${outreachId}-1`,
    )

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
    expect(satellite.authorizationIntentId).toBe('pi_hold_1')
    expect(satellite.authorizedAmountInCents).toBe(450)
    expect(satellite.paymentMethodId).toBe('pm_1')
    expect(satellite.stripeCustomerId).toBe('cus_test')
    expect(satellite.payAttempt).toBe(1)
    expect(satellite.captureBefore).not.toBeNull()

    // The spine advances off pending_payment so the row shows in the history.
    const spine = await readSpine(outreachId)
    expect(spine.status).toBe('pending')

    expect(trackSpy).toHaveBeenCalledTimes(1)
    const [userId, event, , , messageId] = trackSpy.mock.calls[0] ?? []
    expect(userId).toBe(service.user.id)
    expect(event).toBe(EVENTS.Robocall.HoldPlaced)
    expect(messageId).toBe(`${outreachId}:hold_placed`)
  })

  it('retries from hold_failed with a new card and authorizes', async () => {
    // A declined draft (payAttempt already 1) re-enters placement with a new
    // card — the CAS must accept hold_failed, and the retry uses a fresh key.
    const outreachId = await createDraft({
      sendInDays: 2,
      settleState: RobocallSettleState.hold_failed,
      payAttempt: 1,
    })
    deriveSpy.mockResolvedValue(100)
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_2',
      customer: 'cus_test',
      type: 'card',
    })
    paymentIntentsCreate.mockResolvedValue({
      id: 'pi_hold_2',
      status: 'requires_capture',
      capture_before: captureBeforeUnix(),
    })

    const res = await postAuthorize(outreachId, 'pm_2')

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.status).toBe('authorized')
    // Fresh idempotency key off the bumped attempt (2), not the declined 1.
    expect(paymentIntentsCreate.mock.calls[0]?.[1]?.idempotencyKey).toBe(
      `robocall-hold-${outreachId}-2`,
    )
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
    expect(satellite.paymentMethodId).toBe('pm_2')
    expect(satellite.payAttempt).toBe(2)
  })

  it('escalates a card-error on a hold_failed retry to hold_failed, not a pending_payment strand', async () => {
    // A card-validation error whose pre-claim state was hold_failed must
    // TERMINATE to hold_failed (the reminder path), never revert to
    // pending_payment — which the daily sweep would re-select and re-charge with
    // the same bad card forever. The hold_failed pre-claim state is the key,
    // reached both on-session (a /authorize retry, exercised here) and
    // off-session (the deferred sweep / card-update webhook). The pending_payment
    // /authorize path still throws 400 (see the not-on-customer test).
    const outreachId = await createDraft({
      settleState: RobocallSettleState.hold_failed,
      payAttempt: 1,
    })
    deriveSpy.mockResolvedValue(100)
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_foreign',
      customer: 'cus_someone_else',
      type: 'card',
    })

    const res = await postAuthorize(outreachId, 'pm_foreign')

    expect(res.data.status).toBe('hold_failed')
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.hold_failed)
    // The FOREIGN card fails validation BEFORE the post-validation persist, so it
    // is never written onto the row — no stale foreign PM left behind.
    expect(satellite.paymentMethodId).toBeNull()
    expect(trackSpy).toHaveBeenCalledTimes(1)
    const [, event, , , messageId] = trackSpy.mock.calls[0] ?? []
    expect(event).toBe(EVENTS.Robocall.HoldFailed)
    // The escalation bumps payAttempt (1 → 2) so its dedup key is monotonic: a
    // later escalation on this draft advances the key again and still emails past
    // Segment's 24h window. messageId carries the bumped attempt.
    expect(messageId).toBe(`${outreachId}:hold_failed:2`)
    expect(satellite.payAttempt).toBe(2)
  })

  it('persists the NEW card after validation so a transient failure never reverts to a stale card', async () => {
    // A hold_failed retry supplies a NEW card. If the placement hits a transient
    // (non-decline) failure, the revert to pending_payment must carry the NEW
    // card — never the OLD declined one the daily sweep would re-charge.
    const outreachId = await createDraft({
      settleState: RobocallSettleState.hold_failed,
      payAttempt: 1,
      paymentMethodId: 'pm_old',
      stripeCustomerId: 'cus_test',
    })
    deriveSpy.mockResolvedValue(100)
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_new',
      customer: 'cus_test',
      type: 'card',
    })
    paymentIntentsCreate.mockRejectedValue(new Error('network down'))

    const res = await postAuthorize(outreachId, 'pm_new')

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
    // The claim persisted the NEW card, so the deferred sweep retries pm_new.
    expect(satellite.paymentMethodId).toBe('pm_new')
    expect(satellite.stripeCustomerId).toBe('cus_test')
  })

  it('clears any prior staged CallHub campaign on a hold_failed re-authorize', async () => {
    // A re-auth re-derives the billable count from the live voter DB, so a
    // previously-staged campaign (frozen phonebook) must be invalidated — else
    // the staging sweep never re-stages and CallHub dials the stale audience.
    const outreachId = await createDraft({
      sendInDays: 2,
      settleState: RobocallSettleState.hold_failed,
      payAttempt: 1,
    })
    await service.prisma.outreachRobocall.update({
      where: { outreachId },
      data: {
        callhubCampaignPkStr: 'vb_stale',
        callhubStartingDate: addDays(new Date(), 2),
        callhubExpirationDate: addDays(new Date(), 9),
      },
    })
    deriveSpy.mockResolvedValue(100)
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_2',
      customer: 'cus_test',
      type: 'card',
    })
    paymentIntentsCreate.mockResolvedValue({
      id: 'pi_hold_reauth',
      status: 'requires_capture',
      capture_before: captureBeforeUnix(),
    })

    const res = await postAuthorize(outreachId, 'pm_2')

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.status).toBe('authorized')
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
    // The stale campaign is cleared so the staging sweep (callhubCampaignPkStr
    // IS NULL) re-stages a phonebook matching the newly-derived count.
    expect(satellite.callhubCampaignPkStr).toBeNull()
    expect(satellite.callhubStartingDate).toBeNull()
    expect(satellite.callhubExpirationDate).toBeNull()
    // The cleared campaign is recorded as an orphan so the cleanup sweep ABORTs
    // the PAUSED campaign it left behind at CallHub.
    const orphan = await service.prisma.robocallOrphanedCampaign.findUnique({
      where: { campaignPkStr: 'vb_stale' },
    })
    expect(orphan?.reason).toBe('reauth_restage')
    expect(orphan?.outreachId).toBe(outreachId)
    expect(orphan?.abortedAt).toBeNull()
  })

  it('502s and reverts without bumping payAttempt on an infra failure', async () => {
    // A non-decline Stripe/infra error must 502, revert the claim, and leave
    // payAttempt unchanged so a retry REUSES the same idempotency key (Stripe
    // replays a possibly-live PI rather than stacking a second hold).
    const outreachId = await createDraft({ sendInDays: 2 })
    deriveSpy.mockResolvedValue(100)
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_1',
      customer: 'cus_test',
      type: 'card',
    })
    paymentIntentsCreate.mockRejectedValue(new Error('network down'))

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
    expect(satellite.payAttempt).toBe(0)
  })

  it('defers when the send is beyond the hold window, placing no hold', async () => {
    const outreachId = await createDraft({ sendInDays: 10 })
    // The defer branch validates the chosen card before persisting it, so it
    // reads paymentMethods.retrieve — mock it here so the test passes in
    // isolation (clearMocks resets calls, not a prior test's implementation).
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
    // Card saved and committed, so it shows in the history even before the hold.
    const spine = await readSpine(outreachId)
    expect(spine.status).toBe('pending')
  })

  it('rejects an estimate over the per-run ceiling and reverts to pending_payment', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
    // 11112 landlines → $500.04, just over the $500 ceiling.
    deriveSpy.mockResolvedValue(11112)

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
    // The guard only flips on success — a rejected authorize stays hidden.
    const spine = await readSpine(outreachId)
    expect(spine.status).toBe('pending_payment')
  })

  it('records hold_failed (not a 502) when the card is declined', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
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

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.status).toBe('hold_failed')
    expect(paymentIntentsCancel).not.toHaveBeenCalled()

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.hold_failed)
    expect(satellite.payAttempt).toBe(1)
    expect(satellite.authorizationIntentId).toBeNull()
    // A first on-session decline must PERSIST the card + customer onto the
    // hold_failed row (the commit CAS is never reached on a decline), so the
    // card-update retry — which filters on stripeCustomerId — can later find it.
    expect(satellite.paymentMethodId).toBe('pm_1')
    expect(satellite.stripeCustomerId).toBe('cus_test')

    expect(trackSpy).toHaveBeenCalledTimes(1)
    const [, event, , , messageId] = trackSpy.mock.calls[0] ?? []
    expect(event).toBe(EVENTS.Robocall.HoldFailed)
    // A real decline folds the attempt into the messageId (attempt 1 here) so a
    // later card-update retry that declines again — past Segment's 24h dedup
    // window — still sends a distinct "update your card" email.
    expect(messageId).toBe(`${outreachId}:hold_failed:1`)
  })

  it('gives a second decline attempt a distinct HoldFailed messageId', async () => {
    // A card-update retry of an already-declined draft (payAttempt 1) whose new
    // card ALSO declines emits HoldFailed under a DISTINCT messageId (attempt 2),
    // so a second "update your card" email sends even days later — a fixed
    // messageId would fall inside Segment's 24h dedup window and be suppressed.
    const outreachId = await createDraft({
      settleState: RobocallSettleState.hold_failed,
      payAttempt: 1,
    })
    deriveSpy.mockResolvedValue(100)
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_2',
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

    await postAuthorize(outreachId, 'pm_2')

    const [, event, , , messageId] = trackSpy.mock.calls[0] ?? []
    expect(event).toBe(EVENTS.Robocall.HoldFailed)
    expect(messageId).toBe(`${outreachId}:hold_failed:2`)
  })

  it('rejects a payment method that is not on the customer', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
    deriveSpy.mockResolvedValue(100)
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_1',
      customer: 'cus_other',
      type: 'card',
    })

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
  })

  it('voids the hold and 400s when it would expire before capture', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
    deriveSpy.mockResolvedValue(100)
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_1',
      customer: 'cus_test',
      type: 'card',
    })
    // capture_before only 3 days out — before send (2d) + 48h run + 24h margin.
    paymentIntentsCreate.mockResolvedValue({
      id: 'pi_short',
      status: 'requires_capture',
      capture_before: getUnixTime(addDays(new Date(), 3)),
    })

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(paymentIntentsCancel).toHaveBeenCalledWith('pi_short')
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
    // The voided hold bumps payAttempt so a retry derives a fresh idempotency
    // key and a new PI instead of idempotent-replaying the canceled one.
    expect(satellite.payAttempt).toBe(1)
    // The best-effort void is recorded so the reconcile sweep re-voids it if the
    // void did not land.
    const orphan = await service.prisma.robocallOrphanedHold.findUnique({
      where: { paymentIntentId: 'pi_short' },
    })
    expect(orphan?.reason).toBe('window_fit')
    expect(orphan?.outreachId).toBe(outreachId)
  })

  it('places the hold at the window edge when capture_before fits', async () => {
    // Send exactly at the 3-day window edge; capture_before ~7 days out. The
    // fit check (send 3d + 48h + 24h = 6d) clears a 7-day capture_before, so the
    // window and the fit are consistent — this is the case FIX 1 restored.
    const outreachId = await createDraft({ sendInDays: 3 })
    deriveSpy.mockResolvedValue(100)
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_1',
      customer: 'cus_test',
      type: 'card',
    })
    paymentIntentsCreate.mockResolvedValue({
      id: 'pi_edge',
      status: 'requires_capture',
      capture_before: getUnixTime(addDays(new Date(), 7)),
    })

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.status).toBe('authorized')
    expect(paymentIntentsCancel).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
  })

  it('treats a non-requires_capture status as a decline, not a success', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
    deriveSpy.mockResolvedValue(100)
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_1',
      customer: 'cus_test',
      type: 'card',
    })
    // Confirmed off-session but landed in requires_action (not a usable hold).
    paymentIntentsCreate.mockResolvedValue({
      id: 'pi_action',
      status: 'requires_action',
      capture_before: captureBeforeUnix(),
    })

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.status).toBe('hold_failed')
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.hold_failed)
    expect(satellite.authorizationIntentId).toBeNull()
  })

  it('rejects a non-card payment method', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
    deriveSpy.mockResolvedValue(100)
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_bank',
      customer: 'cus_test',
      type: 'us_bank_account',
    })

    const res = await postAuthorize(outreachId, 'pm_bank')

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.pending_payment)
  })

  it('does not place a second hold on an already-authorized draft', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.authorized,
      authorizedAmountInCents: 450,
      authorizationIntentId: 'pi_existing',
      payAttempt: 1,
    })

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      status: 'authorized',
      settleState: RobocallSettleState.authorized,
      authorizedAmountInCents: 450,
    })
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('returns noop and places no hold while a placement is in flight', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.hold_pending,
    })

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.status).toBe('noop')
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('voids the placed hold if the draft moves out of hold_pending mid-placement', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
    deriveSpy.mockResolvedValue(100)
    paymentMethodsRetrieve.mockResolvedValue({
      id: 'pm_1',
      customer: 'cus_test',
      type: 'card',
    })
    // A concurrent actor advances the draft while the Stripe hold is in flight,
    // so the success claim finds nothing to commit and the hold must be voided.
    paymentIntentsCreate.mockImplementation(async () => {
      await service.prisma.outreachRobocall.updateMany({
        where: { outreachId },
        data: { settleState: RobocallSettleState.authorized },
      })
      return {
        id: 'pi_race',
        status: 'requires_capture',
        capture_before: captureBeforeUnix(),
      }
    })

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.status).toBe('authorized')
    expect(paymentIntentsCancel).toHaveBeenCalledWith('pi_race')
    expect(trackSpy).not.toHaveBeenCalled()
    // The best-effort void of the lost-race hold is recorded for the reconcile
    // sweep to re-void if it did not land.
    const orphan = await service.prisma.robocallOrphanedHold.findUnique({
      where: { paymentIntentId: 'pi_race' },
    })
    expect(orphan?.reason).toBe('lost_commit')
  })

  it('is Pro-gated: a non-Pro campaign is rejected without touching Stripe', async () => {
    const outreachId = await createDraft({ sendInDays: 2 })
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { isPro: false },
    })

    const res = await postAuthorize(outreachId)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(paymentIntentsCreate).not.toHaveBeenCalled()
    expect(paymentMethodsRetrieve).not.toHaveBeenCalled()
  })
})
