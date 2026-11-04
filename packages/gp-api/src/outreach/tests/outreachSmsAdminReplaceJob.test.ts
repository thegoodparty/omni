import { HttpStatus } from '@nestjs/common'
import { addDays, subDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { PeerlyP2pJobService } from '@/vendors/peerly/services/peerlyP2pJob.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { S3Service } from 'src/vendors/aws/services/s3.service'
import {
  OutreachStatus,
  OutreachType,
  P2pSmsSettleState,
  UserRole,
} from '../../generated/prisma'

const service = useTestService()

const OLD_JOB = 'peerly-job-flagged'
const NEW_JOB = 'peerly-job-new'
const SEND_AT = addDays(new Date(), 3)
const NEW_SEND_AT = addDays(new Date(), 4)
// ET, not runner-local: the route refuses a pair whose ET day disagrees.
const etDay = (instant: Date) =>
  formatInTimeZone(instant, 'America/New_York', 'yyyy-MM-dd')

const createPeerlyP2pJob = vi.fn()
const deleteJob = vi.fn()
const findJob = vi.fn()

const replacePayload = (overrides: Record<string, unknown> = {}) => ({
  sendAt: NEW_SEND_AT.toISOString(),
  scheduledLocalDate: etDay(NEW_SEND_AT),
  currentJobId: OLD_JOB,
  reason: 'bad_sending_number',
  replacedBy: 'cas@goodparty.org',
  ...overrides,
})

const replace = (id: number, overrides: Record<string, unknown> = {}) =>
  service.client.post(
    `/v1/outreach/admin/sms/${id}/replace-job`,
    replacePayload(overrides),
  )

// A clone made by hand in Peerly, booked there for the send day.
const CLONE_JOB = 'peerly-job-clone'
const peerlyJob = (overrides: Record<string, unknown> = {}) => ({
  id: CLONE_JOB,
  identity_id: 'identity-1',
  status: 'active',
  start_date: '2026-11-02',
  leads_remaining: 4104,
  has_canvassers_scheduled: true,
  canvassers_schedule: { approved: true },
  ...overrides,
})
// The job the send was on, finished: Peerly counts its texts as sent.
const spentJob = peerlyJob({ id: OLD_JOB, leads_remaining: 0 })

const link = (id: number, overrides: Record<string, unknown> = {}) =>
  service.client.post(`/v1/outreach/admin/sms/${id}/link-job`, {
    jobId: CLONE_JOB,
    currentJobId: OLD_JOB,
    reason: 'bad_sending_number',
    linkedBy: 'cas@goodparty.org',
    ...overrides,
  })

let campaignId: number

beforeEach(async () => {
  createPeerlyP2pJob.mockReset().mockResolvedValue(NEW_JOB)
  deleteJob.mockReset().mockResolvedValue(undefined)
  findJob
    .mockReset()
    .mockImplementation((jobId: string) =>
      Promise.resolve(jobId === OLD_JOB ? spentJob : peerlyJob()),
    )

  const peerly = service.app.get(PeerlyP2pJobService)
  vi.spyOn(peerly, 'createPeerlyP2pJob').mockImplementation(createPeerlyP2pJob)
  vi.spyOn(peerly, 'deleteJob').mockImplementation(deleteJob)
  vi.spyOn(peerly, 'findJob').mockImplementation(findJob)
  vi.spyOn(
    service.app.get(S3Service),
    'getFileBytesWithContentType',
  ).mockResolvedValue({ bytes: Buffer.from('img'), contentType: 'image/png' })

  await service.prisma.user.update({
    where: { id: service.user.id },
    data: { roles: [UserRole.admin] },
  })

  campaignId = 996
  const orgSlug = `campaign-${campaignId}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'kirk-robbins-test',
      details: { state: 'AR', zip: '72712' },
      data: {},
      aiContent: {},
    },
  })
})

// A paid, approved and booked send whose day has not come yet.
const seedSend = (
  overrides: Partial<{
    status: OutreachStatus
    canvassRequestedAt: Date | null
    approvedAt: Date | null
    date: Date
  }> = {},
) =>
  service.prisma.outreach.create({
    data: {
      campaignId,
      outreachType: OutreachType.p2p,
      name: 'kirk-robbins',
      status: OutreachStatus.pending,
      projectId: OLD_JOB,
      identityId: 'identity-1',
      phoneListId: 3240294,
      didState: 'AR',
      didNpaSubset: ['479'],
      imageUrl: 'https://assets.goodparty.org/scheduled-campaign/k/p2p/i.png',
      script: 'Hello {first_name}, Kirk here.\n\nReply STOP to opt out.',
      date: SEND_AT,
      scheduledLocalDate: etDay(SEND_AT),
      scheduledLocalTime: '10:00',
      textCount: 4104,
      billableTextCount: 4104,
      stripeCheckoutSessionId: 'cs_test_paid',
      approvedAt: subDays(new Date(), 1),
      approvedBy: 'cas@goodparty.org',
      canvassRequestedAt: subDays(new Date(), 1),
      ...overrides,
    },
  })

const reload = (id: number) =>
  service.prisma.outreach.findFirstOrThrow({
    where: { id },
    include: { p2pSms: true },
  })

const spyOnMoney = () => {
  const stripe = service.app.get(StripeService)
  return [
    vi.spyOn(stripe, 'createPaymentIntent'),
    vi.spyOn(stripe, 'createManualCaptureHold'),
    vi.spyOn(stripe, 'createOutreachManualCaptureHold'),
    vi.spyOn(stripe, 'createOffSessionCharge'),
    vi.spyOn(stripe, 'capturePaymentIntent'),
    vi.spyOn(stripe, 'createCustomCheckoutSession'),
    vi.spyOn(stripe, 'refundPaymentIntent'),
    vi.spyOn(stripe, 'refundCharge'),
    vi.spyOn(stripe, 'voidHold'),
    vi.spyOn(stripe, 'cancelHold'),
  ]
}

describe('POST /v1/outreach/admin/sms/:id/replace-job', () => {
  it('cancels the current job, makes a new one, and puts the send back in review', async () => {
    const row = await seedSend()

    const res = await replace(row.id)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toMatchObject({
      approvalStatus: 'awaiting_review',
      jobId: NEW_JOB,
      previousJobId: OLD_JOB,
      jobReplacedBy: 'cas@goodparty.org',
      jobReplaceReason: 'Peerly flagged the sending number',
    })
    // Built from what the row stores, on the new day, on the same list.
    expect(createPeerlyP2pJob).toHaveBeenCalledTimes(1)
    expect(createPeerlyP2pJob).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId,
        listId: 3240294,
        identityId: 'identity-1',
        scriptText: row.script,
        didState: 'AR',
        didNpaSubset: ['479'],
        scheduledDate: etDay(NEW_SEND_AT),
        scheduledStartTime: '10:00',
      }),
    )
    expect(deleteJob).toHaveBeenCalledTimes(1)
    expect(deleteJob).toHaveBeenCalledWith(OLD_JOB)

    const updated = await reload(row.id)
    expect(updated).toMatchObject({
      projectId: NEW_JOB,
      status: OutreachStatus.pending,
      scheduledLocalDate: etDay(NEW_SEND_AT),
      approvedAt: null,
      approvedBy: null,
      canvassRequestedAt: null,
      previousJobId: OLD_JOB,
      jobReplaceClaimedAt: null,
    })
    expect(updated.date?.toISOString()).toBe(NEW_SEND_AT.toISOString())
    expect(updated.jobReplacedAt).not.toBeNull()
  })

  it('stores the typed reason for "other"', async () => {
    const row = await seedSend()

    const res = await replace(row.id, {
      reason: 'other',
      otherReason: 'Candidate asked to move the day',
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect((await reload(row.id)).jobReplaceReason).toBe(
      'Candidate asked to move the day',
    )
  })

  it('needs words for "other"', async () => {
    const row = await seedSend()

    const res = await replace(row.id, { reason: 'other' })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(createPeerlyP2pJob).not.toHaveBeenCalled()
  })

  it('replaces an unbooked send too', async () => {
    const row = await seedSend({ approvedAt: null, canvassRequestedAt: null })

    const res = await replace(row.id)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect((await reload(row.id)).projectId).toBe(NEW_JOB)
  })

  it('creates no charge or hold and leaves the payment record intact', async () => {
    const row = await seedSend()
    await service.prisma.outreachP2pSms.create({
      data: {
        outreachId: row.id,
        settleState: P2pSmsSettleState.captured,
        capturedAmountInCents: 14364,
        chargeIntentId: 'pi_test_captured',
      },
    })
    const moneyCalls = spyOnMoney()

    const res = await replace(row.id)

    expect(res.status).toBe(HttpStatus.CREATED)
    for (const call of moneyCalls) expect(call).not.toHaveBeenCalled()
    const updated = await reload(row.id)
    expect(updated.stripeCheckoutSessionId).toBe('cs_test_paid')
    expect(updated.billableTextCount).toBe(4104)
    expect(updated.p2pSms).toMatchObject({
      settleState: P2pSmsSettleState.captured,
      capturedAmountInCents: 14364,
      chargeIntentId: 'pi_test_captured',
    })
  })

  it('refuses a send that has already gone out', async () => {
    const row = await seedSend({
      status: OutreachStatus.completed,
      date: subDays(new Date(), 2),
    })

    const res = await replace(row.id)

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(JSON.stringify(res.data)).toContain('link it instead')
    expect(createPeerlyP2pJob).not.toHaveBeenCalled()
    expect(deleteJob).not.toHaveBeenCalled()
  })

  it('refuses a send that is booked on its send day', async () => {
    const row = await seedSend({ status: OutreachStatus.in_progress })

    const res = await replace(row.id)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(JSON.stringify(res.data)).toContain('already sending')
    expect(createPeerlyP2pJob).not.toHaveBeenCalled()
  })

  it('refuses a send booked by hand in Peerly on its send day', async () => {
    const row = await seedSend({
      status: OutreachStatus.in_progress,
      approvedAt: null,
      canvassRequestedAt: null,
    })
    findJob.mockResolvedValue(peerlyJob({ id: OLD_JOB }))

    const res = await replace(row.id)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(createPeerlyP2pJob).not.toHaveBeenCalled()
  })

  it('replaces an unbooked send on its send day', async () => {
    const row = await seedSend({
      status: OutreachStatus.in_progress,
      approvedAt: null,
      canvassRequestedAt: null,
    })
    findJob.mockResolvedValue(
      peerlyJob({
        id: OLD_JOB,
        has_canvassers_scheduled: false,
        canvassers_schedule: null,
      }),
    )

    const res = await replace(row.id)

    expect(res.status).toBe(HttpStatus.CREATED)
  })

  it('refuses a canceled send', async () => {
    const row = await seedSend({ status: OutreachStatus.canceled })

    const res = await replace(row.id)

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(createPeerlyP2pJob).not.toHaveBeenCalled()
  })

  it('refuses a send day in the past', async () => {
    const row = await seedSend()
    const past = subDays(new Date(), 1)

    const res = await replace(row.id, {
      sendAt: past.toISOString(),
      scheduledLocalDate: etDay(past),
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(createPeerlyP2pJob).not.toHaveBeenCalled()
  })

  it('removes the new job and changes nothing when the current one cannot be canceled', async () => {
    const row = await seedSend()
    deleteJob.mockImplementation((jobId: string) =>
      jobId === OLD_JOB
        ? Promise.reject(new Error('peerly down'))
        : Promise.resolve(undefined),
    )

    const res = await replace(row.id)

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
    expect(deleteJob).toHaveBeenCalledWith(NEW_JOB)
    const untouched = await reload(row.id)
    expect(untouched.projectId).toBe(OLD_JOB)
    expect(untouched.canvassRequestedAt).not.toBeNull()
    expect(untouched.jobReplaceClaimedAt).toBeNull()
  })

  it('releases the claim when the vendor create fails, so a retry works', async () => {
    const row = await seedSend()
    createPeerlyP2pJob.mockRejectedValueOnce(new Error('peerly down'))

    const failed = await replace(row.id)
    expect(failed.status).toBe(HttpStatus.BAD_GATEWAY)
    const afterFailure = await reload(row.id)
    expect(afterFailure.projectId).toBe(OLD_JOB)
    expect(afterFailure.jobReplaceClaimedAt).toBeNull()
    expect(deleteJob).not.toHaveBeenCalled()

    const retry = await replace(row.id)
    expect(retry.status).toBe(HttpStatus.CREATED)
    expect(createPeerlyP2pJob).toHaveBeenCalledTimes(2)
  })

  it('makes one job for a double click', async () => {
    const row = await seedSend()
    let finishCreate: (jobId: string) => void = () => undefined
    createPeerlyP2pJob.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishCreate = resolve
        }),
    )

    const first = replace(row.id)
    await vi.waitFor(() => expect(createPeerlyP2pJob).toHaveBeenCalled())
    const second = await replace(row.id)
    finishCreate(NEW_JOB)
    const firstRes = await first

    expect(firstRes.status).toBe(HttpStatus.CREATED)
    expect(second.status).toBe(HttpStatus.CONFLICT)
    expect(createPeerlyP2pJob).toHaveBeenCalledTimes(1)
  })

  it('refuses a retry once the replacement has landed', async () => {
    const row = await seedSend()
    expect((await replace(row.id)).status).toBe(HttpStatus.CREATED)

    // The retry still names the job the admin saw, which is gone.
    const retry = await replace(row.id)

    expect(retry.status).toBe(HttpStatus.CONFLICT)
    expect(createPeerlyP2pJob).toHaveBeenCalledTimes(1)
    expect((await reload(row.id)).projectId).toBe(NEW_JOB)
  })
})

describe('POST /v1/outreach/admin/sms/:id/link-job', () => {
  // The 2026-11-02 case: the send went out on a bad number, and CAS cloned
  // the job by hand in Peerly and booked canvassers there.
  const seedSentSend = () =>
    seedSend({
      status: OutreachStatus.completed,
      date: subDays(new Date(), 3),
    })

  it('points the send at a job cloned and booked by hand in Peerly', async () => {
    const row = await seedSentSend()

    const res = await link(row.id)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toMatchObject({
      jobId: CLONE_JOB,
      previousJobId: OLD_JOB,
      jobReplaceReason: 'Peerly flagged the sending number',
      jobReplacedBy: 'cas@goodparty.org',
    })
    expect(findJob).toHaveBeenCalledWith(CLONE_JOB)
    // Nothing is written to the vendor on this path.
    expect(createPeerlyP2pJob).not.toHaveBeenCalled()
    expect(deleteJob).not.toHaveBeenCalled()

    const updated = await reload(row.id)
    expect(updated).toMatchObject({
      projectId: CLONE_JOB,
      status: OutreachStatus.pending,
      scheduledLocalDate: '2026-11-02',
      // Replies still map through the list we built and captured.
      phoneListId: 3240294,
      approvedBy: 'cas@goodparty.org',
      jobReplaceClaimedAt: null,
    })
    // 10:00 ET on 2026-11-02 (EST).
    expect(updated.date?.toISOString()).toBe('2026-11-02T15:00:00.000Z')
    // Booked in Peerly, so it reads booked here too.
    expect(updated.canvassRequestedAt).not.toBeNull()
    expect(updated.approvedAt).not.toBeNull()
  })

  it('sends an unbooked clone to awaiting review', async () => {
    const row = await seedSentSend()
    findJob.mockImplementation((jobId: string) =>
      Promise.resolve(
        jobId === OLD_JOB
          ? spentJob
          : peerlyJob({
              has_canvassers_scheduled: false,
              canvassers_schedule: null,
            }),
      ),
    )

    const res = await link(row.id)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.approvalStatus).toBe('awaiting_review')
    const updated = await reload(row.id)
    expect(updated.canvassRequestedAt).toBeNull()
    expect(updated.approvedAt).toBeNull()
  })

  it('links when the current job was deleted in Peerly', async () => {
    const row = await seedSend()
    findJob.mockImplementation((jobId: string) =>
      Promise.resolve(jobId === OLD_JOB ? null : peerlyJob()),
    )

    const res = await link(row.id)

    expect(res.status).toBe(HttpStatus.CREATED)
  })

  it('refuses while the current job still has texts to send', async () => {
    const row = await seedSend()
    findJob.mockImplementation((jobId: string) =>
      Promise.resolve(peerlyJob({ id: jobId })),
    )

    const res = await link(row.id)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(JSON.stringify(res.data)).toContain('still has texts to send')
    expect((await reload(row.id)).projectId).toBe(OLD_JOB)
  })

  it('refuses a job on a different identity', async () => {
    const row = await seedSentSend()
    findJob.mockImplementation((jobId: string) =>
      Promise.resolve(
        jobId === OLD_JOB
          ? spentJob
          : peerlyJob({ identity_id: 'someone-else' }),
      ),
    )

    const res = await link(row.id)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(JSON.stringify(res.data)).toContain('different identity')
    expect((await reload(row.id)).projectId).toBe(OLD_JOB)
  })

  it('refuses a job Peerly does not have', async () => {
    const row = await seedSentSend()
    findJob.mockImplementation((jobId: string) =>
      Promise.resolve(jobId === OLD_JOB ? spentJob : null),
    )

    const res = await link(row.id)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect((await reload(row.id)).projectId).toBe(OLD_JOB)
  })

  it('refuses a deleted job', async () => {
    const row = await seedSentSend()
    findJob.mockImplementation((jobId: string) =>
      Promise.resolve(
        jobId === OLD_JOB ? spentJob : peerlyJob({ status: 'deleted' }),
      ),
    )

    const res = await link(row.id)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('refuses a job another send already follows', async () => {
    const row = await seedSentSend()
    await service.prisma.outreach.update({
      where: { id: (await seedSentSend()).id },
      data: { projectId: CLONE_JOB },
    })

    const res = await link(row.id)

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(findJob).not.toHaveBeenCalled()
  })

  it('refuses the job the send already has', async () => {
    const row = await seedSentSend()

    const res = await link(row.id, { jobId: OLD_JOB })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('refuses when the send is already on another job', async () => {
    const row = await seedSentSend()

    const res = await link(row.id, { currentJobId: 'some-older-job' })

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(findJob).not.toHaveBeenCalled()
  })

  it('creates no charge and leaves the payment record intact', async () => {
    const row = await seedSentSend()
    const moneyCalls = spyOnMoney()

    const res = await link(row.id)

    expect(res.status).toBe(HttpStatus.CREATED)
    for (const call of moneyCalls) expect(call).not.toHaveBeenCalled()
    const updated = await reload(row.id)
    expect(updated.stripeCheckoutSessionId).toBe('cs_test_paid')
    expect(updated.billableTextCount).toBe(4104)
  })
})
