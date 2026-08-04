import { describe, expect, it, vi } from 'vitest'
import { SqlRejected } from './districtInsights.tool'
import {
  buildDescribeConstituentDataTool,
  buildQueryConstituentDataTool,
  type ConstituentDataScope,
  validateConstituentSql,
} from './queryConstituentData.tool'
import {
  type DatabricksProvider,
  InMemoryDatabricksProvider,
} from './queryDatabricks.tool'

const TABLE = 'int__l2_nationwide_uniform_w_haystaq'
const STATE = 'NC'
const DISTRICT = 'HENDERSONVILLE'

const scope: ConstituentDataScope = {
  allowedTables: new Set([TABLE]),
  allowedDimensions: new Set(['age_band', 'gender', 'turnout_band']),
  advertisedDimensions: [
    { name: 'age_band', label: 'Age band' },
    { name: 'gender', label: 'Gender' },
  ],
  forbiddenColumns: new Set(['party', 'hs_partisan_lean', 'partisan_score']),
  mandatoryFilters: [
    { column: 'state_postal_code', value: STATE },
    { column: 'City_Council_Commissioner_District', value: DISTRICT },
  ],
}

const scopeWhere = `WHERE state_postal_code = '${STATE}'
  AND City_Council_Commissioner_District = '${DISTRICT}'`

const validate = (sql: string) => validateConstituentSql(sql, scope)

describe('validateConstituentSql — happy paths still work', () => {
  it('accepts a pure COUNT(*) scoped to the district', () => {
    expect(() =>
      validate(`SELECT COUNT(*) AS n FROM ${TABLE} ${scopeWhere}`),
    ).not.toThrow()
  })

  it('accepts APPROX_COUNT_DISTINCT without GROUP BY', () => {
    // Parses as type 'function', not 'aggr_func' — must not be rejected by the
    // base validator's no-GROUP-BY shape re-check (skipSelectShapeCheck).
    expect(() =>
      validate(
        `SELECT APPROX_COUNT_DISTINCT(turnout_band) AS d, COUNT(*) AS n
         FROM ${TABLE} ${scopeWhere}`,
      ),
    ).not.toThrow()
  })

  it('accepts a GROUP BY over an approved coarse dimension', () => {
    expect(() =>
      validate(
        `SELECT age_band, COUNT(*) AS n FROM ${TABLE} ${scopeWhere}
         GROUP BY age_band`,
      ),
    ).not.toThrow()
  })

  it('accepts AVG/SUM/MIN/MAX and APPROX_COUNT_DISTINCT aggregates', () => {
    expect(() =>
      validate(
        `SELECT gender,
                AVG(turnout_band) AS a,
                MIN(turnout_band) AS mn,
                MAX(turnout_band) AS mx,
                APPROX_COUNT_DISTINCT(turnout_band) AS d,
                COUNT(*) AS n
         FROM ${TABLE} ${scopeWhere}
         GROUP BY gender`,
      ),
    ).not.toThrow()
  })

  it('accepts an extra filter on an approved dimension (AND-combined)', () => {
    expect(() =>
      validate(
        `SELECT COUNT(*) AS n FROM ${TABLE} ${scopeWhere}
         AND age_band = '35-44'`,
      ),
    ).not.toThrow()
  })

  it('accepts conditional aggregation (SUM(CASE ...)) for buckets', () => {
    // The recommended way to bucket without a computed GROUP BY: conditional
    // sums over approved columns, no GROUP BY needed.
    expect(() =>
      validate(
        `SELECT COUNT(*) AS count,
                SUM(CASE WHEN turnout_band = 'high' THEN 1 ELSE 0 END) AS high,
                SUM(CASE WHEN gender = 'F' THEN 1 ELSE 0 END) AS women
         FROM ${TABLE} ${scopeWhere}`,
      ),
    ).not.toThrow()
  })
})

describe('select-shape guidance boundaries (observed agent failures)', () => {
  it('rejects a computed CASE expression as a GROUP BY dimension', () => {
    // Agent failure mode: bucketing via a CASE select item + GROUP BY on it.
    // Steered to conditional aggregates instead (see the accept case above).
    expect(() =>
      validate(
        `SELECT CASE WHEN age_band = '18-34' THEN 'young' ELSE 'older' END AS g,
                COUNT(*) AS count
         FROM ${TABLE} ${scopeWhere}
         GROUP BY g`,
      ),
    ).toThrow(SqlRejected)
  })

  it('rejects a query missing the FROM clause', () => {
    // Agent failure mode: omitting FROM entirely.
    expect(() =>
      validate(
        `SELECT gender, COUNT(*) AS count ${scopeWhere} GROUP BY gender`,
      ),
    ).toThrow(SqlRejected)
  })

  it('rejects arithmetic wrapping an aggregate (e.g. AVG(...) * 100)', () => {
    // Agent failure mode: computing a percentage inline. Steered to return the
    // bare aggregate (the AS-rate accept case above) and phrase the percentage.
    expect(() =>
      validate(
        `SELECT COUNT(*) AS count,
                AVG(CASE WHEN gender = 'F' THEN 1.0 ELSE 0.0 END) * 100 AS pct
         FROM ${TABLE} ${scopeWhere}`,
      ),
    ).toThrow(SqlRejected)
  })

  it('accepts the bare-aggregate share the agent is steered to use', () => {
    expect(() =>
      validate(
        `SELECT COUNT(*) AS count,
                AVG(CASE WHEN gender = 'F' THEN 1.0 ELSE 0.0 END) AS women_rate
         FROM ${TABLE} ${scopeWhere}`,
      ),
    ).not.toThrow()
  })
})

describe('bypass: row-returning query (no aggregation)', () => {
  it('rejects a bare column with no aggregate and no GROUP BY', () => {
    expect(() =>
      validate(`SELECT age_band FROM ${TABLE} ${scopeWhere}`),
    ).toThrow(SqlRejected)
  })

  it('rejects SELECT *', () => {
    expect(() => validate(`SELECT * FROM ${TABLE} ${scopeWhere}`)).toThrow(
      SqlRejected,
    )
  })

  it('rejects a non-grouped raw column smuggled beside an aggregate', () => {
    // gender is an approved dimension but is NOT in GROUP BY — selecting it
    // raw would emit a per-row value, defeating aggregate-only.
    expect(() =>
      validate(`SELECT gender, COUNT(*) AS n FROM ${TABLE} ${scopeWhere}`),
    ).toThrow(/aggregate or a GROUP BY column/i)
  })
})

describe('bypass: hard-coded different district — server predicate wins', () => {
  it('rejects a query pinned to a different district', () => {
    expect(() =>
      validate(
        `SELECT COUNT(*) AS n FROM ${TABLE}
         WHERE state_postal_code = 'CA'
           AND City_Council_Commissioner_District = 'OAKLAND'`,
      ),
    ).toThrow(SqlRejected)
  })

  it('rejects widening the scope with OR another district', () => {
    expect(() =>
      validate(
        `SELECT COUNT(*) AS n FROM ${TABLE}
         WHERE state_postal_code = '${STATE}'
           AND (City_Council_Commissioner_District = '${DISTRICT}'
                OR City_Council_Commissioner_District = 'RALEIGH')`,
      ),
    ).toThrow(/City_Council_Commissioner_District/)
  })

  it('rejects an OR-ed tautology that drops the scope', () => {
    expect(() =>
      validate(
        `SELECT COUNT(*) AS n FROM ${TABLE}
         WHERE (state_postal_code = '${STATE}'
                AND City_Council_Commissioner_District = '${DISTRICT}')
            OR 1=1`,
      ),
    ).toThrow(SqlRejected)
  })

  it('rejects when the mandatory scope is missing entirely', () => {
    expect(() => validate(`SELECT COUNT(*) AS n FROM ${TABLE}`)).toThrow(
      SqlRejected,
    )
  })
})

describe('bypass: differencing — coarse dimension allowlist', () => {
  it('rejects grouping by a fine-grained quasi-identifier (zip)', () => {
    expect(() =>
      validate(
        `SELECT zip_code, COUNT(*) AS n FROM ${TABLE} ${scopeWhere}
         GROUP BY zip_code`,
      ),
    ).toThrow(/dimension allowlist/i)
  })

  it('rejects filtering on an off-allowlist column to isolate a cell', () => {
    expect(() =>
      validate(
        `SELECT COUNT(*) AS n FROM ${TABLE} ${scopeWhere}
         AND birth_date = '1970-01-01'`,
      ),
    ).toThrow(/dimension allowlist/i)
  })

  it('rejects COUNT(DISTINCT col) enumeration', () => {
    expect(() =>
      validate(
        `SELECT COUNT(DISTINCT age_band) AS n FROM ${TABLE} ${scopeWhere}`,
      ),
    ).toThrow(/enumeration|distinct/i)
  })

  it('rejects SELECT DISTINCT enumeration', () => {
    expect(() =>
      validate(`SELECT DISTINCT age_band FROM ${TABLE} ${scopeWhere}`),
    ).toThrow(/distinct/i)
  })
})

describe('bypass: SQL-shape attacks', () => {
  it('rejects stacked statements', () => {
    expect(() =>
      validate(
        `SELECT COUNT(*) AS n FROM ${TABLE} ${scopeWhere}; DROP TABLE ${TABLE};`,
      ),
    ).toThrow(SqlRejected)
  })

  it('rejects UNION to a system table', () => {
    expect(() =>
      validate(
        `SELECT COUNT(*) AS n FROM ${TABLE} ${scopeWhere}
         UNION SELECT 1 FROM information_schema.tables`,
      ),
    ).toThrow(SqlRejected)
  })

  it('rejects a window function', () => {
    expect(() =>
      validate(
        `SELECT ROW_NUMBER() OVER (ORDER BY age_band) AS rn
         FROM ${TABLE} ${scopeWhere}`,
      ),
    ).toThrow(/window/i)
  })

  it('rejects a windowed aggregate (COUNT(*) OVER ())', () => {
    expect(() =>
      validate(`SELECT COUNT(*) OVER () AS n FROM ${TABLE} ${scopeWhere}`),
    ).toThrow(/window/i)
  })

  it('rejects a subquery against the base view in FROM', () => {
    expect(() =>
      validate(
        `SELECT COUNT(*) AS n FROM (
           SELECT age_band FROM ${TABLE} ${scopeWhere}
         ) sub`,
      ),
    ).toThrow(/subquer|union/i)
  })

  it('rejects a subquery in WHERE', () => {
    expect(() =>
      validate(
        `SELECT COUNT(*) AS n FROM ${TABLE} ${scopeWhere}
         AND age_band IN (SELECT age_band FROM ${TABLE})`,
      ),
    ).toThrow(SqlRejected)
  })

  it('rejects comment-hidden invisible tokens', () => {
    expect(() =>
      validate(`SELECT COUNT(*) AS n FROM ${TABLE} ${scopeWhere} /* ​ */`),
    ).toThrow(SqlRejected)
  })

  it('rejects a write nested in a CTE the outer SELECT reads', () => {
    const cteScope: ConstituentDataScope = {
      ...scope,
      allowedTables: new Set([TABLE, 'cte_out']),
    }
    expect(() =>
      validateConstituentSql(
        `WITH cte_out AS (
           DELETE FROM ${TABLE} ${scopeWhere} RETURNING *
         )
         SELECT COUNT(*) AS n FROM cte_out ${scopeWhere}`,
        cteScope,
      ),
    ).toThrow(SqlRejected)
  })

  it('rejects a non-allowlisted table', () => {
    expect(() =>
      validate(
        `SELECT COUNT(*) AS n FROM voters
         WHERE state_postal_code = '${STATE}'
           AND City_Council_Commissioner_District = '${DISTRICT}'`,
      ),
    ).toThrow(/table.*allow/i)
  })

  it('rejects a JOIN onto a non-allowlisted table', () => {
    expect(() =>
      validate(
        `SELECT COUNT(*) AS n FROM ${TABLE} a
         JOIN hubspot_contacts b ON a.id = b.id ${scopeWhere}`,
      ),
    ).toThrow(/table.*allow/i)
  })

  it('rejects a disallowed scalar function in the select list', () => {
    expect(() =>
      validate(
        `SELECT LOWER(age_band) AS a, COUNT(*) AS n FROM ${TABLE} ${scopeWhere}
         GROUP BY age_band`,
      ),
    ).toThrow(SqlRejected)
  })
})

describe('bypass: political party / partisan-lean column — app-side reject', () => {
  it('rejects selecting party', () => {
    expect(() =>
      validate(
        `SELECT party, COUNT(*) AS n FROM ${TABLE} ${scopeWhere}
         GROUP BY party`,
      ),
    ).toThrow(/forbidden column/i)
  })

  it('rejects grouping by party', () => {
    expect(() =>
      validate(
        `SELECT COUNT(*) AS n FROM ${TABLE} ${scopeWhere}
         GROUP BY party`,
      ),
    ).toThrow(/forbidden column/i)
  })

  it('rejects filtering on party', () => {
    expect(() =>
      validate(
        `SELECT COUNT(*) AS n FROM ${TABLE} ${scopeWhere}
         AND party = 'D'`,
      ),
    ).toThrow(/forbidden column/i)
  })

  it('rejects a modeled partisan-lean column', () => {
    expect(() =>
      validate(`SELECT AVG(hs_partisan_lean) AS a FROM ${TABLE} ${scopeWhere}`),
    ).toThrow(/forbidden column/i)
  })

  it('forbidden check beats the dimension allowlist (party in WHERE)', () => {
    // party is neither an approved dimension nor allowed; the forbidden check
    // must fire with the party-specific message, not the generic one.
    expect(() =>
      validate(
        `SELECT COUNT(*) AS n FROM ${TABLE} ${scopeWhere}
         AND partisan_score > 0.5`,
      ),
    ).toThrow(/forbidden column/i)
  })
})

describe('buildQueryConstituentDataTool — wiring + suppression', () => {
  const happySql = `SELECT age_band, COUNT(*) AS n FROM ${TABLE} ${scopeWhere}
    GROUP BY age_band`

  const fakeProvider = (
    rows: Array<Record<string, unknown>>,
  ): DatabricksProvider & { calls: string[] } => {
    const calls: string[] = []
    return {
      calls,
      query: vi.fn((sql: string) => {
        calls.push(sql)
        return Promise.resolve({ columns: ['age_band', 'n'], rows })
      }),
    }
  }

  it('validates, queries, and suppresses sub-floor cells', async () => {
    const provider = fakeProvider([
      { age_band: '25-34', n: 800 },
      { age_band: '35-44', n: 50 },
      { age_band: '45-54', n: 12 },
    ])
    const tool = buildQueryConstituentDataTool({ provider, scope })
    const out = await tool.execute({ sql: happySql })

    expect(provider.calls).toHaveLength(1)
    expect(out.rowsReturned).toBe(1)
    expect(out.rowsSuppressed).toBe(2)
    expect(out.rows).toEqual([{ age_band: '25-34', n: 800 }])
    expect(out.truncated).toBe(false)
  })

  it('fails closed when the result has no recognized count column', async () => {
    // Unrecognized count alias -> scrubResults can't enforce the cell-size
    // floor, so the tool must reject rather than return possibly-small cells.
    const provider = fakeProvider([{ age_band: '45-54', headcount: 3 }])
    const tool = buildQueryConstituentDataTool({ provider, scope })
    await expect(tool.execute({ sql: happySql })).rejects.toBeInstanceOf(
      SqlRejected,
    )
  })

  it('accepts a COUNT alias other than the default names (regression)', async () => {
    // A valid COUNT(*) the model aliased to a non-default name must NOT be
    // rejected — the floor keys off the alias read from the parsed SQL.
    const sql = `SELECT age_band, COUNT(*) AS turnout FROM ${TABLE} ${scopeWhere}
      GROUP BY age_band`
    const provider = fakeProvider([
      { age_band: '25-34', turnout: 800 },
      { age_band: '45-54', turnout: 12 },
    ])
    const tool = buildQueryConstituentDataTool({ provider, scope })
    const out = await tool.execute({ sql })
    expect(out.rowsReturned).toBe(1)
    expect(out.rowsSuppressed).toBe(1)
    expect(out.rows).toEqual([{ age_band: '25-34', turnout: 800 }])
  })

  it('never calls the provider when validation rejects the query', async () => {
    const provider = fakeProvider([])
    const tool = buildQueryConstituentDataTool({ provider, scope })
    await expect(
      tool.execute({
        sql: `SELECT party, COUNT(*) FROM ${TABLE} ${scopeWhere}`,
      }),
    ).rejects.toBeInstanceOf(SqlRejected)
    expect(provider.calls).toHaveLength(0)
  })

  it('truncates to maxRows after suppression', async () => {
    const provider = fakeProvider([
      { age_band: '25-34', n: 800 },
      { age_band: '35-44', n: 700 },
      { age_band: '45-54', n: 600 },
    ])
    const tool = buildQueryConstituentDataTool({ provider, scope })
    const out = await tool.execute({ sql: happySql, maxRows: 2 })
    expect(out.truncated).toBe(true)
    expect(out.rows).toHaveLength(2)
  })

  it('works against the mocked InMemoryDatabricksProvider', async () => {
    const normalized = happySql.toLowerCase().replace(/\s+/g, ' ').trim()
    const provider = new InMemoryDatabricksProvider(
      new Map([
        [
          normalized,
          { columns: ['age_band', 'n'], rows: [{ age_band: '25-34', n: 500 }] },
        ],
      ]),
    )
    const tool = buildQueryConstituentDataTool({ provider, scope })
    const out = await tool.execute({ sql: happySql })
    expect(out.rows).toEqual([{ age_band: '25-34', n: 500 }])
    expect(out.rowsSuppressed).toBe(0)
  })
})

describe('buildDescribeConstituentDataTool', () => {
  it('lists the table, dimensions, aggregate functions, and scope', async () => {
    const tool = buildDescribeConstituentDataTool({ scope })
    const meta = await tool.execute({})
    expect(meta.table).toBe(TABLE)
    expect(meta.dimensions.map((d) => d.name)).toContain('age_band')
    expect(meta.dimensions).toContainEqual({
      name: 'age_band',
      label: 'Age band',
    })
    // turnout_band is in allowedDimensions (validator) but NOT advertised, so
    // describe must not leak it — guards against returning the full allowlist.
    expect(meta.dimensions.map((d) => d.name)).not.toContain('turnout_band')
    expect(meta.aggregateFunctions).toContain('APPROX_COUNT_DISTINCT')
    expect(meta.districtScope).toEqual(scope.mandatoryFilters)
  })

  it('never references the warehouse provider', async () => {
    const tool = buildDescribeConstituentDataTool({ scope })
    await expect((async () => tool.execute({}))()).resolves.toBeDefined()
  })
})

describe('tool description — score semantics', () => {
  const provider = new InMemoryDatabricksProvider(new Map())

  it('states the percentile-rank basis so score averages are never read as absolute shares', () => {
    const tool = buildQueryConstituentDataTool({ provider, scope })
    expect(tool.description).toMatch(/percentile rank/i)
    expect(tool.description).toMatch(/deviation from 50/i)
    expect(tool.description).not.toContain('likelihood')
  })
})

describe('tool description — partisan guidance follows the scope', () => {
  const provider = new InMemoryDatabricksProvider(new Map())

  it('carries the hard line when partisan queries are not allowed', () => {
    const tool = buildQueryConstituentDataTool({ provider, scope })
    expect(tool.description).toContain('hard legal line')
    expect(tool.description).not.toContain('ALLOWED')
  })

  it('invites partisan breakdowns when the scope allows them', () => {
    const winScope: ConstituentDataScope = {
      ...scope,
      forbiddenColumns: new Set(['email', 'voter_id']),
      partisanQueriesAllowed: true,
    }
    const tool = buildQueryConstituentDataTool({ provider, scope: winScope })
    expect(tool.description).toContain('Parties_Description')
    expect(tool.description).not.toContain('hard legal line')
  })
})
