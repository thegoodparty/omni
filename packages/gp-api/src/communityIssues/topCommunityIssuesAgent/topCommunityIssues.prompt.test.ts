import { describe, expect, it } from 'vitest'
import { databricksTool } from '@/agents/tools/queryDatabricks'
import type { ToolContext } from '@/agents/tools/tool'
import { TOP_COMMUNITY_ISSUES_PROMPT } from './topCommunityIssues.prompt'

const VOTERS = 'goodparty_data_catalog.mart_gp_api.gp_api_voters'
const JURISDICTION_COLUMNS = new Set(['Residence_Addresses_State', 'Active'])

// The tool exactly as the agent builds it, so this is the real guard.
const tool = (
  state: string,
  district: { column: string; value: string } | null,
) =>
  databricksTool({
    tables: [VOTERS],
    maxRows: 50_000,
    dimensions: ['Active'],
    minCellSize: 100,
    scope: async () => ({ state, district }),
  })

// A refusal and a pass both return from the guard before any provider is
// resolved, so a probe context that throws on `get` is enough: a query that
// reached the warehouse would come back `query_failed` instead of `rejected`.
const ctx: ToolContext = {
  runId: 'run-1',
  stepKey: '0:queryDatabricks:0',
  organizationSlug: 'org',
  signal: new AbortController().signal,
  get: () => {
    throw new Error('the guard probe resolves no providers')
  },
}

const predicates = (sql: string): Array<[string, string]> => {
  const where = sql.split(/\bWHERE\b/)[1] ?? ''
  return [...where.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*'([^']*)'/g)].map(
    (match) => [match[1]!, match[2]!],
  )
}

// The column a query filters on beyond the jurisdiction ones — the paired
// district column, when the example shows one.
const districtOf = (
  where: Array<[string, string]>,
): { column: string; value: string } | null => {
  const pair = where.find(([column]) => !JURISDICTION_COLUMNS.has(column))
  return pair ? { column: pair[0], value: pair[1] } : null
}

// Every SQL example in the prompt is what the model copies. A sample the guard
// refuses for the run it is filed under is one rejection per run: on
// 2026-11-21 every a4-dropped_hint run wrote Step 4's district clause verbatim
// onto a run whose input carried no L2 pair, and each was refused before it
// reached the warehouse.
describe('top_community_issues prompt', () => {
  const examples = [
    ...TOP_COMMUNITY_ISSUES_PROMPT.matchAll(/```sql\n([\s\S]*?)```/g),
  ].map((match) => match[1]!)

  it('shows a Step 4 example for a run with the L2 pair, and one without', () => {
    const withDistrict = examples.filter(
      (sql) => districtOf(predicates(sql)) !== null,
    )
    expect(withDistrict.length).toBeGreaterThan(0)
    expect(examples.length - withDistrict.length).toBeGreaterThan(0)
  })

  // The example a run without the L2 pair copies must filter on nothing but the
  // two jurisdiction columns, or the model writes its district clause for it.
  it('shows a no-L2-pair example with no district predicate', () => {
    const without = examples.filter(
      (sql) => districtOf(predicates(sql)) === null,
    )
    expect(without.length).toBeGreaterThan(0)
    for (const sql of without) {
      const columns = predicates(sql).map(([column]) => column)
      expect(new Set(columns)).toEqual(JURISDICTION_COLUMNS)
    }
  })

  it('passes the guard for every example, scoped as that example shows', async () => {
    for (const sql of examples) {
      const where = predicates(sql)
      const state = where.find(
        ([column]) => column === 'Residence_Addresses_State',
      )?.[1]

      const result = (await tool(state ?? 'NC', districtOf(where)).execute(
        { sql },
        ctx,
      )) as { ok: boolean; reason?: string }

      expect(result.reason).not.toBe('rejected')
    }
  })

  it('never builds a district predicate out of districtDescriptor', () => {
    expect(TOP_COMMUNITY_ISSUES_PROMPT).toMatch(
      /`districtDescriptor` is a seat description/,
    )
  })
})
