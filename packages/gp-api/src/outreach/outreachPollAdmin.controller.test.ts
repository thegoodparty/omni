import { subDays } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { JobsService } from '@/jobs/jobs.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import {
  TEXT_DELIVERY_HANDOFF_PORT,
  type TextDeliveryHandoff,
  type TextDeliveryHandoffPort,
} from './interfaces/textDeliveryHandoff.interface'
import {
  Outreach,
  OutreachStatus,
  OutreachType,
  PollAudienceKind,
  UserRole,
} from '../generated/prisma'
import { OutreachServePollCreateService } from './services/outreachServePollCreate.service'

// Driven through the real routes: the guard, the body pipes and the
// response interceptor are part of what gp-admin calls, and the approval
// claim is a compare-and-set that only real Postgres can race. Workers on, so
// an approved poll's outreachTextSend job can run end to end below.

const service = useTestService({ jobs: true })

const ORG_SLUG = 'eo-poll-admin'
const OFFICE = 'Mayor'
const QUESTION = 'What should the city fix first on Main Street?'
const BASE = '/v1/outreach/admin/polls'

let sendMany: ReturnType<typeof vi.spyOn>
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
  // Queues nothing by default: these tests are about the claim. The
  // delivery describe below lets the real job run.
  sendMany = vi
    .spyOn(service.app.get(JobsService), 'sendMany')
    .mockResolvedValue([])
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
    expect(sendMany).not.toHaveBeenCalled()
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
  it('claims the poll and queues its first send with the claim', async () => {
    const result = await approve(poll.id)

    expect(result.status).toBe(201)
    expect(result.data.approvalStatus).toBe('approved')
    const row = await readPoll(poll.id)
    expect(row.approvedAt).not.toBeNull()
    expect(row.approvedBy).toBe('staffer@goodparty.org')
    // The delivery layer's own claim moves pending to in_progress.
    expect(row.status).toBe(OutreachStatus.pending)
    expect(sendMany).toHaveBeenCalledTimes(1)
    expect(sendMany).toHaveBeenCalledWith(
      'outreachTextSend',
      [
        {
          data: { outreachId: poll.id, sendSeq: 1 },
          key: `${poll.id}:1`,
          group: String(poll.id),
        },
      ],
      { tx: expect.anything() },
    )
  })

  it('queues once and 409s the other of two concurrent approvals', async () => {
    const results = await Promise.all([approve(poll.id), approve(poll.id)])

    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    expect(sendMany).toHaveBeenCalledTimes(1)
  })

  it('rolls the claim back when the send cannot be queued, so it can be approved again', async () => {
    sendMany.mockRejectedValueOnce(
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
    expect(sendMany).toHaveBeenCalledTimes(2)
  })

  it('409s a denied poll', async () => {
    expect((await deny(poll.id)).status).toBe(201)

    expect((await approve(poll.id)).status).toBe(409)
    expect(sendMany).not.toHaveBeenCalled()
  })

  it('409s a poll that has not been paid for', async () => {
    const unpaid = await createPoll({
      status: OutreachStatus.pending_payment,
    })

    expect((await approve(unpaid.id)).status).toBe(409)
    expect(sendMany).not.toHaveBeenCalled()
  })
})

// The approval's outreachTextSend job run for real, with only S3, people
// data and the fulfilment handoff stubbed: no Playwright spec reaches the
// staff approval, so this is its end-to-end test.
describe('an approved poll is sent', () => {
  let handoffs: TextDeliveryHandoff[]

  beforeEach(async () => {
    sendMany.mockRestore()
    vi.stubEnv('OUTREACH_TEXT_CSVS_BUCKET', 'poll-approval-csvs')
    handoffs = []
    const port: TextDeliveryHandoffPort = service.app.get(
      TEXT_DELIVERY_HANDOFF_PORT,
    )
    vi.spyOn(port, 'send').mockImplementation(async (handoff) => {
      handoffs.push(handoff)
    })
    const objects = new Map<string, string>()
    const s3 = service.app.get(S3Service)
    vi.spyOn(s3, 'getFile').mockImplementation(async (bucket, key) =>
      objects.get(`${bucket}/${key}`),
    )
    vi.spyOn(s3, 'uploadFile').mockImplementation(async (bucket, body, key) => {
      objects.set(`${bucket}/${key}`, body as string)
      return `https://${bucket}/${key}`
    })
    const contacts = service.app.get(ContactsService)
    vi.spyOn(contacts, 'getDistrictStats').mockResolvedValue({
      totalConstituentsWithCellPhone: 500,
    } as never)
    vi.spyOn(contacts, 'sampleContacts').mockImplementation(
      async ({ size }) =>
        Array.from({ length: size }, (_, index) => ({
          id: `person-${index}`,
          cellPhone: `512555${String(index + 1000).padStart(4, '0')}`,
        })) as never,
    )
    // Paid at checkout, which is what the delivery layer's funding gate reads.
    await service.prisma.outreach.update({
      where: { id: poll.id },
      data: { stripeCheckoutSessionId: 'cs_test_poll_approval' },
    })
  })

  it('hands the approved poll to fulfilment once, with its recipients captured', async () => {
    expect((await approve(poll.id)).status).toBe(201)
    await service.jobs.settle()

    expect((await readPoll(poll.id)).status).toBe(OutreachStatus.in_progress)
    expect(handoffs).toHaveLength(1)
    expect(handoffs[0]).toMatchObject({
      outreachId: String(poll.id),
      sendSeq: 1,
      recipientCount: 120,
    })
    expect(
      await service.prisma.outreachTextRecipient.count({
        where: { outreachId: poll.id },
      }),
    ).toBe(120)
  })

  it('sends an approved expansion as its own send', async () => {
    await service.prisma.outreach.update({
      where: { id: poll.id },
      data: { status: OutreachStatus.completed, approvedAt: new Date() },
    })
    const expansion = await service.prisma.outreachPollExpansion.create({
      data: {
        outreachId: poll.id,
        sendSeq: 2,
        textCount: 40,
        status: OutreachStatus.pending,
        stripeCheckoutSessionId: 'cs_test_poll_expansion',
      },
    })

    expect((await approve(poll.id, { expansionId: expansion.id })).status).toBe(
      201,
    )
    await service.jobs.settle()

    expect(handoffs).toEqual([
      expect.objectContaining({
        outreachId: String(poll.id),
        sendSeq: 2,
        recipientCount: 40,
      }),
    ])
    expect(
      (
        await service.prisma.outreachPollExpansion.findUniqueOrThrow({
          where: { id: expansion.id },
        })
      ).status,
    ).toBe(OutreachStatus.in_progress)
  })
})

describe('POST :id/approve with expansionId', () => {
  let sent: Outreach
  let expansionId: string

  const readExpansion = () =>
    service.prisma.outreachPollExpansion.findUniqueOrThrow({
      where: { id: expansionId },
    })

  beforeEach(async () => {
    sent = await createPoll({
      status: OutreachStatus.completed,
      approvedAt: subDays(new Date(), 5),
    })
    const expansion = await service.prisma.outreachPollExpansion.create({
      data: {
        outreachId: sent.id,
        sendSeq: 2,
        textCount: 90,
        status: OutreachStatus.pending,
      },
    })
    expansionId = expansion.id
  })

  it('lists an awaiting expansion in the queue beside the polls', async () => {
    const result = await service.client.get(`${BASE}/queue`)

    expect(result.data.items).toHaveLength(2)
    expect(
      result.data.items.find(
        (item: { kind: string }) => item.kind === 'expansion',
      ),
    ).toMatchObject({
      kind: 'expansion',
      outreachId: sent.id,
      expansionId,
      textCount: 90,
      question: QUESTION,
      approvalStatus: 'awaiting_review',
    })
  })

  it('does not list an expansion that has not been paid for', async () => {
    await service.prisma.outreachPollExpansion.update({
      where: { id: expansionId },
      data: { status: OutreachStatus.pending_payment },
    })

    const result = await service.client.get(`${BASE}/queue`)

    expect(
      result.data.items.filter(
        (item: { kind: string }) => item.kind === 'expansion',
      ),
    ).toEqual([])
  })

  it('claims the expansion, queues its own sendSeq and reopens the spine', async () => {
    sendMany.mockClear()
    const result = await approve(sent.id, { expansionId })

    expect(result.status).toBe(201)
    expect(result.data).toMatchObject({
      kind: 'expansion',
      expansionId,
      approvalStatus: 'approved',
    })
    const expansion = await readExpansion()
    expect(expansion.approvedAt).not.toBeNull()
    expect(expansion.approvedBy).toBe('staffer@goodparty.org')
    expect(expansion.status).toBe(OutreachStatus.pending)
    expect((await readPoll(sent.id)).status).toBe(OutreachStatus.in_progress)
    expect(sendMany).toHaveBeenCalledTimes(1)
    expect(sendMany).toHaveBeenCalledWith(
      'outreachTextSend',
      [
        {
          data: { outreachId: sent.id, sendSeq: 2 },
          key: `${sent.id}:2`,
          group: String(sent.id),
        },
      ],
      { tx: expect.anything() },
    )
  })

  it('leaves the spine alone when it is already in progress', async () => {
    await service.prisma.outreach.update({
      where: { id: sent.id },
      data: { status: OutreachStatus.in_progress },
    })

    expect((await approve(sent.id, { expansionId })).status).toBe(201)

    expect((await readPoll(sent.id)).status).toBe(OutreachStatus.in_progress)
  })

  it('queues once and 409s the other of two concurrent approvals', async () => {
    sendMany.mockClear()
    const results = await Promise.all([
      approve(sent.id, { expansionId }),
      approve(sent.id, { expansionId }),
    ])

    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    expect(sendMany).toHaveBeenCalledTimes(1)
  })

  it('rolls back the expansion claim and the reopened spine when the send cannot be queued', async () => {
    sendMany.mockRejectedValueOnce(new Error('Service Unavailable'))

    expect((await approve(sent.id, { expansionId })).status).toBe(500)

    const expansion = await readExpansion()
    expect(expansion.approvedAt).toBeNull()
    expect(expansion.approvedBy).toBeNull()
    expect((await readPoll(sent.id)).status).toBe(OutreachStatus.completed)
    expect((await approve(sent.id, { expansionId })).status).toBe(201)
  })

  it('never touches the spine approval', async () => {
    const before = await readPoll(sent.id)

    await approve(sent.id, { expansionId })

    const after = await readPoll(sent.id)
    expect(after.approvedAt).toEqual(before.approvedAt)
    expect(after.approvedBy).toEqual(before.approvedBy)
  })

  it('409s an expansion that has not been paid for', async () => {
    await service.prisma.outreachPollExpansion.update({
      where: { id: expansionId },
      data: { status: OutreachStatus.pending_payment },
    })
    sendMany.mockClear()

    expect((await approve(sent.id, { expansionId })).status).toBe(409)
    expect(sendMany).not.toHaveBeenCalled()
  })

  it('404s an expansion id that belongs to another poll', async () => {
    expect((await approve(poll.id, { expansionId })).status).toBe(404)
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
    sendMany.mockImplementationOnce(async () => {
      // What the job will read off the row when it runs.
      expect((await readPoll(poll.id)).message).toBe(compose(EDITED))
    })

    expect((await approve(poll.id)).status).toBe(201)
    expect(sendMany).toHaveBeenCalledTimes(1)
  })

  it('409s once the poll is approved', async () => {
    await approve(poll.id)

    expect((await edit(poll.id, EDITED)).status).toBe(409)
    expect((await readPoll(poll.id)).message).toBe(compose(QUESTION))
  })
})
