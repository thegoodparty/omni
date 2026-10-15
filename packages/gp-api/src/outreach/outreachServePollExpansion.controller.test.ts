import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { FeaturesService } from '@/features/services/features.service'
import { useTestService } from '@/test-service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import type { SampleContacts } from '@/contacts/schemas/sampleContacts.schema'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import {
  OutreachStatus,
  OutreachType,
  PollAudienceKind,
} from '../generated/prisma'
import {
  TEXT_DELIVERY_HANDOFF_PORT,
  type TextDeliveryHandoff,
  type TextDeliveryHandoffPort,
} from './interfaces/textDeliveryHandoff.interface'
import { OutreachServePollExpansionService } from './services/outreachServePollExpansion.service'
import { OutreachServeSmsPurchaseHandlerService } from './services/outreachServeSmsPurchase.service'
import { OutreachTextDeliveryService } from './services/outreachTextDelivery.service'

// Driven over HTTP for the create route so the elected-office guard, the
// flag gate and the Zod pipes run for real; the payment and delivery halves
// are called on the real services because their triggers are Stripe and SQS.
const service = useTestService()

let orgSlug: string
let pollId: number
const getDistrictStats = vi.fn()
const sampleContacts = vi.fn()
const findOptedOutPersonIds = vi.fn()

const stub = <T>(token: new (...args: never[]) => T): T =>
  service.app.get(token)

const headers = () => ({ headers: { 'x-organization-slug': orgSlug } })
const postExpansion = (id: number, body: object = { size: 50 }) =>
  service.client.post(
    `/v1/outreach/serve/poll/${id}/expansions`,
    body,
    headers(),
  )

const people = (ids: string[]) =>
  ids.map((id, index) => ({
    id,
    cellPhone: `512555${String(index + 1000).padStart(4, '0')}`,
  }))

const seedPoll = async (status: OutreachStatus = OutreachStatus.completed) => {
  const poll = await service.prisma.outreach.create({
    data: {
      campaignId: null,
      organizationSlug: orgSlug,
      outreachType: OutreachType.poll,
      status,
      name: 'Roads poll',
      message: 'Hi {{first_name}}, what should we fix? Reply STOP to opt out.',
      scheduledLocalDate: '2026-11-02',
      textCount: 3,
      approvedAt: new Date(),
      pollDetails: {
        create: {
          topic: 'roads',
          audienceKind: PollAudienceKind.sample,
          biasOverridden: false,
        },
      },
    },
  })
  await service.prisma.outreachTextRecipient.createMany({
    data: ['asked-1', 'asked-2', 'asked-3'].map((personId, index) => ({
      outreachId: poll.id,
      organizationSlug: orgSlug,
      personId,
      phone: `51255500${index}0`,
    })),
  })
  return poll
}

const excludedIds = (): string[] | undefined => {
  const call: SampleContacts[] = sampleContacts.mock.calls[0] ?? []
  return call[0]?.excludeIds
}

const readExpansion = (id: string) =>
  service.prisma.outreachPollExpansion.findUniqueOrThrow({ where: { id } })

beforeEach(async () => {
  orgSlug = `eo-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { userId: service.user.id, organizationSlug: orgSlug },
  })

  getDistrictStats
    .mockReset()
    .mockResolvedValue({ totalConstituentsWithCellPhone: 200 })
  sampleContacts
    .mockReset()
    .mockImplementation(({ size }: { size: number }) =>
      people(Array.from({ length: size }, (_, i) => `fresh-${i}`)),
    )
  findOptedOutPersonIds.mockReset().mockResolvedValue([])

  vi.spyOn(stub(FeaturesService), 'isFeatureEnabled').mockResolvedValue(true)
  vi.spyOn(stub(ContactsService), 'getDistrictStats').mockImplementation(
    getDistrictStats,
  )
  vi.spyOn(stub(ContactsService), 'sampleContacts').mockImplementation(
    sampleContacts,
  )
  vi.spyOn(
    stub(ContactInteractionTextService),
    'findOptedOutPersonIds',
  ).mockImplementation(findOptedOutPersonIds)
  vi.spyOn(stub(AnalyticsService), 'track').mockImplementation(
    () => new Promise<never>(() => undefined),
  )
  vi.spyOn(stub(SlackService), 'message').mockResolvedValue(undefined)

  pollId = (await seedPoll()).id
})

describe('POST /v1/outreach/serve/poll/:id/expansions', () => {
  it('writes a pending_payment expansion at sendSeq 2 and quotes it', async () => {
    const res = await postExpansion(pollId, { size: 50 })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      expansionId: expect.any(String),
      recipientCount: 50,
      amountCents: 175,
    })
    expect(await readExpansion(res.data.expansionId)).toMatchObject({
      outreachId: pollId,
      sendSeq: 2,
      textCount: 50,
      status: OutreachStatus.pending_payment,
      approvedAt: null,
    })
    expect(stub(AnalyticsService).track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Polls.GatherMoreStarted,
      {
        outreachId: pollId,
        expansionId: res.data.expansionId,
        recipientCount: 50,
      },
    )
  })

  it('draws from the pool minus everyone the poll already asked and every opt-out', async () => {
    findOptedOutPersonIds.mockResolvedValue(['gone-1'])

    await postExpansion(pollId)

    expect([...(excludedIds() ?? [])].sort()).toEqual([
      'asked-1',
      'asked-2',
      'asked-3',
      'gone-1',
    ])
  })

  it('clamps the size to the people still reachable', async () => {
    getDistrictStats.mockResolvedValue({ totalConstituentsWithCellPhone: 13 })

    const res = await postExpansion(pollId, { size: 500 })

    expect(res.data.recipientCount).toBe(10)
    expect(sampleContacts).toHaveBeenCalledWith(
      expect.objectContaining({ size: 10 }),
      expect.anything(),
    )
  })

  it('bills the people the draw will actually text, one per phone number', async () => {
    sampleContacts.mockResolvedValue([
      { id: 'a', cellPhone: '5125550001' },
      { id: 'b', cellPhone: '5125550001' },
      { id: 'c', cellPhone: '5125550002' },
    ])

    const res = await postExpansion(pollId, { size: 3 })

    expect(res.data.recipientCount).toBe(2)
  })

  it('400s when everyone reachable has been asked', async () => {
    getDistrictStats.mockResolvedValue({ totalConstituentsWithCellPhone: 3 })

    const res = await postExpansion(pollId)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(res.data.message).toBe('Everyone reachable has been asked.')
    expect(await service.prisma.outreachPollExpansion.count()).toBe(0)
  })

  it('409s a second expansion while the first is unapproved', async () => {
    expect((await postExpansion(pollId)).status).toBe(HttpStatus.CREATED)

    const second = await postExpansion(pollId)

    expect(second.status).toBe(HttpStatus.CONFLICT)
    expect(await service.prisma.outreachPollExpansion.count()).toBe(1)
  })

  it('creates exactly one of two concurrent expansions', async () => {
    const results = await Promise.all([
      postExpansion(pollId),
      postExpansion(pollId),
    ])

    expect(results.map((r) => r.status).sort()).toEqual([
      HttpStatus.CREATED,
      HttpStatus.CONFLICT,
    ])
    expect(await service.prisma.outreachPollExpansion.count()).toBe(1)
  })

  it('allows the next expansion once the first is approved, at the next sendSeq', async () => {
    const first = await postExpansion(pollId)
    await service.prisma.outreachPollExpansion.update({
      where: { id: first.data.expansionId },
      data: { approvedAt: new Date(), status: OutreachStatus.in_progress },
    })

    const second = await postExpansion(pollId)

    expect(second.status).toBe(HttpStatus.CREATED)
    expect((await readExpansion(second.data.expansionId)).sendSeq).toBe(3)
  })

  it('409s a poll that has not been sent yet', async () => {
    const pending = await seedPoll(OutreachStatus.pending)

    const res = await postExpansion(pending.id)

    expect(res.status).toBe(HttpStatus.CONFLICT)
  })

  it('404s another organization poll and a poll that is not a poll', async () => {
    const otherSlug = `${orgSlug}-other`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    const foreign = await service.prisma.outreach.create({
      data: {
        organizationSlug: otherSlug,
        outreachType: OutreachType.poll,
        status: OutreachStatus.completed,
      },
    })
    const text = await service.prisma.outreach.create({
      data: {
        organizationSlug: orgSlug,
        outreachType: OutreachType.text,
        status: OutreachStatus.completed,
      },
    })

    expect((await postExpansion(foreign.id)).status).toBe(HttpStatus.NOT_FOUND)
    expect((await postExpansion(text.id)).status).toBe(HttpStatus.NOT_FOUND)
  })

  it('400s an organization already past the id filter limit instead of failing a paid send', async () => {
    findOptedOutPersonIds.mockResolvedValue(
      Array.from({ length: 100_000 }, (_, i) => `gone-${i}`),
    )

    const res = await postExpansion(pollId)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('404s when the flag is off', async () => {
    vi.spyOn(stub(FeaturesService), 'isFeatureEnabled').mockResolvedValue(false)

    expect((await postExpansion(pollId)).status).toBe(HttpStatus.NOT_FOUND)
  })

  it('rejects a body that is not a positive integer size', async () => {
    expect((await postExpansion(pollId, { size: 0 })).status).toBe(
      HttpStatus.BAD_REQUEST,
    )
  })
})

describe('paying for an expansion', () => {
  let handler: OutreachServeSmsPurchaseHandlerService
  let expansionId: string
  let slackMessage: ReturnType<typeof vi.fn>

  const metadata = () => ({
    outreachId: pollId,
    organizationSlug: orgSlug,
    expansionId,
  })

  beforeEach(async () => {
    handler = stub(OutreachServeSmsPurchaseHandlerService)
    expansionId = (await postExpansion(pollId, { size: 40 })).data.expansionId
    slackMessage = vi.mocked(stub(SlackService).message)
    slackMessage.mockClear()
  })

  it('prices the expansion row, not the poll', async () => {
    await expect(handler.calculateAmount(metadata())).resolves.toBe(140)
    await expect(handler.validatePurchase(metadata())).resolves.toBeUndefined()
  })

  it('holds the expansion at pending and leaves the parent poll untouched', async () => {
    const before = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: pollId },
    })

    await handler.executePostPurchase('cs_test_1', metadata())

    expect(await readExpansion(expansionId)).toMatchObject({
      status: OutreachStatus.pending,
      stripeCheckoutSessionId: 'cs_test_1',
      approvedAt: null,
    })
    const after = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: pollId },
    })
    expect(after).toEqual(before)
  })

  it('enqueues nothing and posts one review notice across a redelivery', async () => {
    const sendMessage = vi.spyOn(stub(QueueProducerService), 'sendMessage')

    await handler.executePostPurchase('cs_test_1', metadata())
    await handler.executePostPurchase('cs_test_1', metadata())

    expect(sendMessage).not.toHaveBeenCalled()
    expect(slackMessage).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(slackMessage.mock.calls[0]?.[0])).toContain(
      'Poll expansion awaiting review',
    )
  })

  it('refuses to price or pay an expansion that is already paid', async () => {
    await handler.executePostPurchase('cs_test_1', metadata())

    await expect(handler.calculateAmount(metadata())).rejects.toThrow(
      'not awaiting payment',
    )
  })

  it('refuses another organization expansion', async () => {
    await expect(
      handler.calculateAmount({
        ...metadata(),
        organizationSlug: 'someone-else',
      }),
    ).rejects.toThrow('No poll expansion')
    await expect(
      handler.executePostPurchase('cs_test_1', {
        ...metadata(),
        organizationSlug: 'someone-else',
      }),
    ).rejects.toThrow('not found for this organization')
  })

  it('refuses an expansion id paired with a different poll id', async () => {
    const other = await seedPoll()

    await expect(
      handler.calculateAmount({ ...metadata(), outreachId: other.id }),
    ).rejects.toThrow('No poll expansion')
  })
})

describe('delivering an approved expansion', () => {
  let handoffs: TextDeliveryHandoff[]
  let delivery: OutreachTextDeliveryService
  let expansions: OutreachServePollExpansionService
  let objects: Map<string, string>

  beforeEach(() => {
    process.env.OUTREACH_TEXT_CSVS_BUCKET = 'expansion-csvs'
    handoffs = []
    objects = new Map()
    const port: TextDeliveryHandoffPort = service.app.get(
      TEXT_DELIVERY_HANDOFF_PORT,
    )
    vi.spyOn(port, 'send').mockImplementation((handoff) => {
      handoffs.push(handoff)
      return Promise.resolve()
    })
    const s3 = stub(S3Service)
    vi.spyOn(s3, 'getFile').mockImplementation((bucket, key) =>
      Promise.resolve(objects.get(`${bucket}/${key}`)),
    )
    vi.spyOn(s3, 'uploadFile').mockImplementation((bucket, body, key) => {
      objects.set(`${bucket}/${key}`, body as string)
      return Promise.resolve(`https://${bucket}/${key}`)
    })
    delivery = stub(OutreachTextDeliveryService)
    expansions = stub(OutreachServePollExpansionService)
  })

  const approvedExpansion = async (textCount: number) => {
    const { expansionId } = (await postExpansion(pollId, { size: textCount }))
      .data
    await service.prisma.outreachPollExpansion.update({
      where: { id: expansionId },
      data: {
        status: OutreachStatus.pending,
        approvedAt: new Date(),
        approvedBy: 'staffer@goodparty.org',
      },
    })
    return expansionId
  }

  const deliver = async (sendSeq: number) => {
    const resolved = await expansions.resolveDelivery(pollId, sendSeq)
    if (!resolved) throw new Error('expansion not deliverable')
    return delivery.requestSend({
      outreachId: pollId,
      sendSeq,
      audience: {
        kind: 'sample',
        size: resolved.textCount,
        excludePersonIds: resolved.excludePersonIds,
      },
      message: 'Hi, what should we fix?',
      scheduledLocalDate: '2026-11-02',
      paidRecipientCap: resolved.textCount,
    })
  }

  it('sends only to people the earlier send did not reach, and reaches the same results', async () => {
    const expansionId = await approvedExpansion(30)
    sampleContacts
      .mockReset()
      .mockImplementation(({ size }) =>
        people(Array.from({ length: size }, (_, i) => `fresh-${i}`)),
      )

    const result = await deliver(2)

    expect(result.recipientCount).toBe(30)
    expect(excludedIds()).toEqual(
      expect.arrayContaining(['asked-1', 'asked-2', 'asked-3']),
    )
    const recipients = await service.prisma.outreachTextRecipient.findMany({
      where: { outreachId: pollId },
    })
    expect(recipients).toHaveLength(33)
    expect(
      recipients.filter((r) => r.personId.startsWith('asked-')),
    ).toHaveLength(3)
    expect(handoffs).toHaveLength(1)
    expect(handoffs[0]).toMatchObject({ sendSeq: 2, recipientCount: 30 })
    expect((await readExpansion(expansionId)).status).toBe(
      OutreachStatus.in_progress,
    )
    const spine = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: pollId },
    })
    expect(spine.status).toBe(OutreachStatus.completed)
  })

  it('hands off once when the message is delivered twice', async () => {
    await approvedExpansion(30)

    await deliver(2)
    const redelivered = await deliver(2)

    expect(redelivered.terminalReason).toBe('not_sendable')
    expect(handoffs).toHaveLength(1)
  })

  it('logs and drops an upstream draw that returns an already-asked person', async () => {
    await approvedExpansion(5)
    sampleContacts.mockReset().mockResolvedValue([
      { id: 'fresh-0', cellPhone: '5125551000' },
      { id: 'fresh-1', cellPhone: '5125551001' },
    ])
    const error = vi.spyOn(delivery.logger, 'error')

    await deliver(2)

    expect(error).not.toHaveBeenCalled()

    sampleContacts
      .mockReset()
      .mockResolvedValue([{ id: 'asked-1', cellPhone: '5125551002' }])
    await service.prisma.outreachPollExpansion.updateMany({
      where: { outreachId: pollId },
      data: { status: OutreachStatus.pending },
    })
    objects.clear()
    await deliver(2)

    expect(error).toHaveBeenCalledWith(
      { outreachId: pollId, overlapCount: 1 },
      expect.stringContaining('exclusion did not hold'),
    )
  })

  it('clamps to what is still reachable when the pool shrank before delivery', async () => {
    await approvedExpansion(100)
    getDistrictStats.mockResolvedValue({ totalConstituentsWithCellPhone: 20 })

    const result = await deliver(2)

    expect(result.recipientCount).toBe(17)
  })

  it('resolves nothing for an expansion that was never approved', async () => {
    await postExpansion(pollId)

    await expect(expansions.resolveDelivery(pollId, 2)).resolves.toBeNull()
  })

  it('fails only the expansion when the send cannot be made', async () => {
    const expansionId = await approvedExpansion(30)
    sampleContacts.mockReset().mockResolvedValue([])

    const result = await deliver(2)

    expect(result.terminalReason).toBe('send_failed')
    expect((await readExpansion(expansionId)).status).toBe(
      OutreachStatus.failed,
    )
    const spine = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: pollId },
    })
    expect(spine.status).toBe(OutreachStatus.completed)
  })
})
