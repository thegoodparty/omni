import { randomUUID } from 'node:crypto'
import { BadGatewayException } from '@nestjs/common'
import { addDays, addHours, subMinutes } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Stripe from 'stripe'
import { useTestService } from '@/test-service'
import { OutreachRobocallSendService } from '@/outreach/services/outreachRobocallSend.service'
import { CallhubCampaignService } from '@/vendors/callhub/services/callhubCampaign.service'
import { CallhubCampaignReportService } from '@/vendors/callhub/services/callhubCampaignReport.service'
import { CALLHUB_VB_STATUS } from '@/vendors/callhub/schemas/callhubCampaign.schema'
import { ZodError } from 'zod'
import {
  CALLHUB_LOW_CREDIT_DETAIL,
  CALLHUB_OVER_CPS_LIMIT_DETAIL,
  CallhubPermanentError,
  CallhubRecoverableError,
} from '@/vendors/callhub/services/callhubErrorHandling.service'
import { OutreachRobocallHoldService } from '@/outreach/services/outreachRobocallHold.service'
import { OutreachNotificationService } from '@/outreach/services/outreachNotification.service'
import { VoiceBroadcastCampaignStatus } from '@/vendors/callhub/schemas/callhubCampaignReport.schema'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import {
  Campaign,
  OutreachStatus,
  RobocallSettleState,
} from '../../generated/prisma'

// The sweep's multi-launch spacing sleep is vestigial under the serial gate (only
// one run launches per pass), but stub it so a test never waits a real 3s if a
// future change ever re-enables a second launch.
vi.mock('@/shared/util/sleep.util', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}))

const service = useTestService()

let send: OutreachRobocallSendService
let launchSpy: ReturnType<typeof vi.spyOn>
let statusSpy: ReturnType<typeof vi.spyOn>
let retrieveSpy: ReturnType<typeof vi.spyOn>
let trackSpy: ReturnType<typeof vi.spyOn>
let abortSpy: ReturnType<typeof vi.spyOn>

let campaign: Campaign
let orgSlug: string
let filterId: number

afterEach(() => {
  vi.unstubAllEnvs()
})

// retrievePaymentIntent returns the full Stripe.Response<PaymentIntent>; the
// send gate only reads `.status`, so a minimal object cast is enough here.
const piWith = (status: string) =>
  ({ id: 'pi_1', status }) as unknown as Stripe.Response<Stripe.PaymentIntent>

// getCampaignStatus returns the campaign plus a label; reconcile reads `.status`.
const vbWith = (status: number) =>
  ({
    url: 'https://callhub/v1/voice_broadcasts/vb_1/',
    name: 'vb',
    status,
    statusLabel: 'x',
  }) as unknown as VoiceBroadcastCampaignStatus

beforeEach(async () => {
  send = service.app.get(OutreachRobocallSendService)

  launchSpy = vi
    .spyOn(service.app.get(CallhubCampaignService), 'launchVoiceBroadcast')
    .mockResolvedValue({ pk_str: 'vb_1', status: 1 })
  abortSpy = vi
    .spyOn(service.app.get(CallhubCampaignService), 'abortVoiceBroadcast')
    .mockResolvedValue(undefined)
  // Pin the dial rate the free-and-advance estimate assumes, so the estimated
  // completion is deterministic regardless of the CALLHUB_VB_CALLS_PER_MINUTE env
  // (it defaults to 10 when unset; pinning it decouples the test from that).
  vi.spyOn(
    service.app.get(CallhubCampaignService),
    'getConfiguredCallsPerMinute',
  ).mockReturnValue(10)
  statusSpy = vi
    .spyOn(service.app.get(CallhubCampaignReportService), 'getCampaignStatus')
    .mockResolvedValue(vbWith(CALLHUB_VB_STATUS.PAUSE))
  retrieveSpy = vi
    .spyOn(service.app.get(StripeService), 'retrievePaymentIntent')
    .mockResolvedValue(piWith('requires_capture'))
  trackSpy = vi
    .spyOn(service.app.get(AnalyticsService), 'track')
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
})

const createDraft = async ({
  sendInHours = -1,
  settleState = RobocallSettleState.authorized,
  staged = true,
  authorizationIntentId = 'pi_1',
  authorizedAmountInCents,
  withCaptureBefore = false,
  compliancePassed = true,
  promoCoversTotal = false,
  dialedAt,
  poolFreedAt,
  billableCount = 100,
}: {
  sendInHours?: number
  settleState?: RobocallSettleState
  staged?: boolean
  authorizationIntentId?: string | null
  authorizedAmountInCents?: number
  withCaptureBefore?: boolean
  compliancePassed?: boolean
  promoCoversTotal?: boolean
  dialedAt?: Date
  poolFreedAt?: Date
  billableCount?: number
} = {}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: 'pending_payment',
      date: addHours(new Date(), sendInHours),
      voterFileFilterId: filterId,
    },
  })
  await service.prisma.outreachRobocall.create({
    data: {
      outreachId: spine.id,
      audioKey: `robocall/996/${randomUUID()}.mp3`,
      callbackNumber: '+15125550123',
      billableCount,
      amountInCents: 450,
      settleState,
      ...(compliancePassed ? { compliancePassedAt: new Date() } : {}),
      ...(staged ? { callhubCampaignPkStr: 'vb_1' } : {}),
      ...(authorizationIntentId ? { authorizationIntentId } : {}),
      ...(authorizedAmountInCents != null ? { authorizedAmountInCents } : {}),
      ...(withCaptureBefore ? { captureBefore: addDays(new Date(), 5) } : {}),
      ...(dialedAt ? { dialedAt } : {}),
      ...(poolFreedAt ? { poolFreedAt } : {}),
      promoCoversTotal,
    },
  })
  return spine.id
}

// @updatedAt is client-managed, so a stale `dialing` row can only be simulated
// with a raw write to the underlying column.
const ageDialingRow = (outreachId: number, minutes: number) =>
  service.prisma.$executeRaw`
    UPDATE outreach_robocall
    SET updated_at = ${subMinutes(new Date(), minutes)}
    WHERE outreach_id = ${outreachId}
  `

const readSatellite = (outreachId: number) =>
  service.prisma.outreachRobocall.findUniqueOrThrow({ where: { outreachId } })

const loggerErrorSpy = () =>
  vi.spyOn((send as unknown as { logger: PinoLogger }).logger, 'error')

describe('OutreachRobocallSendService.startCampaign', () => {
  it('dials a promo-covered run without a hold and without asking Stripe', async () => {
    const outreachId = await createDraft({
      authorizationIntentId: null,
      authorizedAmountInCents: 0,
      promoCoversTotal: true,
    })

    await send.startCampaign(outreachId)

    expect(retrieveSpy).not.toHaveBeenCalled()
    expect(launchSpy).toHaveBeenCalledTimes(1)
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.dialed)
    expect(satellite.dialedAt).not.toBeNull()
  })

  it('launches once and marks dialed with a dialedAt when the hold is live', async () => {
    const outreachId = await createDraft()

    await send.startCampaign(outreachId)

    expect(retrieveSpy).toHaveBeenCalledWith('pi_1')
    expect(launchSpy).toHaveBeenCalledTimes(1)
    // pk_str is carried as a STRING end-to-end, never coerced to a number.
    const pkArg = launchSpy.mock.calls[0]?.[0]
    expect(pkArg).toBe('vb_1')
    expect(typeof pkArg).toBe('string')
    // A successful launch needs no status reconciliation.
    expect(statusSpy).not.toHaveBeenCalled()

    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.dialed)
    expect(satellite.dialedAt).not.toBeNull()
  })

  it('surfaces a PERMANENT launch rejection as send_failed once CallHub confirms PAUSED', async () => {
    const outreachId = await createDraft()
    const failSpy = vi
      .spyOn(service.app.get(OutreachRobocallHoldService), 'failSend')
      .mockResolvedValue()
    launchSpy.mockRejectedValueOnce(new CallhubPermanentError('bad campaign'))
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.PAUSE))

    await send.startCampaign(outreachId)

    // Confirmed never STARTED (still PAUSED) + permanent → fail the send.
    expect(failSpy).toHaveBeenCalledWith(outreachId, 'send')
    // The marker is persisted BEFORE failSend, so a failSend that could not
    // commit still leaves the stale sweep able to fail (not relaunch) the row.
    expect((await readSatellite(outreachId)).permanentSendFailure).toBe(true)
  })

  it('alerts CAS when a launch is rejected for low_credit', async () => {
    const outreachId = await createDraft()
    vi.spyOn(
      service.app.get(OutreachRobocallHoldService),
      'failSend',
    ).mockResolvedValue()
    const lowCreditSpy = vi
      .spyOn(
        service.app.get(OutreachNotificationService),
        'notifyRobocallLowCredit',
      )
      .mockResolvedValue()
    launchSpy.mockRejectedValueOnce(
      new CallhubPermanentError(
        'out of credit',
        undefined,
        CALLHUB_LOW_CREDIT_DETAIL,
      ),
    )
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.PAUSE))

    await send.startCampaign(outreachId)

    expect(lowCreditSpy).toHaveBeenCalledWith(expect.any(String), outreachId)
  })

  it('does NOT alert low_credit for a permanent launch failure without that detail', async () => {
    const outreachId = await createDraft()
    vi.spyOn(
      service.app.get(OutreachRobocallHoldService),
      'failSend',
    ).mockResolvedValue()
    const lowCreditSpy = vi
      .spyOn(
        service.app.get(OutreachNotificationService),
        'notifyRobocallLowCredit',
      )
      .mockResolvedValue()
    launchSpy.mockRejectedValueOnce(new CallhubPermanentError('bad campaign'))
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.PAUSE))

    await send.startCampaign(outreachId)

    expect(lowCreditSpy).not.toHaveBeenCalled()
  })

  it('does NOT fail a permanently-errored launch that CallHub reports STARTED (it dialed)', async () => {
    const outreachId = await createDraft()
    const failSpy = vi
      .spyOn(service.app.get(OutreachRobocallHoldService), 'failSend')
      .mockResolvedValue()
    launchSpy.mockRejectedValueOnce(new CallhubPermanentError('bad campaign'))
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.START))

    await send.startCampaign(outreachId)

    // The status read shows it actually dialed — never void a delivered run.
    expect(failSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialed,
    )
  })

  it('fails a PERMANENT launch as send_failed when the status read also fails', async () => {
    const outreachId = await createDraft()
    const errorSpy = loggerErrorSpy()
    const failSpy = vi
      .spyOn(service.app.get(OutreachRobocallHoldService), 'failSend')
      .mockResolvedValue()
    launchSpy.mockRejectedValueOnce(new CallhubPermanentError('bad campaign'))
    statusSpy.mockRejectedValue(new BadGatewayException('status read down'))

    await send.startCampaign(outreachId)

    // A permanent 4xx guarantees the campaign never STARTED, so a failed status
    // read adds no uncertainty — fail the send now instead of leaving the row
    // `dialing` for the stale sweep, which retries WITHOUT the permanent flag and
    // would relaunch into another permanent reject forever.
    expect(failSpy).toHaveBeenCalledWith(outreachId, 'send')
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('unresolved'),
    )
  })

  it('fails a SHAPE-error launch (unparseable response) once CallHub confirms PAUSED', async () => {
    const outreachId = await createDraft()
    const failSpy = vi
      .spyOn(service.app.get(OutreachRobocallHoldService), 'failSend')
      .mockResolvedValue()
    // A ZodError = the launch response body could not be parsed. The dial state
    // is unknown from the launch alone, but the status read authoritatively
    // confirms PAUSED (never dialed), so failing the send is money-safe.
    launchSpy.mockRejectedValueOnce(new ZodError([]))
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.PAUSE))

    await send.startCampaign(outreachId)

    expect(failSpy).toHaveBeenCalledWith(outreachId, 'send')
    expect((await readSatellite(outreachId)).permanentSendFailure).toBe(true)
  })

  it('does NOT fail a SHAPE-error launch when the status read is unresolved (dial state unknown)', async () => {
    const outreachId = await createDraft()
    const failSpy = vi
      .spyOn(service.app.get(OutreachRobocallHoldService), 'failSend')
      .mockResolvedValue()
    // Unlike a 4xx, an unparseable launch body does NOT guarantee the campaign
    // never STARTED. With an unresolved status read the dial state is unknown, so
    // it must be LEFT dialing for the stale sweep — never voided on a guess.
    launchSpy.mockRejectedValueOnce(new ZodError([]))
    statusSpy.mockRejectedValue(new BadGatewayException('status read down'))

    await send.startCampaign(outreachId)

    expect(failSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.dialing)
    expect(satellite.permanentSendFailure).toBe(false)
  })

  it('NEVER dials twice: a lost launch that CallHub reports STARTED commits dialed, no re-launch', async () => {
    const outreachId = await createDraft()
    // The PUT reached CallHub and started the broadcast, but the response was
    // lost (502). A blind retry would re-dial the whole audience.
    launchSpy.mockRejectedValueOnce(new BadGatewayException('response lost'))
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.START))

    await send.startCampaign(outreachId)

    // The STARTED read concludes the dial happened — NO second launch, and the
    // row commits to dialed idempotently.
    expect(launchSpy).toHaveBeenCalledTimes(1)
    expect(statusSpy).toHaveBeenCalledWith('vb_1')
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.dialed)
    expect(satellite.dialedAt).not.toBeNull()
  })

  it('a lost launch that CallHub reports PAUSED reverts to authorized (retryable)', async () => {
    const outreachId = await createDraft()
    launchSpy.mockRejectedValueOnce(new BadGatewayException('response lost'))
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.PAUSE))

    await send.startCampaign(outreachId)

    // PAUSED proves the START never took — safe to revert and retry next sweep.
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
    expect(satellite.dialedAt).toBeNull()
  })

  it('does NOT commit dialed when the launch 200 reads back a non-STARTED status', async () => {
    const outreachId = await createDraft()
    // A CallHub 200 that echoes PAUSE (or null/{}) parses through the nullish
    // schema — trusting the 2xx would record `dialed` on a still-PAUSED campaign.
    launchSpy.mockResolvedValue({
      pk_str: 'vb_1',
      status: CALLHUB_VB_STATUS.PAUSE,
    })
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.PAUSE))

    await send.startCampaign(outreachId)

    // Reconcile re-reads the real status (PAUSED) and reverts — not committed
    // dialed, and the launch is not re-sent.
    expect(launchSpy).toHaveBeenCalledTimes(1)
    expect(statusSpy).toHaveBeenCalledWith('vb_1')
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
    expect(satellite.dialedAt).toBeNull()
  })

  it('leaves the row in dialing (not reverted) when the status read itself throws', async () => {
    const outreachId = await createDraft()
    const errorSpy = loggerErrorSpy()
    launchSpy.mockRejectedValueOnce(new BadGatewayException('response lost'))
    statusSpy.mockRejectedValue(new BadGatewayException('status read down'))

    await send.startCampaign(outreachId)

    // Outcome unknown: NEVER relaunch and NEVER revert — leave dialing for the
    // stale-dialing sweep, and alert.
    expect(launchSpy).toHaveBeenCalledTimes(1)
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.dialing)
    expect(satellite.dialedAt).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ dialingCampaignPkStr: 'vb_1' }),
      expect.stringContaining('unresolved'),
    )
  })

  it('NEVER dials unpaid: a non-requires_capture hold fails the draft and clears the intent, no launch', async () => {
    const outreachId = await createDraft({
      authorizedAmountInCents: 450,
      withCaptureBefore: true,
    })
    retrieveSpy.mockResolvedValueOnce(piWith('canceled'))
    const errorSpy = loggerErrorSpy()

    await send.startCampaign(outreachId)

    expect(launchSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.hold_failed)
    expect(satellite.dialedAt).toBeNull()
    // Intent fields cleared so the hold service's new-card retry CAS
    // (authorizationIntentId IS NULL) can re-pick this row.
    expect(satellite.authorizationIntentId).toBeNull()
    expect(satellite.authorizedAmountInCents).toBeNull()
    expect(satellite.captureBefore).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ outreachId, paymentIntentStatus: 'canceled' }),
      expect.any(String),
    )
    // The candidate is not in the app at dial time, so the dead hold emits the
    // HoldFailed reminder once, with a messageId distinct from the authorize-time
    // decline so both can fire once each.
    expect(trackSpy).toHaveBeenCalledTimes(1)
    const [userId, event, , , messageId] = trackSpy.mock.calls[0] ?? []
    expect(userId).toBe(service.user.id)
    expect(event).toBe(EVENTS.Robocall.HoldFailed)
    expect(messageId).toBe(`${outreachId}:hold_failed_at_dial`)
  })

  it('NEVER dials unpaid: a draft with no authorization intent fails and no launch', async () => {
    const outreachId = await createDraft({ authorizationIntentId: null })

    await send.startCampaign(outreachId)

    expect(retrieveSpy).not.toHaveBeenCalled()
    expect(launchSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.hold_failed)
    expect(satellite.authorizationIntentId).toBeNull()
  })

  it('NEVER dials a draft with no compliance pass: reverts and alerts, no launch', async () => {
    // Belt-and-suspenders under the create gate: a dialing draft whose
    // compliancePassedAt is null must not dial. Nothing launched, the hold is
    // fine, so the claim reverts to authorized and a CRITICAL alert fires.
    const outreachId = await createDraft({ compliancePassed: false })
    const errorSpy = loggerErrorSpy()

    await send.startCampaign(outreachId)

    expect(launchSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
    expect(satellite.dialedAt).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ outreachId, dialingCampaignPkStr: 'vb_1' }),
      expect.stringContaining('CRITICAL'),
    )
  })

  it('NEVER dials twice: a concurrent double-start launches exactly once', async () => {
    const outreachId = await createDraft()

    await Promise.all([
      send.startCampaign(outreachId),
      send.startCampaign(outreachId),
    ])

    // The claim CAS elects a single dialer, so exactly one launch happens even
    // when two runners race the same draft.
    expect(launchSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialed,
    )
  })

  it('skips a draft that is not staged (no CallHub campaign)', async () => {
    const outreachId = await createDraft({ staged: false })

    await send.startCampaign(outreachId)

    expect(launchSpy).not.toHaveBeenCalled()
    expect(retrieveSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.authorized)
    expect(satellite.callhubCampaignPkStr).toBeNull()
  })

  it('skips a draft that is not authorized', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.pending_payment,
    })

    await send.startCampaign(outreachId)

    expect(launchSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.pending_payment,
    )
  })

  it('does not re-dial a draft already dialed', async () => {
    const outreachId = await createDraft()
    await send.startCampaign(outreachId)
    expect(launchSpy).toHaveBeenCalledTimes(1)

    // A second pass finds the draft in `dialed`, not `authorized`, so the claim
    // CAS matches nothing and no second launch happens.
    await send.startCampaign(outreachId)

    expect(launchSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialed,
    )
  })

  it('logs a CRITICAL alert and does not un-launch when the commit misses', async () => {
    const outreachId = await createDraft()
    const errorSpy = loggerErrorSpy()
    // A concurrent actor advances the draft out of `dialing` while CallHub is
    // launching, so the commit CAS matches 0 rows.
    launchSpy.mockImplementationOnce(async () => {
      await service.prisma.outreachRobocall.updateMany({
        where: { outreachId },
        data: { settleState: RobocallSettleState.authorized },
      })
      return { pk_str: 'vb_1', status: 1 }
    })

    await send.startCampaign(outreachId)

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ dialingCampaignPkStr: 'vb_1' }),
      expect.stringContaining('CRITICAL'),
    )
  })
})

describe('OutreachRobocallSendService.startCampaign — spine + no per-contact rows', () => {
  const recipientRows = (outreachId: number) =>
    service.prisma.contactInteractionRobocall.findMany({
      where: { outreachId },
    })

  const readSpine = (outreachId: number) =>
    service.prisma.outreach.findUniqueOrThrow({ where: { id: outreachId } })

  const setSpineStatus = (outreachId: number, status: OutreachStatus) =>
    service.prisma.outreach.update({
      where: { id: outreachId },
      data: { status },
    })

  it('advances the spine pending → in_progress and writes NO ContactInteractionRobocall rows', async () => {
    const outreachId = await createDraft()
    // The hold step moved the spine pending_payment → pending before the dial.
    await setSpineStatus(outreachId, OutreachStatus.pending)

    await send.startCampaign(outreachId)

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialed,
    )
    // "Sending" during the run window.
    expect((await readSpine(outreachId)).status).toBe(
      OutreachStatus.in_progress,
    )
    // This billing model does not know WHO was reached (CallHub reports no
    // per-call disposition), so no per-person feed rows are written — only the
    // aggregate count lives on the OutreachRobocall row.
    expect(await recipientRows(outreachId)).toHaveLength(0)
  })

  it('advances the spine on the reconciled-STARTED path too (a lost launch that dialed)', async () => {
    const outreachId = await createDraft()
    await setSpineStatus(outreachId, OutreachStatus.pending)
    launchSpy.mockRejectedValueOnce(new BadGatewayException('response lost'))
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.START))

    await send.startCampaign(outreachId)

    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialed,
    )
    expect((await readSpine(outreachId)).status).toBe(
      OutreachStatus.in_progress,
    )
    expect(await recipientRows(outreachId)).toHaveLength(0)
  })

  it('never flips a canceled spine to in_progress (guarded, idempotent)', async () => {
    const outreachId = await createDraft()
    await setSpineStatus(outreachId, OutreachStatus.canceled)

    await send.startCampaign(outreachId)

    // The dial commits (the claim CAS is on settleState, not spine status), but
    // the spine CAS on `pending` leaves a canceled row canceled — never
    // resurrected to in_progress.
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialed,
    )
    expect((await readSpine(outreachId)).status).toBe(OutreachStatus.canceled)
  })
})

describe('OutreachRobocallSendService.sweepRobocallSend (prod)', () => {
  const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT

  beforeEach(() => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
  })

  it('launches only the single oldest-due run per pass (serial), leaving the rest', async () => {
    // SERIAL: at most one robocall dials at a time, so even with several due runs
    // the sweep launches only the oldest. Created out of date order so `orderBy`
    // (not insertion order) is what picks the oldest.
    const newest = await createDraft({ sendInHours: -1 })
    const oldest = await createDraft({ sendInHours: -3 })
    const middle = await createDraft({ sendInHours: -2 })

    await send.sweepRobocallSend()

    // Only the oldest-due run dials; the other two wait their turn.
    expect(launchSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(oldest)).settleState).toBe(
      RobocallSettleState.dialed,
    )
    expect((await readSatellite(middle)).settleState).toBe(
      RobocallSettleState.authorized,
    )
    expect((await readSatellite(newest)).settleState).toBe(
      RobocallSettleState.authorized,
    )
  })

  it('does NOT launch a queued run while another is DIALING (serial gate)', async () => {
    // A fresh `dialing` run holds the shared CallHub pool, so no queued run may
    // launch this pass — even one whose send is due.
    await createDraft({ settleState: RobocallSettleState.dialing })
    const queued = await createDraft({ sendInHours: -1 })

    await send.sweepRobocallSend()

    expect(launchSpy).not.toHaveBeenCalled()
    expect((await readSatellite(queued)).settleState).toBe(
      RobocallSettleState.authorized,
    )
  })

  it('does NOT launch a queued run while a DIALED run has not been freed', async () => {
    // A dialed run still within its estimated completion is in flight (its pool
    // is not freed), so the serial gate blocks the queued run.
    const inFlight = await createDraft({
      settleState: RobocallSettleState.dialed,
      dialedAt: new Date(),
    })
    const queued = await createDraft({ sendInHours: -1 })

    await send.sweepRobocallSend()

    expect(launchSpy).not.toHaveBeenCalled()
    // Not freed (still within estimate+buffer), so no abort either.
    expect(abortSpy).not.toHaveBeenCalled()
    expect((await readSatellite(inFlight)).poolFreedAt).toBeNull()
    expect((await readSatellite(queued)).settleState).toBe(
      RobocallSettleState.authorized,
    )
  })

  it('frees a dialed run past its estimate+buffer and launches the next queued run', async () => {
    // A dialed run whose estimated completion + buffer is long past: its pool is
    // freed (CallHub campaign aborted, poolFreedAt stamped) and the next queued
    // run then launches in the same pass. The early abort is OPERATIONAL ONLY —
    // the settleState stays `dialed` for the 48h completion sweep to settle.
    const done = await createDraft({
      settleState: RobocallSettleState.dialed,
      dialedAt: addHours(new Date(), -72),
    })
    const queued = await createDraft({ sendInHours: -1 })

    await send.sweepRobocallSend()

    // The finished run's pool was freed, money untouched.
    expect(abortSpy).toHaveBeenCalledWith('vb_1')
    const freed = await readSatellite(done)
    expect(freed.poolFreedAt).not.toBeNull()
    expect(freed.settleState).toBe(RobocallSettleState.dialed)
    // With the pool freed, the next queued run dials.
    expect(launchSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(queued)).settleState).toBe(
      RobocallSettleState.dialed,
    )
  })

  it('does NOT free a dialed run still within its estimate+buffer', async () => {
    // The buffer is respected: a run dialed just now is not aborted, even though
    // its raw audience would finish quickly — the conservative buffer errs long
    // so a still-dialing run is never cut off.
    const dialing = await createDraft({
      settleState: RobocallSettleState.dialed,
      dialedAt: new Date(),
    })

    await send.sweepRobocallSend()

    expect(abortSpy).not.toHaveBeenCalled()
    expect((await readSatellite(dialing)).poolFreedAt).toBeNull()
  })

  it('does not re-free a run whose pool was already freed', async () => {
    // poolFreedAt set → the run is out of the free-and-advance candidate set, so
    // the abort is never re-sent (it would spam the rate-limited CallHub API for
    // the ~48h until the completion sweep settles).
    await createDraft({
      settleState: RobocallSettleState.dialed,
      dialedAt: addHours(new Date(), -72),
      poolFreedAt: addHours(new Date(), -1),
    })

    await send.sweepRobocallSend()

    expect(abortSpy).not.toHaveBeenCalled()
  })

  it('leaves a run in flight when the free abort fails (queue stays blocked)', async () => {
    // A transient CallHub abort failure must NOT stamp poolFreedAt: the run stays
    // in flight so the queue does not advance while the pool may still be
    // occupied, and the abort is retried next pass. The money-safe direction.
    const done = await createDraft({
      settleState: RobocallSettleState.dialed,
      dialedAt: addHours(new Date(), -72),
    })
    const queued = await createDraft({ sendInHours: -1 })
    abortSpy.mockRejectedValueOnce(new BadGatewayException('abort down'))

    await send.sweepRobocallSend()

    // Not freed, so still in flight → the queued run does not launch.
    expect((await readSatellite(done)).poolFreedAt).toBeNull()
    expect(launchSpy).not.toHaveBeenCalled()
    expect((await readSatellite(queued)).settleState).toBe(
      RobocallSettleState.authorized,
    )
  })

  it('kill-switch: ROBOCALL_SEND_MAX_PER_SWEEP=0 launches nothing; unset launches one', async () => {
    const oldest = await createDraft({ sendInHours: -2 })
    const newest = await createDraft({ sendInHours: -1 })

    // 0 is HONORED as the incident kill-switch — `take: 0` selects no rows, so
    // no due authorized run launches, with no deploy.
    vi.stubEnv('ROBOCALL_SEND_MAX_PER_SWEEP', '0')
    await send.sweepRobocallSend()
    expect(launchSpy).not.toHaveBeenCalled()
    expect(
      await service.prisma.outreachRobocall.count({
        where: { settleState: RobocallSettleState.authorized },
      }),
    ).toBe(2)

    // Unset: the serial model launches exactly ONE (the oldest); the newer waits.
    vi.unstubAllEnvs()
    await send.sweepRobocallSend()
    expect(launchSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(oldest)).settleState).toBe(
      RobocallSettleState.dialed,
    )
    expect((await readSatellite(newest)).settleState).toBe(
      RobocallSettleState.authorized,
    )
  })

  it('a throttled launch reverts to authorized and dials on a later pass', async () => {
    // The over_cps_limit back-off survives: a START CallHub throttles reverts the
    // run to authorized (never lost), and a later clean pass dials it. With serial
    // this is the self-correction if the gate ever lets two overlap.
    const outreachId = await createDraft({ sendInHours: -1 })
    launchSpy.mockRejectedValueOnce(
      new CallhubRecoverableError(
        'over cps',
        undefined,
        CALLHUB_OVER_CPS_LIMIT_DETAIL,
      ),
    )
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.PAUSE))

    await send.sweepRobocallSend()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.authorized,
    )

    await send.sweepRobocallSend()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialed,
    )
  })

  it('a failing launch does not throw out of the sweep (per-record isolation)', async () => {
    const outreachId = await createDraft({ sendInHours: -1 })
    launchSpy.mockRejectedValueOnce(new BadGatewayException('boom'))
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.PAUSE))

    await expect(send.sweepRobocallSend()).resolves.toBeUndefined()

    // The failed launch reverted via the PAUSED read; a later pass retries it.
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.authorized,
    )
  })

  it('dials only arrived drafts, once across repeat sweeps', async () => {
    const arrived = await createDraft({ sendInHours: -1 })
    const notYet = await createDraft({ sendInHours: 2 })

    await send.sweepRobocallSend()
    // A second sweep must not re-dial: the arrived draft is now `dialed`.
    await send.sweepRobocallSend()

    expect(launchSpy).toHaveBeenCalledTimes(1)
    expect((await readSatellite(arrived)).settleState).toBe(
      RobocallSettleState.dialed,
    )
    expect((await readSatellite(notYet)).settleState).toBe(
      RobocallSettleState.authorized,
    )
  })

  it('recovers a stale dialing row: CallHub STARTED commits dialed', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.dialing,
    })
    await ageDialingRow(outreachId, 30)
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.START))

    await send.sweepRobocallSend()

    // Recovery reconciles via the status read — it never launches.
    expect(launchSpy).not.toHaveBeenCalled()
    expect(statusSpy).toHaveBeenCalledWith('vb_1')
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.dialed)
    expect(satellite.dialedAt).not.toBeNull()
  })

  it('recovers a stale dialing row: CallHub ENDED commits dialed', async () => {
    // A small list finishes dialing before the stale read, so it reads back
    // END, not START. END means it dialed — resolve to dialed, never re-dial.
    const outreachId = await createDraft({
      settleState: RobocallSettleState.dialing,
    })
    await ageDialingRow(outreachId, 30)
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.END))

    await send.sweepRobocallSend()

    expect(launchSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.dialed)
    expect(satellite.dialedAt).not.toBeNull()
  })

  it('recovers a stale dialing row: CallHub ABORTED commits dialed', async () => {
    // ABORT (manual stop, or a partial run) also means the campaign left
    // PAUSED and dialed — resolve to dialed, never re-dial. How much to bill is
    // the completion/capture slice's concern, not a reason to re-dial here.
    const outreachId = await createDraft({
      settleState: RobocallSettleState.dialing,
    })
    await ageDialingRow(outreachId, 30)
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.ABORT))

    await send.sweepRobocallSend()

    expect(launchSpy).not.toHaveBeenCalled()
    const satellite = await readSatellite(outreachId)
    expect(satellite.settleState).toBe(RobocallSettleState.dialed)
    expect(satellite.dialedAt).not.toBeNull()
  })

  it('recovers a stale dialing row: CallHub PAUSED reverts to authorized', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.dialing,
    })
    await ageDialingRow(outreachId, 30)
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.PAUSE))

    await send.sweepRobocallSend()

    expect(launchSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.authorized,
    )
  })

  it('recovers a stale PERMANENTLY-FAILED dialing row by failing the send, not reverting', async () => {
    // A permanent launch reject was confirmed but failSend could not commit, so
    // the marker is set on the still-`dialing` row. The stale sweep must FAIL the
    // send off the persisted marker — never revert to `authorized` and relaunch
    // into the same 4xx, even though the status still reads PAUSED.
    const outreachId = await createDraft({
      settleState: RobocallSettleState.dialing,
    })
    await service.prisma.outreachRobocall.update({
      where: { outreachId },
      data: { permanentSendFailure: true },
    })
    await ageDialingRow(outreachId, 30)
    const failSpy = vi
      .spyOn(service.app.get(OutreachRobocallHoldService), 'failSend')
      .mockResolvedValue()
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.PAUSE))

    await send.sweepRobocallSend()

    expect(failSpy).toHaveBeenCalledWith(outreachId, 'send')
    expect(launchSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).not.toBe(
      RobocallSettleState.authorized,
    )
  })

  it('does not recover a fresh (in-flight) dialing row', async () => {
    const outreachId = await createDraft({
      settleState: RobocallSettleState.dialing,
    })
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.START))

    await send.sweepRobocallSend()

    // updatedAt is recent, so the stale predicate misses — a healthy in-flight
    // launch is never reconciled underneath itself.
    expect(statusSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialing,
    )
  })

  it('a PAUSED lost-launch reverts, then a subsequent sweep dials it', async () => {
    const outreachId = await createDraft({ sendInHours: -1 })
    launchSpy.mockRejectedValueOnce(new BadGatewayException('response lost'))
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.PAUSE))

    await send.sweepRobocallSend()
    // First pass: launch threw, CallHub PAUSED → reverted to authorized.
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.authorized,
    )

    await send.sweepRobocallSend()
    // Second pass: the retry launches successfully and dials exactly once.
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.dialed,
    )
  })
})

describe('OutreachRobocallSendService.sweepRobocallSend guards', () => {
  const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
  })

  it('no-ops off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    const outreachId = await createDraft({ sendInHours: -1 })

    await send.sweepRobocallSend()

    expect(launchSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.authorized,
    )
  })
})
