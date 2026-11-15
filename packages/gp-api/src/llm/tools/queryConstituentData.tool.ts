import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import {
  ALLOWED_AGGREGATE_FUNCTIONS,
  type ConstituentSqlScope,
  findPeopleCountColumns,
  findRowCountColumn,
  type MandatoryFilter,
  scrubResults,
  validateConstituentSql,
} from './constituentSql.validator'
import { dataSourceRoutingRules } from './dataSourceRouting'
import { hsScoreSemantics } from './hsScoreSemantics'
import type { DatabricksProvider } from './queryDatabricks.tool'
import type { PeopleDataset } from '@/peopleDb/services/peopleDataset.service'
import { isRecord } from './util/isRecord.util'
import { parseSingleSelect } from './util/sqlAst.util'

const DEFAULT_MIN_CELL_SIZE = 100
const DEFAULT_MAX_ROWS = 200
const HARD_MAX_ROWS = 1000

export interface AdvertisedDimension {
  name: string
  label: string
}

export interface ConstituentDataScope extends ConstituentSqlScope {
  // The curated, human-labelled subset surfaced to the model as recommended
  // breakdowns. A usable slice of allowedDimensions so the agent isn't handed
  // hundreds of raw column names (which made it reach for useless district
  // breakdowns); the full table stays queryable via allowedDimensions.
  advertisedDimensions: AdvertisedDimension[]
  minCellSize?: number
  // Whether partisan columns (party registration, partisanship/ideology
  // scores) may be queried. Serve scopes omit this (false): elected officials
  // must not slice constituents by party, and the description carries that as
  // a hard line. The Win scope sets true: its mart retains partisan fields by
  // design for campaign targeting, so the description invites them instead.
  partisanQueriesAllowed?: boolean
  // How the model must name the people in these rows. Serve (elected
  // officials) says "constituent": they govern everyone in the district,
  // including the people who did not vote, so electorate framing is wrong for
  // that product. Win (campaigns) says "voter". The model echoes whichever
  // noun this description uses straight into its answers, so it is set here
  // rather than left to the system prompt alone.
  audienceNoun: 'constituent' | 'voter'
  // Whether advertisedDimensions carries the verified score semantics: meaning
  // labels, categorical value tokens, and the exception marks ("not centered
  // at 50", "limited coverage") that hsScoreSemantics refers to. Serve sets
  // true (labels and marks verified against serve_agent_voters, 2026-08-04).
  // Scopes that omit it (Win) keep the legacy score wording: their catalogs
  // have no marks or tokens, so the semantics block would reference entries
  // that do not exist. Give a catalog the same treatment before flipping this.
  catalogCarriesScoreMarks?: boolean
  // Which people the table holds, from PeopleDatasetService for the chat's
  // org. 'constituents' (Serve with the consumer-data flag) adds adult
  // residents who are not registered to vote, so the description names that
  // base. Win's base is always voters; it sets the dataset only for the
  // imported-contact overlay.
  peopleDataset?: PeopleDataset
  // One sentence on how L2 assigns Parties_Description in this district's
  // state when it is not a registration (peopleDb/partySource.ts), so a
  // party count is never reported as one. Scopes that omit it keep the
  // registration wording.
  partyNote?: string | null
  // The table joined to the org's imported contacts, set when the dataset
  // carries the overlay (buildConstituentDataScope). It replaces the table
  // only after the validator has accepted the SQL against the bare table.
  contactOverlayTable?: string
}

const clampMaxRows = (requested?: number): number => {
  if (requested === undefined) return DEFAULT_MAX_ROWS
  return Math.min(requested, HARD_MAX_ROWS)
}

export interface QueryConstituentDataInput {
  sql: string
  maxRows?: number
}

export interface QueryConstituentDataOutput {
  columns: string[]
  rows: Array<Record<string, unknown>>
  rowsReturned: number
  rowsSuppressed: number
  truncated: boolean
}

const queryConstituentDataInputSchema = z.object({
  sql: z.string().min(1),
  maxRows: z.number().int().positive().optional(),
})

const buildDescription = (scope: ConstituentDataScope): string => {
  const table = [...scope.allowedTables][0] ?? '<table>'
  const whereClause = scope.mandatoryFilters
    .map((f) => `${f.column} = '${f.value}'`)
    .join(' AND ')

  return `Answer AGGREGATE questions about your constituents (how many, what share, averages), optionally broken down by an approved dimension. Returns counts/sums/averages only — never a list of people.

Write ONE SELECT against this exact table — you MUST include the FROM clause:

  SELECT <approved dimension(s)>, COUNT(*) AS count, <other aggregates>
  FROM ${table}
  WHERE ${whereClause}
  GROUP BY <approved dimension(s)>

The WHERE clause is your district scope — copy it verbatim, AND-combined with any extra filters. The GROUP BY is optional; omit it for a single district-wide total.

Breakdown dimensions: call describe_constituent_data first to see the recommended dimensions and what each one means. Most are modeled issue-support scores (columns named hs_*${scope.catalogCarriesScoreMarks ? '' : ', each a 0-100 likelihood where a higher score means more aligned with the named position — report them as approximate shares/averages, never as exact head counts'}), plus age and urbanicity. Break down or filter by those. Do NOT group by a district or geography column: your district scope above already pins every row to one district, so a district breakdown just returns one meaningless row.
${scope.catalogCarriesScoreMarks ? `\n${hsScoreSemantics(scope.audienceNoun, scope.peopleDataset ?? { base: 'voters' })}\n` : ''}
RULES:
  - Single SELECT, and it MUST contain "FROM ${table}".
  - ALWAYS include COUNT(*) (e.g. COUNT(*) AS count); any alias is fine. Queries with no COUNT are rejected.
  - Every select item must be an aggregate (COUNT, SUM, AVG, MIN, MAX, APPROX_COUNT_DISTINCT) or a column that appears in GROUP BY.
  - GROUP BY only an approved dimension column BY NAME. Do NOT GROUP BY a computed expression such as a CASE — that is rejected.
  - To bucket a numeric column (e.g. age ranges) or build a custom breakdown, do NOT use CASE in GROUP BY — use conditional aggregates in the SELECT instead, e.g.:
      SUM(CASE WHEN Voters_Age < 35 THEN 1 ELSE 0 END) AS age_under_35,
      SUM(CASE WHEN Voters_Age BETWEEN 35 AND 64 THEN 1 ELSE 0 END) AS age_35_64
  - Each select item must be ONE bare aggregate — do NOT wrap an aggregate in arithmetic (no AVG(...) * 100, no SUM(a) / SUM(b)). ${scope.catalogCarriesScoreMarks ? "For a share/percentage, return the raw aggregate, e.g. AVG(CASE WHEN <col> = '<value>' THEN 1.0 WHEN <col> IS NOT NULL THEN 0.0 END) AS support_rate (a 0–1 share over SCORED rows — the missing ELSE keeps nulls out of the average), and state the percentage or ratio in your written answer. Categorical columns hold string values, never 1/0, and the tokens vary by column — filter with the exact values stated in each dimension's describe_constituent_data entry; a guessed token ('Y' vs 'Yes' vs 'true') silently matches zero rows. Null means unknown, not 'No' — count it as its own segment (see SCORE SEMANTICS) rather than folding it into the 0 side or dropping it." : "For a share/percentage, return the raw aggregate, e.g. AVG(CASE WHEN <col> = '<value>' THEN 1.0 ELSE 0.0 END) AS support_rate (a 0–1 share), and state the percentage or ratio in your written answer. Categorical flag columns hold string values (e.g. 'support', 'oppose'), not 1/0."}
  - No SELECT *, no DISTINCT, no window functions, no subqueries, no UNION.
${
  scope.partisanQueriesAllowed
    ? `  - ${scope.partyNote ? 'Party' : 'Party registration'} (Parties_Description) and modeled partisanship/ideology score columns are available and ALLOWED — breaking ${scope.audienceNoun}s down by party is a normal campaign analysis here.${scope.partyNote ? `\n  - Parties_Description is not a registration here. ${scope.partyNote} Report party counts and shares as assigned or modeled, never as registrations.` : ''}`
    : '  - Never select, filter, or group by political party or any partisan-lean column. This is a hard legal line.'
}
  - SUM may only count: SUM(CASE WHEN <condition> THEN 1 ELSE 0 END). No COUNT or SUM in HAVING.
  - Rows whose COUNT(*) is below ${scope.minCellSize ?? DEFAULT_MIN_CELL_SIZE} are dropped automatically, and any other COUNT or SUM below ${scope.minCellSize ?? DEFAULT_MIN_CELL_SIZE} comes back null. A null count means fewer than ${scope.minCellSize ?? DEFAULT_MIN_CELL_SIZE} people: say so, and never work the number out from a share, a total or another count.

Surface findings to the user in plain language — counts and percentages, not raw scores. Never echo the SQL or internal column names.

${dataSourceRoutingRules(scope.peopleDataset ?? { base: 'voters' })}`
}

export const buildQueryConstituentDataTool = (deps: {
  provider: DatabricksProvider
  scope: ConstituentDataScope
}): LlmStreamTool<QueryConstituentDataInput, QueryConstituentDataOutput> => ({
  description: buildDescription(deps.scope),
  inputSchema: queryConstituentDataInputSchema,
  execute: async ({ sql, maxRows }) => {
    const validatedSql = validateConstituentSql(sql, deps.scope)
    const limit = clampMaxRows(maxRows)

    const table = [...deps.scope.allowedTables][0]
    const overlay = deps.scope.contactOverlayTable
    const from = parseSingleSelect(validatedSql)?.stmt.from
    const aliased =
      Array.isArray(from) &&
      from.some(
        (entry: unknown) =>
          isRecord(entry) &&
          typeof entry.as === 'string' &&
          entry.as.length > 0,
      )
    const querySql =
      overlay && table
        ? validatedSql.replace(
            new RegExp(`\\bFROM\\s+\`?${table}\`?(?![\\w\`.])`, 'i'),
            () => (aliased ? `FROM ${overlay}` : `FROM ${overlay} AS ${table}`),
          )
        : validatedSql

    const result = await deps.provider.query(querySql)
    const scrubbed = scrubResults(result.rows, {
      minCellSize: deps.scope.minCellSize ?? DEFAULT_MIN_CELL_SIZE,
      rowCountColumn: findRowCountColumn(validatedSql, result.columns),
      peopleCountColumns: findPeopleCountColumns(validatedSql, result.columns),
    })
    const truncated = scrubbed.kept.length > limit
    const rows = truncated ? scrubbed.kept.slice(0, limit) : scrubbed.kept

    return {
      columns: result.columns,
      rows,
      rowsReturned: rows.length,
      rowsSuppressed: scrubbed.suppressed,
      truncated,
    }
  },
})

export interface ConstituentDataMetadata {
  table: string
  dimensions: AdvertisedDimension[]
  aggregateFunctions: string[]
  districtScope: MandatoryFilter[]
}

// Optional metadata helper: lets the agent discover the recommended breakdown
// dimensions (with human labels) and aggregate functions without guessing
// internal names. Returns the curated advertised set, not the full validator
// allowlist — handing over hundreds of raw columns is what confused the agent.
// It never touches the warehouse, so it carries no data-exposure risk.
export const buildDescribeConstituentDataTool = (deps: {
  scope: ConstituentDataScope
}): LlmStreamTool<Record<string, never>, ConstituentDataMetadata> => ({
  description:
    'List the table, recommended breakdown dimensions (with labels), and aggregate functions available to query_constituent_data. Call this before writing a query so you use valid names.\n\n' +
    dataSourceRoutingRules(deps.scope.peopleDataset ?? { base: 'voters' }),
  inputSchema: z.object({}),
  execute: () => ({
    table: [...deps.scope.allowedTables][0] ?? '',
    dimensions: deps.scope.advertisedDimensions,
    aggregateFunctions: [...ALLOWED_AGGREGATE_FUNCTIONS],
    districtScope: deps.scope.mandatoryFilters,
  }),
})
