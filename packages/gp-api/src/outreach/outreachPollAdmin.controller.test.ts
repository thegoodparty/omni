import { subDays } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { MessageGroup, QueueType } from '@/queue/queue.types'
import {
  Outreach,
  OutreachStatus,
  OutreachType,
  PollAudienceKind,
  UserRole,
} from '../generated/prisma'
import { OutreachServePollCreateService } from './services/outreachServePollCreate.service'
import {
  OutreachPollReviewOverdueService,
  POLL_REVIEW_OVERDUE_LOG,
} from './services/outreachPollReviewOverdue.service'

// Driven through the real routes: the guard, the body pipes and the
// response interceptor are part of what gp-admin calls, and the approval
// claim is a compare-and-set that only real Postgres can race.

const service = useTestService()

const ORG_SLUG = 'eo-poll-admin'
const OFFICE = 'Mayor'
const QUESTION = 'What should the city fix first on Main Street?'
const BASE = '/v1/outreach/admin/polls'

let sendMessage: ReturnType<typeof vi.spyOn>
let poll: Outreach

const compose = (question: string) =>
  service.app
    .get(OutreachServePollCreateService)
    .composeMessage(question, service.user, OFFICE)

const createPoll = (
  data: Partial<{
    status: OutreachStatus
    createdAt: Date
    approvedAt: Date
  }> = {},
) =>
  service.prisma.outreach.create({
    data: {
      campaignId: null,
      organizationSlug: ORG_SLUG,
      outreachType: OutreachType.poll,
      status: OutreachStatus.pending,
      name: 'Roads poll',
      message: compose(QUESTION),
      scheduledLocalDate: '2026-11-02',
      textCount: 120,
      ...data,
      pollDetails: {
        create: {
          topic: 'roads',
          audienceKind: PollAudienceKind.sample,
          biasOverridden: true,
        },
      },
    },
  })

const readPoll = (id: number) =>
  service.prisma.outreach.findUniqueOrThrow({ where: { id } })

const approve = (id: number, body: Record<string, unknown> = {}) =>
  service.client.post(`${BASE}/${id}/approve`, {
    approvedBy: 'staffer@goodparty.org',
    ...body,
  })

const deny = (id: number) =>
  service.client.post(`${BASE}/${id}/deny`, {
    deniedBy: 'staffer@goodparty.org',
    reason: 'Leading question',
  })

const edit = (id: number, question: string) =>
  service.client.patch(`${BASE}/${id}`, {
    question,
    editedBy: 'staffer@goodparty.org',
  })

beforeEach(async () => {
  await service.prisma.user.update({
    where: { id: service.user.id },
    data: { roles: [UserRole.admin] },
  })
  await service.prisma.organization.create({
    data: {
      slug: ORG_SLUG,
      ownerId: service.user.id,
      customPositionName: OFFICE,
    },
  })
  sendMessage = vi
    .spyOn(service.app.get(QueueProducerService), 'sendMessage')
    .mockResolvedValue(undefined)
  poll = await createPoll()
})

describe('access', () => {
  it('refuses a signed-in user who is not an admin', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.candidate] },
    })

    expect((await service.client.get(`${BASE}/queue`)).status).toBe(403)
    expect((await approve(poll.id)).status).toBe(403)
    expect(sendMessage).not.toHaveBeenCalled()
    expect((await readPoll(poll.id)).approvedAt).toBeNull()
  })
})

describe('GET queue and detail', () => {
  it('lists paid polls awaiting review, with the question recovered', async () => {
    await createPoll({ status: OutreachStatus.pending_payment })
    await service.prisma.outreach.create({
      data: {
        organizationSlug: ORG_SLUG,
        outreachType: OutreachType.text,
        status: OutreachStatus.pending,
      },
    })

    const result = await service.client.get(`${BASE}/queue`)

    expect(result.status).toBe(200)
    expect(result.data.items).toHaveLength(1)
    expect(result.data.items[0]).toMatchObject({
      kind: 'poll',
      outreachId: poll.id,
      expansionId: null,
      organizationSlug: ORG_SLUG,
      question: QUESTION,
      topic: 'roads',
      textCount: 120,
      approvalStatus: 'awaiting_review',
    })
  })

  it('moves an approved poll to the approved tab', async () => {
    await approve(poll.id)

    const awaiting = await service.client.get(`${BASE}/queue`)
    const approved = await service.client.get(`${BASE}/queue`, {
      params: { status: 'approved' },
    })

    expect(awaiting.data.items).toEqual([])
    expect(approved.data.items[0]).toMatchObject({
      outreachId: poll.id,
      approvalStatus: 'approved',
      approvedBy: 'staffer@goodparty.org',
    })
  })

  it('returns the full message, audience and bias override', async () => {
    const result = await service.client.get(`${BASE}/${poll.id}`)

    expect(result.status).toBe(200)
    expect(result.data).toMatchObject({
      message: compose(QUESTION),
      audienceKind: PollAudienceKind.sample,
      biasOverridden: true,
      expansions: [],
      item: { outreachId: poll.id, question: QUESTION },
    })
  })

  it('404s an id that is not a poll', async () => {
    const text = await service.prisma.outreach.create({
      data: {
        organizationSlug: ORG_SLUG,
        outreachType: OutreachType.text,
        status: OutreachStatus.pending,
      },
    })

    expect((await service.client.get(`${BASE}/${text.id}`)).status).toBe(404)
    expect((await approve(text.id)).status).toBe(404)
  })
})

describe('POST :id/approve', () => {
  it('claims the poll and enqueues its first send', async () => {
    const result = await approve(poll.id)

    expect(result.status).toBe(201)
    expect(result.data.approvalStatus).toBe('approved')
    const row = await readPoll(poll.id)
    expect(row.approvedAt).not.toBeNull()
    expect(row.approvedBy).toBe('staffer@goodparty.org')
    // The delivery layer's own claim moves pending to in_progress.
    expect(row.status).toBe(OutreachStatus.pending)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(
      {
        type: QueueType.OUTREACH_TEXT_SEND,
        data: { outreachId: poll.id, sendSeq: 1 },
      },
      `${MessageGroup.outreachTextSend}-${poll.id}`,
      {
        throwOnError: true,
        deduplicationId: `${QueueType.OUTREACH_TEXT_SEND}-${poll.id}-1`,
      },
    )
  })

  it('enqueues once and 409s the other of two concurrent approvals', async () => {
    const results = await Promise.all([approve(poll.id), approve(poll.id)])

    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('reverts the claim when the enqueue fails, so it can be approved again', async () => {
    sendMessage.mockRejectedValueOnce(
      Object.assign(new Error('Service Unavailable'), {
        name: 'ServiceUnavailable',
        $fault: 'server',
      }),
    )

    const failed = await approve(poll.id)

    expect(failed.status).toBe(500)
    const reverted = await readPoll(poll.id)
    expect(reverted.approvedAt).toBeNull()
    expect(reverted.approvedBy).toBeNull()

    expect((await approve(poll.id)).status).toBe(201)
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  it('reverts only its own claim, never a different approval stamp', async () => {
    const otherClaim = subDays(new Date(), 1)
    sendMessage.mockImplementationOnce(async () => {
      await service.prisma.outreach.update({
        where: { id: poll.id },
        data: { approvedAt: otherClaim, approvedBy: 'other@goodparty.org' },
      })
      throw new Error('Service Unavailable')
    })

    expect((await approve(poll.id)).status).toBe(500)

    const row = await readPoll(poll.id)
    expect(row.approvedAt).toEqual(otherClaim)
    expect(row.approvedBy).toBe('other@goodparty.org')
  })

  it('400s an expansion approval until expansions land', async () => {
    const result = await approve(poll.id, { expansionId: 'exp-1' })

    expect(result.status).toBe(400)
    expect((await readPoll(poll.id)).approvedAt).toBeNull()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('409s a denied poll', async () => {
    expect((await deny(poll.id)).status).toBe(201)

    expect((await approve(poll.id)).status).toBe(409)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('409s a poll that has not been paid for', async () => {
    const unpaid = await createPoll({
      status: OutreachStatus.pending_payment,
    })

    expect((await approve(unpaid.id)).status).toBe(409)
    expect(sendMessage).not.toHaveBeenCalled()
  })
})

describe('POST :id/deny', () => {
  it('stamps the denial and moves the poll to denied', async () => {
    const result = await deny(poll.id)

    expect(result.status).toBe(201)
    expect(result.data.approvalStatus).toBe('denied')
    const row = await readPoll(poll.id)
    expect(row.status).toBe(OutreachStatus.denied)
    expect(row.deniedBy).toBe('staffer@goodparty.org')
    expect(row.deniedReason).toBe('Leading question')
  })

  it('409s an approved poll', async () => {
    await approve(poll.id)

    expect((await deny(poll.id)).status).toBe(409)
    expect((await readPoll(poll.id)).deniedAt).toBeNull()
  })
})

describe('PATCH :id', () => {
  const EDITED = 'Which Main Street repair matters most to you?'

  it('recomposes the message and stamps the staff edit', async () => {
    const result = await edit(poll.id, EDITED)

    expect(result.status).toBe(200)
    expect(result.data.message).toBe(compose(EDITED))
    expect(result.data.item.question).toBe(EDITED)
    const row = await readPoll(poll.id)
    expect(row.message).toBe(compose(EDITED))
    expect(row.adminEditedBy).toBe('staffer@goodparty.org')
    expect(row.adminEditedAt).not.toBeNull()
  })

  it('sends the edited message once approved', async () => {
    await edit(poll.id, EDITED)
    sendMessage.mockImplementationOnce(async () => {
      // What the consumer will read off the row when the message lands.
      expect((await readPoll(poll.id)).message).toBe(compose(EDITED))
    })

    expect((await approve(poll.id)).status).toBe(201)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('409s once the poll is approved', async () => {
    await approve(poll.id)

    expect((await edit(poll.id, EDITED)).status).toBe(409)
    expect((await readPoll(poll.id)).message).toBe(compose(QUESTION))
  })
})

describe('review overdue alert', () => {
  it('logs each paid poll still unreviewed past 2 business days', async () => {
    const overdueService = service.app.get(OutreachPollReviewOverdueService)
    const warn = vi.spyOn(overdueService.logger, 'warn')
    const old = await createPoll({ createdAt: subDays(new Date(), 6) })
    await createPoll({
      createdAt: subDays(new Date(), 6),
      approvedAt: new Date(),
    })
    await createPoll({
      createdAt: subDays(new Date(), 6),
      status: OutreachStatus.pending_payment,
    })

    await overdueService.logOverduePolls()

    const lines = warn.mock.calls.filter(
      ([, message]) => message === POLL_REVIEW_OVERDUE_LOG,
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]?.[0]).toMatchObject({ outreachId: old.id })
  })

  it('runs once per hourly slot', async () => {
    const overdueService = service.app.get(OutreachPollReviewOverdueService)
    const warn = vi.spyOn(overdueService.logger, 'warn')
    await createPoll({ createdAt: subDays(new Date(), 6) })

    await Promise.all([
      overdueService.logOverduePolls(),
      overdueService.logOverduePolls(),
    ])

    expect(
      warn.mock.calls.filter(
        ([, message]) => message === POLL_REVIEW_OVERDUE_LOG,
      ),
    ).toHaveLength(1)
  })
})
