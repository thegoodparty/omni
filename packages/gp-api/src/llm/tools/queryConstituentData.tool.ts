import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import {
  type MandatoryFilter,
  scrubResults,
  SqlRejected,
  validateInsightsSql,
} from './districtInsights.tool'
import { HS_SCORE_SEMANTICS } from './hsScoreSemantics'
import type { DatabricksProvider } from './queryDatabricks.tool'
import { isRecord } from './util/isRecord.util'
import { parseSingleSelect } from './util/sqlAst.util'

// Amplitude feature flag gating the constituent-data tool. Slice 6a ships it
// DISABLED: the flag does not exist in Amplitude, so isFeatureEnabled returns
// false and the CoS scope handler must not register the tool. It is enabled
// only in slice 6b, after the scoped Databricks credential is validated in
// dev/qa. NEVER enable this before that credential exists.
export const CONSTITUENT_DATA_TOOL_FLAG = 'cos-constituent-data-tool'

// Aggregate functions the agent may use. Anything outside this set (including
// scalar functions and window functions) is rejected so a SELECT item can only
// ever be an aggregate or a GROUP BY dimension — never a row-level value.
const ALLOWED_AGGREGATE_FUNCTIONS = new Set([
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'APPROX_COUNT_DISTINCT',
])

const DEFAULT_MIN_CELL_SIZE = 100
const DEFAULT_MAX_ROWS = 200
const HARD_MAX_ROWS = 1000

export interface AdvertisedDimension {
  name: string
  label: string
}

export interface ConstituentDataScope {
  allowedTables: Set<string>
  // Coarse dimensions the agent may reference anywhere (SELECT/GROUP BY/WHERE).
  // The real anti-differencing control: fine-grained quasi-identifiers are not
  // listed, so they can't be sliced. Mandatory-filter columns are implicitly
  // allowed (they're server-bound), but listing them here is harmless. This is
  // the validator allowlist (can be the whole approved table); it is NOT the
  // menu shown to the model — see advertisedDimensions.
  allowedDimensions: Set<string>
  // The curated, human-labelled subset surfaced to the model as recommended
  // breakdowns. A usable slice of allowedDimensions so the agent isn't handed
  // hundreds of raw column names (which made it reach for useless district
  // breakdowns); the full table stays queryable via allowedDimensions.
  advertisedDimensions: AdvertisedDimension[]
  // Columns that must never appear anywhere. App-side defensive backstop for the
  // hard "no political party / partisan-lean" line; in 6b the credential also
  // denies these at the warehouse.
  forbiddenColumns: Set<string>
  // Server-bound district predicate. Built from
  // DistrictResolverService.resolveByUserId — NEVER from agent input.
  mandatoryFilters: MandatoryFilter[]
  minCellSize?: number
  // Whether partisan columns (party registration, partisanship/ideology
  // scores) may be queried. Serve scopes omit this (false): elected officials
  // must not slice constituents by party, and the description carries that as
  // a hard line. The Win scope sets true: its mart retains partisan fields by
  // design for campaign targeting, so the description invites them instead.
  partisanQueriesAllowed?: boolean
  // Whether advertisedDimensions carries the verified score semantics: meaning
  // labels, categorical value tokens, and the exception marks ("not centered
  // at 50", "limited coverage") that HS_SCORE_SEMANTICS refers to. Serve sets
  // true (labels and marks verified against serve_agent_voters, 2026-08-04).
  // Scopes that omit it (Win) keep the legacy score wording: their catalogs
  // have no marks or tokens, so the semantics block would reference entries
  // that do not exist. Give a catalog the same treatment before flipping this.
  catalogCarriesScoreMarks?: boolean
}

const normalizeColumn = (name: string): string => name.toLowerCase()

const collectColumnNode = (node: unknown): string | null => {
  if (!isRecord(node)) return null
  if (node.type !== 'column_ref') return null
  const col = node.column
  if (typeof col === 'string') return col
  if (isRecord(col) && isRecord(col.expr)) {
    const ex = col.expr
    if (typeof ex.value === 'string') return ex.value
  }
  return null
}

// Every column_ref referenced ANYWHERE in the statement (select list, where,
// group by, having, order by). Used for both the dimension allowlist and the
// forbidden-column check, so a party column can't hide in any clause.
const collectAllColumns = (node: unknown, acc: Set<string>): void => {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    for (const item of node) collectAllColumns(item, acc)
    return
  }
  if (!isRecord(node)) return
  const colName = collectColumnNode(node)
  if (colName !== null) acc.add(colName)
  for (const key of Object.keys(node)) {
    collectAllColumns(node[key], acc)
  }
}

const aggregateFunctionName = (
  expr: Record<string, unknown>,
): string | null => {
  if (expr.type === 'aggr_func' && typeof expr.name === 'string') {
    return expr.name.toUpperCase()
  }
  // APPROX_COUNT_DISTINCT and friends parse as a generic function node whose
  // name is { name: [{ value: 'FN' }] }.
  if (expr.type === 'function' && isRecord(expr.name)) {
    const nameParts: unknown = expr.name.name
    if (Array.isArray(nameParts) && nameParts.length > 0) {
      const last: unknown = nameParts[nameParts.length - 1]
      if (isRecord(last) && typeof last.value === 'string') {
        return last.value.toUpperCase()
      }
    }
  }
  return null
}

const isWindowed = (expr: Record<string, unknown>): boolean =>
  expr.over !== null && expr.over !== undefined

// COUNT(DISTINCT col) etc. — DISTINCT inside an aggregate is enumeration over
// distinct values, a differencing vector. Reject it.
const aggregateHasDistinct = (expr: Record<string, unknown>): boolean => {
  const args = expr.args
  return isRecord(args) && args.distinct !== null && args.distinct !== undefined
}

// True when any node anywhere is a window function or carries an OVER clause.
const containsWindowNode = (node: unknown): boolean => {
  if (node === null || node === undefined) return false
  if (Array.isArray(node)) return node.some(containsWindowNode)
  if (!isRecord(node)) return false
  if (node.type === 'window_func') return true
  if (
    (node.type === 'aggr_func' || node.type === 'function') &&
    isWindowed(node)
  ) {
    return true
  }
  for (const key of Object.keys(node)) {
    if (containsWindowNode(node[key])) return true
  }
  return false
}

// A subquery (derived table / IN-subquery / scalar subquery) shows up as a
// nested `ast` select node, or as a UNION via `_next` / `set_op`. Reject all of
// them: a subquery against a base view re-opens row-level access and defeats the
// aggregate-only and scoping guarantees.
const containsNestedSelect = (node: unknown, isRoot: boolean): boolean => {
  if (node === null || node === undefined) return false
  if (Array.isArray(node)) {
    return node.some((item) => containsNestedSelect(item, false))
  }
  if (!isRecord(node)) return false
  if (!isRoot && node.type === 'select') return true
  if (node._next !== null && node._next !== undefined) return true
  for (const key of Object.keys(node)) {
    if (key === '_next') continue
    if (containsNestedSelect(node[key], false)) return true
  }
  return false
}

const groupByColumns = (groupby: unknown): Set<string> => {
  const cols = new Set<string>()
  if (!isRecord(groupby)) return cols
  const list = groupby.columns
  if (!Array.isArray(list)) return cols
  for (const item of list) {
    const name = collectColumnNode(item)
    if (name !== null) cols.add(normalizeColumn(name))
  }
  return cols
}

const NOT_AGGREGATE_OR_GROUP =
  'select items must be an allowlisted aggregate or a GROUP BY column'

const assertAllowedAggregate = (
  expr: Record<string, unknown>,
  aggName: string,
): void => {
  if (isWindowed(expr)) {
    throw new SqlRejected('window functions are not allowed')
  }
  if (aggregateHasDistinct(expr)) {
    throw new SqlRejected(
      'DISTINCT inside an aggregate is not allowed (enumeration)',
    )
  }
  if (!ALLOWED_AGGREGATE_FUNCTIONS.has(aggName)) {
    throw new SqlRejected(`aggregate function not allowed: ${aggName}`)
  }
}

const assertSelectItem = (
  expr: Record<string, unknown>,
  groupBy: Set<string>,
): void => {
  if (expr.type === 'star' || expr.column === '*') {
    throw new SqlRejected('SELECT * is not allowed; aggregate-only')
  }
  if (expr.type === 'number' || expr.type === 'string') return

  const aggName = aggregateFunctionName(expr)
  if (aggName !== null) {
    assertAllowedAggregate(expr, aggName)
    return
  }

  const name = expr.type === 'column_ref' ? collectColumnNode(expr) : null
  if (name !== null && groupBy.has(normalizeColumn(name))) return

  throw new SqlRejected(NOT_AGGREGATE_OR_GROUP)
}

// Every SELECT-list item must be an allowlisted aggregate (no window, no
// DISTINCT) or a literal, OR a bare column that is in GROUP BY. Anything else —
// SELECT *, a raw column not grouped, a scalar function, a disallowed aggregate
// — is a potential row-level / enumeration leak and is rejected.
const validateSelectList = (columns: unknown, groupBy: Set<string>): void => {
  if (!Array.isArray(columns)) {
    throw new SqlRejected('unparseable select list')
  }
  for (const col of columns) {
    if (!isRecord(col)) {
      throw new SqlRejected('unparseable select item')
    }
    const expr = col.expr
    if (!isRecord(expr)) {
      throw new SqlRejected('unparseable select expression')
    }
    assertSelectItem(expr, groupBy)
  }
}

export const validateConstituentSql = (
  sql: string,
  scope: ConstituentDataScope,
): string => {
  // Structural shape checks run FIRST so their specific rejection reason wins
  // over the base validator's coarser GROUP-BY / mandatory-filter messages for
  // the same query. parseSingleSelect also covers invisible chars (via the
  // base validator below) but here gives us the AST to inspect.
  const parsed = parseSingleSelect(sql)
  if (!parsed) {
    throw new SqlRejected('only a single SELECT statement is allowed')
  }
  const stmt = parsed.stmt

  const distinct = stmt.distinct
  if (isRecord(distinct) && distinct.type === 'DISTINCT') {
    throw new SqlRejected('SELECT DISTINCT is not allowed (enumeration)')
  }

  if (containsWindowNode(stmt)) {
    throw new SqlRejected('window functions are not allowed')
  }

  if (containsNestedSelect(stmt, true)) {
    throw new SqlRejected(
      'subqueries / UNION against base views are not allowed',
    )
  }

  const groupBy = groupByColumns(stmt.groupby)
  validateSelectList(stmt.columns, groupBy)

  // Base guards (after the shape checks): invisible chars, single SELECT,
  // write-node recursion, table allowlist, GROUP-BY-or-aggregate shape, and the
  // server-bound mandatory district filters (OR-safe).
  validateInsightsSql(sql, {
    allowedTables: scope.allowedTables,
    mandatoryFilters: scope.mandatoryFilters,
    // validateSelectList above already enforced the (richer) aggregate-only
    // shape, including APPROX_COUNT_DISTINCT; skip the base check's coarser
    // re-validation, which rejects APPROX_COUNT_DISTINCT in a no-GROUP-BY query.
    skipSelectShapeCheck: true,
  })

  const referencedColumns = new Set<string>()
  collectAllColumns(stmt, referencedColumns)

  const forbidden = new Set([...scope.forbiddenColumns].map(normalizeColumn))
  const allowedDims = new Set([...scope.allowedDimensions].map(normalizeColumn))
  const mandatoryCols = new Set(
    scope.mandatoryFilters.map((f) => normalizeColumn(f.column)),
  )

  for (const raw of referencedColumns) {
    const col = normalizeColumn(raw)
    if (forbidden.has(col)) {
      throw new SqlRejected(`forbidden column referenced: ${raw}`)
    }
    // Mandatory (server-bound) columns are always permitted; otherwise every
    // referenced column must be an approved coarse dimension.
    if (mandatoryCols.has(col)) continue
    if (!allowedDims.has(col)) {
      throw new SqlRejected(`column not in coarse dimension allowlist: ${raw}`)
    }
  }

  return sql
}

// The cell-size floor keys off the row-count column. Rather than guess its name
// from a fixed alias list (which rejects a perfectly valid COUNT(*) the model
// happened to alias differently), read the COUNT aggregate's alias straight off
// the parsed SELECT. Returns the alias when the COUNT is aliased, else null
// (an unaliased COUNT(*) lands on Spark's default `count(1)` name, handled by
// the caller's fallback).
export const findCountAlias = (sql: string): string | null => {
  const parsed = parseSingleSelect(sql)
  if (!parsed) return null
  const columns = parsed.stmt.columns
  if (!Array.isArray(columns)) return null
  for (const col of columns) {
    if (!isRecord(col)) continue
    const expr = col.expr
    if (isRecord(expr) && aggregateFunctionName(expr) === 'COUNT') {
      return typeof col.as === 'string' && col.as.length > 0 ? col.as : null
    }
  }
  return null
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
${scope.catalogCarriesScoreMarks ? `\n${HS_SCORE_SEMANTICS}\n` : ''}
RULES:
  - Single SELECT, and it MUST contain "FROM ${table}".
  - ALWAYS include COUNT(*) (e.g. COUNT(*) AS count); any alias is fine. Queries with no COUNT are rejected.
  - Every select item must be an aggregate (COUNT, SUM, AVG, MIN, MAX, APPROX_COUNT_DISTINCT) or a column that appears in GROUP BY.
  - GROUP BY only an approved dimension column BY NAME. Do NOT GROUP BY a computed expression such as a CASE — that is rejected.
  - To bucket a numeric column (e.g. age ranges) or build a custom breakdown, do NOT use CASE in GROUP BY — use conditional aggregates in the SELECT instead, e.g.:
      SUM(CASE WHEN Voters_Age < 35 THEN 1 ELSE 0 END) AS age_under_35,
      SUM(CASE WHEN Voters_Age BETWEEN 35 AND 64 THEN 1 ELSE 0 END) AS age_35_64
  - Each select item must be ONE bare aggregate — do NOT wrap an aggregate in arithmetic (no AVG(...) * 100, no SUM(a) / SUM(b)). For a share/percentage, return the raw aggregate, e.g. AVG(CASE WHEN <col> = '<value>' THEN 1.0 ELSE 0.0 END) AS support_rate (a 0–1 share), and state the percentage or ratio in your written answer. ${scope.catalogCarriesScoreMarks ? "Categorical columns hold string values, never 1/0, and the tokens vary by column — filter with the exact values stated in each dimension's describe_constituent_data entry; a guessed token ('Y' vs 'Yes' vs 'true') silently matches zero rows. Null means unknown, not 'No' — count it as its own segment (see SCORE SEMANTICS) rather than dropping it." : "Categorical flag columns hold string values (e.g. 'support', 'oppose'), not 1/0."}
  - No SELECT *, no DISTINCT, no window functions, no subqueries, no UNION.
${
  scope.partisanQueriesAllowed
    ? '  - Party registration (Parties_Description) and modeled partisanship/ideology score columns are available and ALLOWED — breaking constituents down by party is a normal campaign analysis here.'
    : '  - Never select, filter, or group by political party or any partisan-lean column. This is a hard legal line.'
}
  - Small cells (COUNT(*) below the suppression floor) are dropped automatically.

Surface findings to the user in plain language — counts and percentages, not raw scores. Never echo the SQL or internal column names.`
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

    const result = await deps.provider.query(validatedSql)
    const countAlias = findCountAlias(validatedSql)
    const scrubbed = scrubResults(result.rows, {
      minCellSize: deps.scope.minCellSize ?? DEFAULT_MIN_CELL_SIZE,
      // The COUNT's own alias (any name) plus Spark's default name for an
      // unaliased COUNT(*), so a valid count is found regardless of how the
      // model named it.
      countColumnAliases: countAlias ? [countAlias, 'count(1)'] : ['count(1)'],
    })
    // Fail closed: scrubResults can only enforce the cell-size floor when it
    // finds the row-count column. If it still can't (the query has no COUNT at
    // all), we cannot prove every cell is above the floor, so returning the
    // rows could leak small / individual-level cells.
    if (scrubbed.reason === 'no_count_column') {
      throw new SqlRejected(
        'every query must include COUNT(*) so cell sizes can be enforced',
      )
    }
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
    'List the table, recommended breakdown dimensions (with labels), and aggregate functions available to query_constituent_data. Call this before writing a query so you use valid names.',
  inputSchema: z.object({}),
  execute: () => ({
    table: [...deps.scope.allowedTables][0] ?? '',
    dimensions: deps.scope.advertisedDimensions,
    aggregateFunctions: [...ALLOWED_AGGREGATE_FUNCTIONS],
    districtScope: deps.scope.mandatoryFilters,
  }),
})
