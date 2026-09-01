import { beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '../test-service'

const service = useTestService()

// Separate suite from persons.integration.test.ts because the density path
// needs a District (and a Position pointing at it) that the person fixtures
// there deliberately do not have.
const PERSON_ID = '11111111-1111-1111-1111-111111111111'
const DISTRICTLESS_PERSON_ID = '22222222-2222-2222-2222-222222222222'
const MISSING_PERSON_ID = '99999999-9999-9999-9999-999999999999'

const DISTRICT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const EMPTY_DISTRICT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const UNKNOWN_DISTRICT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

const POSITION_ID = '66666666-6666-6666-6666-666666666666'
const OFFICE_HOLDER_ID = '44444444-4444-4444-4444-444444444444'

// The resolution the route pins. Rows at any other resolution must not leak
// into the response.
const RESOLUTION = 8

const seedDistrict = async (id: string, name: string) =>
  service.prisma.district.create({
    data: {
      id,
      state: 'CA',
      L2DistrictType: 'City',
      L2DistrictName: name,
    },
  })

const seedCells = async (
  districtId: string,
  cells: { h3Index: string; lat: number; lng: number; voterCount: number }[],
  resolution: number = RESOLUTION,
) =>
  service.prisma.districtVoterDensity.createMany({
    data: cells.map((c) => ({
      ...c,
      districtId,
      resolution,
      state: 'CA',
      updatedAt: new Date('2026-08-01'),
    })),
  })

const seedMeta = async (districtId: string, coverage: number) =>
  service.prisma.districtVoterDensityMeta.create({
    data: {
      districtId,
      resolution: RESOLUTION,
      coverage,
      minCellCount: 5,
      totalVoters: 1000,
      geocodedVoters: 900,
      renderedVoters: Math.round(1000 * coverage),
      suppressedCells: 3,
      state: 'CA',
      updatedAt: new Date('2026-08-01'),
    },
  })

/** A person holding a current office term in `districtId`. */
const seedPersonInDistrict = async (districtId: string) => {
  await service.prisma.person.create({
    data: {
      id: PERSON_ID,
      slug: 'jane-doe',
      firstName: 'Jane',
      lastName: 'Doe',
      fullName: 'Jane Doe',
      state: 'CA',
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
      districtId,
    },
  })

  await service.prisma.officeHolder.create({
    data: {
      id: OFFICE_HOLDER_ID,
      personId: PERSON_ID,
      officeTitle: 'Mayor',
      state: 'CA',
      isCurrent: true,
      positionId: POSITION_ID,
    },
  })
}

/** A person with no office and no candidacy, so nothing resolves to a district. */
const seedDistrictlessPerson = async () =>
  service.prisma.person.create({
    data: {
      id: DISTRICTLESS_PERSON_ID,
      slug: 'john-roe',
      firstName: 'John',
      lastName: 'Roe',
      fullName: 'John Roe',
      state: 'NY',
    },
  })

beforeEach(async () => {
  await seedDistrict(DISTRICT_ID, 'Los Angeles')
  await seedDistrict(EMPTY_DISTRICT_ID, 'Fresno')
  await seedDistrictlessPerson()
})

describe('GET /v1/persons/:personId/voter-density', () => {
  it('returns the district cells and its coverage', async () => {
    await seedPersonInDistrict(DISTRICT_ID)
    await seedCells(DISTRICT_ID, [
      { h3Index: '88283082a9fffff', lat: 34.2, lng: -118.1, voterCount: 7 },
      { h3Index: '88283082abfffff', lat: 34.1, lng: -118.2, voterCount: 12 },
    ])
    await seedMeta(DISTRICT_ID, 0.82)

    const res = await service.client.get(
      `/v1/persons/${PERSON_ID}/voter-density`,
    )

    expect(res.status).toBe(200)
    expect(res.data.districtId).toBe(DISTRICT_ID)
    expect(res.data.coverage).toBe(0.82)
    expect(res.data.cells).toEqual([
      { lat: 34.1, lng: -118.2, count: 12 },
      { lat: 34.2, lng: -118.1, count: 7 },
    ])
  })

  it('orders cells by (lat, lng) regardless of insertion order', async () => {
    // gp-api compares this response against the people-db one cell by cell
    // during the migration; an unstable order would read as a divergence.
    await seedPersonInDistrict(DISTRICT_ID)
    await seedCells(DISTRICT_ID, [
      { h3Index: '88283082a1fffff', lat: 35.0, lng: -118.0, voterCount: 5 },
      { h3Index: '88283082a2fffff', lat: 33.0, lng: -118.0, voterCount: 6 },
      { h3Index: '88283082a3fffff', lat: 34.0, lng: -119.0, voterCount: 7 },
      { h3Index: '88283082a4fffff', lat: 34.0, lng: -117.0, voterCount: 8 },
    ])

    const res = await service.client.get(
      `/v1/persons/${PERSON_ID}/voter-density`,
    )

    expect(res.data.cells.map((c: { count: number }) => c.count)).toEqual([
      6, 7, 8, 5,
    ])
  })

  it('serves only the pinned resolution', async () => {
    // Finer resolutions are built with the same K but smaller cells; serving
    // them off this route would hand out a precision the caller never asked
    // for and the k-anonymity policy was not set for.
    await seedPersonInDistrict(DISTRICT_ID)
    await seedCells(DISTRICT_ID, [
      { h3Index: '88283082a9fffff', lat: 34.2, lng: -118.1, voterCount: 7 },
    ])
    await seedCells(
      DISTRICT_ID,
      [{ h3Index: '89283082a9fffff', lat: 34.25, lng: -118.15, voterCount: 3 }],
      9,
    )

    const res = await service.client.get(
      `/v1/persons/${PERSON_ID}/voter-density`,
    )

    expect(res.data.cells).toEqual([{ lat: 34.2, lng: -118.1, count: 7 }])
  })

  it('returns empty cells and null coverage for a district with nothing published', async () => {
    await seedPersonInDistrict(EMPTY_DISTRICT_ID)

    const res = await service.client.get(
      `/v1/persons/${PERSON_ID}/voter-density`,
    )

    expect(res.status).toBe(200)
    expect(res.data).toEqual({
      personId: PERSON_ID,
      districtId: EMPTY_DISTRICT_ID,
      coverage: null,
      cells: [],
    })
  })

  it('returns null coverage when cells exist but the meta row does not', async () => {
    await seedPersonInDistrict(DISTRICT_ID)
    await seedCells(DISTRICT_ID, [
      { h3Index: '88283082a9fffff', lat: 34.2, lng: -118.1, voterCount: 7 },
    ])

    const res = await service.client.get(
      `/v1/persons/${PERSON_ID}/voter-density`,
    )

    expect(res.data.coverage).toBeNull()
    expect(res.data.cells).toHaveLength(1)
  })

  it('degrades to an empty map for a person who resolves to no district', async () => {
    const res = await service.client.get(
      `/v1/persons/${DISTRICTLESS_PERSON_ID}/voter-density`,
    )

    expect(res.status).toBe(200)
    expect(res.data).toEqual({
      personId: DISTRICTLESS_PERSON_ID,
      districtId: null,
      coverage: null,
      cells: [],
    })
  })

  it('404s for an unknown person rather than returning an empty map', async () => {
    const res = await service.client.get(
      `/v1/persons/${MISSING_PERSON_ID}/voter-density`,
    )

    expect(res.status).toBe(404)
  })

  it('400s on a non-UUID person id', async () => {
    const res = await service.client.get('/v1/persons/not-a-uuid/voter-density')

    expect(res.status).toBe(400)
  })

  it('does not leak person PII', async () => {
    await seedPersonInDistrict(DISTRICT_ID)
    await seedCells(DISTRICT_ID, [
      { h3Index: '88283082a9fffff', lat: 34.2, lng: -118.1, voterCount: 7 },
    ])

    const res = await service.client.get(
      `/v1/persons/${PERSON_ID}/voter-density`,
    )

    const json = JSON.stringify(res.data)
    expect(json).not.toContain('email')
    expect(json).not.toContain('phone')
    expect(json).not.toContain('gpApiUserId')
  })
})

describe('District_Voter_Density foreign key', () => {
  it('rejects cells for a district that does not exist', async () => {
    // This is the whole reason the tables moved into election-db. In people-db
    // District lived in another database, so a cell keyed on a stale or
    // differently-salted uuid inserted cleanly and the only symptom was a map
    // that silently never rendered. Here the load fails instead.
    await expect(
      seedCells(UNKNOWN_DISTRICT_ID, [
        { h3Index: '88283082a9fffff', lat: 34.2, lng: -118.1, voterCount: 7 },
      ]),
    ).rejects.toThrow()
  })

  it('rejects a meta row for a district that does not exist', async () => {
    await expect(seedMeta(UNKNOWN_DISTRICT_ID, 0.9)).rejects.toThrow()
  })
})
