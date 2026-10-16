import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { Person } from '@goodparty_org/contracts'
import {
  ConstituentFeedbackChannel,
  ContactStatusField,
  OutreachType,
  SynthesisRunStatus,
  UserRole,
} from '@/generated/prisma'
import { MockSynthesisEngine } from '@/constituentFeedback/services/mockSynthesisEngine'
import {
  createServeOrg,
  createWinOrg,
} from '@/constituentFeedback/tests/issueCaptureFixtures'
import { ContactsService } from '@/contacts/services/contacts.service'
import { LlmService } from '@/llm/services/llm.service'
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

const seed = (slug: string) =>
  service.client.post(
    `/v1/test-fixtures/organizations/${slug}/activity`,
    { people: PEOPLE.length },
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
    const sample = vi
      .spyOn(service.app.get(ContactsService), 'sampleContacts')
      .mockResolvedValue(PEOPLE)
    // A completed run asks the model to match its issues to themes.
    const llm = vi
      .spyOn(service.app.get(LlmService), 'jsonCompletion')
      .mockRejectedValue(new Error('No model in this suite'))
    onTestFinished(() => {
      engine.mockRestore()
      sample.mockRestore()
      llm.mockRestore()
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
    expect(runs).toHaveLength(3)
    expect(
      runs.every((run) => run.status === SynthesisRunStatus.completed),
    ).toBe(true)
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
