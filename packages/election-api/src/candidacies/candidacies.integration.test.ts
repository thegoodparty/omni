import { beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '../test-service'

const service = useTestService()

const POSITION_ID = '55555555-5555-5555-5555-555555555555'
const OTHER_POSITION_ID = '77777777-7777-7777-7777-777777777777'
const RACE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const OTHER_RACE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const CANDIDACY_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const OTHER_CANDIDACY_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
const OFF_POSITION_CANDIDACY_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

// Candidacy PII — must never surface on this public endpoint.
const CANDIDATE_EMAIL = 'candidate.personal@example.com'

const seed = async () => {
  await service.prisma.position.create({
    data: {
      id: POSITION_ID,
      brDatabaseId: '9001',
      brPositionId: 'br-pos-9001',
      state: 'CA',
      name: 'City Council District 3',
    },
  })
  await service.prisma.position.create({
    data: {
      id: OTHER_POSITION_ID,
      brDatabaseId: '9002',
      brPositionId: 'br-pos-9002',
      state: 'CA',
      name: 'Mayor',
    },
  })

  await service.prisma.race.create({
    data: {
      id: RACE_ID,
      electionDate: new Date('2026-11-03'),
      slug: 'ca/city-council-district-3',
      state: 'CA',
      positionLevel: 'CITY',
      positionId: POSITION_ID,
    },
  })
  await service.prisma.race.create({
    data: {
      id: OTHER_RACE_ID,
      electionDate: new Date('2026-11-03'),
      slug: 'ca/mayor',
      state: 'CA',
      positionLevel: 'CITY',
      positionId: OTHER_POSITION_ID,
    },
  })

  // Two candidacies sharing the target position (via their race).
  await service.prisma.candidacy.create({
    data: {
      id: CANDIDACY_ID,
      brDatabaseId: 1001,
      slug: 'jane-doe-city-council-district-3',
      firstName: 'Jane',
      lastName: 'Doe',
      state: 'CA',
      email: CANDIDATE_EMAIL,
      raceId: RACE_ID,
    },
  })
  await service.prisma.candidacy.create({
    data: {
      id: OTHER_CANDIDACY_ID,
      brDatabaseId: 1002,
      slug: 'john-roe-city-council-district-3',
      firstName: 'John',
      lastName: 'Roe',
      state: 'CA',
      raceId: RACE_ID,
    },
  })

  // A candidacy for a different position — must NOT match the positionId filter.
  await service.prisma.candidacy.create({
    data: {
      id: OFF_POSITION_CANDIDACY_ID,
      brDatabaseId: 1003,
      slug: 'mary-major-mayor',
      firstName: 'Mary',
      lastName: 'Major',
      state: 'CA',
      raceId: OTHER_RACE_ID,
    },
  })
}

beforeEach(seed)

describe('GET /v1/candidacies (public list)', () => {
  it('runs against a localhost database only', () => {
    const host = new URL(process.env.DATABASE_URL!).hostname
    expect(['localhost', '127.0.0.1']).toContain(host)
  })

  it('never returns candidate email PII', async () => {
    const res = await service.client.get('/v1/candidacies', {
      params: { state: 'CA' },
    })

    expect(res.status).toBe(200)
    const json = JSON.stringify(res.data)
    expect(json).not.toContain(CANDIDATE_EMAIL)
    for (const row of res.data) {
      expect(row.email).toBeUndefined()
    }
  })

  it('400s when email is requested via columns', async () => {
    const res = await service.client.get('/v1/candidacies', {
      params: { columns: 'id,slug,email' },
    })
    expect(res.status).toBe(400)
  })

  it('filters by positionId via the related race (other candidates for position)', async () => {
    const res = await service.client.get('/v1/candidacies', {
      params: { positionId: POSITION_ID },
    })

    expect(res.status).toBe(200)
    expect(res.data).toHaveLength(2)
    const ids = res.data.map((c: { id: string }) => c.id).sort()
    expect(ids).toEqual([CANDIDACY_ID, OTHER_CANDIDACY_ID].sort())
    // The off-position candidacy must not be included.
    expect(ids).not.toContain(OFF_POSITION_CANDIDACY_ID)
    // Still no PII.
    expect(JSON.stringify(res.data)).not.toContain(CANDIDATE_EMAIL)
  })

  it('combines positionId with includeRace', async () => {
    const res = await service.client.get('/v1/candidacies', {
      params: { positionId: POSITION_ID, includeRace: true },
    })

    expect(res.status).toBe(200)
    expect(res.data).toHaveLength(2)
    for (const row of res.data) {
      expect(row.Race).toBeTruthy()
      expect(row.Race.positionId).toBe(POSITION_ID)
    }
  })

  it('400s for a non-uuid positionId', async () => {
    const res = await service.client.get('/v1/candidacies', {
      params: { positionId: 'not-a-uuid' },
    })
    expect(res.status).toBe(400)
  })
})
