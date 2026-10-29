import { describe, expect, it } from 'vitest'
import {
  findPeopleCountColumns,
  findRowCountColumn,
  scrubResults,
  SqlRejected,
  validateInsightsSql,
} from './constituentSql.validator'

const ALLOWED = new Set(['int__l2_nationwide_uniform_w_haystaq'])
const DISTRICT = 'NC-HENDERSONVILLE-CITY'

const defaultOpts = {
  allowedTables: ALLOWED,
  mandatoryFilters: [{ column: 'district_id', value: DISTRICT }],
}

describe('validateInsightsSql', () => {
  describe('rejects non-SELECT statements', () => {
    it('rejects INSERT', () => {
      expect(() =>
        validateInsightsSql(
          "INSERT INTO int__l2_nationwide_uniform_w_haystaq (district_id) VALUES ('x')",
          defaultOpts,
        ),
      ).toThrow(SqlRejected)
    })

    it('rejects UPDATE', () => {
      expect(() =>
        validateInsightsSql(
          "UPDATE int__l2_nationwide_uniform_w_haystaq SET district_id = 'x'",
          defaultOpts,
        ),
      ).toThrow(SqlRejected)
    })

    it('rejects DELETE', () => {
      expect(() =>
        validateInsightsSql(
          "DELETE FROM int__l2_nationwide_uniform_w_haystaq WHERE district_id = 'x'",
          defaultOpts,
        ),
      ).toThrow(SqlRejected)
    })

    it('rejects multi-statement SQL', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT COUNT(*) FROM int__l2_nationwide_uniform_w_haystaq WHERE district_id = '${DISTRICT}'; DROP TABLE int__l2_nationwide_uniform_w_haystaq;`,
          defaultOpts,
        ),
      ).toThrow(SqlRejected)
    })

    it('rejects unparseable SQL', () => {
      expect(() => validateInsightsSql('not sql at all', defaultOpts)).toThrow(
        SqlRejected,
      )
    })
  })

  describe('rejects write nodes nested anywhere in the AST', () => {
    // Postgres allows writable CTEs: INSERT/UPDATE/DELETE wrapped inside a
    // WITH that the outer SELECT reads from. node-sql-parser parses these as
    // a single top-level SELECT — the existing `stmt.type === 'select'` check
    // is bypassed. The recursive write-node guard catches them.
    //
    // Allowlisting the CTE alias here so the ONLY reason left to reject is
    // the recursive write-node guard.
    const writeCteOpts = {
      allowedTables: new Set([
        'int__l2_nationwide_uniform_w_haystaq',
        'cte_out',
      ]),
      mandatoryFilters: [{ column: 'district_id', value: DISTRICT }],
    }

    it('rejects a SELECT whose CTE wraps DELETE', () => {
      expect(() =>
        validateInsightsSql(
          `WITH cte_out AS (
             DELETE FROM int__l2_nationwide_uniform_w_haystaq
             WHERE district_id = '${DISTRICT}'
             RETURNING *
           )
           SELECT COUNT(*) AS n FROM cte_out WHERE district_id = '${DISTRICT}'`,
          writeCteOpts,
        ),
      ).toThrow(SqlRejected)
    })

    it('rejects a SELECT whose CTE wraps INSERT', () => {
      expect(() =>
        validateInsightsSql(
          `WITH cte_out AS (
             INSERT INTO int__l2_nationwide_uniform_w_haystaq (district_id)
             VALUES ('x')
             RETURNING *
           )
           SELECT COUNT(*) AS n FROM cte_out WHERE district_id = '${DISTRICT}'`,
          writeCteOpts,
        ),
      ).toThrow(SqlRejected)
    })

    it('rejects a SELECT whose CTE wraps UPDATE', () => {
      expect(() =>
        validateInsightsSql(
          `WITH cte_out AS (
             UPDATE int__l2_nationwide_uniform_w_haystaq
             SET district_id = 'y'
             WHERE district_id = '${DISTRICT}'
             RETURNING *
           )
           SELECT COUNT(*) AS n FROM cte_out WHERE district_id = '${DISTRICT}'`,
          writeCteOpts,
        ),
      ).toThrow(SqlRejected)
    })
  })

  describe('rejects invisible / zero-width characters', () => {
    // node-sql-parser ACCEPTS invisible chars in places like comments and
    // quoted identifier aliases. Without an explicit pre-parser guard, an
    // LLM (or attacker) could craft SQL that looks correct to a human
    // reviewer (the visible string matches the contract) but smuggles
    // invisible bytes through. The INVISIBLE_CHARS guard rejects these
    // before parsing — defense-in-depth around log/audit clarity.

    it('rejects SQL with a zero-width space hidden in a /* */ comment', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT COUNT(*) AS n FROM int__l2_nationwide_uniform_w_haystaq
           WHERE district_id = '${DISTRICT}' /* ​ */`,
          defaultOpts,
        ),
      ).toThrow(SqlRejected)
    })

    it('rejects SQL with a BOM hidden in a -- line comment', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT COUNT(*) AS n FROM int__l2_nationwide_uniform_w_haystaq
           WHERE district_id = '${DISTRICT}' -- comment﻿`,
          defaultOpts,
        ),
      ).toThrow(SqlRejected)
    })

    it('rejects SQL with a zero-width space inside a quoted identifier alias', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT COUNT(*) AS "n​" FROM int__l2_nationwide_uniform_w_haystaq
           WHERE district_id = '${DISTRICT}'`,
          defaultOpts,
        ),
      ).toThrow(SqlRejected)
    })

    it('rejects SQL with a zero-width joiner hidden in a /* */ comment', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT COUNT(*) AS n FROM int__l2_nationwide_uniform_w_haystaq
           WHERE district_id = '${DISTRICT}' /* ‍ */`,
          defaultOpts,
        ),
      ).toThrow(SqlRejected)
    })

    it('rejects SQL with a word-joiner hidden in a /* */ comment', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT COUNT(*) AS n FROM int__l2_nationwide_uniform_w_haystaq
           WHERE district_id = '${DISTRICT}' /* ⁠ */`,
          defaultOpts,
        ),
      ).toThrow(SqlRejected)
    })
  })

  describe('rejects tables not in the allowlist', () => {
    it('rejects unknown table', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT COUNT(*) FROM voters WHERE district_id = '${DISTRICT}'`,
          defaultOpts,
        ),
      ).toThrow(/table.*allow/i)
    })

    it('rejects JOIN onto unknown table', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT COUNT(*) FROM int__l2_nationwide_uniform_w_haystaq a
           JOIN hubspot_contacts b ON a.email = b.email
           WHERE a.district_id = '${DISTRICT}'`,
          defaultOpts,
        ),
      ).toThrow(/table.*allow/i)
    })

    it('rejects a schema-qualified table that shares the allowlisted bare name', () => {
      // other_schema.<allowed> parses to { db: 'other_schema', table: <allowed> };
      // the qualifier must not be dropped, or it reads a same-named table in
      // another schema and escapes the curated mart.
      expect(() =>
        validateInsightsSql(
          `SELECT COUNT(*) FROM other_schema.int__l2_nationwide_uniform_w_haystaq WHERE district_id = '${DISTRICT}'`,
          defaultOpts,
        ),
      ).toThrow(/table.*allow/i)
    })

    it('rejects a three-part catalog.schema.table reference', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT COUNT(*) FROM other_catalog.other_schema.int__l2_nationwide_uniform_w_haystaq WHERE district_id = '${DISTRICT}'`,
          defaultOpts,
        ),
      ).toThrow(/table.*allow/i)
    })

    it('still allows the bare allowlisted table', () => {
      expect(
        validateInsightsSql(
          `SELECT COUNT(*) AS n FROM int__l2_nationwide_uniform_w_haystaq WHERE district_id = '${DISTRICT}'`,
          defaultOpts,
        ),
      ).toContain('int__l2_nationwide_uniform_w_haystaq')
    })
  })

  describe('enforces aggregate-only shape', () => {
    it('rejects a query without GROUP BY and without aggregate functions', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT lalvoterid FROM int__l2_nationwide_uniform_w_haystaq WHERE district_id = '${DISTRICT}'`,
          defaultOpts,
        ),
      ).toThrow(/(group by|aggregate)/i)
    })

    it('rejects SELECT * even with a WHERE filter', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT * FROM int__l2_nationwide_uniform_w_haystaq WHERE district_id = '${DISTRICT}'`,
          defaultOpts,
        ),
      ).toThrow(/(group by|aggregate)/i)
    })

    it('accepts a pure-aggregate query (COUNT(*) with no GROUP BY)', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT COUNT(*) AS n FROM int__l2_nationwide_uniform_w_haystaq WHERE district_id = '${DISTRICT}'`,
          defaultOpts,
        ),
      ).not.toThrow()
    })

    it('accepts a GROUP BY query with COUNT(*)', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT party, COUNT(*) AS n FROM int__l2_nationwide_uniform_w_haystaq
           WHERE district_id = '${DISTRICT}'
           GROUP BY party`,
          defaultOpts,
        ),
      ).not.toThrow()
    })

    it('accepts a GROUP BY query with AVG over an hs_ column', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT party, AVG(hs_regulations_too_harsh) AS avg_reg, COUNT(*) AS n
           FROM int__l2_nationwide_uniform_w_haystaq
           WHERE district_id = '${DISTRICT}'
           GROUP BY party`,
          defaultOpts,
        ),
      ).not.toThrow()
    })
  })

  describe('keeps every count of people a bare COUNT or SUM', () => {
    const TABLE = 'int__l2_nationwide_uniform_w_haystaq'
    const where = `WHERE district_id = '${DISTRICT}'`

    it.each([
      ['SUM(CASE WHEN on_uploaded_list THEN 1 ELSE 0 END) AS uploaded'],
      ['SUM(CASE WHEN has_email THEN 1 END)'],
      ["SUM(CASE WHEN gender = 'F' THEN 1.0 ELSE 0.0 END) AS women"],
      ['SUM(CASE WHEN on_uploaded_list THEN 1 ELSE NULL END) AS uploaded'],
      ['COUNT(CASE WHEN on_uploaded_list THEN 1 END) AS uploaded'],
      ['COUNT_IF(has_email) AS with_email'],
      ['TRY_SUM(CASE WHEN has_email THEN 1 ELSE 0 END) AS with_email'],
    ])('accepts %s', (item) => {
      expect(() =>
        validateInsightsSql(
          `SELECT gender, COUNT(*) AS n, ${item} FROM ${TABLE} ${where} GROUP BY gender`,
          defaultOpts,
        ),
      ).not.toThrow()
    })

    it.each([
      ['100.0 * SUM(CASE WHEN on_uploaded_list THEN 1 ELSE 0 END) AS pct'],
      ['COUNT(*) - 5 AS n2'],
      ['COUNT(*) * 1000 AS scaled'],
      ['SUM(CASE WHEN has_email THEN 1 ELSE 0 END) / COUNT(*) AS share'],
      ["CASE WHEN COUNT(*) < 100 THEN 'small' ELSE 'big' END AS size"],
      ['AVG(1) + COUNT_IF(has_email) AS sneaky'],
    ])('rejects a count inside a larger expression: %s', (item) => {
      expect(() =>
        validateInsightsSql(
          `SELECT gender, COUNT(*) AS n, ${item} FROM ${TABLE} ${where} GROUP BY gender`,
          defaultOpts,
        ),
      ).toThrow(/its own select item/)
    })

    it.each([
      ['SUM(CASE WHEN on_uploaded_list THEN 1000 ELSE 0 END) AS uploaded'],
      ['SUM(CASE WHEN on_uploaded_list THEN 2 END) AS uploaded'],
      ['SUM(CASE WHEN on_uploaded_list THEN Voters_Age END) AS ages'],
      ['SUM(Voters_Age) AS ages'],
      ['SUM(CAST(on_uploaded_list AS INT)) AS uploaded'],
      ['TRY_SUM(Voters_Age) AS ages'],
    ])('rejects a SUM that is not a count: %s', (item) => {
      expect(() =>
        validateInsightsSql(
          `SELECT gender, COUNT(*) AS n, ${item} FROM ${TABLE} ${where} GROUP BY gender`,
          defaultOpts,
        ),
      ).toThrow(/SUM may only count people/)
    })

    it('rejects a HAVING that filters on a count, which would probe a small one', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT gender, COUNT(*) AS n FROM ${TABLE} ${where}
           GROUP BY gender
           HAVING SUM(CASE WHEN on_uploaded_list THEN 1 ELSE 0 END) < 30`,
          defaultOpts,
        ),
      ).toThrow(/HAVING/)
    })
  })

  describe('enforces district scope filter', () => {
    it('rejects when WHERE clause is missing entirely', () => {
      expect(() =>
        validateInsightsSql(
          'SELECT COUNT(*) AS n FROM int__l2_nationwide_uniform_w_haystaq',
          defaultOpts,
        ),
      ).toThrow(/district/i)
    })

    it('rejects when district_id is filtered to a DIFFERENT district', () => {
      expect(() =>
        validateInsightsSql(
          "SELECT COUNT(*) AS n FROM int__l2_nationwide_uniform_w_haystaq WHERE district_id = 'CA-OAKLAND-CITY'",
          defaultOpts,
        ),
      ).toThrow(/district/i)
    })

    it('rejects when WHERE filters on something other than district_id', () => {
      expect(() =>
        validateInsightsSql(
          "SELECT COUNT(*) AS n FROM int__l2_nationwide_uniform_w_haystaq WHERE party = 'D'",
          defaultOpts,
        ),
      ).toThrow(/district/i)
    })

    it('rejects when district filter is OR-ed with another district', () => {
      // Classic SQL injection: include the user's district + sneak in another
      expect(() =>
        validateInsightsSql(
          `SELECT COUNT(*) AS n FROM int__l2_nationwide_uniform_w_haystaq
           WHERE district_id = '${DISTRICT}' OR district_id = 'CA-OAKLAND-CITY'`,
          defaultOpts,
        ),
      ).toThrow(/district/i)
    })

    it('rejects when district filter is OR-ed with a tautology like 1=1', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT COUNT(*) AS n FROM int__l2_nationwide_uniform_w_haystaq
           WHERE district_id = '${DISTRICT}' OR 1=1`,
          defaultOpts,
        ),
      ).toThrow(/district/i)
    })

    it('accepts AND-combined filters as long as district_id = userDistrict is mandatory', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT party, COUNT(*) AS n FROM int__l2_nationwide_uniform_w_haystaq
           WHERE district_id = '${DISTRICT}' AND age_band = '35-44'
           GROUP BY party`,
          defaultOpts,
        ),
      ).not.toThrow()
    })
  })

  describe('enforces multiple mandatory filters (real Haystaq shape)', () => {
    // The actual Haystaq table has no `district_id` column. It has dozens of
    // L2 typed district columns (City_Council_Commissioner_District, etc.)
    // plus a state_postal_code column. Real queries must pin BOTH state and
    // the typed district column to guarantee scoping.
    const haystaqOpts = {
      allowedTables: ALLOWED,
      mandatoryFilters: [
        { column: 'state_postal_code', value: 'NC' },
        {
          column: 'City_Council_Commissioner_District',
          value: 'HENDERSONVILLE',
        },
      ],
    }

    it('accepts a query that pins both state and L2 district column', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT AVG(hs_regulations_too_harsh) AS avg_reg, COUNT(*) AS n
           FROM int__l2_nationwide_uniform_w_haystaq
           WHERE state_postal_code = 'NC'
             AND City_Council_Commissioner_District = 'HENDERSONVILLE'`,
          haystaqOpts,
        ),
      ).not.toThrow()
    })

    it('rejects when state filter is present but L2 district column is missing', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT COUNT(*) AS n FROM int__l2_nationwide_uniform_w_haystaq
           WHERE state_postal_code = 'NC'`,
          haystaqOpts,
        ),
      ).toThrow(/City_Council_Commissioner_District/)
    })

    it('rejects when L2 district column is present but state filter is missing', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT COUNT(*) AS n FROM int__l2_nationwide_uniform_w_haystaq
           WHERE City_Council_Commissioner_District = 'HENDERSONVILLE'`,
          haystaqOpts,
        ),
      ).toThrow(/state_postal_code/)
    })

    it('rejects when state is pinned to a different state than the user', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT COUNT(*) AS n FROM int__l2_nationwide_uniform_w_haystaq
           WHERE state_postal_code = 'CA'
             AND City_Council_Commissioner_District = 'HENDERSONVILLE'`,
          haystaqOpts,
        ),
      ).toThrow(/state_postal_code/)
    })

    it('rejects when one mandatory filter is OR-broken even though the other is pinned', () => {
      expect(() =>
        validateInsightsSql(
          `SELECT COUNT(*) AS n FROM int__l2_nationwide_uniform_w_haystaq
           WHERE state_postal_code = 'NC'
             AND (City_Council_Commissioner_District = 'HENDERSONVILLE'
                  OR City_Council_Commissioner_District = 'RALEIGH')`,
          haystaqOpts,
        ),
      ).toThrow(/City_Council_Commissioner_District/)
    })
  })
})

describe('findPeopleCountColumns', () => {
  const from = `FROM t WHERE district_id = '${DISTRICT}'`

  it('names every count of people by its alias, whatever the alias', () => {
    expect(
      findPeopleCountColumns(
        `SELECT gender, COUNT(*) AS people,
                SUM(CASE WHEN on_uploaded_list THEN 1 ELSE 0 END) AS uploaded,
                COUNT_IF(has_email) AS reachable,
                APPROX_COUNT_DISTINCT(voter_key) AS approx,
                AVG(Voters_Age) AS avg_age
         ${from} GROUP BY gender`,
        ['gender', 'people', 'uploaded', 'reachable', 'approx', 'avg_age'],
      ),
    ).toEqual(['people', 'uploaded', 'reachable', 'approx'])
  })

  it('names an unaliased count by the result column at its position', () => {
    expect(
      findPeopleCountColumns(
        `SELECT COUNT(*), SUM(CASE WHEN has_email THEN 1 ELSE 0 END) ${from}`,
        ['count(1)', 'sum(CASE WHEN has_email THEN 1 ELSE 0 END)'],
      ),
    ).toEqual(['count(1)', 'sum(CASE WHEN has_email THEN 1 ELSE 0 END)'])
  })

  it('fails closed when an unaliased count has no result column to name it', () => {
    expect(() =>
      findPeopleCountColumns(
        `SELECT COUNT(*) AS n, SUM(CASE WHEN has_email THEN 1 ELSE 0 END) ${from}`,
        ['n'],
      ),
    ).toThrow(SqlRejected)
  })

  it('names nothing for an empty result, which has no columns', () => {
    expect(
      findPeopleCountColumns(
        `SELECT COUNT(*), SUM(CASE WHEN has_email THEN 1 ELSE 0 END) ${from}`,
        [],
      ),
    ).toEqual([])
  })
})

describe('findRowCountColumn', () => {
  const from = `FROM t WHERE district_id = '${DISTRICT}'`

  it('names the COUNT(*) by its alias, wherever it sits', () => {
    expect(
      findRowCountColumn(
        `SELECT gender, MAX(Voters_Age) AS count, COUNT(*) AS people ${from} GROUP BY gender`,
        ['gender', 'count', 'people'],
      ),
    ).toBe('people')
  })

  it('names an unaliased COUNT(*) by the result column at its position', () => {
    expect(
      findRowCountColumn(`SELECT gender, COUNT(*) ${from} GROUP BY gender`, [
        'gender',
        'count(1)',
      ]),
    ).toBe('count(1)')
  })

  it('names nothing for an empty result, which has no columns', () => {
    expect(findRowCountColumn(`SELECT COUNT(*) ${from}`, [])).toBeNull()
  })

  it('rejects a result where another column shares the COUNT(*) name', () => {
    expect(() =>
      findRowCountColumn(`SELECT COUNT(*), MAX(Voters_Age) AS x ${from}`, [
        'count(1)',
        'count(1)',
      ]),
    ).toThrow(SqlRejected)
  })

  it.each([
    ['no count at all', 'AVG(Voters_Age) AS count'],
    ['a COUNT of a column', 'COUNT(Voters_Age) AS n'],
    ['a COUNT(1)', 'COUNT(1) AS n'],
    ['a filtered COUNT(*)', 'COUNT(*) FILTER (WHERE Voters_Age > 90) AS n'],
    ['a SUM aliased count', 'SUM(CASE WHEN x THEN 1 ELSE 0 END) AS count'],
  ])('rejects %s', (_label, item) => {
    expect(() => findRowCountColumn(`SELECT ${item} ${from}`, ['n'])).toThrow(
      /COUNT\(\*\)/,
    )
  })
})

describe('scrubResults', () => {
  it('masks a sub-threshold count of people whatever its alias (uploaded-list repro)', () => {
    const res = scrubResults(
      [{ count: 9147, uploaded: 29, with_email: 13, avg_age: 41.2 }],
      {
        minCellSize: 100,
        rowCountColumn: 'count',
        peopleCountColumns: ['count', 'Uploaded', 'with_email'],
      },
    )
    expect(res.kept).toEqual([
      { count: 9147, uploaded: null, with_email: null, avg_age: 41.2 },
    ])
  })

  it('keeps a count of people at or above the floor', () => {
    const res = scrubResults([{ count: 9147, uploaded: 100 }], {
      minCellSize: 100,
      rowCountColumn: 'count',
      peopleCountColumns: ['uploaded'],
    })
    expect(res.kept).toEqual([{ count: 9147, uploaded: 100 }])
  })

  it('fails closed when the result has no COUNT(*) column', () => {
    expect(() =>
      scrubResults([{ people: 29, avg_age: 41.2 }], {
        minCellSize: 100,
        rowCountColumn: 'n',
        peopleCountColumns: ['people'],
      }),
    ).toThrow(SqlRejected)
    expect(() =>
      scrubResults([{ people: 29 }], {
        minCellSize: 100,
        rowCountColumn: null,
        peopleCountColumns: [],
      }),
    ).toThrow(SqlRejected)
  })

  it('keys the floor on the COUNT(*) column, never on an alias that looks like a count', () => {
    const rows = [
      { age: 101, people: 1, count: 101000 },
      { age: 40, people: 812, count: 40000 },
    ]
    expect(
      scrubResults(rows, {
        minCellSize: 100,
        rowCountColumn: 'people',
        peopleCountColumns: ['people'],
      }),
    ).toEqual({
      kept: [{ age: 40, people: 812, count: 40000 }],
      suppressed: 1,
      reason: 'cell_size',
    })
  })

  it('masks a sub-threshold unknown_count, the alias the score-semantics guidance recommends', () => {
    const res = scrubResults([{ n: 5000, unknown_count: 12 }], {
      minCellSize: 100,
      rowCountColumn: 'n',
      peopleCountColumns: ['n'],
    })
    expect(res.kept).toEqual([{ n: 5000, unknown_count: null }])
  })

  it('returns empty result with reason null when given no rows', () => {
    expect(
      scrubResults([], {
        minCellSize: 100,
        rowCountColumn: null,
        peopleCountColumns: [],
      }),
    ).toEqual({
      kept: [],
      suppressed: 0,
      reason: null,
    })
  })

  const scrub = (rows: Array<Record<string, unknown>>) =>
    scrubResults(rows, {
      minCellSize: 100,
      rowCountColumn: 'count',
      peopleCountColumns: ['count'],
    })

  it('keeps all rows unchanged when every row is above threshold', () => {
    const rows = [
      { gender: 'F', count: 500 },
      { gender: 'M', count: 300 },
    ]
    expect(scrub(rows)).toEqual({ kept: rows, suppressed: 0, reason: null })
  })

  it('drops rows below threshold and reports cell_size', () => {
    const rows = [
      { gender: 'F', count: 500 },
      { gender: 'M', count: 50 },
      { gender: 'U', count: 10 },
    ]
    expect(scrub(rows)).toEqual({
      kept: [{ gender: 'F', count: 500 }],
      suppressed: 2,
      reason: 'cell_size',
    })
  })

  it('drops all rows when all are below threshold', () => {
    const rows = [
      { gender: 'F', count: 5 },
      { gender: 'M', count: 10 },
      { gender: 'U', count: 1 },
    ]
    expect(scrub(rows)).toEqual({
      kept: [],
      suppressed: 3,
      reason: 'cell_size',
    })
  })

  it('finds the COUNT(*) column case-insensitively', () => {
    const rows = [{ gender: 'F', COUNT: 150 }]
    expect(scrub(rows)).toEqual({ kept: rows, suppressed: 0, reason: null })
  })

  it('handles BigInt count values', () => {
    const rows = [
      { gender: 'F', count: 150n },
      { gender: 'M', count: 50n },
    ]
    expect(scrub(rows)).toEqual({
      kept: [{ gender: 'F', count: 150n }],
      suppressed: 1,
      reason: 'cell_size',
    })
  })

  it('coerces string count values, dropping NaN ones', () => {
    const rows = [
      { gender: 'F', count: '150' },
      { gender: 'M', count: 'foo' },
    ]
    expect(scrub(rows)).toEqual({
      kept: [{ gender: 'F', count: '150' }],
      suppressed: 1,
      reason: 'cell_size',
    })
  })

  it('treats null count as 0 and drops the row', () => {
    const rows = [
      { gender: 'F', count: 500 },
      { gender: 'M', count: null },
    ]
    expect(scrub(rows)).toEqual({
      kept: [{ gender: 'F', count: 500 }],
      suppressed: 1,
      reason: 'cell_size',
    })
  })

  it('keeps a row whose count equals the threshold exactly', () => {
    const rows = [{ gender: 'F', count: 100 }]
    expect(scrub(rows)).toEqual({ kept: rows, suppressed: 0, reason: null })
  })

  it('masks sub-threshold secondary count columns on rows kept by the COUNT(*)', () => {
    const rows = [
      { gender: 'F', count: 150, n: 5 },
      { gender: 'M', count: 50, n: 500 },
    ]
    expect(scrub(rows)).toEqual({
      kept: [{ gender: 'F', count: 150, n: null }],
      suppressed: 1,
      reason: 'cell_size',
    })
  })
})
