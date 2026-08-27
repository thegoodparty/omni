import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PinoLogger } from 'nestjs-pino'
import { DatabricksVoterDensityService } from './databricksVoterDensity.service'
import {
  PeopleDbxStatementClient,
  PeopleDbxTimeoutError,
  PeopleDbxUnavailableError,
} from './peopleDbxStatement.client'

const DISTRICT_ID = '635757db-0000-0000-0000-000000000000'

const rows = (data: Array<Array<string | null>>) => ({
  columns: [],
  rows: data,
})

describe('DatabricksVoterDensityService', () => {
  let service: DatabricksVoterDensityService
  let query: ReturnType<typeof vi.fn>

  beforeEach(() => {
    query = vi.fn()
    service = new DatabricksVoterDensityService(
      { setContext: vi.fn(), error: vi.fn() } as unknown as PinoLogger,
      { query } as unknown as PeopleDbxStatementClient,
    )
  })

  const respond = (
    cells: Array<Array<string | null>>,
    meta: Array<Array<string | null>>,
  ) => {
    query.mockImplementation((statement: { sql: string }) =>
      Promise.resolve(
        statement.sql.includes('_meta') ? rows(meta) : rows(cells),
      ),
    )
  }

  it('returns the mapped cells and coverage for a district', async () => {
    respond(
      [
        ['43.1', '-108.2', '25'],
        ['43.2', '-108.3', '11'],
      ],
      [['0.982']],
    )

    const result = await service.findVoterDensity(DISTRICT_ID, 8)

    expect(result).toEqual({
      coverage: 0.982,
      cells: [
        { lat: 43.1, lng: -108.2, count: 25 },
        { lat: 43.2, lng: -108.3, count: 11 },
      ],
    })
  })

  it('returns null coverage and no cells when the district has none', async () => {
    respond([], [])

    const result = await service.findVoterDensity(DISTRICT_ID, 8)

    expect(result).toEqual({ coverage: null, cells: [] })
  })

  it('passes the requested resolution through to both statements', async () => {
    respond([], [])

    await service.findVoterDensity(DISTRICT_ID, 9)

    for (const [statement] of query.mock.calls) {
      expect(statement.params).toContainEqual({
        name: 'p1',
        value: '9',
        type: 'INT',
      })
    }
  })

  it('surfaces an unreachable warehouse as 502, not an empty district', async () => {
    query.mockRejectedValue(new PeopleDbxUnavailableError('down'))

    await expect(
      service.findVoterDensity(DISTRICT_ID, 8),
    ).rejects.toBeInstanceOf(BadGatewayException)
  })

  it('surfaces a statement that ran too long as 504', async () => {
    query.mockRejectedValue(new PeopleDbxTimeoutError(30_000))

    await expect(
      service.findVoterDensity(DISTRICT_ID, 8),
    ).rejects.toBeInstanceOf(GatewayTimeoutException)
  })
})
