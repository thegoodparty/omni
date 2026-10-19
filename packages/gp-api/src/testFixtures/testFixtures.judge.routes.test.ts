import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_AGENT_IDS, chatOrgSlug } from './judgeChatFixture/seed'
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
const BRIEFING_CASE = { agentId: 'briefing_annotation', slugKey: 'case-1' }

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

describe('POST /v1/test-fixtures/judge-chat-cases', () => {
  beforeEach(() => {
    envNonProd.value = true
  })

  it('stages a case the judge can drive, under a judge- slug', async () => {
    const res = await setUp(BRIEFING_CASE)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.organizationSlug).toBe(
      chatOrgSlug(BRIEFING_CASE.agentId, BRIEFING_CASE.slugKey),
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
    envNonProd.value = false

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
    const res = await setUp({ agentId: 'opposition_research', slugKey: 'c' })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  // Each scope answers a different shape — an anchor for two of them, an
  // office alone for another — and the response schema validates at runtime,
  // so a scope left untested here is one that 500s on its first real case.
  it.each(CHAT_AGENT_IDS)('stages a %s case', async (agentId) => {
    const res = await setUp({ agentId, slugKey: 'shape' })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.organizationSlug).toBe(chatOrgSlug(agentId, 'shape'))
  })
})

describe('DELETE /v1/test-fixtures/judge-chat-cases/:organizationSlug', () => {
  beforeEach(() => {
    envNonProd.value = true
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
    envNonProd.value = false

    const res = await tearDown(data.organizationSlug)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    await expect(
      service.prisma.organization.findUnique({
        where: { slug: data.organizationSlug },
      }),
    ).resolves.not.toBeNull()
  })
})
