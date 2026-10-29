import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type { DatabricksProvider } from './queryDatabricks.tool'
import { isRecord } from './util/isRecord.util'
import { hsScoreSemantics } from './hsScoreSemantics'
import type { PeopleDataset } from '@/peopleDb/services/peopleDataset.service'
import { parseSingleSelect } from './util/sqlAst.util'

export class SqlRejected extends Error {
  constructor(reason: string) {
    super(`SQL rejected: ${reason}`)
    this.name = 'SqlRejected'
  }
}

const WRITE_AST_TYPES = new Set([
  'insert',
  'update',
  'delete',
  'replace',
  'truncate',
  'create',
  'alter',
  'drop',
  'rename',
  'grant',
  'revoke',
  'copy',
  'call',
  'use',
  'set',
  'lock',
  'unlock',
  'execute',
  'merge',
])

const INVISIBLE_CHARS = new RegExp(
  '[' + '\\uFEFF' + '\\u200B' + '\\u200C' + '\\u200D' + '\\u2060' + ']',
)

const containsWriteNode = (node: unknown): boolean => {
  if (node === null || node === undefined) return false
  if (Array.isArray(node)) {
    return node.some(containsWriteNode)
  }
  if (!isRecord(node)) return false
  const t = node.type
  if (typeof t === 'string' && WRITE_AST_TYPES.has(t.toLowerCase())) {
    return true
  }
  for (const key of Object.keys(node)) {
    if (containsWriteNode(node[key])) return true
  }
  return false
}

export interface MandatoryFilter {
  column: string
  value: string
}

export interface ValidateInsightsSqlOptions {
  allowedTables: Set<string>
  // Every filter listed here MUST be guaranteed across every result row.
  // I.e., each filter's column must equal its value via a mandatory AND-chain
  // predicate. OR-branches that don't preserve the equality break the
  // guarantee and the query is rejected. Typical use: lock the L2 district
  // type column to the user's district AND lock state_postal_code to the
  // user's state.
  mandatoryFilters: MandatoryFilter[]
  // Skip the base SELECT-list shape check. Callers that run their own, richer
  // select-list validation (e.g. the constituent-data tool, which recognizes
  // APPROX_COUNT_DISTINCT — parsed as `function`, not `aggr_func`) set this so a
  // valid no-GROUP-BY aggregate isn't rejected by the coarser base check here.
  skipSelectShapeCheck?: boolean
}

const stripQuotes = (s: string): string =>
  s.replace(/^[`"']/, '').replace(/[`"']$/, '')

const collectTableRefs = (node: unknown, acc: Set<string>): void => {
  if (!node) return
  if (Array.isArray(node)) {
    for (const item of node) collectTableRefs(item, acc)
    return
  }
  if (!isRecord(node)) return

  // Common shape: { table: 'x' } from FROM/JOIN entries. node-sql-parser puts
  // any schema/catalog qualifier in node.db. The allowlist holds BARE table
  // names (resolved via the session's pinned catalog/schema), so record the
  // qualifier too — a schema-qualified reference like
  // other_schema.serve_agent_voters then fails the allowlist instead of
  // matching the bare name and reading a same-named table in another schema
  // (CWE-863).
  const table = node.table
  if (typeof table === 'string' && table.length > 0) {
    const db = node.db
    const qualifier =
      typeof db === 'string' && db.length > 0 ? `${stripQuotes(db)}.` : ''
    acc.add(`${qualifier}${stripQuotes(table)}`)
  }

  for (const key of Object.keys(node)) {
    // table + db are folded into the qualified name above; don't recurse into
    // them (a future AST that nests an object in db must not leak a bare name).
    if (key === 'table' || key === 'db') continue
    collectTableRefs(node[key], acc)
  }
}

// Aggregates whose value is a number of people. scrubResults holds each one
// to the cell-size floor, which only means something if the value is the
// count itself, so assertPeopleCountShape keeps them bare.
const PEOPLE_COUNT_FUNCTIONS = new Set([
  'COUNT',
  'COUNT_IF',
  'APPROX_COUNT_DISTINCT',
  'SUM',
  'TRY_SUM',
])

const peopleCountFunction = (node: unknown): string | null => {
  if (!isRecord(node)) return null
  let name: string | null = null
  if (node.type === 'aggr_func' && typeof node.name === 'string') {
    name = node.name.toUpperCase()
  }
  // COUNT_IF, TRY_SUM and APPROX_COUNT_DISTINCT parse as a generic function
  // whose name is { name: [{ value: 'FN' }] }.
  if (node.type === 'function' && isRecord(node.name)) {
    const parts: unknown = node.name.name
    const last: unknown = Array.isArray(parts) ? parts[parts.length - 1] : null
    if (isRecord(last) && typeof last.value === 'string') {
      name = last.value.toUpperCase()
    }
  }
  return name !== null && PEOPLE_COUNT_FUNCTIONS.has(name) ? name : null
}

const containsPeopleCount = (node: unknown): boolean => {
  if (node === null || node === undefined) return false
  if (Array.isArray(node)) return node.some(containsPeopleCount)
  if (!isRecord(node)) return false
  if (peopleCountFunction(node) !== null) return true
  return Object.values(node).some(containsPeopleCount)
}

// SUM(CASE WHEN <condition> THEN 1 ELSE 0 END) is a count of people. Any
// other result value (THEN 1000, THEN Voters_Age) would let a small count
// clear the floor scaled up, so only 0, 1 and NULL results pass.
const sumCountsPeople = (node: Record<string, unknown>): boolean => {
  const args = node.args
  if (!isRecord(args)) return false
  const argument: unknown =
    node.type === 'aggr_func'
      ? args.expr
      : Array.isArray(args.value) && args.value.length === 1
        ? args.value[0]
        : null
  if (!isRecord(argument) || argument.type !== 'case') return false
  const branches = argument.args
  return (
    Array.isArray(branches) &&
    branches.every((branch) => {
      if (!isRecord(branch) || !isRecord(branch.result)) return false
      const result = branch.result
      if (result.type === 'null') return true
      if (result.type !== 'number') return false
      const value = Number(result.value)
      return value === 0 || value === 1
    })
  )
}

const assertPeopleCountShape = (stmt: Record<string, unknown>): void => {
  const columns = Array.isArray(stmt.columns) ? stmt.columns : []
  for (const col of columns) {
    const expr: unknown = isRecord(col) ? col.expr : null
    const name = peopleCountFunction(expr)
    if (name === null) {
      if (containsPeopleCount(expr)) {
        throw new SqlRejected(
          'a COUNT or SUM must be its own select item, not part of a larger expression',
        )
      }
      continue
    }
    if (
      (name === 'SUM' || name === 'TRY_SUM') &&
      isRecord(expr) &&
      !sumCountsPeople(expr)
    ) {
      throw new SqlRejected(
        'SUM may only count people: SUM(CASE WHEN <condition> THEN 1 ELSE 0 END). Use AVG for an average',
      )
    }
  }
  if (containsPeopleCount(stmt.having)) {
    throw new SqlRejected('HAVING may not filter on a COUNT or SUM')
  }
}

// The result column of every select item that counts people: its alias, or
// for an unaliased one the name the warehouse gave that position. The
// provider reports no columns only for an empty result, which has nothing to
// mask.
export const findPeopleCountColumns = (
  sql: string,
  resultColumns: string[],
): string[] => {
  const columns = parseSingleSelect(sql)?.stmt.columns
  if (!Array.isArray(columns) || resultColumns.length === 0) return []
  const names: string[] = []
  columns.forEach((col: unknown, index) => {
    if (!isRecord(col) || peopleCountFunction(col.expr) === null) return
    const name =
      typeof col.as === 'string' && col.as.length > 0
        ? stripQuotes(col.as)
        : resultColumns[index]
    if (name === undefined) {
      throw new SqlRejected('give every COUNT and SUM an alias')
    }
    names.push(name)
  })
  return names
}

const selectListIsAllAggregateOrLiteral = (columns: unknown): boolean => {
  if (!Array.isArray(columns)) return false
  return columns.every((col) => {
    if (!isRecord(col)) return false
    const expr = col.expr
    if (!isRecord(expr)) return false
    if (expr.type === 'aggr_func') return true
    if (expr.type === 'number' || expr.type === 'string') return true
    return false
  })
}

const extractStringLiteral = (node: unknown): string | null => {
  if (!isRecord(node)) return null
  if (node.type === 'string' && typeof node.value === 'string')
    return node.value
  if (node.type === 'single_quote_string' && typeof node.value === 'string')
    return node.value
  return null
}

const extractColumnRef = (node: unknown): string | null => {
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

/**
 * Walks a WHERE-expression AST and returns the set of values that are
 * guaranteed to equal `column` on EVERY satisfying row (i.e. mandatory
 * AND-chain equality predicates against `column`).
 *
 * - AND node: union of both sides' mandatory sets.
 * - OR node: intersection — only values guaranteed by BOTH branches are
 *   mandatory. This rejects "col = X OR col = Y" (mandatory set is empty
 *   because neither value alone is guaranteed) and "col = X OR 1=1"
 *   (right side has nothing, so intersection is empty).
 * - `col = literal` matching the target column: returns { literal }.
 * - Anything else (functions, type coercions, comparisons against other
 *   columns): empty set.
 */
const mandatoryValuesForColumn = (
  where: unknown,
  column: string,
): Set<string> => {
  if (!isRecord(where)) return new Set()
  const type = where.type

  if (type === 'binary_expr') {
    const op =
      typeof where.operator === 'string' ? where.operator.toUpperCase() : ''
    const left = where.left
    const right = where.right

    if (op === 'AND') {
      const a = mandatoryValuesForColumn(left, column)
      const b = mandatoryValuesForColumn(right, column)
      return new Set([...a, ...b])
    }
    if (op === 'OR') {
      const a = mandatoryValuesForColumn(left, column)
      const b = mandatoryValuesForColumn(right, column)
      const intersect = new Set<string>()
      for (const v of a) if (b.has(v)) intersect.add(v)
      return intersect
    }
    if (op === '=') {
      const colName = extractColumnRef(left) ?? extractColumnRef(right)
      if (colName !== column) return new Set()
      const value = extractStringLiteral(right) ?? extractStringLiteral(left)
      if (value === null) return new Set()
      return new Set([value])
    }
    return new Set()
  }

  return new Set()
}

export const validateInsightsSql = (
  sql: string,
  opts: ValidateInsightsSqlOptions,
): string => {
  if (INVISIBLE_CHARS.test(sql)) {
    throw new SqlRejected('invisible / zero-width characters are not allowed')
  }
  const parsed = parseSingleSelect(sql)
  if (!parsed) {
    throw new SqlRejected(
      'only a single SELECT statement is allowed (unparseable, multi-statement, or non-SELECT)',
    )
  }
  const stmt = parsed.stmt

  if (containsWriteNode(stmt)) {
    throw new SqlRejected(
      'write operations (INSERT/UPDATE/DELETE/DDL) are not allowed, even nested in CTEs or subqueries',
    )
  }

  // Table allowlist — every table referenced anywhere in the AST must be in
  // the allowlist. We walk recursively so JOINs, CTEs, and subqueries are
  // covered too.
  const referenced = new Set<string>()
  collectTableRefs(stmt, referenced)
  if (referenced.size === 0) {
    throw new SqlRejected('no table referenced')
  }
  for (const table of referenced) {
    if (!opts.allowedTables.has(table)) {
      throw new SqlRejected(`table not in allowlist: ${table}`)
    }
  }

  assertPeopleCountShape(stmt)

  // Aggregate-only shape: must have GROUP BY OR every selected expression
  // must be an aggregate function (or literal).
  const hasGroupBy = stmt.groupby !== null && stmt.groupby !== undefined
  if (!hasGroupBy && !opts.skipSelectShapeCheck) {
    if (!selectListIsAllAggregateOrLiteral(stmt.columns)) {
      throw new SqlRejected(
        'query must use GROUP BY or be a pure aggregate (e.g. COUNT(*))',
      )
    }
  }

  // Every mandatory filter must be guaranteed across every result row.
  // The mandatory-set walker handles AND/OR correctly: an OR that doesn't
  // preserve the equality on both sides breaks the guarantee.
  for (const filter of opts.mandatoryFilters) {
    const got = mandatoryValuesForColumn(stmt.where, filter.column)
    if (!got.has(filter.value)) {
      throw new SqlRejected(
        `query must guarantee ${filter.column} = '${filter.value}' (no OR / no leak)`,
      )
    }
  }

  // Return the original SQL string. node-sql-parser's sqlify() re-emits in
  // PostgreSQL dialect (double-quoted identifiers), but Databricks runs Spark
  // SQL where double-quoted identifiers are a parse error. Since we've
  // validated the AST is safe, the original SQL is fine to pass through.
  return sql
}

export interface ScrubOptions {
  minCellSize: number
  countColumnAliases?: string[]
  // findPeopleCountColumns for the query: masked below the floor whatever
  // they are called.
  peopleCountColumns?: string[]
}

export interface ScrubResult {
  kept: Array<Record<string, unknown>>
  suppressed: number
  reason: 'cell_size' | 'no_count_column' | null
}

// 'unknown_count' is the alias the score-semantics guidance recommends for
// null-segment counts — it must be suppressible like any other count.
const DEFAULT_COUNT_ALIASES = [
  'count',
  'n',
  'voters',
  'total',
  'count_voters',
  'unknown_count',
]

const findCountKey = (
  row: Record<string, unknown>,
  aliases: string[],
): string | null => {
  const keys = Object.keys(row)
  const lowerToActual = new Map<string, string>()
  for (const k of keys) lowerToActual.set(k.toLowerCase(), k)
  for (const alias of aliases) {
    const actual = lowerToActual.get(alias.toLowerCase())
    if (actual !== undefined) return actual
  }
  return null
}

// BigInt -> Number loses precision for values > 2^53; cell-size thresholds are
// small enough that this is safe in practice.
const coerceToNumber = (v: unknown): number => {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isNaN(n) ? 0 : n
  }
  return 0
}

export const scrubResults = (
  rows: Array<Record<string, unknown>>,
  opts: ScrubOptions,
): ScrubResult => {
  const [firstRow] = rows
  if (!firstRow) {
    return { kept: [], suppressed: 0, reason: null }
  }

  const aliases = [...(opts.countColumnAliases ?? []), ...DEFAULT_COUNT_ALIASES]
  const countKey = findCountKey(firstRow, aliases)
  const countKeys = new Set(
    [...aliases, ...(opts.peopleCountColumns ?? [])].map((a) =>
      a.toLowerCase(),
    ),
  )
  // Row-level suppression keys on one count column, but a query can carry
  // more than one count-like value (e.g. a small unknown_count selected
  // alongside a large group count). Mask any secondary count cell below the
  // threshold so no sub-threshold exact count reaches the model.
  const maskSmallCounts = (row: Record<string, unknown>) => {
    const masked: Record<string, unknown> = { ...row }
    for (const key of Object.keys(masked)) {
      if (key === countKey) continue
      if (!countKeys.has(key.toLowerCase())) continue
      if (coerceToNumber(masked[key]) < opts.minCellSize) masked[key] = null
    }
    return masked
  }

  if (countKey === null) {
    return {
      kept: rows.map(maskSmallCounts),
      suppressed: 0,
      reason: 'no_count_column',
    }
  }

  const kept: Array<Record<string, unknown>> = []
  let suppressed = 0
  for (const row of rows) {
    const value = coerceToNumber(row[countKey])
    if (value >= opts.minCellSize) {
      kept.push(maskSmallCounts(row))
    } else {
      suppressed += 1
    }
  }

  return {
    kept,
    suppressed,
    reason: suppressed > 0 ? 'cell_size' : null,
  }
}

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

export interface BuildDistrictInsightsToolDeps {
  provider: DatabricksProvider
  allowedTables: Set<string>
  mandatoryFilters: MandatoryFilter[]
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
  - Must include GROUP BY (or be a pure aggregate like COUNT(*) / AVG(...)).
  - Must include the WHERE clause above verbatim — AND-combined with any extra filters.
  - Each COUNT or SUM must be its own select item (no arithmetic around it, none in HAVING), and SUM may only count: SUM(CASE WHEN <condition> THEN 1 ELSE 0 END).
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
    const validatedSql = validateInsightsSql(sql, {
      allowedTables: deps.allowedTables,
      mandatoryFilters: deps.mandatoryFilters,
    })

    const result = await deps.provider.query(validatedSql)
    const scrubbed = scrubResults(result.rows, {
      minCellSize: deps.minCellSize ?? DEFAULT_MIN_CELL_SIZE,
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
