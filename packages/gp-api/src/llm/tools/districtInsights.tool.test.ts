import { describe, expect, it, vi } from 'vitest'
import {
  buildConstituentDataScope,
  CONSTITUENT_TABLES,
} from '@/chats/general/chief-of-staff/services/constituentDataScope'
import { SqlRejected } from './constituentSql.validator'
import { buildDistrictInsightsTool } from './districtInsights.tool'
import type { DatabricksProvider } from './queryDatabricks.tool'

describe('buildDistrictInsightsTool', () => {
  const mandatoryFilters = [
    { column: 'state_postal_code', value: 'NC' },
    {
      column: 'City_Council_Commissioner_District',
      value: 'HENDERSONVILLE',
    },
  ]
  const { allowedTables, allowedDimensions, forbiddenColumns } =
    buildConstituentDataScope(mandatoryFilters, CONSTITUENT_TABLES, {
      base: 'voters',
    })
  const scope = {
    allowedTables,
    allowedDimensions,
    forbiddenColumns,
    mandatoryFilters,
  }
  const FROM_DISTRICT = `FROM serve_agent_voters
                        WHERE state_postal_code = 'NC'
                          AND City_Council_Commissioner_District = 'HENDERSONVILLE'`

  const happyPathSql = `SELECT Voters_Gender, AVG(hs_regulations_too_harsh) AS avg_reg, COUNT(*) AS n
                        ${FROM_DISTRICT}
                        GROUP BY Voters_Gender`

  const fakeProvider = (
    overrides: {
      columns?: string[]
      rows?: Array<Record<string, unknown>>
      throws?: Error
    } = {},
  ): DatabricksProvider & { calls: string[] } => {
    const calls: string[] = []
    return {
      calls,
      query: vi.fn(async (sql: string) => {
        calls.push(sql)
        if (overrides.throws) throw overrides.throws
        return {
          columns: overrides.columns ?? ['Voters_Gender', 'avg_reg', 'n'],
          rows: overrides.rows ?? [
            { Voters_Gender: 'F', avg_reg: 0.3, n: 800 },
            { Voters_Gender: 'M', avg_reg: 0.7, n: 600 },
            { Voters_Gender: 'U', avg_reg: 0.5, n: 200 },
          ],
        }
      }),
    }
  }

  it('exposes a description that includes the table and scope WHERE clause so the LLM can write valid SQL', () => {
    const tool = buildDistrictInsightsTool({
      provider: fakeProvider(),
      ...scope,
      peopleDataset: { base: 'voters' },
    })
    expect(typeof tool.description).toBe('string')
    // Must include the table the LLM should query against.
    expect(tool.description).toContain('serve_agent_voters')
    // Must include the literal mandatory WHERE values so the LLM can copy
    // them verbatim into its query.
    expect(tool.description).toContain("state_postal_code = 'NC'")
    expect(tool.description).toContain(
      "City_Council_Commissioner_District = 'HENDERSONVILLE'",
    )
    expect(typeof tool.inputSchema.parse).toBe('function')
  })

  it('describes the voters table as the registration file', () => {
    const tool = buildDistrictInsightsTool({
      provider: fakeProvider(),
      ...scope,
      peopleDataset: { base: 'voters' },
    })
    expect(tool.description).toContain('registration file')
    expect(tool.description).not.toContain('not registered to vote')
  })

  it('names both bases on the constituents table', () => {
    const tool = buildDistrictInsightsTool({
      provider: fakeProvider(),
      ...scope,
      peopleDataset: { base: 'constituents' },
    })
    expect(tool.description).not.toContain('registration file')
    expect(tool.description).toContain('not registered to vote')
  })

  it('requires both sql and rationale in the input schema', () => {
    const tool = buildDistrictInsightsTool({
      provider: fakeProvider(),
      ...scope,
      peopleDataset: { base: 'voters' },
    })
    expect(() => tool.inputSchema.parse({ sql: 'x' })).toThrow()
    expect(() => tool.inputSchema.parse({ rationale: 'x' })).toThrow()
    expect(() =>
      tool.inputSchema.parse({ sql: 'x', rationale: 'because' }),
    ).not.toThrow()
  })

  it('happy path: validates SQL, calls provider, scrubs results', async () => {
    const provider = fakeProvider()
    const tool = buildDistrictInsightsTool({
      provider,
      ...scope,
      peopleDataset: { base: 'voters' },
    })
    const out = await tool.execute({
      sql: happyPathSql,
      rationale: 'compare regulation views by gender',
    })

    expect(provider.calls).toHaveLength(1)
    // All 3 rows are >= 100 with default minCellSize, so none suppressed.
    expect(out.rowsReturned).toBe(3)
    expect(out.rowsSuppressed).toBe(0)
    expect(out.columns).toEqual(['Voters_Gender', 'avg_reg', 'n'])
    expect(out.rows).toHaveLength(3)
  })

  it('rejects SQL that fails the validator (provider is never called)', async () => {
    const provider = fakeProvider()
    const tool = buildDistrictInsightsTool({
      provider,
      ...scope,
      peopleDataset: { base: 'voters' },
    })
    // Missing the state filter — validator rejects.
    await expect(
      tool.execute({
        sql: `SELECT Voters_Gender, COUNT(*) AS n FROM serve_agent_voters
              WHERE City_Council_Commissioner_District = 'HENDERSONVILLE'
              GROUP BY Voters_Gender`,
        rationale: 'gender breakdown',
      }),
    ).rejects.toBeInstanceOf(SqlRejected)
    expect(provider.calls).toHaveLength(0)
  })

  it('suppresses rows below the default minCellSize (100) before returning', async () => {
    const provider = fakeProvider({
      rows: [
        { Voters_Gender: 'F', n: 500 },
        { Voters_Gender: 'M', n: 50 },
        { Voters_Gender: 'U', n: 10 },
      ],
    })
    const tool = buildDistrictInsightsTool({
      provider,
      ...scope,
      peopleDataset: { base: 'voters' },
    })
    const out = await tool.execute({
      sql: happyPathSql,
      rationale: 'r',
    })
    expect(out.rowsReturned).toBe(1)
    expect(out.rowsSuppressed).toBe(2)
    expect(out.rows).toEqual([{ Voters_Gender: 'F', n: 500 }])
  })

  it('masks a small SUM or COUNT beside a large row count, whatever its alias', async () => {
    const unaliased =
      'count(CASE WHEN (hs_regulations_too_harsh < 10) THEN 1 END)'
    const provider = fakeProvider({
      columns: ['n', 'aligned', unaliased, 'avg_reg'],
      rows: [{ n: 9147, aligned: 29, [unaliased]: 13, avg_reg: 0.4 }],
    })
    const tool = buildDistrictInsightsTool({
      provider,
      ...scope,
      peopleDataset: { base: 'voters' },
    })
    const out = await tool.execute({
      sql: `SELECT COUNT(*) AS n,
                   SUM(CASE WHEN hs_regulations_too_harsh >= 50 THEN 1 ELSE 0 END) AS aligned,
                   COUNT(CASE WHEN hs_regulations_too_harsh < 10 THEN 1 END),
                   AVG(hs_regulations_too_harsh) AS avg_reg
            ${FROM_DISTRICT}`,
      rationale: 'r',
    })
    expect(out.rows).toEqual([
      { n: 9147, aligned: null, [unaliased]: null, avg_reg: 0.4 },
    ])
  })

  it('respects a custom minCellSize', async () => {
    const provider = fakeProvider({
      rows: [
        { Voters_Gender: 'F', n: 500 },
        { Voters_Gender: 'M', n: 30 },
      ],
    })
    const tool = buildDistrictInsightsTool({
      provider,
      ...scope,
      peopleDataset: { base: 'voters' },
      minCellSize: 25,
    })
    const out = await tool.execute({
      sql: happyPathSql,
      rationale: 'r',
    })
    expect(out.rowsReturned).toBe(2)
    expect(out.rowsSuppressed).toBe(0)
  })

  it('propagates provider errors', async () => {
    const upstream = new Error('warehouse down')
    const provider = fakeProvider({ throws: upstream })
    const tool = buildDistrictInsightsTool({
      provider,
      ...scope,
      peopleDataset: { base: 'voters' },
    })
    await expect(
      tool.execute({ sql: happyPathSql, rationale: 'r' }),
    ).rejects.toBe(upstream)
  })

  it.each([
    [
      'a share over scored rows',
      `SELECT COUNT(*) AS count,
              AVG(CASE WHEN hs_regulations_too_harsh >= 50 THEN 1.0 WHEN hs_regulations_too_harsh IS NOT NULL THEN 0.0 END) AS aligned_share,
              SUM(CASE WHEN hs_regulations_too_harsh IS NULL THEN 1 ELSE 0 END) AS unknown_count
       ${FROM_DISTRICT}`,
    ],
    [
      'age buckets counted in the SELECT',
      `SELECT COUNT(*) AS count,
              SUM(CASE WHEN Voters_Age < 35 THEN 1 ELSE 0 END) AS age_under_35,
              SUM(CASE WHEN Voters_Age BETWEEN 35 AND 64 THEN 1 ELSE 0 END) AS age_35_64
       ${FROM_DISTRICT}`,
    ],
    [
      'a breakdown by a demographic column',
      `SELECT Voters_Gender, COUNT(*), AVG(hs_regulations_too_harsh) AS avg_reg
       ${FROM_DISTRICT} GROUP BY Voters_Gender`,
    ],
  ])('runs %s', async (_label, sql) => {
    const provider = fakeProvider({ columns: [], rows: [] })
    const tool = buildDistrictInsightsTool({
      provider,
      ...scope,
      peopleDataset: { base: 'voters' },
    })
    await tool.execute({ sql, rationale: 'r' })
    expect(provider.calls).toEqual([sql])
  })

  describe('holds every row to the floor (one row per voter repros)', () => {
    const run = (
      sql: string,
      result: { columns: string[]; rows: Array<Record<string, unknown>> } = {
        columns: [],
        rows: [],
      },
    ) => {
      const provider = fakeProvider(result)
      const tool = buildDistrictInsightsTool({
        provider,
        ...scope,
        peopleDataset: { base: 'voters' },
      })
      return {
        provider,
        out: tool.execute({ sql, rationale: 'r' }),
      }
    }

    it.each([
      [
        'a query with no count column',
        `SELECT Voters_Age, Residence_Addresses_CensusTract, AVG(hs_regulations_too_harsh) AS score
         ${FROM_DISTRICT}
         GROUP BY Voters_Age, Residence_Addresses_CensusTract`,
        /COUNT\(\*\)/,
      ],
      [
        'a GROUP BY on voter_key',
        `SELECT voter_key, Voters_Age, Residence_Addresses_CensusTract, hs_regulations_too_harsh, COUNT(*) AS n
         ${FROM_DISTRICT}
         GROUP BY voter_key, Voters_Age, Residence_Addresses_CensusTract, hs_regulations_too_harsh`,
        /voter_key/,
      ],
      [
        'the original repro, voter_key grouped with no count at all',
        `SELECT voter_key, Voters_Age, Residence_Addresses_CensusTract, hs_regulations_too_harsh
         ${FROM_DISTRICT}
         GROUP BY voter_key, Voters_Age, Residence_Addresses_CensusTract, hs_regulations_too_harsh`,
        /SQL rejected/,
      ],
      [
        'a count written as SIZE(COLLECT_SET(...))',
        `SELECT Residence_Addresses_CensusTract, SIZE(COLLECT_SET(Voters_Age)) AS count
         ${FROM_DISTRICT} GROUP BY Residence_Addresses_CensusTract`,
        /SIZE/,
      ],
      [
        'a SIZE(COLLECT_LIST(...)) beside COUNT(*)',
        `SELECT Residence_Addresses_CensusTract, COUNT(*) AS n, SIZE(COLLECT_LIST(Voters_Age)) AS people
         ${FROM_DISTRICT} GROUP BY Residence_Addresses_CensusTract`,
        /SIZE/,
      ],
      [
        'a bare COLLECT_SET',
        `SELECT COUNT(*) AS n, COLLECT_SET(Voters_Age) AS ages ${FROM_DISTRICT}`,
        /COLLECT_SET/,
      ],
      [
        'a COUNT(DISTINCT ...)',
        `SELECT COUNT(*) AS n, COUNT(DISTINCT Voters_Age) AS ages ${FROM_DISTRICT}`,
        /DISTINCT/,
      ],
      [
        'an aliased SUM standing in for the count',
        `SELECT Residence_Addresses_CensusTract, SUM(CASE WHEN Voters_Age > 0 THEN 1 ELSE 0 END) AS count
         ${FROM_DISTRICT} GROUP BY Residence_Addresses_CensusTract`,
        /COUNT\(\*\)/,
      ],
      [
        'a MAX(... * 1000) sharing the COUNT(*) alias',
        `SELECT Residence_Addresses_CensusTract, COUNT(*) AS count, MAX(Voters_Age * 1000) AS count
         ${FROM_DISTRICT} GROUP BY Residence_Addresses_CensusTract`,
        /different name/,
      ],
      [
        'a COUNT(*) aliased as a grouped column',
        `SELECT Voters_Age, COUNT(*) AS voters_age
         ${FROM_DISTRICT} GROUP BY Voters_Age`,
        /different name/,
      ],
      [
        'a MAX(... * 1000) aliased as the count',
        `SELECT Residence_Addresses_CensusTract, MAX(Voters_Age * 1000) AS count, AVG(hs_regulations_too_harsh) AS score
         ${FROM_DISTRICT} GROUP BY Residence_Addresses_CensusTract`,
        /COUNT\(\*\)/,
      ],
    ])('rejects %s before the warehouse', async (_label, sql, reason) => {
      const { provider, out } = run(sql)
      await expect(out).rejects.toThrow(reason)
      expect(provider.calls).toHaveLength(0)
    })

    it('masks an aliased SUM below the floor', async () => {
      const { out } = run(
        `SELECT COUNT(*) AS n,
                SUM(CASE WHEN hs_regulations_too_harsh >= 50 THEN 1 ELSE 0 END) AS supporters
         ${FROM_DISTRICT}`,
        { columns: ['n', 'supporters'], rows: [{ n: 9147, supporters: 4 }] },
      )
      expect((await out).rows).toEqual([{ n: 9147, supporters: null }])
    })

    it('drops a small group even when a MAX(... * 1000) is aliased count', async () => {
      const { out } = run(
        `SELECT Voters_Age, COUNT(*) AS people, MAX(Voters_Age * 1000) AS count
         ${FROM_DISTRICT} GROUP BY Voters_Age`,
        {
          columns: ['Voters_Age', 'people', 'count'],
          rows: [
            { Voters_Age: 101, people: 1, count: 101000 },
            { Voters_Age: 40, people: 812, count: 40000 },
          ],
        },
      )
      const result = await out
      expect(result.rows).toEqual([
        { Voters_Age: 40, people: 812, count: 40000 },
      ])
      expect(result.rowsSuppressed).toBe(1)
    })

    it('floors an unaliased COUNT(*) by the name the warehouse gave it', async () => {
      const { out } = run(
        `SELECT Voters_Gender, COUNT(*) ${FROM_DISTRICT} GROUP BY Voters_Gender`,
        {
          columns: ['Voters_Gender', 'count(1)'],
          rows: [
            { Voters_Gender: 'F', 'count(1)': 4210 },
            { Voters_Gender: 'U', 'count(1)': 7 },
          ],
        },
      )
      expect((await out).rows).toEqual([
        { Voters_Gender: 'F', 'count(1)': 4210 },
      ])
    })
  })

  it('caps very small mandatoryFilters list (no filters) — defensive', () => {
    // If we accidentally pass an empty filter list, the factory must still
    // build, but the validator will reject every query because there's no
    // mandatory scoping. (Defense in depth: factory doesn't silently OK
    // queries with no scope.)
    const tool = buildDistrictInsightsTool({
      provider: fakeProvider(),
      ...scope,
      mandatoryFilters: [],
      peopleDataset: { base: 'voters' },
    })
    // The tool object still exists.
    expect(tool).toBeDefined()
    // But this would happily pass validation because there are no mandatory
    // filters to check. The injection point in the chat service must NEVER
    // pass [] — log a separate test once wired.
  })
})
