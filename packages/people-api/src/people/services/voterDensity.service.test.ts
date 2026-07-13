import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '../../generated/prisma'
import { VoterDensityService } from './voterDensity.service'

// Real-Postgres integration test for the precomputed voter-density read. Spins
// up an ephemeral local container (testcontainers), applies ONLY the density
// migration on top of the prerequisites it depends on (green schema + the
// public."USState" enum), seeds fake precomputed rows, and asserts the service
// returns the right cells scoped to (districtId, resolution) plus coverage from
// the meta row. No dev/qa/prod DB is ever touched.
const MIGRATION_SQL = readFileSync(
  join(
    __dirname,
    '../../../prisma/schema/migrations/20260713000000_add_voter_density_heatmap/migration.sql',
  ),
  'utf8',
)

// The density tables reference green schema + public."USState"; those exist in
// the real people-api DB (created by earlier migrations / the data pipeline),
// so recreate just enough of them here before replaying the density migration.
const PREREQ_SQL = `
  CREATE SCHEMA IF NOT EXISTS green;
  CREATE SCHEMA IF NOT EXISTS public;
  CREATE TYPE "public"."USState" AS ENUM ('WY', 'CA', 'TX');
`

const DISTRICT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DISTRICT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('VoterDensityService (integration)', () => {
  let container: StartedPostgreSqlContainer
  let prisma: PrismaClient
  let service: VoterDensityService

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('people_api_test')
      .withUsername('test_user')
      .withPassword('test_password')
      .start()

    const url = container.getConnectionUri()
    // Safety: this must be a throwaway local container, never a remote host.
    expect(new URL(url).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/)

    // Use a raw pg client for the DDL: it accepts multiple statements in one
    // query, which Prisma's $executeRawUnsafe (a prepared statement) does not.
    const ddl = new Client({ connectionString: url })
    await ddl.connect()
    await ddl.query(PREREQ_SQL)
    await ddl.query(MIGRATION_SQL)
    await ddl.end()

    prisma = new PrismaClient({ datasources: { db: { url } } })

    service = new VoterDensityService()
    Object.defineProperty(service, '_prisma', {
      get: () => prisma,
      configurable: true,
    })
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await container?.stop()
  })

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "green"."DistrictVoterDensity", "green"."DistrictVoterDensityMeta"',
    )
  })

  const seedCell = (
    districtId: string,
    resolution: number,
    h3Index: string,
    lat: number,
    lng: number,
    voterCount: number,
  ) =>
    prisma.districtVoterDensity.create({
      data: {
        districtId,
        resolution,
        h3Index,
        lat,
        lng,
        voterCount,
        state: 'WY',
        updatedAt: new Date(),
      },
    })

  const seedMeta = (
    districtId: string,
    resolution: number,
    coverage: number,
    minCellCount: number,
  ) =>
    prisma.districtVoterDensityMeta.create({
      data: {
        districtId,
        resolution,
        coverage,
        minCellCount,
        totalVoters: 1000,
        geocodedVoters: 900,
        renderedVoters: 800,
        suppressedCells: 3,
        state: 'WY',
        updatedAt: new Date(),
      },
    })

  it('returns precomputed cells + coverage for a district/resolution', async () => {
    await seedCell(DISTRICT_A, 8, 'h1', 41.14, -104.82, 25)
    await seedCell(DISTRICT_A, 8, 'h2', 41.15, -104.81, 40)
    await seedMeta(DISTRICT_A, 8, 0.8, 10)

    const result = await service.getVoterDensity({
      districtId: DISTRICT_A,
      resolution: 8,
    } as never)

    expect(result.districtId).toBe(DISTRICT_A)
    expect(result.resolution).toBe(8)
    expect(result.coverage).toBe(0.8)
    expect(result.minCellCount).toBe(10)
    expect(result.cells).toHaveLength(2)
    expect(result.cells).toContainEqual({ lat: 41.14, lng: -104.82, count: 25 })
    expect(result.cells).toContainEqual({ lat: 41.15, lng: -104.81, count: 40 })
  })

  it('scopes cells to the requested district (no cross-district leakage)', async () => {
    await seedCell(DISTRICT_A, 8, 'h1', 41.14, -104.82, 25)
    await seedCell(DISTRICT_B, 8, 'h9', 34.05, -118.24, 99)

    const result = await service.getVoterDensity({
      districtId: DISTRICT_A,
      resolution: 8,
    } as never)

    expect(result.cells).toHaveLength(1)
    expect(result.cells[0]?.count).toBe(25)
  })

  it('scopes cells to the requested resolution', async () => {
    await seedCell(DISTRICT_A, 7, 'r7', 41.1, -104.8, 50)
    await seedCell(DISTRICT_A, 8, 'r8', 41.2, -104.9, 60)

    const result = await service.getVoterDensity({
      districtId: DISTRICT_A,
      resolution: 7,
    } as never)

    expect(result.cells).toHaveLength(1)
    expect(result.cells[0]?.count).toBe(50)
  })

  it('returns empty cells and null coverage when the district has no data', async () => {
    const result = await service.getVoterDensity({
      districtId: DISTRICT_A,
      resolution: 8,
    } as never)

    expect(result.cells).toEqual([])
    expect(result.coverage).toBeNull()
    expect(result.minCellCount).toBeNull()
  })

  it('returns cells with null coverage when cells exist but meta is missing', async () => {
    await seedCell(DISTRICT_A, 8, 'h1', 41.14, -104.82, 25)

    const result = await service.getVoterDensity({
      districtId: DISTRICT_A,
      resolution: 8,
    } as never)

    expect(result.cells).toHaveLength(1)
    expect(result.coverage).toBeNull()
  })
})
