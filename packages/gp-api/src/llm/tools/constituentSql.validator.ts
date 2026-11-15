import { isRecord } from './util/isRecord.util'
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

// A bare, unfiltered COUNT(*): the number of rows in its group. The row floor
// keys on this select item and nothing else, so no other value can stand in
// for the group size.
const isRowCount = (expr: unknown): boolean =>
  isRecord(expr) &&
  expr.type === 'aggr_func' &&
  typeof expr.name === 'string' &&
  expr.name.toUpperCase() === 'COUNT' &&
  isRecord(expr.args) &&
  isRecord(expr.args.expr) &&
  expr.args.expr.type === 'star' &&
  !expr.args.distinct &&
  !expr.over &&
  !expr.filter

// The result column of the query's COUNT(*), named like findPeopleCountColumns
// names its columns. Null only for an empty result, which has no columns.
export const findRowCountColumn = (
  sql: string,
  resultColumns: string[],
): string | null => {
  const columns = parseSingleSelect(sql)?.stmt.columns
  const index = Array.isArray(columns)
    ? columns.findIndex((col: unknown) => isRecord(col) && isRowCount(col.expr))
    : -1
  if (!Array.isArray(columns) || index === -1) {
    throw new SqlRejected(
      'every query must include COUNT(*) so cell sizes can be enforced',
    )
  }
  if (resultColumns.length === 0) return null
  const col: unknown = columns[index]
  const name =
    isRecord(col) && typeof col.as === 'string' && col.as.length > 0
      ? stripQuotes(col.as)
      : resultColumns[index]
  if (name === undefined) {
    throw new SqlRejected('give COUNT(*) an alias')
  }
  const sameName = resultColumns.filter(
    (column) => column.toLowerCase() === name.toLowerCase(),
  )
  if (sameName.length > 1) {
    throw new SqlRejected('the COUNT(*) column needs a name of its own')
  }
  return name
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
  // findRowCountColumn for the query: rows whose COUNT(*) is below the floor
  // are dropped.
  rowCountColumn: string | null
  // findPeopleCountColumns for the query: masked below the floor whatever
  // they are called.
  peopleCountColumns: string[]
}

export interface ScrubResult {
  kept: Array<Record<string, unknown>>
  suppressed: number
  reason: 'cell_size' | null
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

  const countKey = Object.keys(firstRow).find(
    (key) => key.toLowerCase() === opts.rowCountColumn?.toLowerCase(),
  )
  if (countKey === undefined) {
    throw new SqlRejected(
      'the result has no COUNT(*) column, so cell sizes cannot be enforced',
    )
  }
  const countKeys = new Set(
    [...DEFAULT_COUNT_ALIASES, ...opts.peopleCountColumns].map((a) =>
      a.toLowerCase(),
    ),
  )
  // Row-level suppression keys on the COUNT(*) column, but a query can carry
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

// Aggregate functions the agent may use. Anything outside this set (including
// scalar functions and window functions) is rejected so a SELECT item can only
// ever be an aggregate or a GROUP BY dimension — never a row-level value.
export const ALLOWED_AGGREGATE_FUNCTIONS = new Set([
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'APPROX_COUNT_DISTINCT',
])

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

export interface ConstituentSqlScope {
  allowedTables: Set<string>
  // Coarse dimensions the agent may reference anywhere (SELECT/GROUP BY/WHERE).
  // The real anti-differencing control: fine-grained quasi-identifiers are not
  // listed, so they can't be sliced. Mandatory-filter columns are implicitly
  // allowed (they're server-bound), but listing them here is harmless. This is
  // the validator allowlist (can be the whole approved table); it is NOT the
  // menu shown to the model — see advertisedDimensions.
  allowedDimensions: Set<string>
  // Columns that must never appear anywhere. App-side defensive backstop for the
  // hard "no political party / partisan-lean" line; in 6b the credential also
  // denies these at the warehouse.
  forbiddenColumns: Set<string>
  // Server-bound district predicate. Built from
  // DistrictResolverService.resolveByOrgSlug on the conversation's own org —
  // NEVER from agent input, and never from the user's first office.
  mandatoryFilters: MandatoryFilter[]
}

export const validateConstituentSql = (
  sql: string,
  scope: ConstituentSqlScope,
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

  if (
    !Array.isArray(stmt.columns) ||
    !stmt.columns.some((col: unknown) => isRecord(col) && isRowCount(col.expr))
  ) {
    throw new SqlRejected(
      'every query must include COUNT(*) so cell sizes can be enforced',
    )
  }

  // A result row is an object keyed by column name, so a second column with
  // the COUNT(*)'s name would overwrite the count the floor reads.
  const names = stmt.columns.flatMap((col: unknown) => {
    if (!isRecord(col)) return []
    if (typeof col.as === 'string' && col.as.length > 0) {
      return [normalizeColumn(stripQuotes(col.as))]
    }
    const name = collectColumnNode(col.expr)
    return name === null ? [] : [normalizeColumn(name)]
  })
  if (new Set(names).size !== names.length) {
    throw new SqlRejected('give every select item a different name')
  }

  return sql
}
