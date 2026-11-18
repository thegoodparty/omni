import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest'
import { z } from 'zod'
import { AgentModels } from '@/agents/agentModels'
import { AGENTS } from '@/agents/agents.registry'
import { AgentsService } from '@/agents/agents.service'
import { defineAgent } from '@/agents/defineAgent'
import { ElectionsService } from '@/elections/services/elections.service'
import { AgentMessageRole } from '@/generated/prisma'
import { PeopleDbxStatementClient } from '@/peopleDb/databricks/peopleDbxStatement.client'
import { useTestService } from '@/test-service'
import type { ToolContext } from './tool'
import {
  databricksTool,
  orgDatabricksScope,
  type DatabricksScope,
} from './queryDatabricks'

const service = useTestService({ jobs: true })

const TABLE = 'goodparty_data_catalog.dbt.int__l2_nationwide_uniform_w_haystaq'
const SCOPE: DatabricksScope = { state: 'IL' }

const tool = databricksTool({
  tables: [TABLE],
  maxRows: 2,
  dimensions: ['title', 'hs_violent_crime_worried'],
  scope: async () => SCOPE,
})

const ctx = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  runId: 'run-1',
  stepKey: '0:queryDatabricks:0',
  organizationSlug: 'org',
  signal: new AbortController().signal,
  get: (type) => service.app.get(type, { strict: false }),
  ...overrides,
})

const rows = (count: number): string[][] =>
  Array.from({ length: count }, (_, i) => [`issue-${i}`, String(500 + i)])

let query: Mock<PeopleDbxStatementClient['query']>

beforeAll(() => {
  query = vi.fn<PeopleDbxStatementClient['query']>()
  vi.spyOn(
    service.app.get(PeopleDbxStatementClient),
    'query',
  ).mockImplementation((...args) => query(...args))
})

afterEach(() => {
  query.mockReset()
})

describe('queryDatabricks', () => {
  const runs = (sql: string) =>
    tool.execute({ sql }, ctx()) as Promise<Record<string, unknown>>

  it('runs one scoped aggregate SELECT and returns its columns and rows', async () => {
    query.mockResolvedValue({ columns: ['title', 'n'], rows: rows(2) })

    await expect(
      runs(
        `SELECT title, COUNT(*) AS n FROM ${TABLE}
         WHERE Residence_Addresses_State = 'IL'
         GROUP BY title LIMIT 50`,
      ),
    ).resolves.toEqual({
      ok: true,
      columns: ['title', 'n'],
      rows: rows(2),
      rowCount: 2,
      suppressed: 0,
      truncated: false,
    })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('accepts the allowlisted name however it is qualified', async () => {
    query.mockResolvedValue({ columns: ['n'], rows: [['1']] })

    for (const ref of [
      TABLE,
      'dbt.int__l2_nationwide_uniform_w_haystaq',
      '`goodparty_data_catalog`.`dbt`.`int__l2_nationwide_uniform_w_haystaq`',
    ]) {
      await expect(
        runs(
          `SELECT COUNT(*) AS n FROM ${ref} WHERE Residence_Addresses_State = 'IL'`,
        ),
      ).resolves.toMatchObject({ ok: true })
    }
    expect(query).toHaveBeenCalledTimes(3)
  })

  // The statement client pins the session to goodparty_data_catalog.mart_gp_api,
  // so a bare name resolves to the mart, not to the dbt table the manifest
  // granted. Accepting it would read a table the agent was not given.
  it('refuses a bare table name, which resolves to a different schema', async () => {
    const result = await runs(
      `SELECT COUNT(*) AS n FROM int__l2_nationwide_uniform_w_haystaq
       WHERE Residence_Addresses_State = 'IL'`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(String(result.detail)).toContain('is not an allowed table')
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a table the agent was not granted', async () => {
    const result = await runs(
      `SELECT * FROM goodparty_data_catalog.gp_api_pg.gp_api_voters
       WHERE Residence_Addresses_State = 'IL'`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(String(result.detail)).toContain('is not an allowed table')
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a spoofed catalog that shares the allowed table name', async () => {
    const result = await runs(
      `SELECT * FROM evil_catalog.public.int__l2_nationwide_uniform_w_haystaq
       WHERE Residence_Addresses_State = 'IL'`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  it.each([
    ['write', `INSERT INTO ${TABLE} VALUES ('IL')`],
    ['update', `UPDATE ${TABLE} SET title = 'x'`],
    ['delete', `DELETE FROM ${TABLE}`],
    ['DDL', 'CREATE TABLE t (a INT)'],
    ['drop', `DROP TABLE ${TABLE}`],
  ])('refuses a %s statement', async (_label, sql) => {
    const result = await runs(sql)

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses two statements even when the second is a harmless SELECT', async () => {
    const result = await runs(
      `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'; SELECT 1`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(String(result.detail)).toContain('exactly one SELECT')
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a write hidden after a block comment', async () => {
    const result = await runs(
      `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL' /* ; */
       ; DROP TABLE ${TABLE}`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a table function in place of a table', async () => {
    const result = await runs(
      `SELECT * FROM read_files('/etc/passwd') WHERE Residence_Addresses_State = 'IL'`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  // A CTE name can mean the CTE in one place and the real table in another, and
  // there is no Spark binder here to tell them apart, so a CTE is refused
  // outright rather than resolved.
  it('refuses a CTE that hides a table outside the grant', async () => {
    const result = await runs(
      `WITH stolen AS (
         SELECT * FROM goodparty_data_catalog.gp_api_pg.gp_api_voters
         WHERE Residence_Addresses_State = 'IL'
       )
       SELECT * FROM stolen`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(String(result.detail)).toContain('CTE')
    expect(query).not.toHaveBeenCalled()
  })

  // A non-recursive CTE cannot see itself, so the inner `secret` is the real
  // table; without refusing CTEs by name this read escaped the allowlist and
  // the scope check entirely.
  it('refuses a CTE that references its own name', async () => {
    const result = await runs(
      `WITH secret AS (SELECT * FROM secret) SELECT * FROM secret`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  // A reference outside its CTE's scope is the real table too, even when the
  // CTE of that name is harmless.
  it('refuses a table reference that shares a CTE name from outside its scope', async () => {
    const result = await runs(
      `SELECT * FROM (WITH secret AS (SELECT 1 AS a) SELECT a FROM secret) x
       CROSS JOIN secret`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  // mandatoryValuesForColumn drops the qualifier, so a predicate on a second
  // relation used to count as proof for the table. A derived table carrying the
  // column under the filter's name is the whole attack.
  it('refuses a filter that belongs to another relation in the FROM', async () => {
    const result = await runs(
      `SELECT t.title FROM ${TABLE} t
       JOIN (SELECT 'IL' AS Residence_Addresses_State) d ON 1 = 1
       WHERE d.Residence_Addresses_State = 'IL'`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a self-join that would satisfy the filter for one alias only', async () => {
    const result = await runs(
      `SELECT a.title FROM ${TABLE} a
       JOIN ${TABLE} b ON a.title = b.title
       WHERE a.Residence_Addresses_State = 'IL'`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  // A derived table reads nothing of its own, so it is fine — as long as it is
  // the only thing in FROM alongside the table's own SELECT. A scalar subquery
  // in the select list is not: it is neither an aggregate nor a GROUP BY column.
  it('refuses a scalar subquery in the select list', async () => {
    const result = await runs(
      `SELECT (SELECT MAX(title) FROM ${TABLE} WHERE Residence_Addresses_State = 'IL') AS m
       FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(String(result.detail)).toContain('aggregate')
    expect(query).not.toHaveBeenCalled()
  })

  // The qualifier has to be this table's own alias. A correlated subquery can
  // name the outer relation's column and look like proof while its own read of
  // the table is unfiltered.
  it('refuses a filter qualified to an alias that is not the table own', async () => {
    const result = await runs(
      `SELECT COUNT(*) AS n FROM ${TABLE}
       WHERE Residence_Addresses_State = 'IL'
         AND d.Residence_Addresses_State = 'IL'`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(String(result.detail)).toContain('on goodparty_data_catalog.dbt')
    expect(query).not.toHaveBeenCalled()
  })

  it('accepts a filter qualified to the table own alias', async () => {
    query.mockResolvedValue({ columns: ['n'], rows: [['1']] })

    await expect(
      runs(
        `SELECT COUNT(*) AS n FROM ${TABLE} t WHERE t.Residence_Addresses_State = 'IL'`,
      ),
    ).resolves.toMatchObject({ ok: true })
  })

  it('refuses a CTE whose body reads the allowed table unscoped', async () => {
    const result = await runs(
      `WITH everyone AS (SELECT title FROM ${TABLE})
       SELECT COUNT(*) AS n FROM everyone WHERE Residence_Addresses_State = 'IL'`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  // Comments are refused outright rather than reasoned about: each comment
  // dialect difference found so far fails closed, but a generated query never
  // needs one, and a comment is the one construct whose extent is a pure
  // parsing question between two different parsers.
  it.each([
    [
      'a nested block comment hiding the filter',
      `SELECT * FROM ${TABLE} WHERE /* /* */ Residence_Addresses_State = 'IL' -- */ 1=1`,
    ],
    [
      'a plain block comment',
      `SELECT * FROM ${TABLE} WHERE /* state */ Residence_Addresses_State = 'IL'`,
    ],
    [
      'a line comment',
      `SELECT * FROM ${TABLE} WHERE Residence_Addresses_State = 'IL' -- always`,
    ],
  ])('refuses %s', async (_label, sql) => {
    const result = await runs(sql)

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(String(result.detail)).toContain('no comments')
    expect(query).not.toHaveBeenCalled()
  })

  // node-sql-parser's postgres grammar and Spark do not agree on every literal
  // and FROM shape, and there is no way to prove they do. Each disagreement
  // here has to fail closed: where the two see different SQL, this must refuse
  // rather than prove a filter on a statement Spark would run differently.
  describe('parser differences fail closed', () => {
    it.each([
      // A real backslash, with a proven 'IL' filter right beside it. This
      // grammar reads the whole `a\' OR 1=1 OR \'b'` as one literal, so the
      // filter proves; Spark's own escaping may close the string there and run
      // the rest as SQL. That is the divergence the refusal exists to prevent.
      [
        'a backslash in a literal beside a proven filter',
        String.raw`SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL' AND title = 'a\' OR 1=1 OR \'b'`,
      ],
      // postgres reads a parenthesised join as one opaque FROM entry, which is
      // not a table it can allowlist, so it is refused rather than skipped.
      [
        'a parenthesised join',
        `SELECT COUNT(*) AS n FROM (${TABLE} a JOIN ${TABLE} b ON 1 = 1)
         WHERE a.Residence_Addresses_State = 'IL'`,
      ],
      // Spark accepts a fullwidth semicolon as a statement separator.
      [
        'a fullwidth semicolon and a second statement',
        `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'\uff1b DROP TABLE ${TABLE}`,
      ],
    ])('refuses %s', async (_label, sql) => {
      const result = await runs(sql)

      expect(result).toMatchObject({ ok: false, reason: 'rejected' })
      expect(query).not.toHaveBeenCalled()
    })
  })

  // Spark does not read `''` as an escaped quote the way this grammar does: it
  // reads two adjacent literals. The filter still proves (both parsers end the
  // literal in the same place), but the value Spark compares is different, so a
  // scope value containing a quote can never be matched — and one written here
  // would come back empty with no error. An org whose district name carries an
  // apostrophe gets a clear refusal instead.
  it('refuses when the scope value itself contains a quote', async () => {
    const quoted = databricksTool({
      tables: [TABLE],
      maxRows: 10,
      scope: async () => ({
        state: 'IL',
        district: { column: 'City_Ward', value: "O'Fallon Ward 1" },
      }),
    })

    const result = await quoted.execute(
      {
        sql: `SELECT COUNT(*) AS n FROM ${TABLE}
              WHERE Residence_Addresses_State = 'IL'
                AND City_Ward = 'O''Fallon Ward 1'`,
      },
      ctx(),
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(String((result as { detail: string }).detail)).toContain(
      'contains a quote',
    )
    expect(query).not.toHaveBeenCalled()
  })

  it('accepts a doubled-quote literal elsewhere in a proven query', async () => {
    query.mockResolvedValue({ columns: ['n'], rows: [['1']] })

    await expect(
      runs(
        `SELECT COUNT(*) AS n FROM ${TABLE}
         WHERE Residence_Addresses_State = 'IL' AND title = 'O''Fallon'`,
      ),
    ).resolves.toMatchObject({ ok: true })
  })

  it('refuses a UNION branch that reads the table unscoped', async () => {
    const result = await runs(
      `SELECT title FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'
       UNION ALL
       SELECT title FROM ${TABLE}`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a query with no jurisdiction filter at all', async () => {
    const result = await runs(`SELECT COUNT(*) AS n FROM ${TABLE}`)

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(String(result.detail)).toContain("Residence_Addresses_State = 'IL'")
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a filter an OR could step around', async () => {
    const result = await runs(
      `SELECT COUNT(*) AS n FROM ${TABLE}
       WHERE Residence_Addresses_State = 'IL' OR 1 = 1`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses a filter pinned to another state', async () => {
    const result = await runs(
      `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'CA'`,
    )

    expect(result).toMatchObject({ ok: false, reason: 'rejected' })
    expect(query).not.toHaveBeenCalled()
  })

  it('requires the district column too when the org has a district', async () => {
    const scoped = databricksTool({
      tables: [TABLE],
      maxRows: 10,
      scope: async () => ({
        state: 'NC',
        district: { column: 'City_Ward', value: 'FAYETTEVILLE CITY WARD 2' },
      }),
    })
    query.mockResolvedValue({ columns: ['n'], rows: [['1']] })

    const missing = await scoped.execute(
      {
        sql: `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'NC'`,
      },
      ctx(),
    )
    expect(missing).toMatchObject({ ok: false, reason: 'rejected' })
    expect(String((missing as { detail: string }).detail)).toContain(
      'City_Ward',
    )

    await expect(
      scoped.execute(
        {
          sql: `SELECT COUNT(*) AS n FROM ${TABLE}
                WHERE Residence_Addresses_State = 'NC'
                  AND \`City_Ward\` = 'FAYETTEVILLE CITY WARD 2'`,
        },
        ctx(),
      ),
    ).resolves.toMatchObject({ ok: true })
  })

  it('truncates the result at the row cap and says so', async () => {
    query.mockResolvedValue({ columns: ['title', 'n'], rows: rows(3) })

    const result = await runs(
      `SELECT title, COUNT(*) AS n FROM ${TABLE}
       WHERE Residence_Addresses_State = 'IL' GROUP BY title`,
    )

    expect(result).toMatchObject({
      ok: true,
      rows: rows(2),
      rowCount: 2,
      truncated: true,
    })
    // The warehouse does the cutting: one row past the cap is what makes
    // "there was more" observable without materializing the rest here.
    expect(query.mock.calls[0]?.[1]).toMatchObject({ rowLimit: 3 })
  })

  it('reports an exactly-full result as not truncated', async () => {
    query.mockResolvedValue({ columns: ['title', 'n'], rows: rows(2) })

    const result = await runs(
      `SELECT title, COUNT(*) AS n FROM ${TABLE}
       WHERE Residence_Addresses_State = 'IL' GROUP BY title`,
    )

    expect(result).toMatchObject({ ok: true, rowCount: 2, truncated: false })
  })

  // The constituent-data tool's shape, which the broker never enforced here: a
  // query over voter data returns aggregates, never a row per person.
  describe('aggregate-only and cell-size rules', () => {
    const counted = `SELECT title, COUNT(*) AS n FROM ${TABLE}
      WHERE Residence_Addresses_State = 'IL' GROUP BY title`

    it('refuses a row-level SELECT', async () => {
      const result = await runs(
        `SELECT title, hs_violent_crime_worried FROM ${TABLE}
         WHERE Residence_Addresses_State = 'IL'`,
      )

      expect(result).toMatchObject({ ok: false, reason: 'rejected' })
      expect(String(result.detail)).toContain('aggregate')
      expect(query).not.toHaveBeenCalled()
    })

    it('refuses LALVOTERID, selected or grouped by', async () => {
      for (const sql of [
        `SELECT LALVOTERID, COUNT(*) AS n FROM ${TABLE}
         WHERE Residence_Addresses_State = 'IL' GROUP BY LALVOTERID`,
        `SELECT COUNT(*) AS n FROM ${TABLE}
         WHERE Residence_Addresses_State = 'IL' GROUP BY LALVOTERID`,
      ]) {
        const result = await runs(sql)

        expect(result).toMatchObject({ ok: false, reason: 'rejected' })
        expect(String(result.detail)).toMatch(/lalvoterid/i)
      }
      expect(query).not.toHaveBeenCalled()
    })

    // A filter is the other way to isolate one person. The floor cannot see
    // it: `AND LALVOTERID <> 'x'` leaves both cells far above 100, and the
    // difference between the two results IS that person's score.
    it.each([
      ['an identifier equality', `AND LALVOTERID = 'abc'`],
      [
        'an identifier inequality, which shifts a whole cell',
        `AND LALVOTERID <> 'abc'`,
      ],
      ['a score range', 'AND hs_other > 63'],
    ])('refuses %s in the WHERE', async (_label, predicate) => {
      const result = await runs(
        `SELECT COUNT(*) AS n, AVG(hs_violent_crime_worried) AS avg_score
         FROM ${TABLE} WHERE Residence_Addresses_State = 'IL' ${predicate}`,
      )

      expect(result).toMatchObject({ ok: false, reason: 'rejected' })
      expect(String(result.detail)).toContain('WHERE or HAVING')
      expect(query).not.toHaveBeenCalled()
    })

    it('refuses an off-allowlist column in HAVING', async () => {
      const result = await runs(
        `SELECT title, COUNT(*) AS n FROM ${TABLE}
         WHERE Residence_Addresses_State = 'IL'
         GROUP BY title HAVING hs_other > 60`,
      )

      expect(result).toMatchObject({ ok: false, reason: 'rejected' })
      expect(query).not.toHaveBeenCalled()
    })

    // The aggregate's own argument is not a filter: it is what the aggregate is
    // for, and the floor holds its result.
    it('still accepts an aggregate over a score column', async () => {
      query.mockResolvedValue({
        columns: ['n', 'avg_score'],
        rows: [['4820', '61.4']],
      })

      await expect(
        runs(
          `SELECT COUNT(*) AS n, AVG(hs_violent_crime_worried) AS avg_score
           FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`,
        ),
      ).resolves.toMatchObject({ ok: true, rowCount: 1, suppressed: 0 })
    })

    it('refuses an aggregate query with no COUNT(*)', async () => {
      const result = await runs(
        `SELECT title, AVG(hs_violent_crime_worried) AS avg_score FROM ${TABLE}
         WHERE Residence_Addresses_State = 'IL' GROUP BY title`,
      )

      expect(result).toMatchObject({ ok: false, reason: 'rejected' })
      expect(String(result.detail)).toContain('COUNT(*)')
      expect(query).not.toHaveBeenCalled()
    })

    it('refuses COUNT(DISTINCT)', async () => {
      const result = await runs(
        `SELECT COUNT(DISTINCT title) AS n FROM ${TABLE}
         WHERE Residence_Addresses_State = 'IL'`,
      )

      expect(result).toMatchObject({ ok: false, reason: 'rejected' })
      expect(String(result.detail)).toContain('DISTINCT')
      expect(query).not.toHaveBeenCalled()
    })

    it('refuses a GROUP BY column that is not an allowed dimension', async () => {
      const result = await runs(
        `SELECT hs_other AS x, COUNT(*) AS n FROM ${TABLE}
         WHERE Residence_Addresses_State = 'IL' GROUP BY hs_other`,
      )

      expect(result).toMatchObject({ ok: false, reason: 'rejected' })
      expect(String(result.detail)).toContain('coarse dimension allowlist')
    })

    // The office's L2 district column is named per run, not in the tool's
    // options, so it has to be groupable from the scope itself.
    it('allows grouping by the run jurisdiction columns', async () => {
      const scoped = databricksTool({
        tables: [TABLE],
        maxRows: 10,
        scope: async () => ({
          state: 'NC',
          district: { column: 'City_Ward', value: 'FAYETTEVILLE CITY WARD 2' },
        }),
      })
      query.mockResolvedValue({
        columns: ['City_Ward', 'n'],
        rows: [['FAYETTEVILLE CITY WARD 2', '4820']],
      })

      await expect(
        scoped.execute(
          {
            sql: `SELECT \`City_Ward\`, COUNT(*) AS n FROM ${TABLE}
                  WHERE Residence_Addresses_State = 'NC'
                    AND \`City_Ward\` = 'FAYETTEVILLE CITY WARD 2'
                  GROUP BY \`City_Ward\``,
          },
          ctx(),
        ),
      ).resolves.toMatchObject({ ok: true, rowCount: 1 })
    })

    // A derived table is its own SELECT, and a row read there is exactly the
    // read the outer aggregate would otherwise hide.
    it.each([
      [
        'a derived table',
        `SELECT MAX(x.title) AS t, COUNT(*) AS n FROM (
           SELECT title FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'
         ) x`,
      ],
      [
        'a UNION branch',
        `${counted} UNION ALL
         SELECT title, hs_violent_crime_worried AS n FROM ${TABLE}
         WHERE Residence_Addresses_State = 'IL'`,
      ],
      [
        'a CTE',
        `WITH rows AS (
           SELECT title FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'
         )
         SELECT title, COUNT(*) AS n FROM rows GROUP BY title`,
      ],
    ])('refuses a row-level read hidden in %s', async (_label, sql) => {
      const result = await runs(sql)

      expect(result).toMatchObject({ ok: false, reason: 'rejected' })
      expect(query).not.toHaveBeenCalled()
    })

    // The lean query an agent actually writes: bare aggregates and the COUNT(*)
    // the floor reads, with the office's own filters.
    it('accepts a batched AVG and coverage COUNT with COUNT(*)', async () => {
      query.mockResolvedValue({
        columns: ['n', 'avg_crime', 'cov_crime', 'avg_transit', 'cov_transit'],
        rows: [['4820', '61.4', '4790', '48.2', '4790']],
      })

      await expect(
        runs(
          `SELECT COUNT(*) AS n,
             AVG(hs_violent_crime_worried) AS avg_crime,
             COUNT(hs_violent_crime_worried) AS cov_crime,
             AVG(hs_infrastructure_funding_fund_more) AS avg_transit,
             COUNT(hs_infrastructure_funding_fund_more) AS cov_transit
           FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`,
        ),
      ).resolves.toMatchObject({ ok: true, rowCount: 1, suppressed: 0 })
    })

    it('drops a group whose COUNT(*) is under the floor', async () => {
      query.mockResolvedValue({
        columns: ['title', 'n'],
        rows: [
          ['issue-a', '99'],
          ['issue-b', '100'],
          ['issue-c', '40'],
        ],
      })

      // `truncated` counts the raw page too: three rows came back and the cap
      // is two, so more matched even though the floor cut it to one. Reporting
      // false here would read as a complete result.
      await expect(runs(counted)).resolves.toEqual({
        ok: true,
        columns: ['title', 'n'],
        rows: [['issue-b', '100']],
        rowCount: 1,
        suppressed: 2,
        truncated: true,
      })
    })

    // The under-report the floor could cause on its own: a page cut by the
    // warehouse to the cap plus one, where the floor eats exactly that one
    // row, leaves exactly maxRows and would read as complete.
    it('reports truncation when the floor eats the row past the cap', async () => {
      query.mockResolvedValue({
        columns: ['title', 'n'],
        rows: [
          ['issue-a', '900'],
          ['issue-b', '800'],
          ['issue-c', '3'],
        ],
      })

      await expect(runs(counted)).resolves.toMatchObject({
        ok: true,
        rowCount: 2,
        suppressed: 1,
        truncated: true,
      })
    })

    it('masks a secondary count under the floor and keeps the row', async () => {
      query.mockResolvedValue({
        columns: ['title', 'n', 'cov'],
        rows: [['issue-a', '900', '12']],
      })

      await expect(
        runs(
          `SELECT title, COUNT(*) AS n, COUNT(hs_violent_crime_worried) AS cov
           FROM ${TABLE} WHERE Residence_Addresses_State = 'IL' GROUP BY title`,
        ),
      ).resolves.toMatchObject({
        ok: true,
        rows: [['issue-a', '900', null]],
        suppressed: 0,
      })
    })

    it('holds the floor at a minCellSize the agent sets', async () => {
      const strict = databricksTool({
        tables: [TABLE],
        maxRows: 10,
        dimensions: ['title'],
        minCellSize: 500,
        scope: async () => SCOPE,
      })
      query.mockResolvedValue({
        columns: ['title', 'n'],
        rows: [
          ['issue-a', '499'],
          ['issue-b', '500'],
        ],
      })

      await expect(
        strict.execute({ sql: counted }, ctx()),
      ).resolves.toMatchObject({
        ok: true,
        rows: [['issue-b', '500']],
        suppressed: 1,
      })
    })
  })

  // The people mart varies by org (PeopleDatasetService), so the grant is a
  // resolver the run answers rather than a definition-time list.
  describe('a table the run chooses', () => {
    const chosen = (tables: string[]) =>
      databricksTool({
        tables: async () => tables,
        maxRows: 10,
        scope: async () => SCOPE,
      })

    it('accepts the table the run resolved and refuses the other', async () => {
      query.mockResolvedValue({ columns: ['n'], rows: [['42']] })
      const others = 'goodparty_data_catalog.mart_gp_api.gp_api_constituents'

      await expect(
        chosen([TABLE]).execute(
          {
            sql: `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`,
          },
          ctx(),
        ),
      ).resolves.toMatchObject({ ok: true })
      await expect(
        chosen([others]).execute(
          {
            sql: `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`,
          },
          ctx(),
        ),
      ).resolves.toMatchObject({ ok: false, reason: 'rejected' })
    })

    it('names the run input for the table instead of listing one', () => {
      expect(chosen([TABLE]).description).toContain('named in your input')
    })

    it('refuses every query when the run resolved no table', async () => {
      const result = await chosen([]).execute(
        {
          sql: `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`,
        },
        ctx(),
      )

      expect(result).toMatchObject({ ok: false, reason: 'no_scope' })
      expect(query).not.toHaveBeenCalled()
    })
  })

  it('gives up at its own statement ceiling and cancels the query', async () => {
    let seen: AbortSignal | undefined
    query.mockImplementation((_statement, options) => {
      seen = options?.signal
      return new Promise(() => undefined)
    })
    const timed = databricksTool({
      tables: [TABLE],
      maxRows: 10,
      scope: async () => SCOPE,
      statementTimeoutMs: 20,
    })

    const result = await timed.execute(
      {
        sql: `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`,
      },
      ctx(),
    )

    expect(result).toMatchObject({ ok: false, reason: 'timeout' })
    expect(seen?.aborted).toBe(true)
  })

  it('reports a warehouse error back to the model briefly', async () => {
    query.mockRejectedValue(
      new Error('Databricks statement FAILED: OVERLOADED'),
    )

    const result = await runs(
      `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`,
    )

    expect(result).toEqual({
      ok: false,
      reason: 'query_failed',
      detail: 'Databricks statement FAILED: OVERLOADED',
    })
  })

  it('stops the run rather than answering when the run itself is stopping', async () => {
    const stopping = new AbortController()
    query.mockImplementation(() => {
      stopping.abort()
      return Promise.reject(new Error('aborted'))
    })

    await expect(
      tool.execute(
        {
          sql: `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`,
        },
        ctx({ signal: stopping.signal }),
      ),
    ).rejects.toThrow('aborted')
  })

  // The run can stop before the query is even sent, which is the state a deploy
  // leaves behind. An already-aborted signal never fires `abort` again, so
  // without checking first the race would wait on a statement nobody wants.
  it('stops without sending when the run stopped before the query started', async () => {
    const stopping = new AbortController()
    stopping.abort()

    await expect(
      tool.execute(
        {
          sql: `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`,
        },
        ctx({ signal: stopping.signal }),
      ),
    ).rejects.toThrow('stopped before the query ran')
    expect(query).not.toHaveBeenCalled()
  })

  // The ceiling is only useful if a statement that never settles still stops,
  // which is what this covers: the query promise is left pending forever.
  it('stops at the ceiling even when the query promise never settles', async () => {
    query.mockImplementation(() => new Promise(() => undefined))
    const timed = databricksTool({
      tables: [TABLE],
      maxRows: 10,
      scope: async () => SCOPE,
      statementTimeoutMs: 20,
    })

    await expect(
      timed.execute(
        {
          sql: `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`,
        },
        ctx(),
      ),
    ).resolves.toMatchObject({ ok: false, reason: 'timeout' })
  })

  it('answers the same way twice', async () => {
    query.mockResolvedValue({ columns: ['n'], rows: [['1']] })
    const sql = `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`

    const first = await runs(sql)
    const second = await runs(sql)

    expect(second).toEqual(first)
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('refuses every query when the org has no jurisdiction', async () => {
    const unscoped = databricksTool({
      tables: [TABLE],
      maxRows: 10,
      scope: async () => null,
    })

    await expect(
      unscoped.execute(
        {
          sql: `SELECT COUNT(*) AS n FROM ${TABLE} WHERE Residence_Addresses_State = 'IL'`,
        },
        ctx(),
      ),
    ).resolves.toMatchObject({ ok: false, reason: 'no_scope' })
    expect(query).not.toHaveBeenCalled()
  })
})

describe('orgDatabricksScope', () => {
  it("reads the run's organization jurisdiction, not tool input", async () => {
    const elections = service.app.get(ElectionsService)
    const district = vi.spyOn(elections, 'getDistrict').mockResolvedValue({
      id: 'district-1',
      state: 'NC',
      L2DistrictType: 'City_Ward',
      L2DistrictName: 'FAYETTEVILLE CITY WARD 2',
    })
    await service.prisma.organization.create({
      data: {
        slug: 'eo-dbx-scope',
        ownerId: service.user.id,
        customPositionName: 'City Council Member',
        overrideDistrictId: 'district-1',
      },
    })

    try {
      await expect(
        orgDatabricksScope(
          ctx({
            organizationSlug: 'eo-dbx-scope',
            // Nothing the model could have supplied is consulted.
            runId: 'run-1',
          }),
        ),
      ).resolves.toEqual({
        state: 'NC',
        district: {
          column: 'City_Ward',
          value: 'FAYETTEVILLE CITY WARD 2',
        },
      })
    } finally {
      district.mockRestore()
    }
  })

  it('resolves to null for an org with no jurisdiction', async () => {
    await service.prisma.organization.create({
      data: { slug: 'eo-dbx-none', ownerId: service.user.id },
    })

    await expect(
      orgDatabricksScope(ctx({ organizationSlug: 'eo-dbx-none' })),
    ).resolves.toBeNull()
  })
})

describe('queryDatabricks on a run', () => {
  const OutputSchema = z.object({ summary: z.string() })
  const testTool = databricksTool({
    tables: [TABLE],
    maxRows: 2,
    dimensions: ['title'],
    scope: async () => SCOPE,
  })

  beforeAll(() => {
    AGENTS.databricksToolAgent = defineAgent({
      input: z.object({ organizationSlug: z.string() }),
      output: OutputSchema,
      model: 'claude-sonnet-4-6',
      prompt: 'Query the data.',
      tools: { queryDatabricks: testTool },
      onArtifact: async () => undefined,
    })
  })

  afterAll(() => {
    delete AGENTS.databricksToolAgent
  })

  it('hands the model a rejection, then the rows, and saves both as tool results', async () => {
    query.mockResolvedValue({ columns: ['title', 'n'], rows: rows(3) })
    const replied = (options: LanguageModelV3CallOptions) => {
      const step = options.prompt.filter((m) => m.role === 'assistant').length
      if (step === 0) {
        return {
          type: 'tool-call' as const,
          toolCallId: 'call-bad',
          toolName: 'queryDatabricks',
          input: JSON.stringify({
            sql: `SELECT * FROM goodparty_data_catalog.gp_api_pg.gp_api_voters`,
          }),
        }
      }
      if (step === 1) {
        return {
          type: 'tool-call' as const,
          toolCallId: 'call-good',
          toolName: 'queryDatabricks',
          input: JSON.stringify({
            sql: `SELECT title, COUNT(*) AS n FROM ${TABLE}
                  WHERE Residence_Addresses_State = 'IL' GROUP BY title`,
          }),
        }
      }
      return {
        type: 'tool-call' as const,
        toolCallId: 'call-submit',
        toolName: 'submitOutput',
        input: JSON.stringify({ output: { summary: 'done' } }),
      }
    }
    vi.spyOn(service.app.get(AgentModels), 'resolve').mockReturnValue({
      model: new MockLanguageModelV3({
        doStream: async (options) => ({
          stream: simulateReadableStream<LanguageModelV3StreamPart>({
            chunks: [
              { type: 'stream-start', warnings: [] },
              replied(options),
              {
                type: 'finish',
                finishReason: { unified: 'tool-calls', raw: 'tool_use' },
                usage: {
                  inputTokens: {
                    total: 1000,
                    noCache: 1000,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: { total: 100, text: 100, reasoning: undefined },
                },
              },
            ],
          }),
        }),
      }),
      modelId: 'claude-sonnet-4-6',
      provider: 'anthropic',
    })
    await service.prisma.organization.create({
      data: { slug: 'eo-dbx-run', ownerId: service.user.id },
    })

    const { runId } = await service.app
      .get(AgentsService)
      .run('databricksToolAgent', { organizationSlug: 'eo-dbx-run' })
    await service.jobs.settle()

    const toolRows = await service.prisma.agentMessage.findMany({
      where: { agentRunId: runId, role: AgentMessageRole.tool },
      orderBy: { index: 'asc' },
      select: { parts: true },
    })
    const results = toolRows.map((row) => row.parts)
    expect(results[0]).toEqual([
      expect.objectContaining({
        toolName: 'queryDatabricks',
        output: expect.objectContaining({
          type: 'json',
          value: expect.objectContaining({ ok: false, reason: 'rejected' }),
        }),
      }),
    ])
    expect(results[1]).toEqual([
      expect.objectContaining({
        toolName: 'queryDatabricks',
        output: expect.objectContaining({
          type: 'json',
          value: expect.objectContaining({
            ok: true,
            rowCount: 2,
            truncated: true,
          }),
        }),
      }),
    ])
  })
})
