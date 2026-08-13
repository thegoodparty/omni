import { beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '../test-service'

const service = useTestService()

// Two persons so id/slug/ids filters have something to discriminate against.
const PERSON_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_PERSON_ID = '22222222-2222-2222-2222-222222222222'
const MISSING_PERSON_ID = '99999999-9999-9999-9999-999999999999'

const PERSON_SLUG = 'jane-doe'
const OTHER_PERSON_SLUG = 'john-roe'

// PII that must NEVER appear on the public read endpoints.
const PERSON_EMAIL = 'jane.doe.personal@example.com'
const PERSON_PHONE = '+1-555-0142'
const CANDIDACY_EMAIL = 'jane.campaign@example.com'

// Internal gp-api user linkage (numeric gp-api User.id as text, NOT a UUID).
// Filterable, but must NEVER appear in any response.
const PERSON_GP_API_USER_ID = '12345'

// Public-by-design office contact — these MUST be present.
const OFFICE_EMAIL = 'mayor.office@city.gov'
const OFFICE_PHONE = '555-0100'

const CANDIDACY_ID = '33333333-3333-3333-3333-333333333333'
const OFFICE_HOLDER_ID = '44444444-4444-4444-4444-444444444444'
const RACE_ID = '55555555-5555-5555-5555-555555555555'
// The candidacy's race date — surfaced (non-PII) so consumers can date a run.
const RACE_ELECTION_DATE = '2024-11-05'

// A second office term with no position, so one payload covers both the
// resolvable and the degraded (null positionId) branch.
const POSITION_ID = '66666666-6666-6666-6666-666666666666'
const UNLINKED_OFFICE_HOLDER_ID = '77777777-7777-7777-7777-777777777777'
// The office's own race. Its slug is what the /people breadcrumb parses into
// `Elections > CA > Los Angeles > Mayor`; the officeholder has no candidacy, so
// this is the only route to it.
const OFFICE_RACE_ID = '88888888-8888-8888-8888-888888888888'
const OFFICE_RACE_SLUG = 'ca/los-angeles/mayor'

/**
 * Fails if any Person/Candidacy PII (the actual secret values, or the `email`/
 * `phone` keys) shows up anywhere in a public payload. Scanning the serialized
 * JSON catches leaks even if they surface under an unexpected nesting.
 */
const expectNoPersonPii = (payload: unknown) => {
  const json = JSON.stringify(payload)
  expect(json).not.toContain(PERSON_EMAIL)
  expect(json).not.toContain(PERSON_PHONE)
  expect(json).not.toContain(CANDIDACY_EMAIL)
  // The internal gp-api user linkage is filter-only and must never be
  // broadcast, under any key.
  expect(json).not.toContain('gpApiUserId')
  expect(json).not.toContain('gp_api_user_id')
  expect(json).not.toContain(PERSON_GP_API_USER_ID)
}

type OfficeHolderPayload = { id: string; [key: string]: unknown }

/** The position-linked Mayor term; office terms come back unordered. */
const findOffice = (person: { OfficeHolders: OfficeHolderPayload[] }) => {
  const office = person.OfficeHolders.find((o) => o.id === OFFICE_HOLDER_ID)
  expect(office).toBeDefined()
  return office!
}

/** The term with no positionId — the degraded branch. */
const findUnlinkedOffice = (person: {
  OfficeHolders: OfficeHolderPayload[]
}) => {
  const office = person.OfficeHolders.find(
    (o) => o.id === UNLINKED_OFFICE_HOLDER_ID,
  )
  expect(office).toBeDefined()
  return office!
}

const seedPerson = async () => {
  await service.prisma.person.create({
    data: {
      id: PERSON_ID,
      slug: PERSON_SLUG,
      firstName: 'Jane',
      lastName: 'Doe',
      fullName: 'Jane Doe',
      state: 'CA',
      // PII columns that the service must omit from every response.
      email: PERSON_EMAIL,
      phone: PERSON_PHONE,
      // Internal linkage — filterable, never returned.
      gpApiUserId: PERSON_GP_API_USER_ID,
    },
  })

  await service.prisma.person.create({
    data: {
      id: OTHER_PERSON_ID,
      slug: OTHER_PERSON_SLUG,
      firstName: 'John',
      lastName: 'Roe',
      fullName: 'John Roe',
      state: 'NY',
      email: 'john.roe.personal@example.com',
      phone: '+1-555-0199',
    },
  })

  await service.prisma.race.create({
    data: {
      id: RACE_ID,
      electionDate: new Date(RACE_ELECTION_DATE),
      slug: 'ca/mayor',
      state: 'CA',
      positionLevel: 'CITY',
    },
  })

  await service.prisma.candidacy.create({
    data: {
      id: CANDIDACY_ID,
      brDatabaseId: 9001,
      slug: 'jane-doe-mayor',
      firstName: 'Jane',
      lastName: 'Doe',
      state: 'CA',
      // Candidacy PII that must be omitted when nested under a Person.
      email: CANDIDACY_EMAIL,
      personId: PERSON_ID,
      // Linked race so the nested candidacy can surface its election date.
      raceId: RACE_ID,
    },
  })

  await service.prisma.position.create({
    data: {
      id: POSITION_ID,
      brDatabaseId: '7001',
      brPositionId: 'br-position-7001',
      state: 'CA',
      name: 'Mayor',
      level: 'CITY',
    },
  })

  // Two races for the office; the most recent one supplies the slug.
  await service.prisma.race.createMany({
    data: [
      {
        id: OFFICE_RACE_ID,
        electionDate: new Date('2022-11-08'),
        slug: 'ca/los-angeles/mayor-stale',
        state: 'CA',
        positionLevel: 'CITY',
        positionId: POSITION_ID,
      },
      {
        id: '88888888-8888-8888-8888-888888888889',
        electionDate: new Date('2026-11-03'),
        slug: OFFICE_RACE_SLUG,
        state: 'CA',
        positionLevel: 'CITY',
        positionId: POSITION_ID,
      },
    ],
  })

  await service.prisma.officeHolder.create({
    data: {
      id: OFFICE_HOLDER_ID,
      personId: PERSON_ID,
      officeTitle: 'Mayor',
      state: 'CA',
      isCurrent: true,
      // Public office contact — intentionally exposed.
      officeEmail: OFFICE_EMAIL,
      officePhone: OFFICE_PHONE,
      positionId: POSITION_ID,
    },
  })

  await service.prisma.officeHolder.create({
    data: {
      id: UNLINKED_OFFICE_HOLDER_ID,
      personId: PERSON_ID,
      officeTitle: 'City Council Member',
      state: 'CA',
      isCurrent: false,
    },
  })
}

beforeEach(seedPerson)

describe('GET /v1/persons (public list)', () => {
  it('runs against a localhost database only', () => {
    const host = new URL(process.env.DATABASE_URL!).hostname
    expect(['localhost', '127.0.0.1']).toContain(host)
  })

  it('omits email/phone on the default response', async () => {
    const res = await service.client.get('/v1/persons')

    expect(res.status).toBe(200)
    expect(res.data).toHaveLength(2)
    const jane = res.data.find((p: { id: string }) => p.id === PERSON_ID)
    // Non-PII scalars still flow through...
    expect(jane.slug).toBe(PERSON_SLUG)
    expect(jane.firstName).toBe('Jane')
    // ...but the PII keys are stripped entirely.
    expect(jane.email).toBeUndefined()
    expect(jane.phone).toBeUndefined()
    expect(jane).not.toHaveProperty('email')
    expect(jane).not.toHaveProperty('phone')
    expectNoPersonPii(res.data)
  })

  it('never leaks PII when nesting office holders and candidacies', async () => {
    const res = await service.client.get('/v1/persons', {
      params: { includeOfficeHolders: true, includeCandidacies: true },
    })

    expect(res.status).toBe(200)
    const jane = res.data.find((p: { id: string }) => p.id === PERSON_ID)

    // Nested candidacy is present but its email is omitted.
    expect(jane.Candidacies).toHaveLength(1)
    expect(jane.Candidacies[0].id).toBe(CANDIDACY_ID)
    expect(jane.Candidacies[0].email).toBeUndefined()
    // The race's election date is surfaced (non-PII) so consumers can date the run.
    expect(jane.Candidacies[0].Race.electionDate).toContain(RACE_ELECTION_DATE)

    // Nested office holder IS present with its public office contact.
    expect(jane.OfficeHolders).toHaveLength(2)
    const mayor = findOffice(jane)
    expect(mayor.officeEmail).toBe(OFFICE_EMAIL)
    expect(mayor.officePhone).toBe(OFFICE_PHONE)

    expect(jane.email).toBeUndefined()
    expect(jane.phone).toBeUndefined()
    expectNoPersonPii(res.data)
  })

  it('filters by slug', async () => {
    const res = await service.client.get('/v1/persons', {
      params: { slug: PERSON_SLUG },
    })

    expect(res.status).toBe(200)
    expect(res.data).toHaveLength(1)
    expect(res.data[0].id).toBe(PERSON_ID)
    expectNoPersonPii(res.data)
  })

  it('filters by a batch of ids (sitemap lookup) without leaking PII', async () => {
    const res = await service.client.get('/v1/persons', {
      params: { ids: `${PERSON_ID},${OTHER_PERSON_ID}` },
    })

    expect(res.status).toBe(200)
    expect(res.data).toHaveLength(2)
    expect(res.data.map((p: { id: string }) => p.id).sort()).toEqual(
      [PERSON_ID, OTHER_PERSON_ID].sort(),
    )
    expectNoPersonPii(res.data)
  })

  it('returns only the requested non-PII columns', async () => {
    const res = await service.client.get('/v1/persons', {
      params: { columns: 'id,slug' },
    })

    expect(res.status).toBe(200)
    const jane = res.data.find((p: { id: string }) => p.id === PERSON_ID)
    expect(Object.keys(jane).sort()).toEqual(['id', 'slug'])
    expectNoPersonPii(res.data)
  })

  it('rejects a request for the email column (allowlist blocks PII)', async () => {
    const res = await service.client.get('/v1/persons', {
      params: { columns: 'id,slug,email' },
    })
    expect(res.status).toBe(400)
  })

  it('rejects a request for the phone column (allowlist blocks PII)', async () => {
    const res = await service.client.get('/v1/persons', {
      params: { columns: 'id,phone' },
    })
    expect(res.status).toBe(400)
  })

  it('requires M2M auth to use the gpApiUserId filter (no public enumeration)', async () => {
    // The linkage column is already omitted from responses, but filtering on it
    // is itself an enumeration oracle, so an unauthenticated (observe-only)
    // caller is rejected outright. The authenticated 200 path is covered by the
    // service + controller unit tests (the harness runs without an M2M token).
    const res = await service.client.get('/v1/persons', {
      params: { gpApiUserId: PERSON_GP_API_USER_ID, columns: 'id' },
    })
    expect(res.status).toBe(401)
  })

  it('never returns gp_api_user_id on the default response', async () => {
    const res = await service.client.get('/v1/persons')

    expect(res.status).toBe(200)
    const jane = res.data.find((p: { id: string }) => p.id === PERSON_ID)
    expect(jane).not.toHaveProperty('gpApiUserId')
    expect(jane).not.toHaveProperty('gp_api_user_id')
    expectNoPersonPii(res.data)
  })

  it('rejects a request for the gp_api_user_id column (never selectable)', async () => {
    const res = await service.client.get('/v1/persons', {
      params: { columns: 'id,gp_api_user_id' },
    })
    expect(res.status).toBe(400)
  })

  it('rejects a non-numeric gpApiUserId filter', async () => {
    const res = await service.client.get('/v1/persons', {
      params: { gpApiUserId: 'not-a-number' },
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /v1/persons/:personId (public profile)', () => {
  it('returns the person with relations and never any PII', async () => {
    const res = await service.client.get(`/v1/persons/${PERSON_ID}`)

    expect(res.status).toBe(200)
    expect(res.data.id).toBe(PERSON_ID)
    expect(res.data.slug).toBe(PERSON_SLUG)

    // PII omitted on the person itself.
    expect(res.data.email).toBeUndefined()
    expect(res.data.phone).toBeUndefined()

    // Candidacy nested with email omitted.
    expect(res.data.Candidacies).toHaveLength(1)
    expect(res.data.Candidacies[0].email).toBeUndefined()

    // Office holder nested with public office contact intact.
    expect(res.data.OfficeHolders).toHaveLength(2)
    const mayor = findOffice(res.data)
    expect(mayor.officeEmail).toBe(OFFICE_EMAIL)
    expect(mayor.officePhone).toBe(OFFICE_PHONE)

    expectNoPersonPii(res.data)
  })

  // Without this the /people breadcrumb for a pure officeholder degrades to
  // `Elections > State > Name` — there is no candidacy race slug to parse.
  it('carries the office position slug and level from the office own race', async () => {
    const res = await service.client.get(`/v1/persons/${PERSON_ID}`)

    expect(res.status).toBe(200)
    const mayor = findOffice(res.data)
    // The most recent of the position's races, not the stale one.
    expect(mayor.positionSlug).toBe(OFFICE_RACE_SLUG)
    expect(mayor.positionLevel).toBe('CITY')
    // Pulled only to reach the race; never part of the response shape.
    expect(mayor).not.toHaveProperty('Position')
  })

  it('degrades to a null position slug for an office term with no position', async () => {
    const res = await service.client.get(`/v1/persons/${PERSON_ID}`)

    expect(res.status).toBe(200)
    const unlinked = findUnlinkedOffice(res.data)
    expect(unlinked.positionId).toBeNull()
    expect(unlinked.positionSlug).toBeNull()
    expect(unlinked.positionLevel).toBeNull()
    // The rest of the term still renders.
    expect(unlinked.officeTitle).toBe('City Council Member')
  })

  it('404s for an unknown id', async () => {
    const res = await service.client.get(`/v1/persons/${MISSING_PERSON_ID}`)
    expect(res.status).toBe(404)
  })

  it('400s for a non-uuid id', async () => {
    const res = await service.client.get('/v1/persons/not-a-uuid')
    expect(res.status).toBe(400)
  })
})

describe('GET /v1/persons/by-slug/:slug (canonical URL resolution)', () => {
  // Public slug is `<base>-<id8>`; PERSON_ID starts 11111111, OTHER 22222222.
  const PERSON_PUBLIC_SLUG = `${PERSON_SLUG}-11111111`
  const OTHER_PUBLIC_SLUG = `${OTHER_PERSON_SLUG}-22222222`

  it('resolves a person by the base slug + 8-hex id suffix, with relations and no PII', async () => {
    const res = await service.client.get(
      `/v1/persons/by-slug/${PERSON_PUBLIC_SLUG}`,
    )

    expect(res.status).toBe(200)
    expect(res.data.id).toBe(PERSON_ID)
    expect(res.data.slug).toBe(PERSON_SLUG)

    // Same spine shape as by-id: relations present, PII stripped.
    expect(res.data.Candidacies).toHaveLength(1)
    expect(res.data.Candidacies[0].email).toBeUndefined()
    expect(res.data.OfficeHolders).toHaveLength(2)
    expect(findOffice(res.data).officeEmail).toBe(OFFICE_EMAIL)
    // Same office position slug as the by-id path.
    expect(findOffice(res.data).positionSlug).toBe(OFFICE_RACE_SLUG)
    expect(res.data.email).toBeUndefined()
    expect(res.data.phone).toBeUndefined()
    expectNoPersonPii(res.data)
  })

  it('does not capture the by-slug segment as an id', async () => {
    // Regression guard for route ordering: `by-slug` must not hit :personId.
    const res = await service.client.get(
      `/v1/persons/by-slug/${OTHER_PUBLIC_SLUG}`,
    )
    expect(res.status).toBe(200)
    expect(res.data.id).toBe(OTHER_PERSON_ID)
  })

  it('resolves by the id suffix even when the base slug is stale', async () => {
    // The <id8> suffix is the real key; a wrong/old base still resolves (the
    // marketing layer then 301s to the canonical slug).
    const res = await service.client.get(
      `/v1/persons/by-slug/some-old-name-11111111`,
    )
    expect(res.status).toBe(200)
    expect(res.data.id).toBe(PERSON_ID)
  })

  it('404s when the id suffix matches no person', async () => {
    const res = await service.client.get('/v1/persons/by-slug/nobody-deadbeef')
    expect(res.status).toBe(404)
  })

  it('404s for a slug with no 8-hex id suffix', async () => {
    const res = await service.client.get('/v1/persons/by-slug/nobody-here')
    expect(res.status).toBe(404)
  })

  it('400s for a slug with invalid characters', async () => {
    const res = await service.client.get('/v1/persons/by-slug/Jane_Doe')
    expect(res.status).toBe(400)
  })
})
