import { beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '../test-service'

const service = useTestService()

const PERSON_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_PERSON_ID = '22222222-2222-2222-2222-222222222222'
const POSITION_ID = '55555555-5555-5555-5555-555555555555'
const OFFICE_HOLDER_ID = '44444444-4444-4444-4444-444444444444'
const OTHER_OFFICE_HOLDER_ID = '66666666-6666-6666-6666-666666666666'
const GEO_ID = 'geo-example-city'
const OTHER_GEO_ID = 'geo-other-town'

// The Person carries PII; the officeholders endpoint never joins Person, so
// these values must never surface here either.
const PERSON_EMAIL = 'jane.doe.personal@example.com'
const PERSON_PHONE = '+1-555-0142'

// Public-by-design office contact — MUST be present.
const OFFICE_EMAIL = 'mayor.office@city.gov'
const OFFICE_PHONE = '555-0100'

const seed = async () => {
  await service.prisma.person.create({
    data: {
      id: PERSON_ID,
      slug: 'jane-doe',
      firstName: 'Jane',
      lastName: 'Doe',
      state: 'CA',
      email: PERSON_EMAIL,
      phone: PERSON_PHONE,
    },
  })
  await service.prisma.person.create({
    data: {
      id: OTHER_PERSON_ID,
      slug: 'john-roe',
      firstName: 'John',
      lastName: 'Roe',
      state: 'NY',
    },
  })

  await service.prisma.position.create({
    data: {
      id: POSITION_ID,
      brDatabaseId: '7001',
      brPositionId: 'br-pos-7001',
      state: 'CA',
      name: 'Mayor of Example City',
    },
  })

  await service.prisma.officeHolder.create({
    data: {
      id: OFFICE_HOLDER_ID,
      personId: PERSON_ID,
      positionId: POSITION_ID,
      officeTitle: 'Mayor',
      state: 'CA',
      isCurrent: true,
      geoId: GEO_ID,
      officeEmail: OFFICE_EMAIL,
      officePhone: OFFICE_PHONE,
    },
  })

  await service.prisma.officeHolder.create({
    data: {
      id: OTHER_OFFICE_HOLDER_ID,
      personId: OTHER_PERSON_ID,
      officeTitle: 'Council Member',
      state: 'NY',
      isCurrent: false,
      geoId: OTHER_GEO_ID,
    },
  })
}

beforeEach(seed)

describe('GET /v1/officeholders (public list)', () => {
  it('runs against a localhost database only', () => {
    const host = new URL(process.env.DATABASE_URL!).hostname
    expect(['localhost', '127.0.0.1']).toContain(host)
  })

  it('exposes public office contact and never the person PII', async () => {
    const res = await service.client.get('/v1/officeholders')

    expect(res.status).toBe(200)
    expect(res.data).toHaveLength(2)

    const mayor = res.data.find(
      (o: { id: string }) => o.id === OFFICE_HOLDER_ID,
    )
    // Office contact is public by design.
    expect(mayor.officeEmail).toBe(OFFICE_EMAIL)
    expect(mayor.officePhone).toBe(OFFICE_PHONE)

    // Person PII must not ride along (endpoint never joins Person).
    const json = JSON.stringify(res.data)
    expect(json).not.toContain(PERSON_EMAIL)
    expect(json).not.toContain(PERSON_PHONE)
  })

  it('filters by personId', async () => {
    const res = await service.client.get('/v1/officeholders', {
      params: { personId: PERSON_ID },
    })

    expect(res.status).toBe(200)
    expect(res.data).toHaveLength(1)
    expect(res.data[0].id).toBe(OFFICE_HOLDER_ID)
    expect(res.data[0].officeEmail).toBe(OFFICE_EMAIL)
  })

  it('includes the related position when requested', async () => {
    const res = await service.client.get('/v1/officeholders', {
      params: { personId: PERSON_ID, includePosition: true },
    })

    expect(res.status).toBe(200)
    expect(res.data).toHaveLength(1)
    expect(res.data[0].Position).toBeTruthy()
    expect(res.data[0].Position.id).toBe(POSITION_ID)
    expect(res.data[0].Position.name).toBe('Mayor of Example City')
  })

  it('does not include the position by default', async () => {
    const res = await service.client.get('/v1/officeholders', {
      params: { personId: PERSON_ID },
    })

    expect(res.status).toBe(200)
    expect(res.data[0].Position).toBeUndefined()
  })

  it('400s for a non-uuid personId', async () => {
    const res = await service.client.get('/v1/officeholders', {
      params: { personId: 'not-a-uuid' },
    })
    expect(res.status).toBe(400)
  })

  it('filters by geoId (nearby officials)', async () => {
    const res = await service.client.get('/v1/officeholders', {
      params: { geoId: GEO_ID },
    })

    expect(res.status).toBe(200)
    expect(res.data).toHaveLength(1)
    expect(res.data[0].id).toBe(OFFICE_HOLDER_ID)
    expect(res.data[0].geoId).toBe(GEO_ID)

    // No person PII even when filtering by geo.
    const json = JSON.stringify(res.data)
    expect(json).not.toContain(PERSON_EMAIL)
    expect(json).not.toContain(PERSON_PHONE)
  })
})
