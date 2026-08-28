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
import { VoiceBroadcastCampaignStatus } from '@/vendors/callhub/schemas/callhubCampaignReport.schema'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { Campaign, RobocallSettleState } from '../../generated/prisma'

const service = useTestService()

let send: OutreachRobocallSendService
let launchSpy: ReturnType<typeof vi.spyOn>
let statusSpy: ReturnType<typeof vi.spyOn>
let retrieveSpy: ReturnType<typeof vi.spyOn>
let trackSpy: ReturnType<typeof vi.spyOn>

let campaign: Campaign
let orgSlug: string
let filterId: number

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
}: {
  sendInHours?: number
  settleState?: RobocallSettleState
  staged?: boolean
  authorizationIntentId?: string | null
  authorizedAmountInCents?: number
  withCaptureBefore?: boolean
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
      billableCount: 100,
      amountInCents: 450,
      settleState,
      ...(staged ? { callhubCampaignPkStr: 'vb_1' } : {}),
      ...(authorizationIntentId ? { authorizationIntentId } : {}),
      ...(authorizedAmountInCents != null ? { authorizedAmountInCents } : {}),
      ...(withCaptureBefore ? { captureBefore: addDays(new Date(), 5) } : {}),
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

describe('OutreachRobocallSendService.sweepRobocallSend (prod, enabled)', () => {
  const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT
  const originalEnabled = process.env.ROBOCALL_SEND_ENABLED

  beforeEach(() => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
    process.env.ROBOCALL_SEND_ENABLED = 'true'
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
    if (originalEnabled === undefined) delete process.env.ROBOCALL_SEND_ENABLED
    else process.env.ROBOCALL_SEND_ENABLED = originalEnabled
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

  it('continues past a failing draft and dials the rest', async () => {
    const a = await createDraft({ sendInHours: -1 })
    const b = await createDraft({ sendInHours: -1 })
    // One launch fails outright; its status read is PAUSED so it reverts.
    launchSpy
      .mockRejectedValueOnce(new BadGatewayException('boom'))
      .mockResolvedValue({ pk_str: 'vb_ok', status: 1 })
    statusSpy.mockResolvedValue(vbWith(CALLHUB_VB_STATUS.PAUSE))

    await send.sweepRobocallSend()

    const rows = [await readSatellite(a), await readSatellite(b)]
    const dialed = rows.filter(
      (r) => r.settleState === RobocallSettleState.dialed,
    )
    const authorized = rows.filter(
      (r) => r.settleState === RobocallSettleState.authorized,
    )
    expect(dialed).toHaveLength(1)
    expect(authorized).toHaveLength(1)
  })
})

describe('OutreachRobocallSendService.sweepRobocallSend guards', () => {
  const originalEnv = process.env.OTEL_SERVICE_ENVIRONMENT
  const originalEnabled = process.env.ROBOCALL_SEND_ENABLED

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
    else process.env.OTEL_SERVICE_ENVIRONMENT = originalEnv
    if (originalEnabled === undefined) delete process.env.ROBOCALL_SEND_ENABLED
    else process.env.ROBOCALL_SEND_ENABLED = originalEnabled
  })

  it('no-ops off prod', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'dev'
    process.env.ROBOCALL_SEND_ENABLED = 'true'
    const outreachId = await createDraft({ sendInHours: -1 })

    await send.sweepRobocallSend()

    expect(launchSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.authorized,
    )
  })

  it('no-ops on prod when the kill-switch is off', async () => {
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
    delete process.env.ROBOCALL_SEND_ENABLED
    const outreachId = await createDraft({ sendInHours: -1 })

    await send.sweepRobocallSend()

    expect(launchSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      RobocallSettleState.authorized,
    )
  })
})
