import { useTestService } from '@/test-service'
import {
  PersonProfileIssueStatus,
  PrioritySource,
} from '../../generated/prisma'
import { describe, expect, it } from 'vitest'

const service = useTestService()

const PERSON_ID = '11111111-1111-1111-1111-111111111111'
const SECOND_PERSON_ID = '22222222-2222-2222-2222-222222222222'

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
          status: PersonProfileIssueStatus.IN_PROGRESS,
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
    // The owner-set progress pill is exposed on the public payload.
    expect(res.data.issues[0].status).toBe(PersonProfileIssueStatus.IN_PROGRESS)
  })

  it('exposes a null status when the owner set none', async () => {
    const profile = await seedProfile()
    const priority = await seedPriority('budget')
    await service.prisma.personProfileIssue.create({
      data: {
        personProfileId: profile.id,
        issueId: priority.id,
        visible: true,
        sortOrder: 1,
      },
    })

    const res = await get()
    expect(res.status).toBe(200)
    expect(res.data.issues[0].status).toBeNull()
  })
})

describe('public profile render-gate scenarios (local DB)', () => {
  // DB SAFETY: the harness points Prisma at a throwaway testcontainer. Fail
  // loudly if anything ever repoints it at a non-local host.
  it('runs against a localhost database only', () => {
    const host = new URL(process.env.DATABASE_URL!).hostname
    expect(['localhost', '127.0.0.1']).toContain(host)
  })

  it('exposes the public contact surface but never owner-only fields', async () => {
    await service.prisma.personProfile.create({
      data: {
        personId: PERSON_ID,
        userId: service.user.id,
        displayName: 'Jane Rivera',
        publicEmail: 'press@janerivera.gov',
        publicPhone: '555-0100',
        accomplishments: [{ title: 'Passed the budget', date: '2024' }],
        recentExperience: [
          {
            title: 'City Council Member, Ward 3',
            organization: 'City of Springfield',
            term: '2021-2025',
            source: 'user',
          },
        ],
        publishedAt: new Date(),
      },
    })

    const res = await get()
    expect(res.status).toBe(200)
    // Public-by-design contact overrides are surfaced.
    expect(res.data.publicEmail).toBe('press@janerivera.gov')
    expect(res.data.publicPhone).toBe('555-0100')
    // Accomplishments JSON round-trips as a typed array.
    expect(res.data.accomplishments).toEqual([
      { title: 'Passed the budget', date: '2024' },
    ])
    // Owner-authored Recent Experience is part of the public whitelist so the
    // marketing profile can render it.
    expect(res.data.recentExperience).toEqual([
      {
        title: 'City Council Member, Ward 3',
        organization: 'City of Springfield',
        term: '2021-2025',
        source: 'user',
      },
    ])
    // Owner-only / gate internals must never leak.
    expect(res.data.userId).toBeUndefined()
    expect(res.data.deletedAt).toBeUndefined()
    expect(res.data.id).toBeUndefined()
  })

  it('treats a deleted draft as gone (410 takes precedence over unpublished)', async () => {
    await seedProfile({ publishedAt: null, deletedAt: new Date() })
    const res = await get()
    expect(res.status).toBe(410)
  })

  it('returns visible issues ordered by sortOrder ascending', async () => {
    const profile = await seedProfile()
    const first = await seedPriority('roads')
    const second = await seedPriority('parks')
    const third = await seedPriority('budget')
    await service.prisma.personProfileIssue.createMany({
      data: [
        {
          personProfileId: profile.id,
          issueId: second.id,
          visible: true,
          sortOrder: 2,
        },
        {
          personProfileId: profile.id,
          issueId: third.id,
          visible: true,
          sortOrder: 3,
        },
        {
          personProfileId: profile.id,
          issueId: first.id,
          visible: true,
          sortOrder: 1,
        },
      ],
    })

    const res = await get()
    expect(res.status).toBe(200)
    expect(res.data.issues.map((i: { title: string }) => i.title)).toEqual([
      'roads',
      'parks',
      'budget',
    ])
  })

  it('lists multiple live profiles newest-first at /published', async () => {
    // Oldest first so we can assert the endpoint re-orders by updatedAt desc.
    const older = await service.prisma.user.create({
      data: { clerkId: 'user_older', email: 'older@goodparty.org' },
    })
    await service.prisma.personProfile.create({
      data: {
        personId: SECOND_PERSON_ID,
        userId: older.id,
        publishedAt: new Date(),
      },
    })
    await seedProfile() // service.user, created after `older`

    const res = await service.client.get('/v1/public-person-profiles/published')
    expect(res.status).toBe(200)
    expect(res.data).toHaveLength(2)
    expect(res.data[0].personId).toBe(PERSON_ID)
    expect(res.data[1].personId).toBe(SECOND_PERSON_ID)
    // Freshness feed carries identity + updatedAt only.
    expect(Object.keys(res.data[0]).sort()).toEqual(['personId', 'updatedAt'])
  })
})

describe('POST /v1/public-person-profiles/claim-request', () => {
  const EMAIL = 'voter@example.com'
  const claim = (body: Record<string, unknown>) =>
    service.client.post('/v1/public-person-profiles/claim-request', body)

  it('persists a claim request with name + email', async () => {
    const res = await claim({
      personId: PERSON_ID,
      requesterEmail: EMAIL,
      requesterName: 'Curious Voter',
    })

    expect(res.status).toBe(201)
    expect(res.data.personId).toBe(PERSON_ID)
    expect(res.data.id).toBeTruthy()
    // Lead PII (email/name) is stored but never echoed back on the public path.
    expect(res.data.requesterEmail).toBeUndefined()
    expect(res.data.requesterName).toBeUndefined()

    const stored = await service.prisma.profileClaimRequest.findFirst({
      where: { personId: PERSON_ID },
    })
    expect(stored?.requesterEmail).toBe(EMAIL)
    expect(stored?.requesterName).toBe('Curious Voter')
  })

  it('persists a claim request with just an email (name optional)', async () => {
    const res = await claim({
      personId: PERSON_ID,
      requesterEmail: EMAIL,
    })
    expect(res.status).toBe(201)

    const stored = await service.prisma.profileClaimRequest.findFirst({
      where: { personId: PERSON_ID },
    })
    expect(stored?.requesterName).toBeNull()
  })

  it('400s on a missing email', async () => {
    const res = await claim({ personId: PERSON_ID })
    expect(res.status).toBe(400)
  })

  it('400s on a non-email requesterEmail', async () => {
    const res = await claim({
      personId: PERSON_ID,
      requesterEmail: 'not-an-email',
    })
    expect(res.status).toBe(400)
  })

  it('400s on a non-uuid personId', async () => {
    const res = await claim({
      personId: 'nope',
      requesterEmail: EMAIL,
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /v1/public-person-profiles removal gate', () => {
  it('returns 200 { removed: true } and no content when a removal exists', async () => {
    await service.prisma.personProfileRemoval.create({
      data: { personId: PERSON_ID },
    })

    const res = await get()
    expect(res.status).toBe(200)
    expect(res.data.removed).toBe(true)
    expect(res.data.personId).toBe(PERSON_ID)
    // No authored/overlay content on the removed payload.
    expect(res.data.displayName).toBeNull()
    expect(res.data.bioOverride).toBeNull()
    expect(res.data.issues).toEqual([])
  })

  it('removal wins over a live, published profile (privacy takedown)', async () => {
    await seedProfile()
    await service.prisma.personProfileRemoval.create({
      data: { personId: PERSON_ID, note: 'CA privacy request' },
    })

    const res = await get()
    expect(res.status).toBe(200)
    expect(res.data.removed).toBe(true)
    // The published overlay content must not leak through the removal gate.
    expect(res.data.displayName).toBeNull()
  })
})
