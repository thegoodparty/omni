import { useTestService } from '@/test-service'
import {
  PersonProfileIssueStatus,
  PrioritySource,
  ProfileClaimRequestSource,
} from '../../generated/prisma'
import { subMinutes } from 'date-fns'
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

  it('marks an unpublished (draft) profile rather than 404ing', async () => {
    await seedProfile({ publishedAt: null })
    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.unpublished).toBe(true)
    expect(res.data.personId).toBe(PERSON_ID)
  })

  it('leaks no authored content on the unpublished marker', async () => {
    // The owner wrote this and chose not to publish it. The marker exists so
    // the page can stop inviting them to claim what they already own — it must
    // not become a back door to the draft itself.
    await seedProfile({ publishedAt: null })
    const res = await get()

    expect(res.status).toBe(200)
    expect(res.data.displayName).toBeNull()
    expect(res.data.bioOverride).toBeNull()
    expect(res.data.publishedAt).toBeNull()
    expect(res.data.issues).toEqual([])
  })

  it('404s when no profile row exists at all', async () => {
    // The distinction the marker exists for: nobody has claimed this person,
    // so the page legitimately shows claim CTAs.
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
        officePhone: '555-0199',
        governmentWebsiteUrl: 'https://springfield.gov/council/rivera',
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
    // Public-by-design contact overrides are surfaced — including the office
    // contact fields, which the owner can set but the interceptor would strip
    // unless they're on the public whitelist.
    expect(res.data.publicEmail).toBe('press@janerivera.gov')
    expect(res.data.publicPhone).toBe('555-0100')
    expect(res.data.officePhone).toBe('555-0199')
    expect(res.data.governmentWebsiteUrl).toBe(
      'https://springfield.gov/council/rivera',
    )
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
    // Deleting is a stronger request than unpublishing: the owner asked for
    // the page to be gone, not merely hidden for now.
    await seedProfile({ publishedAt: null, deletedAt: new Date() })
    const res = await get()
    expect(res.status).toBe(410)
  })

  it('serves the live overlay again once a draft is published', async () => {
    await seedProfile({ publishedAt: null })
    expect((await get()).data.unpublished).toBe(true)

    await service.prisma.personProfile.update({
      where: { personId: PERSON_ID },
      data: { publishedAt: new Date() },
    })

    const res = await get()
    expect(res.status).toBe(200)
    expect(res.data.unpublished).toBeUndefined()
    expect(res.data.displayName).toBe('Jane Rivera')
  })

  it('marks a live profile the owner unpublished', async () => {
    // The bug this fixes: someone who claimed and then deliberately hid their
    // profile was indistinguishable from a stranger who never claimed one.
    await seedProfile()
    await service.prisma.personProfile.update({
      where: { personId: PERSON_ID },
      data: { publishedAt: null },
    })

    const res = await get()
    expect(res.status).toBe(200)
    expect(res.data.unpublished).toBe(true)
    expect(res.data.displayName).toBeNull()
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
        // listPublished orders on updatedAt alone, and @updatedAt is stamped
        // client-side at millisecond precision, so two adjacent creates can
        // land on the same value and leave the order arbitrary.
        updatedAt: subMinutes(new Date(), 1),
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
      marketingConsent: true,
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
    // The opt-in checkbox value is recorded verbatim.
    expect(stored?.marketingConsent).toBe(true)
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
    // Absent consent defaults to opted out (no marketing).
    expect(stored?.marketingConsent).toBe(false)
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

  // The two public forms POST this one endpoint but mean opposite things, and
  // only `notify` feeds the candidate's HubSpot counter.
  it.each([ProfileClaimRequestSource.notify, ProfileClaimRequestSource.owner])(
    'records which form sent it (%s)',
    async (source) => {
      const res = await claim({
        personId: PERSON_ID,
        requesterEmail: EMAIL,
        source,
      })
      expect(res.status).toBe(201)

      const stored = await service.prisma.profileClaimRequest.findFirst({
        where: { personId: PERSON_ID },
      })
      expect(stored?.source).toBe(source)
    },
  )

  it('leaves source null when the caller omits it', async () => {
    // An older marketing deploy sends no discriminator. The row is stored but
    // stays out of the notify count rather than being guessed into it.
    const res = await claim({ personId: PERSON_ID, requesterEmail: EMAIL })
    expect(res.status).toBe(201)

    const stored = await service.prisma.profileClaimRequest.findFirst({
      where: { personId: PERSON_ID },
    })
    expect(stored?.source).toBeNull()
  })

  it('400s on an unrecognised source', async () => {
    const res = await claim({
      personId: PERSON_ID,
      requesterEmail: EMAIL,
      source: 'somewhere-else',
    })
    expect(res.status).toBe(400)
  })

  // The CRM sync runs detached after the row is committed, and HubSpot is
  // unconfigured in tests, so this asserts the visitor's submission is
  // unaffected by whatever the CRM side does or fails to do.
  it('still persists and returns 201 for a notify submission', async () => {
    const res = await claim({
      personId: PERSON_ID,
      requesterEmail: EMAIL,
      source: ProfileClaimRequestSource.notify,
    })

    expect(res.status).toBe(201)
    const stored = await service.prisma.profileClaimRequest.findFirst({
      where: { personId: PERSON_ID },
    })
    expect(stored?.requesterEmail).toBe(EMAIL)
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

  it('removal wins over an unpublished draft', async () => {
    // Both are 200 markers now, so precedence has to be explicit: a takedown
    // noindexes the page, an unpublished draft does not.
    await seedProfile({ publishedAt: null })
    await service.prisma.personProfileRemoval.create({
      data: { personId: PERSON_ID },
    })

    const res = await get()
    expect(res.status).toBe(200)
    expect(res.data.removed).toBe(true)
    expect(res.data.unpublished).toBeUndefined()
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
