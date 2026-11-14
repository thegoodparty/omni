import { HttpStatus } from '@nestjs/common'
import { subDays } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { PeerlyCdrCsvRow } from '@/vendors/peerly/schemas/peerlyJobResultsReport.schema'
import { PeerlyJobResultsService } from '@/vendors/peerly/services/peerlyJobResults.service'
import { OutreachType, UserRole } from '../../generated/prisma'
import { OutreachInboundSweepService } from '../services/outreachInboundSweep.service'

const service = useTestService({ jobs: true })

const ENDPOINT = '/v1/outreach/admin/sms/backfill-replies'
const PHONE_LIST_ID = 7001

const fetchInboundCdrRows =
  vi.fn<(jobId: string) => Promise<PeerlyCdrCsvRow[]>>()

const replyRow = (content: string): PeerlyCdrCsvRow =>
  ({
    Timestamp: '2026-07-17 10:23:46',
    Direction: 'received',
    From: '13035550101',
    To: '18885550000',
    Content: content,
  }) as PeerlyCdrCsvRow

let campaignId: number
let infoSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>

const seedSend = async (params: {
  projectId: string
  previousJobId?: string
  date: Date
}) => {
  const outreach = await service.prisma.outreach.create({
    data: {
      campaignId,
      outreachType: OutreachType.p2p,
      phoneListId: PHONE_LIST_ID,
      ...params,
    },
  })
  await service.prisma.contactInteractionText.create({
    data: {
      organizationSlug: `campaign-${campaignId}`,
      personId: 'person-1',
      outreachId: outreach.id,
      occurredAt: params.date,
    },
  })
  return outreach
}

const messagesOf = (outreachId: number) =>
  service.prisma.pollIndividualMessage.findMany({ where: { outreachId } })

const summaryLog = () =>
  infoSpy.mock.calls.find(
    ([, message]: unknown[]) =>
      message === '[Outreach Win Reply Backfill] summary',
  )?.[0]

beforeEach(async () => {
  await service.prisma.user.update({
    where: { id: service.user.id },
    data: { roles: [UserRole.admin] },
  })
  campaignId = 7000
  const organizationSlug = `campaign-${campaignId}`
  await service.prisma.organization.create({
    data: { slug: organizationSlug, ownerId: service.user.id, positionId: 'p' },
  })
  await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug,
      userId: service.user.id,
      slug: 'jane-doe-backfill',
    },
  })
  await service.prisma.peerlyPhoneList.create({
    data: {
      organizationSlug,
      campaignId,
      token: 'token-backfill',
      peerlyListId: PHONE_LIST_ID,
      recipients: {
        createMany: {
          data: [{ personId: 'person-1', phone: '+13035550101' }],
        },
      },
    },
  })

  fetchInboundCdrRows.mockReset().mockResolvedValue([])
  vi.spyOn(
    service.app.get(PeerlyJobResultsService),
    'fetchInboundCdrRows',
  ).mockImplementation(fetchInboundCdrRows)
  const logger = (
    service.app.get(OutreachInboundSweepService) as unknown as {
      logger: PinoLogger
    }
  ).logger
  infoSpy = vi.spyOn(logger, 'info')
  warnSpy = vi.spyOn(logger, 'warn')
})

describe('POST /outreach/admin/sms/backfill-replies', () => {
  it('refuses a non-admin', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [] },
    })

    const res = await service.client.post(ENDPOINT, { dryRun: true })

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('rejects a body without dryRun', async () => {
    const res = await service.client.post(ENDPOINT, {})

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('counts on a dry run, writes on a real run, and writes nothing new on a re-run', async () => {
    const send = await seedSend({
      projectId: 'current-job',
      previousJobId: 'previous-job',
      date: new Date(),
    })
    const tooOld = await seedSend({
      projectId: 'expired-job',
      date: subDays(new Date(), 120),
    })
    fetchInboundCdrRows.mockImplementation(async (jobId) =>
      jobId === 'previous-job' ? [replyRow('Early reply')] : [],
    )

    const dry = await service.client.post(ENDPOINT, { dryRun: true })
    expect(dry.status).toBe(HttpStatus.ACCEPTED)
    expect(dry.data.jobId).toEqual(expect.any(String))
    await service.jobs.settle()

    expect(await messagesOf(send.id)).toEqual([])
    expect(summaryLog()).toEqual(
      expect.objectContaining({
        dryRun: true,
        sends: 1,
        jobsRead: 2,
        messagesFound: 1,
        messagesWritten: 0,
        jobsFailed: 0,
      }),
    )
    expect(fetchInboundCdrRows.mock.calls.map(([jobId]) => jobId)).toEqual([
      'current-job',
      'previous-job',
    ])

    infoSpy.mockClear()
    await service.client.post(ENDPOINT, { dryRun: false })
    await service.jobs.settle()

    const messages = await messagesOf(send.id)
    expect(messages.map(({ content }) => content)).toEqual(['Early reply'])
    expect(await messagesOf(tooOld.id)).toEqual([])
    expect(summaryLog()).toEqual(
      expect.objectContaining({ dryRun: false, messagesWritten: 1 }),
    )

    infoSpy.mockClear()
    await service.client.post(ENDPOINT, { dryRun: false })
    await service.jobs.settle()

    expect(await messagesOf(send.id)).toHaveLength(1)
    expect(summaryLog()).toEqual(
      expect.objectContaining({ messagesFound: 1, messagesWritten: 0 }),
    )
  })

  it('records a failed Peerly job, still reads the rest, and never logs reply text', async () => {
    const send = await seedSend({
      projectId: 'current-job',
      previousJobId: 'previous-job',
      date: new Date(),
    })
    fetchInboundCdrRows.mockImplementation(async (jobId) => {
      if (jobId === 'previous-job') throw new Error('Peerly report timed out')
      return [replyRow('A private reply')]
    })

    await service.client.post(ENDPOINT, { dryRun: false })
    const { deadLetters } = await service.jobs.settle({
      allowDeadLetters: true,
    })

    expect(deadLetters).toEqual([])
    expect(await messagesOf(send.id)).toHaveLength(1)
    expect(summaryLog()).toEqual(
      expect.objectContaining({ jobsRead: 1, jobsFailed: 1 }),
    )
    expect(warnSpy).toHaveBeenCalledWith(
      {
        dryRun: false,
        failedJobs: [
          {
            outreachId: send.id,
            jobId: 'previous-job',
            error: 'Peerly report timed out',
          },
        ],
      },
      '[Outreach Win Reply Backfill] jobs failed',
    )
    expect(
      JSON.stringify([...infoSpy.mock.calls, ...warnSpy.mock.calls]),
    ).not.toContain('A private reply')
  })
})
