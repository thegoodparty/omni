import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PeopleDbxStatementClient,
  PeopleDbxStatementTooLargeError,
  PeopleDbxTimeoutError,
  PeopleDbxUnavailableError,
} from './peopleDbxStatement.client'
import type { DbxStatement } from './databricksVoterSql.util'
import { PEOPLE_DBX_HOSTNAME, PEOPLE_DBX_SCHEMA } from './peopleDbx.config'

const stmt = (sql: string): DbxStatement => ({ sql, params: [] })

const ENV_KEYS = [
  'PEOPLE_DATABRICKS_WAREHOUSE_ID',
  'PEOPLE_DATABRICKS_CLIENT_ID',
  'PEOPLE_DATABRICKS_CLIENT_SECRET',
  'PEOPLE_DATABRICKS_API_KEY',
] as const

const jsonResponse = (body: object) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body),
})

const succeeded = (dataArray: Array<Array<string | null>>) => ({
  statement_id: 's1',
  status: { state: 'SUCCEEDED' },
  manifest: { schema: { columns: [{ name: 'count' }] } },
  result: { data_array: dataArray },
})

describe('PeopleDbxStatementClient', () => {
  const original = new Map<string, string | undefined>()
  let fetchMock: ReturnType<typeof vi.fn>
  let client: PeopleDbxStatementClient

  // Read through mock.calls rather than a side array: a test that overrides
  // the implementation with mockResolvedValue would stop feeding one.
  const callAt = (index: number) => {
    const [url, init] = fetchMock.mock.calls[index] ?? []
    return { url: String(url), init: init as RequestInit | undefined }
  }
  const callsMatching = (fragment: string) =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes(fragment))

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      original.set(key, process.env[key])
      delete process.env[key]
    }
    process.env.PEOPLE_DATABRICKS_WAREHOUSE_ID = 'wh1'
    process.env.PEOPLE_DATABRICKS_API_KEY = 'pat-token'

    fetchMock = vi.fn(() => Promise.resolve(jsonResponse(succeeded([['1']]))))
    vi.stubGlobal('fetch', fetchMock)
    client = new PeopleDbxStatementClient({
      setContext: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as never)
  })

  afterEach(() => {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    vi.unstubAllGlobals()
  })

  describe('query', () => {
    it('submits against the catalog and schema the voter data lives in', async () => {
      await client.query(stmt('SELECT 1'))

      const body: Record<string, string> = JSON.parse(
        String(callAt(0).init?.body),
      )
      expect(callAt(0).url).toBe(
        `https://${PEOPLE_DBX_HOSTNAME}/api/2.0/sql/statements`,
      )
      expect(body).toMatchObject({
        statement: 'SELECT 1',
        catalog: 'goodparty_data_catalog',
        schema: PEOPLE_DBX_SCHEMA,
        format: 'JSON_ARRAY',
        disposition: 'INLINE',
        warehouse_id: 'wh1',
      })
    })

    it('returns rows positionally with nulls preserved', async () => {
      fetchMock.mockResolvedValue(jsonResponse(succeeded([['7828', null]])))

      expect(await client.query(stmt('SELECT 1'))).toEqual({
        columns: ['count'],
        rows: [['7828', null]],
      })
    })

    it('polls a pending statement until it succeeds', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ statement_id: 's1', status: { state: 'PENDING' } }),
        )
        .mockResolvedValueOnce(
          jsonResponse({ statement_id: 's1', status: { state: 'RUNNING' } }),
        )
        .mockResolvedValueOnce(jsonResponse(succeeded([['1']])))

      const result = await client.query(stmt('SELECT 1'))

      expect(result.rows).toEqual([['1']])
      expect(callAt(1).url).toContain('/api/2.0/sql/statements/s1')
      expect(callAt(1).init?.method).toBe('GET')
    })

    it('follows the chunk chain so a large page is not silently truncated', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            statement_id: 's1',
            status: { state: 'SUCCEEDED' },
            manifest: { schema: { columns: [{ name: 'id' }] } },
            result: {
              data_array: [['a']],
              next_chunk_internal_link: '/chunks/1',
            },
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ data_array: [['b']] }))

      expect((await client.query(stmt('SELECT 1'))).rows).toEqual([
        ['a'],
        ['b'],
      ])
    })

    it('surfaces a failed statement with the warehouse error message', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          statement_id: 's1',
          status: {
            state: 'FAILED',
            error: { message: 'INSUFFICIENT_PERMISSIONS' },
          },
        }),
      )

      await expect(client.query(stmt('SELECT 1'))).rejects.toThrow(
        'Databricks statement FAILED: INSUFFICIENT_PERMISSIONS',
      )
    })

    it('surfaces an HTTP failure with its body', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('malformed statement'),
      })

      await expect(client.query(stmt('SELECT 1'))).rejects.toThrow(
        /400: malformed statement/,
      )
    })

    // The distinct error type is what lets the caller answer 504 rather than
    // 500, matching how the Postgres path classifies SQLSTATE 57014.
    it('raises a typed timeout once the ceiling passes', async () => {
      const start = Date.now()
      vi.spyOn(Date, 'now').mockImplementation(() => start)
      fetchMock.mockResolvedValue(
        jsonResponse({ statement_id: 's1', status: { state: 'RUNNING' } }),
      )

      const pending = client.query(stmt('SELECT 1'))
      vi.spyOn(Date, 'now').mockImplementation(() => start + 61_000)

      await expect(pending).rejects.toThrow(PeopleDbxTimeoutError)
    })

    // Reachable because id sets are inlined rather than bound: the contract
    // permits 100k ids per set, and the API rejects a statement over 16 MiB.
    // Measured against the real API, so the number is not a guess.
    it('refuses a statement over the API byte ceiling before sending it', async () => {
      const oversized = `SELECT ${'x'.repeat(16_777_217)}`

      await expect(client.query(stmt(oversized))).rejects.toThrow(
        PeopleDbxStatementTooLargeError,
      )
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('sends a statement that is just within the ceiling', async () => {
      const atLimit = 'S'.repeat(16_777_216)

      await client.query(stmt(atLimit))

      expect(fetchMock).toHaveBeenCalled()
    })

    it('refuses to run when no credential is configured', async () => {
      delete process.env.PEOPLE_DATABRICKS_API_KEY

      await expect(client.query(stmt('SELECT 1'))).rejects.toThrow(
        PeopleDbxUnavailableError,
      )
    })

    // An expired or under-granted token is the failure this cutover is most
    // likely to hit, and it has to be distinguishable from a query error.
    it('classifies an auth rejection as unreachable, not a query error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('token expired'),
      })

      await expect(client.query(stmt('SELECT 1'))).rejects.toThrow(
        PeopleDbxUnavailableError,
      )
    })

    it('classifies a warehouse 503 as unreachable', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve('unavailable'),
      })

      await expect(client.query(stmt('SELECT 1'))).rejects.toThrow(
        PeopleDbxUnavailableError,
      )
    })
  })

  describe('startCsvExport', () => {
    it('requests external CSV links and returns chunk zero', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          statement_id: 's1',
          status: { state: 'SUCCEEDED' },
          manifest: { total_row_count: 898598, total_chunk_count: 26 },
          result: {
            external_links: [
              {
                chunk_index: 0,
                external_link: 'https://s3/chunk0',
                next_chunk_internal_link: '/chunks/1',
              },
            ],
          },
        }),
      )

      const result = await client.startCsvExport(stmt('SELECT 1'))

      const body: Record<string, string> = JSON.parse(
        String(callAt(0).init?.body),
      )
      expect(body).toMatchObject({
        format: 'CSV',
        disposition: 'EXTERNAL_LINKS',
        wait_timeout: '0s',
      })
      expect(result).toEqual({
        statementId: 's1',
        totalRows: 898598,
        totalChunks: 26,
        firstChunk: {
          externalLink: 'https://s3/chunk0',
          nextChunkLink: '/chunks/1',
        },
      })
    })

    // A succeeded export always carries chunk 0 — even an empty result set gets
    // one holding the header row. Missing means broken, and an empty download
    // would read as a legitimate answer.
    it('throws rather than reporting an export with no first chunk', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          statement_id: 's1',
          status: { state: 'SUCCEEDED' },
          result: {},
        }),
      )

      await expect(client.startCsvExport(stmt('SELECT 1'))).rejects.toThrow(
        'returned no first chunk',
      )
    })
  })

  describe('fetchCsvChunk', () => {
    it('resolves a chunk link and the one after it', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          external_links: [
            {
              chunk_index: 1,
              external_link: 'https://s3/chunk1',
              next_chunk_internal_link: '/chunks/2',
            },
          ],
        }),
      )

      expect(await client.fetchCsvChunk('/chunks/1')).toEqual({
        externalLink: 'https://s3/chunk1',
        nextChunkLink: '/chunks/2',
      })
    })

    it('throws on a linkless chunk instead of ending the export early', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))

      await expect(client.fetchCsvChunk('/chunks/1')).rejects.toThrow(
        'returned no link',
      )
    })
  })

  describe('OAuth M2M', () => {
    beforeEach(() => {
      delete process.env.PEOPLE_DATABRICKS_API_KEY
      process.env.PEOPLE_DATABRICKS_CLIENT_ID = 'client'
      process.env.PEOPLE_DATABRICKS_CLIENT_SECRET = 'secret'
    })

    it('mints a token and reuses it across statements', async () => {
      fetchMock.mockImplementation((url: string) =>
        Promise.resolve(
          url.includes('/oidc/v1/token')
            ? jsonResponse({ access_token: 'minted', expires_in: 3600 })
            : jsonResponse(succeeded([['1']])),
        ),
      )

      await client.query(stmt('SELECT 1'))
      await client.query(stmt('SELECT 2'))

      expect(callsMatching('/oidc/v1/token')).toHaveLength(1)
      expect(callAt(0).init?.body).toBe(
        'grant_type=client_credentials&scope=all-apis',
      )
      const statementInit = callAt(1).init
      expect(
        (statementInit?.headers as Record<string, string>).Authorization,
      ).toBe('Bearer minted')
    })
  })
})
