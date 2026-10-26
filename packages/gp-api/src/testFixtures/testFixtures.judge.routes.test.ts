import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHAT_AGENT_IDS,
  JUDGE_POSITION,
  chatOrgSlug,
} from './judgeChatFixture/seed'
import { ElectionsService } from '@/elections/services/elections.service'
import { useTestService } from '@/test-service'
import {
  appEnvOverrides,
  useAppEnvOverrides,
} from '@/shared/test-utils/appEnvOverrides'

useAppEnvOverrides({ IS_NON_PROD_DEPLOY: true })

const service = useTestService()

const ROUTE = '/v1/test-fixtures/judge-chat-cases'
const anonymous = { headers: { Authorization: 'Bearer invalid' } }
const keepStatus = { validateStatus: () => true }

const setUp = (body: object, config: object = {}) =>
  service.client.post(ROUTE, body, { ...keepStatus, ...config })

const tearDown = (slug: string, config: object = {}) =>
  service.client.delete(`${ROUTE}/${slug}`, { ...keepStatus, ...config })

// The briefing scope is what exercises every table the fixture touches: the
// organization, the elected office, the meeting briefing and the experiment
// run it hangs off, and the annotation and note that no foreign key cascades.
const SWEEP_ID = 'judge-19284756312-1'
const BRIEFING_CASE = {
  agentId: 'briefing_annotation',
  sweepId: SWEEP_ID,
  slugKey: 'case-1',
}

const countFixtureRows = async (organizationSlug: string) => {
  const office = await service.prisma.electedOffice.findUnique({
    where: { organizationSlug },
    select: { id: true },
  })
  return {
    organizations: await service.prisma.organization.count({
      where: { slug: organizationSlug },
    }),
    electedOffices: office === null ? 0 : 1,
    experimentRuns: await service.prisma.experimentRun.count({
      where: { organizationSlug },
    }),
    briefings:
      office === null
        ? 0
        : await service.prisma.meetingBriefing.count({
            where: { electedOfficeId: office.id },
          }),
    annotations: await service.prisma.annotation.count({
      where: { authorUserId: service.user.id },
    }),
    notes: await service.prisma.annotationNote.count(),
  }
}

// useTestService answers getPositionById with null, and the fixture refuses
// a district that does not resolve. Stubbed with the row election-api really
// holds for the seeded id, the way a deployed target answers it.
const stubJudgePosition = () =>
  vi
    .spyOn(service.app.get(ElectionsService), 'getPositionById')
    .mockResolvedValue(JUDGE_POSITION)

describe('POST /v1/test-fixtures/judge-chat-cases', () => {
  beforeEach(() => {
    appEnvOverrides.IS_NON_PROD_DEPLOY = true
    stubJudgePosition()
  })

  it('stages a case the judge can drive, under a judge- slug', async () => {
    const res = await setUp(BRIEFING_CASE)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.organizationSlug).toBe(
      chatOrgSlug(SWEEP_ID, BRIEFING_CASE.agentId, BRIEFING_CASE.slugKey),
    )
    expect(res.data.organizationSlug.startsWith('judge-')).toBe(true)
    expect(res.data.briefing).toEqual({
      meetingDate: expect.any(String),
      anchor: { jsonPath: null, start: null, end: null },
    })
    const organization = await service.prisma.organization.findUniqueOrThrow({
      where: { slug: res.data.organizationSlug },
    })
    expect(organization.ownerId).toBe(service.user.id)
  })

  it('returns the district the deployment resolved for the position', async () => {
    const res = await setUp({ ...BRIEFING_CASE, agentId: 'priority_flow' })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.district).toEqual({
      state: 'WY',
      l2DistrictType: 'City_Ward',
      l2DistrictName: 'CHEYENNE CITY WARD 1',
      level: 'CITY',
      positionName: 'Cheyenne City Council - Ward 1',
    })
  })

  // A position that does not resolve drops the constituent tools without an
  // error, so the case would run with no district while recording one.
  it('503s and leaves nothing behind when the district does not resolve', async () => {
    vi.spyOn(
      service.app.get(ElectionsService),
      'getPositionById',
    ).mockResolvedValue(null)

    const res = await setUp({ ...BRIEFING_CASE, agentId: 'priority_flow' })

    expect(res.status).toBe(HttpStatus.SERVICE_UNAVAILABLE)
    await expect(
      service.prisma.organization.count({ where: {} }),
    ).resolves.toBe(0)
  })

  it('does not ask for a district when the case asked for none', async () => {
    vi.spyOn(
      service.app.get(ElectionsService),
      'getPositionById',
    ).mockResolvedValue(null)

    const res = await setUp({
      ...BRIEFING_CASE,
      agentId: 'priority_flow',
      accountState: { district: false },
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.district).toBeUndefined()
  })

  // A sweep retries, and the seeder creates rather than upserts — so without
  // the teardown-first the second call would die on organization.slug.
  it('is idempotent: a repeat setup neither errors nor doubles a row', async () => {
    const first = await setUp(BRIEFING_CASE)
    const before = await countFixtureRows(first.data.organizationSlug)

    const second = await setUp(BRIEFING_CASE)

    expect(second.status).toBe(HttpStatus.CREATED)
    expect(second.data.organizationSlug).toBe(first.data.organizationSlug)
    await expect(
      countFixtureRows(second.data.organizationSlug),
    ).resolves.toEqual(before)
  })

  it('401s a caller with no usable session', async () => {
    const res = await setUp(BRIEFING_CASE, anonymous)

    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
    await expect(
      service.prisma.organization.count({ where: {} }),
    ).resolves.toBe(0)
  })

  it('404s outside a known non-prod deploy', async () => {
    appEnvOverrides.IS_NON_PROD_DEPLOY = false

    const res = await setUp(BRIEFING_CASE)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    await expect(
      service.prisma.organization.count({ where: {} }),
    ).resolves.toBe(0)
  })

  it('400s an account state the scope has no row to carry', async () => {
    const res = await setUp({ ...BRIEFING_CASE, accountState: { pro: false } })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('400s an agent the judge cannot drive as a chat case', async () => {
    const res = await setUp({
      agentId: 'opposition_research',
      sweepId: SWEEP_ID,
      slugKey: 'c',
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  // Each scope answers a different shape — an anchor for two of them, an
  // office alone for another — and the response schema validates at runtime,
  // so a scope left untested here is one that 500s on its first real case.
  it.each(CHAT_AGENT_IDS)('stages a %s case', async (agentId) => {
    const res = await setUp({ agentId, sweepId: SWEEP_ID, slugKey: 'shape' })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.organizationSlug).toBe(
      chatOrgSlug(SWEEP_ID, agentId, 'shape'),
    )
  })

  // THE REASON THE SWEEP ID IS IN THE CONTRACT. Two sweeps staging the same
  // agent and case id on one database used to stage one organization, and
  // the second setup's teardown-first step removed the first's fixture
  // mid-run. They must now be two organizations that coexist.
  it('stages a separate organization for a second sweep', async () => {
    const first = await setUp(BRIEFING_CASE)
    const second = await setUp({
      ...BRIEFING_CASE,
      sweepId: 'judge-19284756312-2',
    })

    expect(second.status).toBe(HttpStatus.CREATED)
    expect(second.data.organizationSlug).not.toBe(first.data.organizationSlug)
    await expect(
      service.prisma.organization.findUnique({
        where: { slug: first.data.organizationSlug },
      }),
    ).resolves.not.toBeNull()
    // And the second sweep's briefing retirement left the first's standing,
    // even though both sit on the same fixed meeting date.
    const office = await service.prisma.electedOffice.findUniqueOrThrow({
      where: { organizationSlug: first.data.organizationSlug },
      select: { id: true },
    })
    await expect(
      service.prisma.meetingBriefing.count({
        where: { electedOfficeId: office.id },
      }),
    ).resolves.toBe(1)
  })

  it('400s a sweep id outside the slug alphabet', async () => {
    const res = await setUp({ ...BRIEFING_CASE, sweepId: 'swp/../etc' })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    await expect(
      service.prisma.organization.count({ where: {} }),
    ).resolves.toBe(0)
  })

  it('400s a request that carries no sweep id', async () => {
    const res = await setUp({
      agentId: BRIEFING_CASE.agentId,
      slugKey: BRIEFING_CASE.slugKey,
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })
})

describe('DELETE /v1/test-fixtures/judge-chat-cases/:organizationSlug', () => {
  beforeEach(() => {
    appEnvOverrides.IS_NON_PROD_DEPLOY = true
    stubJudgePosition()
  })

  it('removes exactly what setup created', async () => {
    const { data } = await setUp(BRIEFING_CASE)

    const res = await tearDown(data.organizationSlug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({
      organizationSlug: data.organizationSlug,
      removed: true,
    })
    await expect(countFixtureRows(data.organizationSlug)).resolves.toEqual({
      organizations: 0,
      electedOffices: 0,
      experimentRuns: 0,
      briefings: 0,
      annotations: 0,
      notes: 0,
    })
  })

  it('leaves a second case alone while removing the first', async () => {
    const first = await setUp(BRIEFING_CASE)
    const second = await setUp({ ...BRIEFING_CASE, slugKey: 'case-2' })

    await tearDown(first.data.organizationSlug)

    await expect(
      service.prisma.organization.count({ where: {} }),
    ).resolves.toBe(1)
    await expect(
      service.prisma.organization.findUnique({
        where: { slug: second.data.organizationSlug },
      }),
    ).resolves.not.toBeNull()
  })

  it('is safe to call twice', async () => {
    const { data } = await setUp(BRIEFING_CASE)
    await tearDown(data.organizationSlug)

    const again = await tearDown(data.organizationSlug)

    expect(again.status).toBe(HttpStatus.OK)
    expect(again.data.removed).toBe(false)
  })

  // The handle is the prefix, and it is refused at the boundary rather than
  // quietly matching nothing, so a caller aiming at a real organization is
  // told it was never a judge fixture.
  it('refuses a slug that is not a judge fixture, and leaves it standing', async () => {
    await service.prisma.organization.create({
      data: { slug: 'real-city-council', ownerId: service.user.id },
    })

    const res = await tearDown('real-city-council')

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    await expect(
      service.prisma.organization.findUnique({
        where: { slug: 'real-city-council' },
      }),
    ).resolves.not.toBeNull()
  })

  // A judge slug is not a capability. Owning it is.
  it("will not remove another user's judge fixture", async () => {
    const other = await service.prisma.user.create({
      data: {
        email: 'other-judge@test.goodparty.org',
        name: 'Other',
        firstName: 'Other',
        lastName: 'Judge',
      },
    })
    await service.prisma.organization.create({
      data: { slug: 'judge-somebody-else', ownerId: other.id },
    })

    const res = await tearDown('judge-somebody-else')

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.removed).toBe(false)
    await expect(
      service.prisma.organization.findUnique({
        where: { slug: 'judge-somebody-else' },
      }),
    ).resolves.not.toBeNull()
  })

  it('401s a caller with no usable session', async () => {
    const { data } = await setUp(BRIEFING_CASE)

    const res = await tearDown(data.organizationSlug, anonymous)

    expect(res.status).toBe(HttpStatus.UNAUTHORIZED)
    await expect(
      service.prisma.organization.findUnique({
        where: { slug: data.organizationSlug },
      }),
    ).resolves.not.toBeNull()
  })

  it('404s outside a known non-prod deploy', async () => {
    const { data } = await setUp(BRIEFING_CASE)
    appEnvOverrides.IS_NON_PROD_DEPLOY = false

    const res = await tearDown(data.organizationSlug)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    await expect(
      service.prisma.organization.findUnique({
        where: { slug: data.organizationSlug },
      }),
    ).resolves.not.toBeNull()
  })
})
