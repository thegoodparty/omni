import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import {
  OutreachStatus,
  OutreachType,
  PollAudienceKind,
  Prisma,
} from '@/generated/prisma'
import { JobsService } from '@/jobs/jobs.service'
import { useTestService } from '@/test-service'
import { OutreachServePollExpansionService } from '../services/outreachServePollExpansion.service'
import {
  OutreachTextDeliveryService,
  type RequestSendResult,
} from '../services/outreachTextDelivery.service'
import { OutreachTextSendFundingService } from '../services/outreachTextSendFunding.service'
import { outreachTextSendJob } from '../util/outreachTextSendJob.util'

// The outreachTextSend job: what it reads off the row and hands the delivery
// layer, and which outcomes complete and which retry. The delivery layer is
// stubbed here; its own tests and the producers' tests cover the send.
const service = useTestService({ jobs: true })

const delivered: RequestSendResult = {
  audienceResolved: true,
  recipientCount: 2,
  excludedOptedOutCount: 0,
  excludedDuplicateCount: 0,
  sendKey: 'send.csv',
}

let slug: string
let filterId: number
let requestSend: Mock<OutreachTextDeliveryService['requestSend']>
let fundingCheck: Mock<OutreachTextSendFundingService['check']>
let reportRefusal: Mock<OutreachTextSendFundingService['reportRefusal']>

beforeEach(async () => {
  slug = `eo-text-job-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  filterId = (
    await service.prisma.voterFileFilter.create({
      data: { organizationSlug: slug, name: 'constituents' },
    })
  ).id
  requestSend = vi
    .fn<OutreachTextDeliveryService['requestSend']>()
    .mockResolvedValue(delivered)
  vi.spyOn(
    service.app.get(OutreachTextDeliveryService),
    'requestSend',
  ).mockImplementation(requestSend)
  const funding = service.app.get(OutreachTextSendFundingService)
  fundingCheck = vi
    .fn<OutreachTextSendFundingService['check']>()
    .mockResolvedValue({ funded: true, via: 'checkout' })
  vi.spyOn(funding, 'check').mockImplementation(fundingCheck)
  reportRefusal = vi
    .fn<OutreachTextSendFundingService['reportRefusal']>()
    .mockResolvedValue(undefined)
  vi.spyOn(funding, 'reportRefusal').mockImplementation(reportRefusal)
})

const createSend = (data: Partial<Prisma.OutreachUncheckedCreateInput> = {}) =>
  service.prisma.outreach.create({
    data: {
      organizationSlug: slug,
      campaignId: null,
      outreachType: OutreachType.text,
      status: OutreachStatus.pending,
      message: 'Trash pickup moves to Thursday.',
      imageUrl: 'https://example.com/flyer.png',
      scheduledLocalDate: '2026-10-08',
      voterFileFilterId: filterId,
      textCount: 412,
      ...data,
    },
  })

const createPoll = async (
  data: Partial<Prisma.OutreachUncheckedCreateInput> = {},
  audienceKind: PollAudienceKind = PollAudienceKind.sample,
) => {
  const poll = await createSend({
    outreachType: OutreachType.poll,
    approvedAt: new Date('2026-10-10T12:00:00Z'),
    message: 'Hi, do you support the park?',
    imageUrl: null,
    scheduledLocalDate: '2026-10-14',
    voterFileFilterId: null,
    textCount: 250,
    ...data,
  })
  await service.prisma.outreachPoll.create({
    data: { outreachId: poll.id, topic: 'parks', audienceKind },
  })
  return poll
}

const send = async (
  data: Parameters<typeof outreachTextSendJob>[0],
  options: { allowDeadLetters?: boolean } = {},
) => {
  await service.app
    .get(JobsService)
    .sendMany('outreachTextSend', [outreachTextSendJob(data)])
  return service.jobs.settle(options)
}

describe('outreachTextSend', () => {
  it('hands the row audience to the delivery layer', async () => {
    const outreach = await createSend()

    await send({ outreachId: outreach.id, sendSeq: 1 })

    expect(requestSend).toHaveBeenCalledExactlyOnceWith({
      outreachId: outreach.id,
      sendSeq: 1,
      audience: { kind: 'savedFilter', voterFileFilterId: filterId },
      message: 'Trash pickup moves to Thursday.',
      imageUrl: 'https://example.com/flyer.png',
      scheduledLocalDate: '2026-10-08',
      paidRecipientCap: 412,
      agentHandoff: undefined,
      signal: expect.any(AbortSignal),
    })
  })

  it('passes an agent hand-off on the job to the delivery layer', async () => {
    const outreach = await createSend()

    await send({
      outreachId: outreach.id,
      sendSeq: 1,
      agentHandoff: {
        mode: 'shadow',
        sendAt: '2026-10-10T18:00:00.000Z',
        timeZone: 'US/Pacific',
      },
    })

    expect(requestSend).toHaveBeenCalledWith(
      expect.objectContaining({
        agentHandoff: {
          mode: 'shadow',
          sendAt: new Date('2026-10-10T18:00:00.000Z'),
          timeZone: 'US/Pacific',
        },
      }),
    )
  })

  it('refuses an agent hand-off with a time zone that is not one', async () => {
    const outreach = await createSend()

    await expect(
      send({
        outreachId: outreach.id,
        sendSeq: 1,
        agentHandoff: {
          mode: 'auto',
          sendAt: '2026-10-10T18:00:00.000Z',
          timeZone: 'Mars/Olympus',
        },
      }),
    ).rejects.toThrow('Not an IANA time zone')
    expect(requestSend).not.toHaveBeenCalled()
  })

  it('completes an unfunded send without building an audience', async () => {
    fundingCheck.mockResolvedValue({ funded: false, reason: 'unpaid' })
    const outreach = await createSend()

    await send({ outreachId: outreach.id, sendSeq: 1 })

    expect(reportRefusal).toHaveBeenCalledWith(outreach.id, 1, 'unpaid')
    expect(requestSend).not.toHaveBeenCalled()
  })

  it('leaves a send that is not pending to the delivery claim', async () => {
    fundingCheck.mockResolvedValue({ funded: false, reason: 'not_sendable' })
    requestSend.mockResolvedValue({
      ...delivered,
      audienceResolved: false,
      recipientCount: 0,
      terminalReason: 'not_sendable',
    })
    const outreach = await createSend()

    await send({ outreachId: outreach.id, sendSeq: 1 })

    expect(reportRefusal).not.toHaveBeenCalled()
    expect(requestSend).toHaveBeenCalledOnce()
  })

  it.each(['not_sendable', 'send_failed', 'unfunded'] as const)(
    'completes, without retrying, a send the delivery layer ends as %s',
    async (terminalReason) => {
      requestSend.mockResolvedValue({
        ...delivered,
        audienceResolved: false,
        recipientCount: 0,
        terminalReason,
      })
      const outreach = await createSend()

      await send({ outreachId: outreach.id, sendSeq: 1 })

      expect(requestSend).toHaveBeenCalledOnce()
    },
  )

  it('completes a send for an outreach that no longer exists', async () => {
    await send({ outreachId: 999_999, sendSeq: 1 })

    expect(requestSend).not.toHaveBeenCalled()
  })

  it('completes a row missing the saved list, without sending', async () => {
    const outreach = await createSend({ voterFileFilterId: null })

    await send({ outreachId: outreach.id, sendSeq: 1 })

    expect(requestSend).not.toHaveBeenCalled()
  })

  it('never sends a round 2 text before its draw', async () => {
    const list = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: slug, sampleSize: 40 },
    })
    const outreach = await createSend({ voterFileFilterId: list.id })

    await send({ outreachId: outreach.id, sendSeq: 1 })

    expect(requestSend).not.toHaveBeenCalled()
  })

  // A genuine fault (S3, Slack, the database) retries: the send is
  // idempotent, and one that keeps failing has to reach the dead letter.
  it('retries a delivery failure and dead-letters it once attempts run out', async () => {
    requestSend.mockRejectedValue(new Error('S3 write failed'))
    const outreach = await createSend()

    const { deadLetters } = await send(
      { outreachId: outreach.id, sendSeq: 1 },
      { allowDeadLetters: true },
    )

    expect(requestSend).toHaveBeenCalledTimes(3)
    expect(deadLetters).toEqual([
      {
        name: 'outreachTextSend',
        data: { outreachId: outreach.id, sendSeq: 1 },
        error: 'S3 write failed',
      },
    ])
  })

  describe('for a poll', () => {
    it('delivers a sample poll as a sample of textCount people', async () => {
      const poll = await createPoll()

      await send({ outreachId: poll.id, sendSeq: 1 })

      expect(requestSend).toHaveBeenCalledWith(
        expect.objectContaining({
          audience: { kind: 'sample', size: 250 },
          paidRecipientCap: 250,
        }),
      )
    })

    it('delivers a list poll to its saved filter', async () => {
      const poll = await createPoll(
        { voterFileFilterId: filterId },
        PollAudienceKind.list,
      )

      await send({ outreachId: poll.id, sendSeq: 1 })

      expect(requestSend).toHaveBeenCalledWith(
        expect.objectContaining({
          audience: { kind: 'savedFilter', voterFileFilterId: filterId },
        }),
      )
    })

    it('sends nothing for a poll that was never approved', async () => {
      const poll = await createPoll({ approvedAt: null })

      await send({ outreachId: poll.id, sendSeq: 1 })

      expect(requestSend).not.toHaveBeenCalled()
    })

    it('delivers an expansion as a sample that excludes earlier recipients', async () => {
      const poll = await createPoll()
      const resolveDelivery = vi
        .spyOn(
          service.app.get(OutreachServePollExpansionService),
          'resolveDelivery',
        )
        .mockResolvedValue({
          textCount: 80,
          excludePersonIds: ['person-1', 'person-2'],
        })

      await send({ outreachId: poll.id, sendSeq: 2 })

      expect(resolveDelivery).toHaveBeenCalledWith(poll.id, 2)
      expect(requestSend).toHaveBeenCalledWith(
        expect.objectContaining({
          sendSeq: 2,
          audience: {
            kind: 'sample',
            size: 80,
            excludePersonIds: ['person-1', 'person-2'],
          },
          paidRecipientCap: 80,
        }),
      )
    })

    it('sends nothing for an expansion that was never approved', async () => {
      const poll = await createPoll()
      vi.spyOn(
        service.app.get(OutreachServePollExpansionService),
        'resolveDelivery',
      ).mockResolvedValue(null)

      await send({ outreachId: poll.id, sendSeq: 2 })

      expect(requestSend).not.toHaveBeenCalled()
    })
  })
})
