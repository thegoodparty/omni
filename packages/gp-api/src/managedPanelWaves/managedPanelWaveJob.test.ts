import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
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
} from '@/generated/prisma'
import { OrganizationsService } from '@/organizations/services/organizations.service'
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
// Wednesday 2026-10-21, morning Eastern. Its third business day is Monday.
const WEDNESDAY = new Date('2026-10-21T12:19:00Z')
const WEDNESDAY_SEND_DATE = '2026-10-26'
// Three members short at the cold 3% join rate.
const GOAL = 3
const WAVE_SIZE = 100

let isFeatureEnabled: Mock<FeaturesService['isFeatureEnabled']>
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
  it('draws a wave and sends the approved invite free on the third business day', async () => {
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
    expect(wave.replyWindowEndsAt).toEqual(new Date(2026, 9, 31))
    expect(textSends()).toHaveLength(1)
    expect((await enrollment(id)).freeTextsUsed).toBe(WAVE_SIZE)
  })

  it('counts the third business day past a weekend', async () => {
    const { id } = await enroll()

    await job().advance(id, new Date('2026-10-23T12:19:00Z'))

    const wave = await waveAt(id, 1)
    expect(wave.outreach?.scheduledLocalDate).toBe('2026-10-28')
  })

  it('makes one wave and one send however often it runs before replies are in', async () => {
    const { id } = await enroll()

    await job().runWaves(WEDNESDAY)
    await job().runWaves(WEDNESDAY)
    expect(await job().advance(id, new Date('2026-10-29T12:19:00Z'))).toBe(
      'waiting',
    )

    expect(await waves(id)).toHaveLength(1)
    expect(textSends()).toHaveLength(1)
    expect((await enrollment(id)).freeTextsUsed).toBe(WAVE_SIZE)
  })

  it('runs once a day across replicas', async () => {
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
    it('closes a wave five days after its send date and counts who joined', async () => {
      const { slug, id } = await enroll({ goalMembers: 10 })
      await job().advance(id, WEDNESDAY)
      const wave = await waveAt(id, 1)
      const drawn = await service.prisma.voterFileFilterSampleMember.findMany({
        where: { voterFileFilterId: wave.voterFileFilterId ?? -1 },
        take: 2,
      })
      for (const { personId } of drawn) await setMember(slug, personId)
      await setMember(slug, randomUUID())

      expect(await job().advance(id, new Date(2026, 9, 30, 23))).toBe('waiting')
      expect(await job().advance(id, new Date(2026, 9, 31, 9))).toBe('sent')

      const closed = await waveAt(id, 1)
      const next = await waveAt(id, 2)
      expect(closed.closedAt).toEqual(new Date(2026, 9, 31, 9))
      expect(closed.joinedMembers).toBe(2)
      expect(next.wave).toBe(2)
      expect(next.outreach?.fundedBy).toBe(OutreachFunding.goodparty_pilot)
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
        }),
      ]),
    )
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
