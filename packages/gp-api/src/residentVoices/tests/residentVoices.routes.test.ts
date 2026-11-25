import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResidentVoicesResponse } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { PeopleDbxStatementClient } from '@/peopleDb/databricks/peopleDbxStatement.client'
import { DEFAULT_RESIDENT_VOICES_TABLE } from '@/peopleDb/databricks/residentVoicesSql.util'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'
const PATH = '/v1/resident-voices'
const DISTRICT_ID = '5b1f6c0e-2a57-4c53-9d0e-7a1f0c9d4e21'
const EMPTY: ResidentVoicesResponse = { voices: [], syntheticCount: 0 }

type Row = Array<string | null>

// One warehouse row, in the order the statement selects its columns. Every
// comment here is invented.
const row = (
  id: string,
  quote: string,
  overrides: Partial<{
    synthetic: boolean
    source: string
    tier: number | null
    rank: number
    status: string
    lat: number | null
    lon: number | null
  }> = {},
): Row => {
  const synthetic = overrides.synthetic ?? false
  const value = {
    source: synthetic ? 'synthetic' : 'public_comment',
    tier: synthetic ? null : 1,
    rank: 1,
    status: 'verified_in_district',
    lat: 42.32,
    lon: -72.64,
    ...overrides,
  }
  const text = (figure: number | null) =>
    figure === null ? null : String(figure)
  return [
    id,
    quote,
    String(synthetic),
    value.source,
    text(value.tier),
    text(value.rank),
    value.status,
    text(value.lat),
    text(value.lon),
  ]
}

const SYNTHETIC_ROWS = [1, 2, 3, 4, 5, 6].map((rank) =>
  row(`made-up-${rank}`, `A made-up comment, number ${rank}.`, {
    synthetic: true,
    rank,
    lat: Number(`42.3${rank}`),
  }),
)

const seedOrg = async (prefix: 'eo' | 'campaign' = 'eo') => {
  const slug = `${prefix}-resident-voices-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id, overrideDistrictId: DISTRICT_ID },
  })
  return slug
}

const stubDistrict = (id: string | null = DISTRICT_ID) =>
  vi
    .spyOn(
      service.app.get(OrganizationsService),
      'getDistrictAndLevelForOrgSlug',
    )
    .mockResolvedValue({
      district: id
        ? { id, state: 'MA', l2Type: 'City', l2Name: 'Anytown City' }
        : null,
      level: null,
    })

const stubWarehouse = (rows: Row[]) =>
  vi
    .spyOn(service.app.get(PeopleDbxStatementClient), 'query')
    .mockResolvedValue({ columns: [], rows })

const read = (slug: string) =>
  service.client.get<ResidentVoicesResponse>(PATH, {
    headers: { [ORG_SLUG_HEADER]: slug },
    validateStatus: () => true,
  })

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /v1/resident-voices', () => {
  it('shows real comments first, best tier then rank, then synthetic ones to fill', async () => {
    const slug = await seedOrg()
    stubDistrict()
    stubWarehouse([
      ...SYNTHETIC_ROWS,
      row('real-c', 'The crosswalk by the library needs paint.', {
        tier: 2,
        rank: 1,
      }),
      row('real-b', 'Our street floods every spring.', { tier: 1, rank: 2 }),
      row('real-a', 'Please keep the pool open in August.', {
        tier: 1,
        rank: 1,
        lat: 42.35,
        lon: -72.61,
      }),
      row('real-d', 'The bus should run later on Fridays.', {
        tier: 3,
        rank: 1,
        source: 'serve_poll',
      }),
    ])

    const res = await read(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.voices.map((voice) => voice.id)).toEqual([
      'real-a',
      'real-b',
      'real-c',
      'real-d',
      'made-up-1',
      'made-up-2',
    ])
    expect(res.data.syntheticCount).toBe(2)
    expect(res.data.voices[0]).toEqual({
      id: 'real-a',
      quote: 'Please keep the pool open in August.',
      lat: 42.35,
      lon: -72.61,
      synthetic: false,
    })
    expect(res.data.voices[4]).toEqual({
      id: 'made-up-1',
      quote: 'A made-up comment, number 1.',
      lat: 42.31,
      lon: -72.64,
      synthetic: true,
    })
  })

  it('returns only the comment, its point and whether it is synthetic', async () => {
    const slug = await seedOrg()
    stubDistrict()
    stubWarehouse([
      row('real-a', 'Fix the lights at the ball field.', {
        source: 'written_comment',
        tier: 4,
      }),
    ])

    const res = await read(slug)

    expect(Object.keys(res.data).sort()).toEqual(['syntheticCount', 'voices'])
    expect(Object.keys(res.data.voices[0] ?? {}).sort()).toEqual([
      'id',
      'lat',
      'lon',
      'quote',
      'synthetic',
    ])
  })

  it('leaves out 311 rows', async () => {
    const slug = await seedOrg()
    stubDistrict()
    stubWarehouse([
      row('call-1', 'Pothole', { source: '311', tier: 1, rank: 1 }),
      row('call-2', 'Missed trash pickup', { source: '311', tier: 1 }),
      row('real-a', 'Plow the side streets sooner.', { tier: 3, rank: 5 }),
    ])

    const res = await read(slug)

    expect(res.data.voices.map((voice) => voice.id)).toEqual(['real-a'])
    expect(res.data.syntheticCount).toBe(0)
  })

  it('leaves out rows with no point or not placed inside the district', async () => {
    const slug = await seedOrg()
    stubDistrict()
    stubWarehouse([
      row('no-lat', 'We need a dog park.', { lat: null }),
      row('no-lon', 'The fair was great this year.', { lon: null }),
      row('outside', 'Lower the speed limit downtown.', {
        status: 'outside_district',
      }),
      row('unverified', 'More benches on Main Street.', {
        status: 'unverified',
      }),
      row('made-up-lost', 'A made-up comment with no place.', {
        synthetic: true,
        lat: null,
        lon: null,
      }),
      row('real-a', 'Thank you for the new sidewalk.'),
    ])

    const res = await read(slug)

    expect(res.data.voices.map((voice) => voice.id)).toEqual(['real-a'])
  })

  it('returns fewer than six when the district has fewer', async () => {
    const slug = await seedOrg()
    stubDistrict()
    stubWarehouse([
      row('real-a', 'The farmers market should stay downtown.'),
      row('real-b', 'Trim the trees along the river path.', { rank: 2 }),
      row('made-up-1', 'A made-up comment.', { synthetic: true }),
    ])

    const res = await read(slug)

    expect(res.data.voices.map((voice) => voice.id)).toEqual([
      'real-a',
      'real-b',
      'made-up-1',
    ])
    expect(res.data.syntheticCount).toBe(1)
  })

  it('shows six real comments and no synthetic ones when there are enough', async () => {
    const slug = await seedOrg()
    stubDistrict()
    stubWarehouse([
      ...SYNTHETIC_ROWS,
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((rank) =>
        row(`real-${rank}`, `An invented remark, number ${rank}.`, { rank }),
      ),
    ])

    const res = await read(slug)

    expect(res.data.voices.map((voice) => voice.id)).toEqual([
      'real-1',
      'real-2',
      'real-3',
      'real-4',
      'real-5',
      'real-6',
    ])
    expect(res.data.syntheticCount).toBe(0)
  })

  it('shows the six synthetic comments of a district with no real ones', async () => {
    const slug = await seedOrg()
    stubDistrict()
    stubWarehouse([...SYNTHETIC_ROWS].reverse())

    const res = await read(slug)

    expect(res.data.voices.map((voice) => voice.id)).toEqual([
      'made-up-1',
      'made-up-2',
      'made-up-3',
      'made-up-4',
      'made-up-5',
      'made-up-6',
    ])
    expect(res.data.syntheticCount).toBe(6)
  })

  it('reads the configured table for the office’s district', async () => {
    const slug = await seedOrg()
    const district = stubDistrict()
    const query = stubWarehouse([])

    expect((await read(slug)).data).toEqual(EMPTY)

    expect(district).toHaveBeenCalledWith(slug)
    const [statement] = query.mock.calls[0] ?? []
    expect(statement?.sql).toContain(`FROM ${DEFAULT_RESIDENT_VOICES_TABLE} `)
    expect(statement?.sql).not.toMatch(/topic|user_ids|campaign_ids|\*/)
    expect(statement?.params.map((param) => param.value)).toEqual([DISTRICT_ID])

    vi.stubEnv('RESIDENT_VOICES_TABLE', 'some_catalog.mart_gp_api.voices')
    await read(slug)

    expect(query.mock.calls[1]?.[0].sql).toContain(
      'FROM some_catalog.mart_gp_api.voices ',
    )
  })

  it('returns none when the table cannot be read', async () => {
    const slug = await seedOrg()
    stubDistrict()
    vi.spyOn(
      service.app.get(PeopleDbxStatementClient),
      'query',
    ).mockRejectedValue(
      new Error('Databricks statement FAILED: TABLE_OR_VIEW_NOT_FOUND'),
    )

    const res = await read(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual(EMPTY)
  })

  it('returns none when the read is slower than its budget', async () => {
    const slug = await seedOrg()
    stubDistrict()
    vi.stubEnv('RESIDENT_VOICES_TIMEOUT_MS', '40')
    let signal: AbortSignal | undefined
    let finish: () => void = () => undefined
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    vi.spyOn(
      service.app.get(PeopleDbxStatementClient),
      'query',
    ).mockImplementation(async (_statement, options) => {
      signal = options?.signal
      await new Promise((resolve) => setTimeout(resolve, 400))
      finish()
      return { columns: [], rows: SYNTHETIC_ROWS }
    })

    const res = await read(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual(EMPTY)
    expect(signal?.aborted).toBe(true)
    await finished
  })

  it('returns none, without a warehouse read, when the office has no district', async () => {
    const slug = await seedOrg()
    stubDistrict(null)
    const query = stubWarehouse(SYNTHETIC_ROWS)

    const res = await read(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual(EMPTY)
    expect(query).not.toHaveBeenCalled()
  })

  it('returns none when the district cannot be resolved or the table name is not a table', async () => {
    const slug = await seedOrg()
    const query = stubWarehouse(SYNTHETIC_ROWS)
    vi.spyOn(
      service.app.get(OrganizationsService),
      'getDistrictAndLevelForOrgSlug',
    ).mockRejectedValueOnce(new Error('election database unreachable'))

    expect((await read(slug)).data).toEqual(EMPTY)

    stubDistrict()
    vi.stubEnv('RESIDENT_VOICES_TABLE', 'voices; DROP TABLE x')

    expect((await read(slug)).data).toEqual(EMPTY)
    expect(query).not.toHaveBeenCalled()
  })

  it('400s for a campaign', async () => {
    const slug = await seedOrg('campaign')
    const query = stubWarehouse(SYNTHETIC_ROWS)

    const res = await read(slug)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses an office the user does not belong to', async () => {
    const owner = await service.prisma.user.create({
      data: { email: `fake-${randomUUID()}@example.com` },
    })
    const slug = `eo-resident-voices-${randomUUID()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: owner.id },
    })
    const query = stubWarehouse(SYNTHETIC_ROWS)

    const res = await read(slug)

    expect(res.status).toBeGreaterThanOrEqual(HttpStatus.BAD_REQUEST)
    expect(query).not.toHaveBeenCalled()
  })
})
