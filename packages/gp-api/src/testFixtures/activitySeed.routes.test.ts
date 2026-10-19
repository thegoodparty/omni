import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  answersNeeded,
  CIVIC_PANEL_JOIN_LINE,
  type Person,
} from '@goodparty_org/contracts'
import {
  CivicPanelBuildChannel,
  CivicPanelBuildPlanStatus,
  CivicPanelStatus,
  ConstituentFeedbackChannel,
  ContactStatusField,
  ContactStatusSource,
  OutreachStatus,
  OutreachType,
  SynthesisRunStatus,
  SynthesisScope,
  UserRole,
} from '@/generated/prisma'
import { MockSynthesisEngine } from '@/constituentFeedback/services/mockSynthesisEngine'
import {
  createServeOrg,
  createWinOrg,
} from '@/constituentFeedback/tests/issueCaptureFixtures'
import { ContactsService } from '@/contacts/services/contacts.service'
import { StatsService } from '@/peopleDb/services/stats.service'
import { PriorityResultsService } from '@/priorities/services/priorityResults.service'
import { useTestService } from '@/test-service'

const { envNonProd } = vi.hoisted(() => ({ envNonProd: { value: true } }))
vi.mock('@/shared/util/appEnvironment.util', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/util/appEnvironment.util')>()
  return {
    ...actual,
    get IS_NON_PROD_DEPLOY() {
      return envNonProd.value
    },
  }
})

const service = useTestService()

const person = (index: number): Person =>
  ({
    id: randomUUID(),
    firstName: `First${index}`,
    lastName: `Last${index}`,
    cellPhone: `30755${String(index).padStart(5, '0')}`,
    address: {
      line1: `${index} Main St`,
      latitude: String(39.7 + index / 1000),
      longitude: String(-104.9 - index / 1000),
    },
  }) as Person

const PEOPLE = Array.from({ length: 40 }, (_, index) => person(index))
// Enough residents for the priority ask to reach a good read.
const DISTRICT_SAMPLE = Array.from({ length: 160 }, (_, index) => person(index))

const seed = (slug: string, people: Person[] = PEOPLE) =>
  service.client.post(
    `/v1/test-fixtures/organizations/${slug}/activity`,
    { people: people.length },
    { validateStatus: () => true },
  )

const makeAdmin = () =>
  service.prisma.user.update({
    where: { id: service.user.id },
    data: { roles: [UserRole.admin] },
  })

describe('POST /v1/test-fixtures/organizations/:slug/activity', () => {
  let scheduled: Array<Parameters<MockSynthesisEngine['scheduleCompletion']>>

  beforeEach(async () => {
    envNonProd.value = true
    await makeAdmin()
    scheduled = []
    const engine = vi
      .spyOn(service.app.get(MockSynthesisEngine), 'scheduleCompletion')
      .mockImplementation((...args) => {
        scheduled.push(args)
      })
    const contacts = service.app.get(ContactsService)
    const sample = vi
      .spyOn(contacts, 'sampleContacts')
      .mockResolvedValue(PEOPLE)
    // What the panel plan sizes its first wave from.
    const pools = vi.spyOn(contacts, 'countWithin').mockResolvedValue(5_000)
    const stats = service.app.get(StatsService)
    const population = vi
      .spyOn(stats, 'findDistrictPopulation')
      .mockResolvedValue(null)
    const weighting = vi
      .spyOn(stats, 'findWeightingInputs')
      .mockResolvedValue({ district: null, cells: [], tractAdults: new Map() })
    onTestFinished(() => {
      engine.mockRestore()
      sample.mockRestore()
      pools.mockRestore()
      population.mockRestore()
      weighting.mockRestore()
    })
  })

  const flushEngine = async () => {
    const engine = service.app.get(MockSynthesisEngine)
    for (const args of scheduled.splice(0)) {
      await engine.complete(...args)
    }
  }

  it('fills a Win org on every channel and synthesizes its efforts', async () => {
    const { slug } = await createWinOrg(service)

    const res = await seed(slug)

    expect(res.status).toBe(HttpStatus.CREATED)
    const types = res.data.efforts.map(
      (effort: { outreachType: string }) => effort.outreachType,
    )
    expect(types).toEqual([
      OutreachType.nativeDoorKnocking,
      OutreachType.nativePhoneBanking,
      OutreachType.text,
      OutreachType.robocall,
    ])
    const [door, phone, text, robocall] = res.data.efforts
    // 24 people on the turf: knocks on slots 0-8 of each ten, memos on 0-5.
    expect(door).toMatchObject({ interactions: 22, memos: 16 })
    expect(phone).toMatchObject({ interactions: 36, memos: 24 })
    expect(text).toMatchObject({ interactions: 40, memos: 0 })
    expect(robocall).toMatchObject({ interactions: 40, memos: 0 })
    expect(text.synthesisRunId).toBeNull()

    const memos = await service.prisma.constituentFeedback.groupBy({
      by: ['outreachId', 'channel'],
      where: { organizationSlug: slug, confirmedAt: { not: null } },
      _count: true,
    })
    expect(memos).toEqual(
      expect.arrayContaining([
        {
          outreachId: door.outreachId,
          channel: ConstituentFeedbackChannel.door_knock,
          _count: 16,
        },
        {
          outreachId: phone.outreachId,
          channel: ConstituentFeedbackChannel.phone_bank,
          _count: 24,
        },
      ]),
    )
    expect(
      await service.prisma.contactStatusEvent.count({
        where: {
          organizationSlug: slug,
          field: ContactStatusField.voter_likelihood,
        },
      }),
    ).toBeGreaterThan(0)
    expect(
      await service.prisma.contactInteractionText.count({
        where: { outreachId: text.outreachId, respondedAt: { not: null } },
      }),
    ).toBe(8)

    await flushEngine()
    const runs = await service.prisma.feedbackSynthesisRun.findMany({
      where: { organizationSlug: slug },
      include: { _count: { select: { themes: true } } },
    })
    expect(runs.map((run) => run.outreachId).sort()).toEqual(
      [door.outreachId, phone.outreachId].sort(),
    )
    for (const run of runs) {
      expect(run.status).toBe(SynthesisRunStatus.completed)
      expect(run._count.themes).toBeGreaterThan(0)
    }
  })

  it('gives a Serve org follow-ups, panel joins and text replies', async () => {
    const slug = await createServeOrg(service)

    const res = await seed(slug)

    expect(res.status).toBe(HttpStatus.CREATED)
    const [door, , text] = res.data.efforts
    expect(text.memos).toBe(8)
    expect(text.synthesisRunId).not.toBeNull()
    expect(
      await service.prisma.contactInteractionDoorKnock.count({
        where: { outreachId: door.outreachId, supportAnswer: { not: null } },
      }),
    ).toBe(0)
    const fields = await service.prisma.contactStatusEvent.findMany({
      where: { organizationSlug: slug },
      distinct: ['field'],
      select: { field: true },
    })
    expect(fields.map((row) => row.field).sort()).toEqual(
      [ContactStatusField.civic_panel, ContactStatusField.follow_up].sort(),
    )
    expect(
      await service.prisma.pollIndividualMessage.count({
        where: { outreachId: text.outreachId, isOptOut: true },
      }),
    ).toBe(2)

    await flushEngine()
    const runs = await service.prisma.feedbackSynthesisRun.findMany({
      where: { organizationSlug: slug },
    })
    // Door, calls, the check-in text, the priority ask and its pooled run.
    expect(runs).toHaveLength(5)
    expect(
      runs.every((run) => run.status === SynthesisRunStatus.completed),
    ).toBe(true)
  })

  it('gives a Serve org the whole civic panel loop', async () => {
    vi.mocked(
      service.app.get(ContactsService).sampleContacts,
    ).mockResolvedValue(DISTRICT_SAMPLE)
    const slug = await createServeOrg(service)

    const res = await seed(slug, DISTRICT_SAMPLE)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.efforts).toHaveLength(6)
    const [, , , , invite, ask] = res.data.efforts

    // 32 joined at the door or on a call; 21 of the 121 invited texted JOIN.
    const panel = {
      organizationSlug: slug,
      field: ContactStatusField.civic_panel,
      value: CivicPanelStatus.member,
    }
    expect(
      await service.prisma.contactCurrentStatus.count({ where: panel }),
    ).toBe(53)
    expect(
      await service.prisma.contactStatusEvent.count({
        where: {
          organizationSlug: slug,
          field: ContactStatusField.civic_panel,
          source: ContactStatusSource.sms,
          toValue: CivicPanelStatus.member,
        },
      }),
    ).toBe(21)
    const inviteSend = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: invite.outreachId },
    })
    expect(inviteSend).toMatchObject({
      asksToJoinCivicPanel: true,
      status: OutreachStatus.completed,
    })
    expect(inviteSend.message?.endsWith(CIVIC_PANEL_JOIN_LINE)).toBe(true)

    const plan = await service.prisma.civicPanelBuildPlan.findFirstOrThrow({
      where: { organizationSlug: slug },
      include: { steps: true },
    })
    expect(plan).toMatchObject({
      status: CivicPanelBuildPlanStatus.active,
      hoursPerWeek: 2,
    })
    const textStep = plan.steps.find(
      (step) => step.channel === CivicPanelBuildChannel.text,
    )
    expect(textStep).toMatchObject({ wave: 1, outreachId: invite.outreachId })
    expect(textStep?.completedAt).not.toBeNull()

    const askSend = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: ask.outreachId },
    })
    expect(askSend).toMatchObject({
      campaignId: null,
      status: OutreachStatus.completed,
    })
    const priorityId = askSend.priorityId
    if (priorityId === null) throw new Error('ask is not on a priority')
    const needed = answersNeeded(null)
    const repliers = await service.prisma.pollIndividualMessage.findMany({
      where: { outreachId: ask.outreachId, isOptOut: false },
      distinct: ['personId'],
      select: { personId: true },
    })
    expect(repliers).toHaveLength(needed + 4)
    expect(
      await service.prisma.contactCurrentStatus.count({
        where: {
          ...panel,
          personId: { in: repliers.map((row) => row.personId) },
        },
      }),
    ).toBe(53)
    const read = await service.app
      .get(PriorityResultsService)
      .readStatuses(slug, [priorityId])
    expect(read.get(priorityId)).toMatchObject({ good: true, needed })

    await flushEngine()
    const pooled = await service.prisma.feedbackSynthesisRun.findFirstOrThrow({
      where: { priorityId, scope: SynthesisScope.priority },
      include: { _count: { select: { themes: true } } },
    })
    expect(pooled.status).toBe(SynthesisRunStatus.completed)
    expect(pooled._count.themes).toBeGreaterThan(0)
  })

  it('turns away a caller who is neither staff nor a machine', async () => {
    const slug = await createServeOrg(service)
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [] },
    })

    const res = await seed(slug)

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
    expect(await service.prisma.outreach.count()).toBe(0)
  })

  it('404s outside a non-prod deploy', async () => {
    envNonProd.value = false
    const slug = await createServeOrg(service)

    const res = await seed(slug)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(await service.prisma.outreach.count()).toBe(0)
  })

  it('404s an org that does not exist', async () => {
    const res = await seed('eo-missing')

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('refuses an org with no district to draw people from', async () => {
    vi.mocked(service.app.get(ContactsService).sampleContacts).mockRestore()
    const slug = `eo-${randomUUID()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: slug },
    })

    const res = await seed(slug)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(await service.prisma.outreach.count()).toBe(0)
  })
})
