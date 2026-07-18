import { BadGatewayException } from '@nestjs/common'
import { addDays, format, subDays } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { DateFormats } from '@/shared/util/date.util'
import { PeerlyP2pJobService } from '@/vendors/peerly/services/peerlyP2pJob.service'
import { PeerlyJob, PeerlyJobStatus } from '@/vendors/peerly/peerly.types'
import {
  Campaign,
  Outreach,
  OutreachStatus,
  OutreachType,
} from '../../generated/prisma'
import { OutreachCompletionService } from './outreachCompletion.service'

const service = useTestService()

const getJob = vi.fn<(jobId: string) => Promise<PeerlyJob>>()

const DEFAULT_PROJECT_ID = 'peerly-job'

// The completion predicate compares a job's `end_date` against the real
// wall-clock date (`sweepOutreachCompletions` sources `now` itself), so these
// fixtures are relative to today rather than fixed calendar dates.
const PAST_END_DATE = format(subDays(new Date(), 1), DateFormats.isoDate)
const TODAY_END_DATE = format(new Date(), DateFormats.isoDate)
const FUTURE_END_DATE = format(addDays(new Date(), 1), DateFormats.isoDate)

let campaign: Campaign
let completionService: OutreachCompletionService

const buildJob = (
  overrides: Partial<
    Pick<PeerlyJob, 'status' | 'leads_remaining' | 'end_date'>
  >,
): PeerlyJob =>
  ({
    id: DEFAULT_PROJECT_ID,
    status: PeerlyJobStatus.ACTIVE,
    leads_remaining: 10,
    end_date: FUTURE_END_DATE,
    ...overrides,
  }) as PeerlyJob

const createOutreach = (overrides: Partial<Outreach> = {}) =>
  service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      outreachType: OutreachType.p2p,
      projectId: DEFAULT_PROJECT_ID,
      status: OutreachStatus.pending,
      ...overrides,
    },
  })

const findOutreach = (id: number) =>
  service.prisma.outreach.findUniqueOrThrow({ where: { id } })

beforeEach(async () => {
  getJob.mockReset()
  const peerlySvc = service.app.get(PeerlyP2pJobService)
  vi.spyOn(peerlySvc, 'getJob').mockImplementation(getJob)

  completionService = service.app.get(OutreachCompletionService)

  const campaignId = 5001
  const orgSlug = `campaign-${campaignId}`

  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })

  campaign = await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe',
    },
  })
})

describe('OutreachCompletionService.sweepOutreachCompletions', () => {
  it('moves a pending outreach to in_progress when the Peerly job is active', async () => {
    const outreach = await createOutreach({ status: OutreachStatus.pending })
    getJob.mockResolvedValue(
      buildJob({ status: PeerlyJobStatus.ACTIVE, leads_remaining: 5 }),
    )

    await completionService.sweepOutreachCompletions()

    const updated = await findOutreach(outreach.id)
    expect(updated.status).toBe(OutreachStatus.in_progress)
  })

  it('moves an in_progress outreach to completed once end_date is strictly in the past, regardless of leads_remaining', async () => {
    const outreach = await createOutreach({
      status: OutreachStatus.in_progress,
    })
    getJob.mockResolvedValue(
      buildJob({
        status: PeerlyJobStatus.ACTIVE,
        leads_remaining: 500,
        end_date: PAST_END_DATE,
      }),
    )

    await completionService.sweepOutreachCompletions()

    const updated = await findOutreach(outreach.id)
    expect(updated.status).toBe(OutreachStatus.completed)
  })

  it.each([
    ['today', TODAY_END_DATE],
    ['in the future', FUTURE_END_DATE],
  ])(
    'does not complete a job whose end_date is %s, even with leads_remaining 0',
    async (_label, endDate) => {
      const outreach = await createOutreach({ status: OutreachStatus.pending })
      getJob.mockResolvedValue(
        buildJob({
          status: PeerlyJobStatus.ACTIVE,
          leads_remaining: 0,
          end_date: endDate,
        }),
      )

      await completionService.sweepOutreachCompletions()

      const updated = await findOutreach(outreach.id)
      expect(updated.status).toBe(OutreachStatus.in_progress)
    },
  )

  it('does not ratchet a pending outreach to completed when the job is still pending, even past its end_date', async () => {
    // Reproduces the pre-fix ratchet bug: a fresh job can be polled while
    // still PENDING (not yet loaded by a Peerly agent) with an end_date the
    // scheduler has already passed. The pending branch must win.
    const outreach = await createOutreach({ status: OutreachStatus.pending })
    getJob.mockResolvedValue(
      buildJob({ status: PeerlyJobStatus.PENDING, end_date: PAST_END_DATE }),
    )

    await completionService.sweepOutreachCompletions()

    const updated = await findOutreach(outreach.id)
    expect(updated.status).toBe(OutreachStatus.pending)
  })

  it('treats a null status the same as pending (picked up + advanced)', async () => {
    const outreach = await createOutreach({ status: null })
    getJob.mockResolvedValue(
      buildJob({ status: PeerlyJobStatus.ACTIVE, leads_remaining: 10 }),
    )

    await completionService.sweepOutreachCompletions()

    expect(getJob).toHaveBeenCalledWith(DEFAULT_PROJECT_ID)
    const updated = await findOutreach(outreach.id)
    expect(updated.status).toBe(OutreachStatus.in_progress)
  })

  it('never touches outreaches without a projectId', async () => {
    const outreach = await createOutreach({
      projectId: null,
      status: OutreachStatus.pending,
    })

    await completionService.sweepOutreachCompletions()

    expect(getJob).not.toHaveBeenCalled()
    const updated = await findOutreach(outreach.id)
    expect(updated.status).toBe(OutreachStatus.pending)
  })

  it.each([
    OutreachStatus.pending_payment,
    OutreachStatus.denied,
    OutreachStatus.completed,
  ])('never touches a %s outreach even with a projectId', async (status) => {
    const outreach = await createOutreach({ status })

    await completionService.sweepOutreachCompletions()

    expect(getJob).not.toHaveBeenCalled()
    const updated = await findOutreach(outreach.id)
    expect(updated.status).toBe(status)
  })

  it('leaves the outreach status untouched (and logs) when the Peerly job is deleted', async () => {
    const outreach = await createOutreach({
      status: OutreachStatus.in_progress,
    })
    getJob.mockResolvedValue(
      buildJob({ status: PeerlyJobStatus.DELETED, leads_remaining: 3 }),
    )

    await completionService.sweepOutreachCompletions()

    const updated = await findOutreach(outreach.id)
    expect(updated.status).toBe(OutreachStatus.in_progress)
  })

  it('leaves the outreach status untouched (and logs) when the Peerly job errored', async () => {
    const outreach = await createOutreach({ status: OutreachStatus.pending })
    getJob.mockResolvedValue(
      buildJob({ status: PeerlyJobStatus.ERROR, leads_remaining: 3 }),
    )

    await completionService.sweepOutreachCompletions()

    const updated = await findOutreach(outreach.id)
    expect(updated.status).toBe(OutreachStatus.pending)
  })

  it('never regresses status backward on a stale/odd Peerly read', async () => {
    // An in_progress row whose job now reports `pending` (Peerly regressing
    // its own status) must not drag the outreach status backward with it.
    const outreach = await createOutreach({
      status: OutreachStatus.in_progress,
    })
    getJob.mockResolvedValue(
      buildJob({ status: PeerlyJobStatus.PENDING, leads_remaining: 10 }),
    )

    await completionService.sweepOutreachCompletions()

    const updated = await findOutreach(outreach.id)
    expect(updated.status).toBe(OutreachStatus.in_progress)
  })

  it('continues the sweep past a Peerly error on one job (no page, no abort)', async () => {
    const failing = await createOutreach({
      projectId: 'job-fail',
      status: OutreachStatus.pending,
    })
    const healthy = await createOutreach({
      projectId: 'job-ok',
      status: OutreachStatus.pending,
    })

    getJob.mockImplementation((jobId: string) =>
      jobId === 'job-fail'
        ? Promise.reject(new BadGatewayException('Failed to fetch P2P job'))
        : Promise.resolve(
            buildJob({ status: PeerlyJobStatus.ACTIVE, leads_remaining: 5 }),
          ),
    )

    await expect(
      completionService.sweepOutreachCompletions(),
    ).resolves.toBeUndefined()

    const updatedFailing = await findOutreach(failing.id)
    const updatedHealthy = await findOutreach(healthy.id)
    expect(updatedFailing.status).toBe(OutreachStatus.pending)
    expect(updatedHealthy.status).toBe(OutreachStatus.in_progress)
  })

  it('is idempotent: a second run produces no additional writes', async () => {
    const outreach = await createOutreach({ status: OutreachStatus.pending })
    getJob.mockResolvedValue(
      buildJob({ status: PeerlyJobStatus.ACTIVE, leads_remaining: 5 }),
    )

    await completionService.sweepOutreachCompletions()
    const afterFirst = await findOutreach(outreach.id)
    expect(afterFirst.status).toBe(OutreachStatus.in_progress)

    await completionService.sweepOutreachCompletions()
    const afterSecond = await findOutreach(outreach.id)

    expect(afterSecond.status).toBe(OutreachStatus.in_progress)
    // `updatedAt` unchanged proves the second sweep issued no write for this
    // row, not just that the value happened to match.
    expect(afterSecond.updatedAt).toEqual(afterFirst.updatedAt)
  })
})
