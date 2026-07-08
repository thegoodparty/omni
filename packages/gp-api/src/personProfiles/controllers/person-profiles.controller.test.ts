import { useTestService } from '@/test-service'
import { PrioritySource } from '../../generated/prisma'
import { beforeEach, describe, expect, it } from 'vitest'

const service = useTestService()

const PERSON_ID = '22222222-2222-2222-2222-222222222222'
const BASE = '/v1/person-profiles'
const MINE = '/v1/person-profiles/mine'

const setPersonId = (personId: string | null) =>
  service.prisma.user.update({
    where: { id: service.user.id },
    data: { personId },
  })

// Mints a canonical person for the test user and creates their (unpublished)
// profile, mirroring the real flow (data team mints personId, user creates).
const createOwnProfile = async () => {
  await setPersonId(PERSON_ID)
  const res = await service.client.post(BASE, {
    displayName: 'Jane Rivera',
  })
  expect(res.status).toBe(201)
  return res.data
}

describe('GET /v1/person-profiles/mine', () => {
  it('reports no profile and canCreate=false before a person is minted', async () => {
    const res = await service.client.get(MINE)
    expect(res.status).toBe(200)
    expect(res.data.profile).toBeNull()
    expect(res.data.canCreate).toBe(false)
  })

  it('reports canCreate=true once the user has a personId', async () => {
    await setPersonId(PERSON_ID)
    const res = await service.client.get(MINE)
    expect(res.status).toBe(200)
    expect(res.data.canCreate).toBe(true)
  })
})

describe('POST /v1/person-profiles', () => {
  it('409s when the user has no canonical person id yet', async () => {
    const res = await service.client.post(BASE, {
      displayName: 'Jane',
    })
    expect(res.status).toBe(409)
  })

  it('creates an unpublished profile once a personId exists', async () => {
    await setPersonId(PERSON_ID)
    const res = await service.client.post(BASE, {
      displayName: 'Jane',
    })
    expect(res.status).toBe(201)
    expect(res.data.personId).toBe(PERSON_ID)
    expect(res.data.publishedAt).toBeNull()
  })

  it('409s on a second create for the same user', async () => {
    await setPersonId(PERSON_ID)
    await service.client.post(BASE, {})
    const res = await service.client.post(BASE, {})
    expect(res.status).toBe(409)
  })
})

describe('owner profile lifecycle', () => {
  beforeEach(async () => {
    await createOwnProfile()
  })

  it('updates editable fields', async () => {
    const res = await service.client.put(MINE, {
      whyRunning: 'For the parks',
    })
    expect(res.status).toBe(200)
    expect(res.data.whyRunning).toBe('For the parks')
  })

  it('publishes and unpublishes', async () => {
    const published = await service.client.post(
      '/v1/person-profiles/mine/publish',
    )
    expect(published.status).toBe(200)
    expect(published.data.publishedAt).not.toBeNull()

    const unpublished = await service.client.post(
      '/v1/person-profiles/mine/unpublish',
    )
    expect(unpublished.status).toBe(200)
    expect(unpublished.data.publishedAt).toBeNull()
  })

  it('soft-deletes by stamping deletedAt', async () => {
    const res = await service.client.delete(MINE)
    expect(res.status).toBe(200)
    expect(res.data.deletedAt).not.toBeNull()
  })

  it('replaces per-issue publication settings', async () => {
    const org = await service.prisma.organization.create({
      data: { slug: 'org-eo', ownerId: service.user.id },
    })
    const eo = await service.prisma.electedOffice.create({
      data: { organizationSlug: org.slug, userId: service.user.id },
    })
    const priority = await service.prisma.priority.create({
      data: {
        electedOfficeId: eo.id,
        title: 'Roads',
        description: 'desc',
        source: PrioritySource.user_stated,
      },
    })

    const res = await service.client.put('/v1/person-profiles/mine/issues', {
      issues: [{ issueId: priority.id, visible: true, sortOrder: 1 }],
    })

    expect(res.status).toBe(200)
    expect(res.data.issues).toHaveLength(1)
    expect(res.data.issues[0].issueId).toBe(priority.id)
  })
})

describe('unauthenticated access', () => {
  it('401s without a session token', async () => {
    const res = await service.client.get(MINE, {
      headers: { Authorization: 'Bearer invalid.token.value' },
    })
    expect([401, 403]).toContain(res.status)
  })
})
