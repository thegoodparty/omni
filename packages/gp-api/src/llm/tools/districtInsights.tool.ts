import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type { DatabricksProvider } from './queryDatabricks.tool'
import { hsScoreSemantics } from './hsScoreSemantics'
import type { PeopleDataset } from '@/peopleDb/services/peopleDataset.service'
import {
  type ConstituentSqlScope,
  findPeopleCountColumns,
  findRowCountColumn,
  type MandatoryFilter,
  scrubResults,
  validateConstituentSql,
} from './constituentSql.validator'

export interface DistrictInsightsInput {
  sql: string
  rationale: string
}

export interface DistrictInsightsOutput {
  columns: string[]
  rows: Array<Record<string, unknown>>
  rowsReturned: number
  rowsSuppressed: number
}

export interface BuildDistrictInsightsToolDeps extends ConstituentSqlScope {
  provider: DatabricksProvider
  peopleDataset: PeopleDataset
  minCellSize?: number
}

const DEFAULT_MIN_CELL_SIZE = 100

const buildDescription = (
  allowedTables: Set<string>,
  mandatoryFilters: MandatoryFilter[],
  peopleDataset: PeopleDataset,
): string => {
  const tableName = [...allowedTables][0] ?? '<table>'
  const whereClause = mandatoryFilters
    .map((f) => `${f.column} = '${f.value}'`)
    .join(' AND ')
  const rows =
    peopleDataset.base === 'constituents'
      ? 'one row per adult resident, registered to vote or not, joined with modeled scores; 200+ hs_* scored columns'
      : 'one row per constituent on the registration file, joined with modeled scores; 200+ hs_* scored columns'
  const totalsRule =
    peopleDataset.base === 'constituents'
      ? '\n  - Totals include adult residents whether or not they are registered to vote. Modeled scores (hs_*), registration status and turnout cover only residents registered to vote. When you quote a total, say which of the two it counts.'
      : ''

  return `Query aggregate constituent data for YOUR district. Use this for questions about how your constituents feel on issues, demographic composition, turnout propensity.

Table: ${tableName} (${rows})

${hsScoreSemantics('constituent', peopleDataset)}

Required WHERE clause (your district scope, copy verbatim):
  WHERE ${whereClause}

CALL list_district_topics FIRST to discover the relevant hs_* columns for the user's question — don't guess column names. The catalog covers housing, taxes, education, healthcare, climate, immigration, crime, social issues, regulation, turnout, engagement, political identity, trust, media, and demographic grouping dimensions.

REQUIREMENTS:
  - Single SELECT statement only.
  - Must include the WHERE clause above verbatim — AND-combined with any extra filters.
  - ALWAYS include COUNT(*) (e.g. COUNT(*) AS count); any alias is fine. Queries without COUNT(*) are rejected.
  - Every select item must be an aggregate (COUNT, SUM, AVG, MIN, MAX, APPROX_COUNT_DISTINCT) or a column that appears in GROUP BY. Any other function (SIZE, COLLECT_SET and the like) is rejected.
  - GROUP BY is optional; omit it for a single district-wide figure. Group only by a column BY NAME, never by an expression such as a CASE. Only the hs_* and demographic columns the catalog names can be used; identifiers such as voter_key are rejected anywhere in the query.
  - To bucket a numeric column (e.g. age ranges), count in the SELECT instead of grouping by a CASE, e.g. SUM(CASE WHEN Voters_Age < 35 THEN 1 ELSE 0 END) AS age_under_35.
  - Each COUNT or SUM must be its own select item (no arithmetic around it, none in HAVING), and SUM may only count: SUM(CASE WHEN <condition> THEN 1 ELSE 0 END).
  - No SELECT *, no DISTINCT, no window functions, no subqueries, no UNION.
  - Rows with COUNT(*) < ${DEFAULT_MIN_CELL_SIZE} are suppressed automatically, and any other COUNT or SUM below ${DEFAULT_MIN_CELL_SIZE} comes back null. A null count means fewer than ${DEFAULT_MIN_CELL_SIZE} people: say so, and never work the number out from a share, a total or another count.
  - For a share/percentage on an hs_* column, compute it over SCORED rows only, e.g. AVG(CASE WHEN <col> >= 50 THEN 1.0 WHEN <col> IS NOT NULL THEN 0.0 END) AS aligned_share (the missing ELSE keeps nulls out of the average). Do not put ELSE 0.0 in a share or divide one by COUNT(*): a null score is unknown, not zero. Report the scored count beside the share.${totalsRule}

INPUT:
  - sql: the full SELECT statement
  - rationale: one sentence explaining why this query answers the user's question

When the tool returns, surface findings to the user in PLAIN LANGUAGE — percentages and counts, not raw decimal scores. Never echo the SQL or the column names.`
}

const districtInsightsInputSchema = z.object({
  sql: z.string().min(1),
  rationale: z.string().min(1),
})

export const buildDistrictInsightsTool = (
  deps: BuildDistrictInsightsToolDeps,
): LlmStreamTool<DistrictInsightsInput, DistrictInsightsOutput> => ({
  description: buildDescription(
    deps.allowedTables,
    deps.mandatoryFilters,
    deps.peopleDataset,
  ),
  inputSchema: districtInsightsInputSchema,
  execute: async ({ sql }) => {
    const validatedSql = validateConstituentSql(sql, deps)

    const result = await deps.provider.query(validatedSql)
    const scrubbed = scrubResults(result.rows, {
      minCellSize: deps.minCellSize ?? DEFAULT_MIN_CELL_SIZE,
      rowCountColumn: findRowCountColumn(validatedSql, result.columns),
      peopleCountColumns: findPeopleCountColumns(validatedSql, result.columns),
    })

    return {
      columns: result.columns,
      rows: scrubbed.kept,
      rowsReturned: scrubbed.kept.length,
      rowsSuppressed: scrubbed.suppressed,
    }
  },
})
