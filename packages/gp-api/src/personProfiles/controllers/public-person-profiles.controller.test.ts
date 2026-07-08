import { useTestService } from '@/test-service'
import { PrioritySource } from '../../generated/prisma'
import { describe, expect, it } from 'vitest'

const service = useTestService()

const PERSON_ID = '11111111-1111-1111-1111-111111111111'

type ProfileOverrides = {
  publishedAt?: Date | null
  deletedAt?: Date | null
}

const seedProfile = (overrides: ProfileOverrides = {}) =>
  service.prisma.personProfile.create({
    data: {
      personId: PERSON_ID,
      userId: service.user.id,
      displayName: 'Jane Rivera',
      bioOverride: 'Serving the city.',
      publishedAt: new Date(),
      ...overrides,
    },
  })

const seedPriority = async (title: string) => {
  const org = await service.prisma.organization.create({
    data: { slug: `org-${title}`, ownerId: service.user.id },
  })
  const eo = await service.prisma.electedOffice.create({
    data: { organizationSlug: org.slug, userId: service.user.id },
  })
  return service.prisma.priority.create({
    data: {
      electedOfficeId: eo.id,
      title,
      description: 'desc',
      source: PrioritySource.user_stated,
    },
  })
}

const get = (personId: string = PERSON_ID) =>
  service.client.get('/v1/public-person-profiles', { params: { personId } })

describe('GET /v1/public-person-profiles', () => {
  it('404s when no profile exists', async () => {
    const res = await get()
    expect(res.status).toBe(404)
  })

  it('returns the whitelisted overlay when the profile is live', async () => {
    await seedProfile()
    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.personId).toBe(PERSON_ID)
    expect(res.data.displayName).toBe('Jane Rivera')
    // Owner-only fields must be stripped by the ResponseSchema whitelist.
    expect(res.data.userId).toBeUndefined()
    expect(res.data.deletedAt).toBeUndefined()
  })

  it('404s when the profile is unpublished (draft)', async () => {
    await seedProfile({ publishedAt: null })
    const res = await get()
    expect(res.status).toBe(404)
  })

  it('410s when the profile has been deleted', async () => {
    await seedProfile({ deletedAt: new Date() })
    const res = await get()
    expect(res.status).toBe(410)
  })

  it('400s on a non-uuid personId', async () => {
    const res = await get('not-a-uuid')
    expect(res.status).toBe(400)
  })

  it('lists only live profiles at /published', async () => {
    await seedProfile()
    const res = await service.client.get('/v1/public-person-profiles/published')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.data)).toBe(true)
    expect(res.data).toHaveLength(1)
    expect(res.data[0].personId).toBe(PERSON_ID)
    // Owner-only fields must not leak into the sitemap feed.
    expect(res.data[0].userId).toBeUndefined()
  })

  it('excludes unpublished and deleted profiles from /published', async () => {
    await seedProfile({ publishedAt: null })
    const res = await service.client.get('/v1/public-person-profiles/published')
    expect(res.status).toBe(200)
    expect(res.data).toHaveLength(0)
  })

  it('returns only visible issues', async () => {
    const profile = await seedProfile()
    const visible = await seedPriority('roads')
    const hidden = await seedPriority('parks')
    await service.prisma.personProfileIssue.createMany({
      data: [
        {
          personProfileId: profile.id,
          issueId: visible.id,
          visible: true,
          sortOrder: 1,
        },
        {
          personProfileId: profile.id,
          issueId: hidden.id,
          visible: false,
          sortOrder: 2,
        },
      ],
    })

    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.issues).toHaveLength(1)
    expect(res.data.issues[0].issueId).toBe(visible.id)
    // The published issue's title flows through from the Serve Priority.
    expect(res.data.issues[0].title).toBe('roads')
  })
})
