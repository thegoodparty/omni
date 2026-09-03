import { randomUUID } from 'node:crypto'
import { addDays, subMinutes } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PinoLogger } from 'nestjs-pino'
import { useTestService } from '@/test-service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { OutreachRobocallChargeService } from '@/outreach/services/outreachRobocallCharge.service'
import { OutreachRobocallHoldService } from '@/outreach/services/outreachRobocallHold.service'
import { OutreachRobocallStrandedService } from '@/outreach/services/outreachRobocallStranded.service'
import {
  StripeChargeDeclinedError,
  StripeService,
} from '@/vendors/stripe/services/stripe.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { Campaign, RobocallSettleState } from '../../generated/prisma'

const service = useTestService()

let campaign: Campaign
let orgSlug: string
let filterId: number
let stranded: OutreachRobocallStrandedService
let failSendSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  stranded = service.app.get(OutreachRobocallStrandedService)
  failSendSpy = vi
    .spyOn(service.app.get(OutreachRobocallHoldService), 'failSend')
    .mockResolvedValue(undefined)

  const campaignId = 994
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
})

const createDraft = async ({
  sendInDays = -1,
  settleState = RobocallSettleState.authorized,
  callhubCampaignPkStr,
}: {
  sendInDays?: number
  settleState?: RobocallSettleState
  callhubCampaignPkStr?: string
} = {}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: 'pending',
      date: addDays(new Date(), sendInDays),
      voterFileFilterId: filterId,
    },
  })
  await service.prisma.outreachRobocall.create({
    data: {
      outreachId: spine.id,
      audioKey: `robocall/994/${randomUUID()}.webm`,
      callbackNumber: '+15125550123',
      billableCount: 100,
      amountInCents: 450,
      settleState,
      authorizationIntentId: 'pi_hold_1',
      authorizedAmountInCents: 450,
      ...(callhubCampaignPkStr ? { callhubCampaignPkStr } : {}),
    },
  })
  return spine.id
}

describe('OutreachRobocallStrandedService.sweepStrandedAuthorized (prod)', () => {
  const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT
  const originalSend = process.env.ROBOCALL_SEND_ENABLED
  const originalCapture = process.env.ROBOCALL_CAPTURE_ENABLED

  beforeEach(() => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
    // The sweep is deliberately NOT kill-switch-gated: leave the send/capture
    // switches unset to prove it still runs.
    delete process.env.ROBOCALL_SEND_ENABLED
    delete process.env.ROBOCALL_CAPTURE_ENABLED
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
    if (originalSend === undefined) delete process.env.ROBOCALL_SEND_ENABLED
    else process.env.ROBOCALL_SEND_ENABLED = originalSend
    if (originalCapture === undefined) {
      delete process.env.ROBOCALL_CAPTURE_ENABLED
    } else {
      process.env.ROBOCALL_CAPTURE_ENABLED = originalCapture
    }
  })

  it('fails a past-due authorized draft that never staged', async () => {
    const outreachId = await createDraft({ sendInDays: -1 })

    await stranded.sweepStrandedAuthorized()

    expect(failSendSpy).toHaveBeenCalledTimes(1)
    expect(failSendSpy).toHaveBeenCalledWith(outreachId, 'expired_unstaged')
  })

  it('runs with the send/capture kill-switches unset (not gated)', async () => {
    await createDraft({ sendInDays: -1 })

    await stranded.sweepStrandedAuthorized()

    expect(failSendSpy).toHaveBeenCalledTimes(1)
  })

  it('skips a staged past-due authorized draft (send sweep owns it)', async () => {
    await createDraft({ sendInDays: -1, callhubCampaignPkStr: 'vb_staged' })

    await stranded.sweepStrandedAuthorized()

    expect(failSendSpy).not.toHaveBeenCalled()
  })

  it('skips a future-dated authorized draft', async () => {
    await createDraft({ sendInDays: 2 })

    await stranded.sweepStrandedAuthorized()

    expect(failSendSpy).not.toHaveBeenCalled()
  })

  it('skips past-due drafts in other settle states', async () => {
    await createDraft({
      sendInDays: -1,
      settleState: RobocallSettleState.staging,
    })
    await createDraft({
      sendInDays: -1,
      settleState: RobocallSettleState.pending_payment,
    })
    await createDraft({
      sendInDays: -1,
      settleState: RobocallSettleState.hold_failed,
    })

    await stranded.sweepStrandedAuthorized()

    expect(failSendSpy).not.toHaveBeenCalled()
  })

  it('continues past a failSend that throws for one record', async () => {
    const first = await createDraft({ sendInDays: -1 })
    const second = await createDraft({ sendInDays: -2 })
    failSendSpy.mockImplementation(async (outreachId: number) => {
      if (outreachId === first) throw new Error('void down')
    })

    await stranded.sweepStrandedAuthorized()

    expect(failSendSpy).toHaveBeenCalledWith(first, 'expired_unstaged')
    expect(failSendSpy).toHaveBeenCalledWith(second, 'expired_unstaged')
    expect(failSendSpy).toHaveBeenCalledTimes(2)
  })

  it('no-ops off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    await createDraft({ sendInDays: -1 })

    await stranded.sweepStrandedAuthorized()

    expect(failSendSpy).not.toHaveBeenCalled()
  })
})

// A robocall whose ESTIMATE was charged up front (CONTINGENCY billing): `paid`
// with a committed chargeIntentId, no hold. Distinct from the hold-model draft
// createDraft builds above (authorized + authorizationIntentId).
const createPaidDraft = async ({
  sendInDays = -1,
  callhubCampaignPkStr,
  chargeIntentId = 'pi_charge_1',
}: {
  sendInDays?: number
  callhubCampaignPkStr?: string
  chargeIntentId?: string | null
} = {}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: 'pending',
      date: addDays(new Date(), sendInDays),
      voterFileFilterId: filterId,
    },
  })
  await service.prisma.outreachRobocall.create({
    data: {
      outreachId: spine.id,
      audioKey: `robocall/994/${randomUUID()}.webm`,
      callbackNumber: '+15125550123',
      billableCount: 100,
      amountInCents: 450,
      settleState: RobocallSettleState.paid,
      authorizedAmountInCents: 450,
      capturedAmountInCents: 450,
      ...(chargeIntentId ? { chargeIntentId } : {}),
      ...(callhubCampaignPkStr ? { callhubCampaignPkStr } : {}),
    },
  })
  return spine.id
}

describe('OutreachRobocallStrandedService.sweepStrandedPaid (estimate model)', () => {
  const originalFlag = process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED
  let charge: OutreachRobocallChargeService
  let trackSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED = 'true'
    charge = service.app.get(OutreachRobocallChargeService)
    trackSpy = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue(undefined as never)
  })
  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED
    } else {
      process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED = originalFlag
    }
  })

  const readSatellite = (outreachId: number) =>
    service.prisma.outreachRobocall.findUniqueOrThrow({ where: { outreachId } })

  it('fails a past-due paid unstaged run → send_failed + spine failed + CRITICAL + SendFailed', async () => {
    const outreachId = await createPaidDraft({ sendInDays: -1 })
    const errorSpy = vi.spyOn(
      (charge as unknown as { logger: PinoLogger }).logger,
      'error',
    )

    await stranded.sweepStrandedPaid()

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.send_failed,
    )
    const spine = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreachId },
    })
    expect(spine.status).toBe('failed')
    // The CRITICAL line pages ops for a manual refund (no auto-refund here).
    expect(errorSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('CRITICAL'),
    )
    expect(trackSpy).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Robocall.SendFailed,
      { outreachId },
      undefined,
      `${outreachId}:send_failed`,
    )
  })

  it('does not touch a paid run that is already staged (pk_str set)', async () => {
    const outreachId = await createPaidDraft({
      sendInDays: -1,
      callhubCampaignPkStr: 'vb_staged',
    })

    await stranded.sweepStrandedPaid()

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.paid,
    )
    expect(trackSpy).not.toHaveBeenCalled()
  })

  it('does not touch a future-dated paid run', async () => {
    const outreachId = await createPaidDraft({ sendInDays: 2 })

    await stranded.sweepStrandedPaid()

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.paid,
    )
    expect(trackSpy).not.toHaveBeenCalled()
  })

  it('is inert when the estimate-billing flag is OFF', async () => {
    delete process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED
    const outreachId = await createPaidDraft({ sendInDays: -1 })

    await stranded.sweepStrandedPaid()

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.paid,
    )
    expect(trackSpy).not.toHaveBeenCalled()
  })

  it('leaves a hold-model authorized draft to the stranded-authorized sweep', async () => {
    const outreachId = await createDraft({ sendInDays: -1 })

    await stranded.sweepStrandedPaid()

    // The paid sweep never touches an `authorized` row.
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.authorized,
    )
    expect(trackSpy).not.toHaveBeenCalled()
  })
})

// An ORPHANED estimate-charge claim: chargeEstimate won the pending_payment ->
// paid claim (freezing authorizedAmountInCents + persisting paymentMethodId) but
// crashed before its commit, so the row is `paid` with chargeIntentId STILL NULL
// and a charge Stripe may have captured was never recorded. sweepOrphanedEstimate
// Claims resumes it under the SAME stable key + frozen amount.
const createOrphanDraft = async ({
  sendInDays = -1,
  ageMinutes = 30,
  authorizedAmountInCents = 450,
  paymentMethodId = 'pm_1',
}: {
  sendInDays?: number
  ageMinutes?: number
  authorizedAmountInCents?: number | null
  paymentMethodId?: string | null
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
      audioKey: `robocall/994/${randomUUID()}.webm`,
      callbackNumber: '+15125550123',
      billableCount: 100,
      amountInCents: 450,
      settleState: RobocallSettleState.paid,
      // The orphan: no committed charge, frozen amount + card set at claim.
      ...(authorizedAmountInCents != null ? { authorizedAmountInCents } : {}),
      ...(paymentMethodId ? { paymentMethodId } : {}),
    },
  })
  // Backdate updated_at so the row looks crashed (past the 15-min stale window)
  // rather than a healthy in-flight charge.
  const staleAt = subMinutes(new Date(), ageMinutes)
  await service.prisma
    .$executeRaw`UPDATE outreach_robocall SET updated_at = ${staleAt} WHERE outreach_id = ${spine.id}`
  return spine.id
}

describe('OutreachRobocallStrandedService.sweepOrphanedEstimateClaims', () => {
  const originalFlag = process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED
  let ensureCustomerSpy: ReturnType<typeof vi.spyOn>
  let retrievePmSpy: ReturnType<typeof vi.spyOn>
  let chargeSpy: ReturnType<typeof vi.spyOn>
  let trackSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED = 'true'
    const stripe = service.app.get(StripeService)
    ensureCustomerSpy = vi
      .spyOn(stripe, 'ensureCustomer')
      .mockResolvedValue('cus_test')
    retrievePmSpy = vi
      .spyOn(stripe, 'retrievePaymentMethod')
      .mockResolvedValue({
        id: 'pm_1',
        customer: 'cus_test',
        type: 'card',
      } as never)
    chargeSpy = vi
      .spyOn(stripe, 'createOffSessionCharge')
      .mockResolvedValue({ paymentIntentId: 'pi_charge_1' })
    trackSpy = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue(undefined as never)
  })
  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED
    } else {
      process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED = originalFlag
    }
  })

  const readSatellite = (outreachId: number) =>
    service.prisma.outreachRobocall.findUniqueOrThrow({ where: { outreachId } })

  it('resumes an orphan under the SAME key + frozen amount and commits chargeIntentId', async () => {
    const outreachId = await createOrphanDraft({ sendInDays: -1 })

    await stranded.sweepOrphanedEstimateClaims()

    expect(chargeSpy).toHaveBeenCalledTimes(1)
    // The resume MUST reuse the stable estimate key + the FROZEN amount, so a
    // charge Stripe already captured replays the SAME PaymentIntent.
    expect(chargeSpy.mock.calls[0]?.[0]).toMatchObject({
      amountInCents: 450,
      idempotencyKey: `robocall-estimate-charge-${outreachId}`,
    })

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.paid)
    // chargeIntentId now committed → staging/send can finally dial the run.
    expect(satellite.chargeIntentId).toBe('pi_charge_1')
    expect(satellite.capturedAmountInCents).toBe(450)
    // The spine advances so the delivered run shows in history.
    const spine = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreachId },
    })
    expect(spine.status).toBe('pending')
    expect(ensureCustomerSpy).toHaveBeenCalledTimes(1)
    expect(retrievePmSpy).toHaveBeenCalledTimes(1)
    // One Receipt milestone.
    expect(trackSpy).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Robocall.Receipt,
      { outreachId, capturedAmountInDollars: 4.5 },
      undefined,
      `${outreachId}:receipt`,
    )
  })

  it('resumes a FUTURE-dated orphan too (delivered before its send)', async () => {
    const outreachId = await createOrphanDraft({ sendInDays: 2 })

    await stranded.sweepOrphanedEstimateClaims()

    expect(chargeSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(outreachId)).chargeIntentId).toBe('pi_charge_1')
  })

  it('never charges twice: once committed, a second sweep skips it', async () => {
    const outreachId = await createOrphanDraft({ sendInDays: -1 })

    await stranded.sweepOrphanedEstimateClaims()
    // A committed row is no longer chargeIntentId-null, so the second pass never
    // selects it — the stable key + this filter mean recovery never re-charges.
    await stranded.sweepOrphanedEstimateClaims()

    expect(chargeSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(outreachId)).chargeIntentId).toBe('pi_charge_1')
  })

  it('does not touch a fresh orphan within the stale window', async () => {
    const outreachId = await createOrphanDraft({
      sendInDays: -1,
      ageMinutes: 5,
    })

    await stranded.sweepOrphanedEstimateClaims()

    expect(chargeSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.paid)
    expect(satellite.chargeIntentId).toBeNull()
  })

  it('is inert when the estimate-billing flag is OFF', async () => {
    delete process.env.ROBOCALL_ESTIMATE_BILLING_ENABLED
    const outreachId = await createOrphanDraft({ sendInDays: -1 })

    await stranded.sweepOrphanedEstimateClaims()

    expect(chargeSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).chargeIntentId).toBeNull()
  })

  it('does not touch a committed paid run (chargeIntentId already set)', async () => {
    const outreachId = await createPaidDraft({ sendInDays: 2 })

    await stranded.sweepOrphanedEstimateClaims()

    expect(chargeSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).chargeIntentId).toBe('pi_charge_1')
  })

  it('routes a decline on resume to charge_failed + one ChargeFailed email', async () => {
    const outreachId = await createOrphanDraft({ sendInDays: -1 })
    chargeSpy.mockRejectedValue(
      new StripeChargeDeclinedError('declined', 'pi_declined'),
    )

    await stranded.sweepOrphanedEstimateClaims()

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.charge_failed)
    // The declined PI id is recorded so a later dispute/refund reconciles.
    expect(satellite.chargeIntentId).toBe('pi_declined')
    expect(trackSpy).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Robocall.ChargeFailed,
      { outreachId },
      undefined,
      `${outreachId}:charge_failed`,
    )
  })

  it('leaves the orphan paid on a transient charge failure (retried next sweep)', async () => {
    const outreachId = await createOrphanDraft({ sendInDays: -1 })
    chargeSpy.mockRejectedValue(new Error('stripe down'))

    await stranded.sweepOrphanedEstimateClaims()

    const satellite = await readSatellite(outreachId)
    // Never revert a possibly-captured orphan: it stays `paid` + chargeIntentId
    // null for the next sweep to replay under the same key.
    expect(satellite.settleState).toBe(RobocallSettleState.paid)
    expect(satellite.chargeIntentId).toBeNull()
  })

  it('pages CRITICAL and leaves the orphan paid when the persisted card is permanently unusable', async () => {
    const outreachId = await createOrphanDraft({ sendInDays: -1 })
    // A detached/foreign card: re-validation throws RobocallCardError, which no
    // later sweep can ever revalidate.
    retrievePmSpy.mockResolvedValue({
      id: 'pm_1',
      customer: 'cus_other',
      type: 'card',
    } as never)
    const charge = service.app.get(OutreachRobocallChargeService)
    const errorSpy = vi.spyOn(
      (charge as unknown as { logger: PinoLogger }).logger,
      'error',
    )

    await stranded.sweepOrphanedEstimateClaims()

    // No second charge is attempted for an un-revalidatable card.
    expect(chargeSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    // Stays paid (never charge_failed) — a capture may have landed under the
    // stable key, so we must not imply no money moved.
    expect(satellite.settleState).toBe(RobocallSettleState.paid)
    expect(satellite.chargeIntentId).toBeNull()
    // Ops is paged to reconcile a possible manual refund by hand.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('CRITICAL'),
    )
  })

  it('leaves the orphan paid QUIETLY (no CRITICAL) on a transient card re-validation failure', async () => {
    const outreachId = await createOrphanDraft({ sendInDays: -1 })
    // A lost Stripe read is transient infra, not a permanent card problem.
    retrievePmSpy.mockRejectedValue(new Error('stripe down'))
    const charge = service.app.get(OutreachRobocallChargeService)
    const errorSpy = vi.spyOn(
      (charge as unknown as { logger: PinoLogger }).logger,
      'error',
    )

    await stranded.sweepOrphanedEstimateClaims()

    expect(chargeSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.paid)
    expect(satellite.chargeIntentId).toBeNull()
    // The transient branch logs, but never pages — no CRITICAL line.
    expect(errorSpy).toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('CRITICAL'),
    )
  })
})
