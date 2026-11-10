import { randomUUID } from 'node:crypto'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest'
import { CIVIC_PANEL_JOIN_LINE } from '@goodparty_org/contracts'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import type { PersonOutput } from '@/contacts/schemas/person.schema'
import { FeaturesService } from '@/features/services/features.service'
import {
  CivicPanelStatus,
  ContactStatusField,
  ContactStatusSource,
  ManagedCivicPanelStatus,
  OutreachFunding,
  OutreachStatus,
  OutreachType,
  Prisma,
  UserRole,
} from '@/generated/prisma'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import {
  OutreachHandoffHandler,
  OutreachHandoffStatus,
} from '@/generated/prisma'
import { OutreachServeSmsCreateService } from '@/outreach/services/outreachServeSmsCreate.service'
import { StatsService } from '@/peopleDb/services/stats.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { QueueType } from '@/queue/queue.types'
import { useTestService } from '@/test-service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { SlackService } from '@/vendors/slack/services/slack.service'
import {
  MANAGED_PANEL_WAVE_JOB,
  ManagedPanelWaveJobService,
} from './managedPanelWaveJob.service'

const service = useTestService()

const INVITE = `Hi, it's Mayor Lee. ${CIVIC_PANEL_JOIN_LINE}\nReply STOP to opt out.`
// Wednesday 2026-10-21, morning Eastern. Two days out is Friday.
const WEDNESDAY = new Date('2026-10-21T12:19:00Z')
const WEDNESDAY_SEND_DATE = '2026-10-23'
// 11am on the send date in the test office's zone (Pacific), plus 48 hours.
const WEDNESDAY_REPLIES_CLOSE = new Date('2026-10-25T18:00:00Z')
// Three members short at the cold 3% join rate.
const GOAL = 3
const WAVE_SIZE = 100

let isFeatureEnabled: Mock<FeaturesService['isFeatureEnabled']>
let agentVariant: string | null
let sendMessage: Mock<QueueProducerService['sendMessage']>
let samplePeople: ReturnType<typeof stubDraws>

const job = () => service.app.get(ManagedPanelWaveJobService)

const page = (totalResults: number) => ({
  people: [],
  pagination: {
    totalResults,
    currentPage: 1,
    pageSize: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
})

const stubCells = (cells: number) =>
  vi
    .spyOn(service.app.get(VoterQueryService), 'findPeople')
    .mockImplementation(async () => page(cells) as never)

const stubDraws = () =>
  vi
    .spyOn(service.app.get(VoterQueryService), 'samplePeople')
    .mockImplementation(async (dto) =>
      Array.from(
        { length: Number(dto.size) },
        () => ({ id: randomUUID() }) as PersonOutput,
      ),
    )

beforeEach(() => {
  stubCells(58_000)
  samplePeople = stubDraws()
  vi.spyOn(
    service.app.get(StatsService),
    'findWeightingInputs',
  ).mockResolvedValue({ district: null, cells: [], tractAdults: new Map() })
  // Everyone a wave's list drew has a cell phone and has not opted out.
  vi.spyOn(
    service.app.get(OutreachServeSmsCreateService),
    'resolveListAudienceCount',
  ).mockImplementation(async (_org, filter) => ({
    recipientCount: await service.prisma.voterFileFilterSampleMember.count({
      where: { voterFileFilterId: Number(filter.id) },
    }),
    excludedOptedOutCount: 0,
    excludedDuplicatePhoneCount: 0,
  }))

  isFeatureEnabled = vi
    .fn<FeaturesService['isFeatureEnabled']>()
    .mockResolvedValue(true)
  vi.spyOn(
    service.app.get(FeaturesService),
    'isFeatureEnabled',
  ).mockImplementation(isFeatureEnabled)
  agentVariant = null
  vi.spyOn(
    service.app.get(FeaturesService),
    'getFeatureVariant',
  ).mockImplementation(async () => agentVariant)
  vi.spyOn(
    service.app.get(OrganizationsService),
    'getDistrictForOrgSlug',
  ).mockResolvedValue({
    id: 'district',
    state: 'CA',
    l2Type: 'City',
    l2Name: 'Anywhere',
  })
  sendMessage = vi
    .fn<QueueProducerService['sendMessage']>()
    .mockResolvedValue(undefined)
  vi.spyOn(
    service.app.get(QueueProducerService),
    'sendMessage',
  ).mockImplementation(sendMessage)
  vi.spyOn(service.app.get(SlackService), 'message').mockResolvedValue(
    undefined,
  )
  vi.spyOn(
    service.app.get(OrganizationsService),
    'resolvePositionNameByOrganizationSlug',
  ).mockResolvedValue('Mayor')
})

const enroll = async (
  overrides: Partial<Prisma.ManagedCivicPanelUncheckedCreateInput> = {},
) => {
  const slug = `eo-managed-job-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id, overrideDistrictId: randomUUID() },
  })
  const enrollment = await service.prisma.managedCivicPanel.create({
    data: {
      organizationSlug: slug,
      inviteMessage: INVITE,
      consentVersion: '2026-10-22',
      approvedAt: new Date(),
      approvedByUserId: service.user.id,
      goalMembers: GOAL,
      ...overrides,
    },
  })
  return { slug, id: enrollment.id }
}

const setMember = (slug: string, personId: string) =>
  service.app.get(ContactStatusService).changeStatus({
    organizationSlug: slug,
    personId,
    field: ContactStatusField.civic_panel,
    toValue: CivicPanelStatus.member,
    source: ContactStatusSource.manual,
    actorUserId: service.user.id,
    fallbackFromValue: CivicPanelStatus.left,
  })

const waves = (enrollmentId: string) =>
  service.prisma.managedPanelWave.findMany({
    where: { enrollmentId },
    orderBy: { wave: 'asc' },
    include: { outreach: true },
  })

const waveAt = (enrollmentId: string, wave: number) =>
  service.prisma.managedPanelWave.findFirstOrThrow({
    where: { enrollmentId, wave },
    include: { outreach: true },
  })

const enrollment = (id: string) =>
  service.prisma.managedCivicPanel.findUniqueOrThrow({ where: { id } })

const textSends = () =>
  sendMessage.mock.calls.filter(
    ([message]) => message.type === QueueType.OUTREACH_TEXT_SEND,
  )

// A wave with its list and an unpaid draft of the invite, as an earlier run
// leaves one it could not claim.
const waveWithDraft = async (
  enrollmentId: string,
  slug: string,
  outreach: Partial<Prisma.OutreachUncheckedCreateInput> = {},
) => {
  const list = await service.prisma.voterFileFilter.create({
    data: {
      organizationSlug: slug,
      civicPanelInvite: true,
      name: 'Civic panel invite',
      sampleMembers: {
        create: Array.from({ length: 40 }, () => ({ personId: randomUUID() })),
      },
    },
  })
  const wave = await service.prisma.managedPanelWave.create({
    data: { enrollmentId, wave: 1, voterFileFilterId: list.id },
  })
  await service.prisma.outreach.create({
    data: {
      campaignId: null,
      organizationSlug: slug,
      outreachType: OutreachType.text,
      status: OutreachStatus.pending_payment,
      message: INVITE,
      asksToJoinCivicPanel: true,
      scheduledLocalDate: WEDNESDAY_SEND_DATE,
      voterFileFilterId: list.id,
      textCount: 40,
      managedPanelWaveId: wave.id,
      ...outreach,
    },
  })
  return wave
}

describe('the managed panel wave job', () => {
  it('draws a wave and sends the approved invite free two days out', async () => {
    const { slug, id } = await enroll()

    expect(await job().advance(id, WEDNESDAY)).toBe('sent')

    const wave = await waveAt(id, 1)
    expect(wave.outreach).toMatchObject({
      organizationSlug: slug,
      campaignId: null,
      outreachType: OutreachType.text,
      status: OutreachStatus.pending,
      fundedBy: OutreachFunding.goodparty_pilot,
      stripeCheckoutSessionId: null,
      message: INVITE,
      asksToJoinCivicPanel: true,
      scheduledLocalDate: WEDNESDAY_SEND_DATE,
      voterFileFilterId: wave.voterFileFilterId,
      textCount: WAVE_SIZE,
      billableTextCount: WAVE_SIZE,
    })
    expect(wave.sentAt).toEqual(WEDNESDAY)
    expect(wave.replyWindowEndsAt).toEqual(WEDNESDAY_REPLIES_CLOSE)
    expect(textSends()).toHaveLength(1)
    expect((await enrollment(id)).freeTextsUsed).toBe(WAVE_SIZE)
  })

  it('moves a send that lands on a weekend to the Monday', async () => {
    const { id } = await enroll()

    await job().advance(id, new Date('2026-10-23T12:19:00Z'))

    const wave = await waveAt(id, 1)
    expect(wave.outreach?.scheduledLocalDate).toBe('2026-10-26')
  })

  it('makes one wave and one send however often it runs before replies are in', async () => {
    const { id } = await enroll()

    await job().runWaves(WEDNESDAY)
    await job().runWaves(WEDNESDAY)
    expect(await job().advance(id, new Date('2026-10-25T12:19:00Z'))).toBe(
      'waiting',
    )

    expect(await waves(id)).toHaveLength(1)
    expect(textSends()).toHaveLength(1)
    expect((await enrollment(id)).freeTextsUsed).toBe(WAVE_SIZE)
  })

  it('runs once an hour across replicas', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'dev')
    const { id } = await enroll()
    const runWaves = vi.spyOn(job(), 'runWaves')
    await service.prisma.cronRun.deleteMany({
      where: { jobName: MANAGED_PANEL_WAVE_JOB },
    })

    await Promise.all([job().runDaily(), job().runDaily()])

    expect(runWaves).toHaveBeenCalledTimes(1)
    expect(await waves(id)).toHaveLength(1)
    vi.unstubAllEnvs()
  })

  it('never runs on a PR preview', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'preview')
    const { id } = await enroll()

    await job().runDaily()

    expect(await waves(id)).toHaveLength(0)
    vi.unstubAllEnvs()
  })

  describe('retries', () => {
    it('sends a wave whose enqueue failed on the next run, once', async () => {
      const { id } = await enroll()
      sendMessage.mockRejectedValueOnce(new Error('SQS down'))

      await job().runWaves(WEDNESDAY)
      const failed = await waveAt(id, 1)
      expect(failed.sentAt).toBeNull()
      expect(failed.outreach?.status).toBe(OutreachStatus.pending_payment)
      expect((await enrollment(id)).freeTextsUsed).toBe(0)

      expect(await job().advance(id, WEDNESDAY)).toBe('sent')

      expect(await waves(id)).toHaveLength(1)
      const after = await waveAt(id, 1)
      expect(after.outreach?.fundedBy).toBe(OutreachFunding.goodparty_pilot)
      expect(after.sentAt).toEqual(WEDNESDAY)
      expect(
        await service.prisma.outreach.count({
          where: { organizationSlug: (await enrollment(id)).organizationSlug },
        }),
      ).toBe(1)
      expect((await enrollment(id)).freeTextsUsed).toBe(WAVE_SIZE)
    })

    it('resumes a wave claimed but never enqueued without spending its texts again', async () => {
      const { slug, id } = await enroll({ freeTextsUsed: 40 })
      const wave = await waveWithDraft(id, slug, {
        status: OutreachStatus.pending,
        fundedBy: OutreachFunding.goodparty_pilot,
        billableTextCount: 40,
      })

      expect(await job().advance(id, WEDNESDAY)).toBe('sent')

      expect(textSends()).toHaveLength(1)
      expect((await enrollment(id)).freeTextsUsed).toBe(40)
      const after = await waveAt(id, 1)
      expect(after.id).toBe(wave.id)
      expect(after.sentAt).toEqual(WEDNESDAY)
    })

    it('only marks a wave sent whose send was already handed off', async () => {
      const { slug, id } = await enroll({ freeTextsUsed: 40 })
      await waveWithDraft(id, slug, {
        status: OutreachStatus.in_progress,
        fundedBy: OutreachFunding.goodparty_pilot,
        billableTextCount: 40,
      })

      expect(await job().advance(id, WEDNESDAY)).toBe('sent')

      expect(textSends()).toHaveLength(0)
      expect((await enrollment(id)).freeTextsUsed).toBe(40)
      expect((await waveAt(id, 1)).sentAt).toEqual(WEDNESDAY)
    })

    it('gives a draft left unclaimed a fresh send date before claiming it', async () => {
      const { slug, id } = await enroll()
      await waveWithDraft(id, slug, { scheduledLocalDate: '2026-10-01' })

      expect(await job().advance(id, WEDNESDAY)).toBe('sent')

      expect((await waveAt(id, 1)).outreach).toMatchObject({
        scheduledLocalDate: WEDNESDAY_SEND_DATE,
        fundedBy: OutreachFunding.goodparty_pilot,
      })
    })
  })

  describe('reply window', () => {
    const AFTER_CLOSE = new Date('2026-10-25T18:19:00Z')

    it('closes a wave 48 hours after its send once its replies are uploaded, and counts who joined', async () => {
      const { slug, id } = await enroll({ goalMembers: 10 })
      await job().advance(id, WEDNESDAY)
      const wave = await waveAt(id, 1)
      const drawn = await service.prisma.voterFileFilterSampleMember.findMany({
        where: { voterFileFilterId: wave.voterFileFilterId ?? -1 },
        take: 2,
      })
      for (const { personId } of drawn) await setMember(slug, personId)
      await setMember(slug, randomUUID())

      expect(await job().advance(id, new Date('2026-10-25T17:19:00Z'))).toBe(
        'waiting',
      )
      expect(await job().advance(id, AFTER_CLOSE)).toBe('waiting')
      await service.prisma.managedPanelWave.update({
        where: { id: wave.id },
        data: { repliesUploadedAt: AFTER_CLOSE },
      })
      expect(await job().advance(id, AFTER_CLOSE)).toBe('sent')

      const closed = await waveAt(id, 1)
      const next = await waveAt(id, 2)
      expect(closed.closedAt).toEqual(AFTER_CLOSE)
      expect(closed.joinedMembers).toBe(2)
      expect(next.wave).toBe(2)
      expect(next.outreach?.fundedBy).toBe(OutreachFunding.goodparty_pilot)
    })

    it('closes a wave whose replies never came three days past its window', async () => {
      const { id } = await enroll({ goalMembers: 10 })
      await job().advance(id, WEDNESDAY)

      expect(await job().advance(id, new Date('2026-10-28T17:19:00Z'))).toBe(
        'waiting',
      )
      expect(await job().advance(id, new Date('2026-10-28T18:19:00Z'))).toBe(
        'sent',
      )

      expect((await waveAt(id, 1)).closedAt).toEqual(
        new Date('2026-10-28T18:19:00Z'),
      )
      expect((await waveAt(id, 2)).wave).toBe(2)
    })

    it('marks the panel ready once members reach the goal', async () => {
      const { slug, id } = await enroll()
      await job().advance(id, WEDNESDAY)
      for (let i = 0; i < GOAL; i++) await setMember(slug, randomUUID())

      expect(await job().advance(id, new Date(2026, 9, 31, 9))).toBe('ready')

      expect(await enrollment(id)).toMatchObject({
        status: ManagedCivicPanelStatus.ready,
        readyAt: new Date(2026, 9, 31, 9),
      })
      expect(await waves(id)).toHaveLength(1)
    })
  })

  it('marks the panel ready without drawing when it already has its members', async () => {
    const { slug, id } = await enroll()
    for (let i = 0; i < GOAL; i++) await setMember(slug, randomUUID())

    expect(await job().advance(id, WEDNESDAY)).toBe('ready')

    expect(await waves(id)).toHaveLength(0)
    expect(textSends()).toHaveLength(0)
  })

  it('marks the panel exhausted when nobody is left to invite', async () => {
    const { id } = await enroll()
    stubCells(0)

    expect(await job().advance(id, WEDNESDAY)).toBe('exhausted')

    expect((await enrollment(id)).status).toBe(
      ManagedCivicPanelStatus.exhausted,
    )
    expect(await waves(id)).toHaveLength(0)
    expect(textSends()).toHaveLength(0)
  })

  it('marks the panel exhausted and drops the wave when its list reaches nobody', async () => {
    const { id } = await enroll()
    vi.spyOn(
      service.app.get(OutreachServeSmsCreateService),
      'resolveListAudienceCount',
    ).mockResolvedValue({
      recipientCount: 0,
      excludedOptedOutCount: 0,
      excludedDuplicatePhoneCount: 0,
    })

    expect(await job().advance(id, WEDNESDAY)).toBe('exhausted')

    expect(await waves(id)).toHaveLength(0)
    expect(textSends()).toHaveLength(0)
  })

  describe('holds', () => {
    it.each([ManagedCivicPanelStatus.paused, ManagedCivicPanelStatus.stopped])(
      'leaves a %s panel alone',
      async (status) => {
        const { slug, id } = await enroll({ status })
        await waveWithDraft(id, slug)

        await job().runWaves(WEDNESDAY)
        expect(await job().advance(id, WEDNESDAY)).toBe('held')

        const wave = await waveAt(id, 1)
        expect(wave.outreach).toMatchObject({
          status: OutreachStatus.pending_payment,
          fundedBy: null,
        })
        expect(wave.sentAt).toBeNull()
        expect(samplePeople).not.toHaveBeenCalled()
        expect(textSends()).toHaveLength(0)
      },
    )

    it('pauses at the cap when the wave does not fit', async () => {
      const { slug, id } = await enroll({ freeTextCap: 100, freeTextsUsed: 80 })
      await waveWithDraft(id, slug)

      expect(await job().advance(id, WEDNESDAY)).toBe('paused_at_cap')

      expect((await enrollment(id)).status).toBe(ManagedCivicPanelStatus.paused)
      expect((await waveAt(id, 1)).outreach?.fundedBy).toBeNull()
      expect(textSends()).toHaveLength(0)
    })

    it('pauses once every free text is spent', async () => {
      const { id } = await enroll({ freeTextCap: 100, freeTextsUsed: 100 })

      expect(await job().advance(id, WEDNESDAY)).toBe('paused_at_cap')

      expect(await enrollment(id)).toMatchObject({
        status: ManagedCivicPanelStatus.paused,
        freeTextsUsed: 100,
      })
      expect(await waves(id)).toHaveLength(0)
      expect(textSends()).toHaveLength(0)
    })
  })

  describe('outside the flag', () => {
    it('sends nothing free for an office whose approver is not flagged', async () => {
      const { slug, id } = await enroll()
      await waveWithDraft(id, slug)
      isFeatureEnabled.mockResolvedValue(false)

      await job().runWaves(WEDNESDAY)

      expect(await waves(id)).toHaveLength(1)
      const wave = await waveAt(id, 1)
      expect(wave.outreach).toMatchObject({
        status: OutreachStatus.pending_payment,
        fundedBy: null,
      })
      expect(wave.sentAt).toBeNull()
      expect(textSends()).toHaveLength(0)
      expect((await enrollment(id)).freeTextsUsed).toBe(0)
    })

    it('draws nothing for an unflagged office', async () => {
      const { id } = await enroll()
      isFeatureEnabled.mockResolvedValue(false)

      expect(await job().advance(id, WEDNESDAY)).toBe('flag_off')

      expect(await waves(id)).toHaveLength(0)
      expect(samplePeople).not.toHaveBeenCalled()
    })

    it("never funds the office's own unpaid texts", async () => {
      const { slug, id } = await enroll()
      const own = await service.prisma.outreach.create({
        data: {
          campaignId: null,
          organizationSlug: slug,
          outreachType: OutreachType.text,
          status: OutreachStatus.pending_payment,
          message: INVITE,
          asksToJoinCivicPanel: true,
          scheduledLocalDate: WEDNESDAY_SEND_DATE,
          textCount: 40,
        },
      })

      await job().runWaves(WEDNESDAY)

      expect(
        await service.prisma.outreach.findUniqueOrThrow({
          where: { id: own.id },
        }),
      ).toMatchObject({
        status: OutreachStatus.pending_payment,
        fundedBy: null,
        managedPanelWaveId: null,
      })
      // The job did run: its own wave went out free.
      expect((await waveAt(id, 1)).outreach?.fundedBy).toBe(
        OutreachFunding.goodparty_pilot,
      )
      expect(textSends().map(([message]) => message.data)).not.toContainEqual(
        expect.objectContaining({ outreachId: own.id }),
      )
    })
  })

  describe('agent-handled waves', () => {
    // Saturday 2026-10-24, 8am Pacific: 11am Pacific is three hours away.
    const SATURDAY = new Date('2026-10-24T15:00:00Z')
    // Saturday 11:30am Pacific: today's slot is gone, so Sunday's is next.
    const SATURDAY_NOON = new Date('2026-10-24T18:30:00Z')

    const handoffOf = (outreachId: number) =>
      service.prisma.outreachTextHandoff.create({
        data: {
          outreachId,
          handler: OutreachHandoffHandler.agent,
          status: OutreachHandoffStatus.queued,
          mode: 'shadow',
          sendAt: SATURDAY,
          timeZone: 'US/Pacific',
        },
      })

    it.each(['off', 'control', null])(
      'sends the manual way when the flag is %s',
      async (variant) => {
        agentVariant = variant
        const { id } = await enroll()

        await job().advance(id, WEDNESDAY)

        const wave = await waveAt(id, 1)
        expect(wave.outreach?.scheduledLocalDate).toBe(WEDNESDAY_SEND_DATE)
        expect(wave.replyWindowEndsAt).toEqual(WEDNESDAY_REPLIES_CLOSE)
        expect(textSends()[0]?.[0].data).not.toHaveProperty('agentHandoff')
      },
    )

    it.each(['shadow', 'auto'] as const)(
      'hands a %s wave the 11am Pacific slot on a Saturday with no window',
      async (mode) => {
        agentVariant = mode
        const { id } = await enroll()

        expect(await job().advance(id, SATURDAY)).toBe('sent')

        const wave = await waveAt(id, 1)
        expect(wave.outreach).toMatchObject({
          scheduledLocalDate: '2026-10-24',
          fundedBy: OutreachFunding.goodparty_pilot,
        })
        expect(wave.sentAt).toEqual(SATURDAY)
        expect(wave.replyWindowEndsAt).toBeNull()
        expect(textSends()[0]?.[0].data).toMatchObject({
          outreachId: wave.outreach?.id,
          agentHandoff: {
            mode,
            sendAt: '2026-10-24T18:00:00.000Z',
            timeZone: 'US/Pacific',
          },
        })
      },
    )

    it('rolls to Sunday once the day slot is under two hours away', async () => {
      agentVariant = 'auto'
      const { id } = await enroll()

      await job().advance(id, SATURDAY_NOON)

      expect((await waveAt(id, 1)).outreach?.scheduledLocalDate).toBe(
        '2026-10-25',
      )
      expect(textSends()[0]?.[0].data).toMatchObject({
        agentHandoff: { sendAt: '2026-10-25T18:00:00.000Z' },
      })
    })

    it('moves a stale draft to the agent slot before claiming it', async () => {
      agentVariant = 'shadow'
      const { slug, id } = await enroll()
      await waveWithDraft(id, slug, { scheduledLocalDate: '2026-10-01' })

      await job().advance(id, SATURDAY)

      expect((await waveAt(id, 1)).outreach?.scheduledLocalDate).toBe(
        '2026-10-24',
      )
    })

    it('keeps a handed-off wave an agent wave when the flag is later off', async () => {
      const { slug, id } = await enroll({ freeTextsUsed: 40 })
      const wave = await waveWithDraft(id, slug, {
        status: OutreachStatus.in_progress,
        fundedBy: OutreachFunding.goodparty_pilot,
        billableTextCount: 40,
      })
      await handoffOf((await waveAt(id, 1)).outreach?.id ?? -1)
      agentVariant = null

      await job().advance(id, SATURDAY)

      expect(textSends()).toHaveLength(0)
      expect(
        (
          await service.prisma.managedPanelWave.findUniqueOrThrow({
            where: { id: wave.id },
          })
        ).replyWindowEndsAt,
      ).toBeNull()
    })

    it('repeats the hand-off on a redelivery after the flag turned off', async () => {
      const { slug, id } = await enroll({ freeTextsUsed: 40 })
      await waveWithDraft(id, slug, {
        status: OutreachStatus.pending,
        fundedBy: OutreachFunding.goodparty_pilot,
        billableTextCount: 40,
      })
      await handoffOf((await waveAt(id, 1)).outreach?.id ?? -1)
      agentVariant = null

      await job().advance(id, SATURDAY)

      expect(textSends()[0]?.[0].data).toMatchObject({
        agentHandoff: {
          mode: 'shadow',
          sendAt: '2026-10-24T15:00:00.000Z',
          timeZone: 'US/Pacific',
        },
      })
      expect((await waveAt(id, 1)).replyWindowEndsAt).toBeNull()
    })

    it('does not close an agent wave with no window, whether or not delivery has made its hand-off', async () => {
      agentVariant = 'shadow'
      const { id } = await enroll({ goalMembers: 10 })
      await job().advance(id, SATURDAY)
      const later = new Date('2026-11-20T15:00:00Z')

      expect(await job().advance(id, later)).toBe('waiting')
      await handoffOf((await waveAt(id, 1)).outreach?.id ?? -1)
      await service.prisma.outreach.updateMany({
        where: { managedPanelWave: { enrollmentId: id } },
        data: { status: OutreachStatus.completed },
      })
      expect(await job().advance(id, later)).toBe('waiting')

      expect((await waveAt(id, 1)).closedAt).toBeNull()
      expect(await waves(id)).toHaveLength(1)
    })

    it('closes an agent wave on the next run once its replies are in', async () => {
      agentVariant = 'shadow'
      const { id } = await enroll({ goalMembers: 10 })
      await job().advance(id, SATURDAY)
      const { outreach } = await waveAt(id, 1)
      const row = await handoffOf(outreach?.id ?? -1)
      const later = new Date('2026-11-20T15:00:00Z')
      expect(await job().advance(id, later)).toBe('waiting')

      await service.prisma.outreachTextHandoff.update({
        where: { id: row.id },
        data: { status: OutreachHandoffStatus.replies_submitted },
      })
      await job().advance(id, later)

      expect((await waveAt(id, 1)).closedAt).toEqual(later)
    })

    it('still closes a manual wave that has a null window', async () => {
      const { slug, id } = await enroll({ goalMembers: 10 })
      const wave = await waveWithDraft(id, slug, {
        status: OutreachStatus.completed,
        fundedBy: OutreachFunding.goodparty_pilot,
        billableTextCount: 40,
      })
      await service.prisma.managedPanelWave.update({
        where: { id: wave.id },
        data: { sentAt: WEDNESDAY },
      })

      await job().advance(id, new Date('2026-10-23T12:19:00Z'))

      expect((await waveAt(id, 1)).closedAt).not.toBeNull()
    })
  })
})

describe('the managed panel wave job analytics', () => {
  let track: Mock<AnalyticsService['track']>
  beforeEach(() => {
    track = vi
      .fn<AnalyticsService['track']>()
      .mockResolvedValue(undefined as never)
    vi.spyOn(service.app.get(AnalyticsService), 'track').mockImplementation(
      track,
    )
  })

  const enrollOffice = async (
    overrides: Partial<Prisma.ManagedCivicPanelUncheckedCreateInput> = {},
  ) => {
    const enrolled = await enroll(overrides)
    await service.prisma.electedOffice.create({
      data: { organizationSlug: enrolled.slug, userId: service.user.id },
    })
    return enrolled
  }

  const tracked = (event: string) =>
    track.mock.calls
      .filter(([, name]) => name === event)
      .map(([, , properties]) => properties)

  it('records each wave sent, once', async () => {
    const { id } = await enrollOffice()

    await job().advance(id, WEDNESDAY)
    await job().advance(id, WEDNESDAY)

    await vi.waitFor(() =>
      expect(tracked(EVENTS.Contacts.CivicPanelWaveSent)).toEqual([
        expect.objectContaining({
          wave: 1,
          texts: WAVE_SIZE,
          sendDate: WEDNESDAY_SEND_DATE,
          handoff: 'manual',
        }),
      ]),
    )
  })

  it('leaves an agent wave unrecorded until its report', async () => {
    agentVariant = 'shadow'
    const { id } = await enrollOffice()

    await job().advance(id, new Date('2026-10-24T15:00:00Z'))

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(tracked(EVENTS.Contacts.CivicPanelWaveSent)).toEqual([])
  })

  it('records the wave closing and the civic panel reaching its goal', async () => {
    const { slug, id } = await enrollOffice()
    await job().advance(id, WEDNESDAY)
    for (let i = 0; i < GOAL; i++) await setMember(slug, randomUUID())

    expect(await job().advance(id, new Date(2026, 9, 31, 9))).toBe('ready')

    await vi.waitFor(() =>
      expect(tracked(EVENTS.Contacts.CivicPanelReady)).toHaveLength(1),
    )
    expect(tracked(EVENTS.Contacts.CivicPanelWaveClosed)).toEqual([
      {
        organizationSlug: slug,
        wave: 1,
        invited: WAVE_SIZE,
        joinedMembers: 0,
        membersAfter: GOAL,
      },
    ])
    expect(tracked(EVENTS.Contacts.CivicPanelStatusChanged)).toEqual([
      expect.objectContaining({
        from: 'building',
        to: 'ready',
        members: GOAL,
        changedBy: 'system',
      }),
    ])
    expect(tracked(EVENTS.Contacts.CivicPanelReady)[0]).toEqual(
      expect.objectContaining({
        members: GOAL,
        goalMembers: GOAL,
        wavesSent: 1,
        daysToReady: expect.any(Number),
      }),
    )
  })

  it('records the job pausing a civic panel at its free text cap', async () => {
    const { slug, id } = await enrollOffice({
      freeTextCap: 100,
      freeTextsUsed: 80,
    })
    await waveWithDraft(id, slug)

    expect(await job().advance(id, WEDNESDAY)).toBe('paused_at_cap')

    await vi.waitFor(() =>
      expect(tracked(EVENTS.Contacts.CivicPanelStatusChanged)).toEqual([
        expect.objectContaining({
          from: 'building',
          to: 'paused',
          changedBy: 'system',
        }),
      ]),
    )
  })
})

describe('a managed wave results upload', () => {
  const BASE = '/v1/outreach/admin/results/sms'
  // Past wave 1's window, which ends 2026-10-25 at 11am Pacific.
  const AFTER_WINDOW = new Date('2026-11-04T15:00:00Z')
  const PERSON = { personId: randomUUID(), phone: '+13035550177' }
  const REPLIES_CSV = [
    'Contact Phone Number,Message Text,Sent At,Send Direction',
    `${PERSON.phone},JOIN,2026-10-27T15:04:05.000Z,INBOUND`,
  ].join('\n')

  beforeEach(async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.admin] },
    })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(AFTER_WINDOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const sentWave = async () => {
    const { slug, id } = await enroll({ goalMembers: 10 })
    await job().advance(id, WEDNESDAY)
    const first = await waveAt(id, 1)
    const outreachId = first.outreach?.id ?? -1
    await service.prisma.outreach.update({
      where: { id: outreachId },
      data: { status: OutreachStatus.in_progress },
    })
    await service.prisma.outreachTextRecipient.create({
      data: { outreachId, organizationSlug: slug, ...PERSON },
    })
    await service.prisma.contactInteractionText.create({
      data: {
        outreachId,
        organizationSlug: slug,
        personId: PERSON.personId,
        occurredAt: new Date(),
      },
    })
    return { slug, id, outreachId }
  }

  const upload = (outreachId: number, dryRun: boolean) =>
    service.client.post(`${BASE}/${outreachId}`, {
      fileName: 'results.csv',
      csv: REPLIES_CSV,
      dryRun,
      sourceLabel: 'gp-admin upload by staffer@goodparty.org',
    })

  const handoff = (outreachId: number) =>
    service.prisma.outreachTextHandoff.create({
      data: {
        outreachId,
        handler: 'agent',
        mode: 'auto',
        sendAt: WEDNESDAY,
        timeZone: 'America/New_York',
      },
    })

  it('marks the hand-off replies_submitted and leaves the wave to the job', async () => {
    const { id, outreachId } = await sentWave()
    await handoff(outreachId)

    const result = await upload(outreachId, false)

    expect(result.status).toBe(201)
    const row = await service.prisma.outreachTextHandoff.findUniqueOrThrow({
      where: { outreachId },
    })
    expect(row.status).toBe('replies_submitted')
    expect(row.repliesSubmittedAt).toEqual(AFTER_WINDOW)
    expect((await waves(id)).map((wave) => wave.closedAt)).toEqual([null])
  })

  it('keeps the first stamp of a hand-off already replies_submitted', async () => {
    const { outreachId } = await sentWave()
    const stamped = new Date('2026-10-30T12:00:00Z')
    await service.prisma.outreachTextHandoff.create({
      data: {
        outreachId,
        handler: 'agent',
        mode: 'auto',
        sendAt: WEDNESDAY,
        timeZone: 'America/New_York',
        status: 'replies_submitted',
        repliesSubmittedAt: stamped,
      },
    })

    const result = await upload(outreachId, false)

    expect(result.status).toBe(201)
    const row = await service.prisma.outreachTextHandoff.findUniqueOrThrow({
      where: { outreachId },
    })
    expect(row.status).toBe('replies_submitted')
    expect(row.repliesSubmittedAt).toEqual(stamped)
  })

  it('stamps a manual wave when its replies are uploaded, once', async () => {
    const { id, outreachId } = await sentWave()

    expect((await upload(outreachId, true)).status).toBe(201)
    expect((await waveAt(id, 1)).repliesUploadedAt).toBeNull()

    expect((await upload(outreachId, false)).status).toBe(201)
    expect((await waveAt(id, 1)).repliesUploadedAt).toEqual(AFTER_WINDOW)

    vi.setSystemTime(new Date('2026-11-05T15:00:00Z'))
    expect((await upload(outreachId, false)).status).toBe(201)
    expect((await waveAt(id, 1)).repliesUploadedAt).toEqual(AFTER_WINDOW)
  })

  it('leaves the hand-off alone on a dry run', async () => {
    const { outreachId } = await sentWave()
    await handoff(outreachId)

    const result = await upload(outreachId, true)

    expect(result.status).toBe(201)
    const row = await service.prisma.outreachTextHandoff.findUniqueOrThrow({
      where: { outreachId },
    })
    expect(row.status).toBe('queued')
    expect(row.repliesSubmittedAt).toBeNull()
  })
})
