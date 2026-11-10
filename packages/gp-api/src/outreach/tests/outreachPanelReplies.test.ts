import { randomUUID } from 'node:crypto'
import type { Message } from '@aws-sdk/client-sqs'
import type { TrackParams } from '@segment/analytics-node'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest'
import { AnalyticsService } from '@/analytics/analytics.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import {
  OutreachFunding,
  OutreachHandoffHandler,
  OutreachHandoffStatus,
  OutreachStatus,
  OutreachType,
} from '@/generated/prisma'
import { JobsService } from '@/jobs/jobs.service'
import { QueueConsumerService } from '@/queue/consumer/queueConsumer.service'
import { QueueType } from '@/queue/queue.types'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { SlackChannel } from '@/vendors/slack/slackService.types'
import { EVENTS } from '@/vendors/segment/segment.types'

const service = useTestService({ jobs: true })

const BUCKET = 'tevyn-poll-csvs-test'
const PHONE_1 = '+13035550101'
const PHONE_2 = '+13035550102'
const EARLIEST_SEND = '2026-11-04T23:50:00Z'

const HEADER = 'Phone Number,Message Text,Send Direction,Sent At'
// Outbound rows deliberately out of order and across midnight UTC.
const exportCsv = (extra: string[] = []) =>
  [
    HEADER,
    `${PHONE_1},Join my panel,OUTBOUND,2026-11-05T00:30:00Z`,
    `${PHONE_2},Join my panel,OUTBOUND,${EARLIEST_SEND}`,
    `${PHONE_1},JOIN,INBOUND,2026-11-05T14:00:00Z`,
    ...extra,
  ].join('\n')

let slug: string
let outreachId: number
let waveId: string
let getFile: Mock<S3Service['getFile']>
let slackMessage: Mock<SlackService['message']>
let track: Mock<AnalyticsService['track']>

const consumer = () => {
  const args: unknown[] = Array.from({ length: 18 }, () => ({}))
  args[14] = createMockLogger()
  args[17] = service.app.get(JobsService)
  return new QueueConsumerService(
    ...(args as ConstructorParameters<typeof QueueConsumerService>),
  )
}

const uploaded = (key: string): Message => ({
  MessageId: randomUUID(),
  Body: JSON.stringify({
    type: QueueType.PANEL_REPLIES_UPLOADED,
    data: { bucket: BUCKET, key, eventId: randomUUID() },
  }),
})

// The consumer forwards the SQS message to its job, which then runs.
const receive = async (message: Message) => {
  const acked = await consumer().processMessage(message)
  await service.jobs.settle()
  return acked
}

const wave = () =>
  service.prisma.managedPanelWave.findUniqueOrThrow({ where: { id: waveId } })
const handoff = () =>
  service.prisma.outreachTextHandoff.findUniqueOrThrow({
    where: { outreachId },
  })
const replyCount = () =>
  service.prisma.pollIndividualMessage.count({ where: { outreachId } })
const waveSentEvents = () =>
  track.mock.calls.filter(
    ([, event]) => event === EVENTS.Contacts.CivicPanelWaveSent,
  )

const seed = async (handler: OutreachHandoffHandler) => {
  slug = `eo-replies-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { organizationSlug: slug, userId: service.user.id },
  })
  const enrollment = await service.prisma.managedCivicPanel.create({
    data: {
      organizationSlug: slug,
      inviteMessage: 'Join my civic panel.',
      consentVersion: 'v1',
      approvedAt: new Date(),
      approvedByUserId: service.user.id,
      goalMembers: 100,
    },
  })
  const created = await service.prisma.managedPanelWave.create({
    data: {
      enrollmentId: enrollment.id,
      wave: 1,
      sentAt: new Date('2026-11-04T15:00:00Z'),
    },
  })
  waveId = created.id
  const outreach = await service.prisma.outreach.create({
    data: {
      organizationSlug: slug,
      campaignId: null,
      outreachType: OutreachType.text,
      status: OutreachStatus.in_progress,
      textCount: 2,
      fundedBy: OutreachFunding.goodparty_pilot,
      managedPanelWaveId: waveId,
    },
  })
  outreachId = outreach.id
  await service.prisma.outreachTextRecipient.createMany({
    data: [
      { personId: 'person-1', phone: PHONE_1 },
      { personId: 'person-2', phone: PHONE_2 },
    ].map((recipient) => ({
      ...recipient,
      outreachId,
      organizationSlug: slug,
    })),
  })
  await service.prisma.contactInteractionText.createMany({
    data: ['person-1', 'person-2'].map((personId) => ({
      outreachId,
      organizationSlug: slug,
      personId,
      occurredAt: new Date(),
    })),
  })
  await service.prisma.outreachTextHandoff.create({
    data: {
      outreachId,
      handler,
      mode: 'shadow',
      sendAt: new Date('2026-11-04T16:00:00Z'),
      timeZone: 'America/Chicago',
    },
  })
}

beforeEach(() => {
  getFile = vi.fn<S3Service['getFile']>()
  vi.spyOn(service.app.get(S3Service), 'getFile').mockImplementation(getFile)
  slackMessage = vi.fn<SlackService['message']>().mockResolvedValue(undefined)
  vi.spyOn(service.app.get(SlackService), 'message').mockImplementation(
    slackMessage,
  )
  track = vi
    .fn<AnalyticsService['track']>()
    .mockResolvedValue({} as TrackParams)
  vi.spyOn(service.app.get(AnalyticsService), 'track').mockImplementation(track)
  const contacts = service.app.get(ContactsService)
  vi.spyOn(contacts, 'findPersonByPhone').mockResolvedValue(null)
  vi.spyOn(contacts, 'resolveProAccess').mockResolvedValue(false)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('panelRepliesUploaded', () => {
  describe('for an agent wave', () => {
    beforeEach(() => seed(OutreachHandoffHandler.agent))

    it('ingests, dates the window from the earliest outbound row, records Wave Sent and stamps the hand-off', async () => {
      getFile.mockResolvedValue(exportCsv())

      const acked = await receive(uploaded(`agent-replies/${outreachId}.csv`))

      expect(acked).toBe(true)
      expect(getFile).toHaveBeenCalledWith(
        BUCKET,
        `agent-replies/${outreachId}.csv`,
      )
      expect(await replyCount()).toBe(1)
      expect((await wave()).replyWindowEndsAt).toEqual(
        new Date('2026-11-06T23:50:00Z'),
      )
      await vi.waitFor(() => expect(waveSentEvents()).toHaveLength(1))
      expect(waveSentEvents()[0]?.[2]).toMatchObject({
        wave: 1,
        texts: 2,
        sendDate: '2026-11-04',
        handoff: 'agent',
      })
      const row = await handoff()
      expect(row.status).toBe(OutreachHandoffStatus.replies_submitted)
      expect(row.repliesSubmittedAt).not.toBeNull()
      expect(slackMessage).not.toHaveBeenCalled()
    })

    it('changes nothing when the same message arrives again', async () => {
      getFile.mockResolvedValue(exportCsv())
      await receive(uploaded(`agent-replies/${outreachId}.csv`))
      const firstWindow = (await wave()).replyWindowEndsAt
      const firstStamp = (await handoff()).repliesSubmittedAt

      expect(await receive(uploaded(`agent-replies/${outreachId}.csv`))).toBe(
        true,
      )

      expect(await replyCount()).toBe(1)
      expect((await wave()).replyWindowEndsAt).toEqual(firstWindow)
      expect((await handoff()).repliesSubmittedAt).toEqual(firstStamp)
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(waveSentEvents()).toHaveLength(1)
    })

    it('runs a message SQS delivers twice once', async () => {
      getFile.mockResolvedValue(exportCsv())
      const message = uploaded(`agent-replies/${outreachId}.csv`)

      await receive(message)
      expect(await receive(message)).toBe(true)

      expect(getFile).toHaveBeenCalledTimes(1)
      expect(await replyCount()).toBe(1)
    })

    it('falls back to the wave send time when the export has no outbound rows', async () => {
      getFile.mockResolvedValue(
        [HEADER, `${PHONE_1},JOIN,INBOUND,2026-11-05T14:00:00Z`].join('\n'),
      )

      await receive(uploaded(`agent-replies/${outreachId}.csv`))

      expect((await wave()).replyWindowEndsAt).toEqual(
        new Date('2026-11-06T15:00:00Z'),
      )
    })

    it('acks a key that is not an agent-replies export without writing', async () => {
      expect(
        await receive(uploaded(`agent-replies/${outreachId}-draft.csv`)),
      ).toBe(true)

      expect(getFile).not.toHaveBeenCalled()
      expect((await wave()).replyWindowEndsAt).toBeNull()
      expect((await handoff()).status).toBe(OutreachHandoffStatus.queued)
    })

    it('posts once to Slack with no phone numbers or reply text when nothing matches', async () => {
      getFile.mockResolvedValue(
        [
          HEADER,
          `+13035559999,secret reply body,INBOUND,2026-11-05T14:00:00Z`,
        ].join('\n'),
      )

      await receive(uploaded(`agent-replies/${outreachId}.csv`))

      expect(slackMessage).toHaveBeenCalledTimes(1)
      const [message, channel] = slackMessage.mock.calls[0] ?? []
      expect(channel).toBe(SlackChannel.botTevynApi)
      const text = JSON.stringify(message)
      expect(text).toContain(String(outreachId))
      expect(text).not.toContain('3035559999')
      expect(text).not.toContain('secret reply body')
    })
  })

  it('acks an outreach the agent does not handle without writing', async () => {
    await seed(OutreachHandoffHandler.manual)
    getFile.mockResolvedValue(exportCsv())

    expect(await receive(uploaded(`agent-replies/${outreachId}.csv`))).toBe(
      true,
    )

    expect(getFile).not.toHaveBeenCalled()
    expect(await replyCount()).toBe(0)
    expect((await wave()).replyWindowEndsAt).toBeNull()
    expect((await handoff()).status).toBe(OutreachHandoffStatus.queued)
  })
})
