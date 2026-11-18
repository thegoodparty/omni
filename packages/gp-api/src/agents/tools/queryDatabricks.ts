import { z } from 'zod'
import {
  containsWriteNode,
  mandatoryValuesForColumn,
  SqlRejected,
} from '@/llm/tools/constituentSql.validator'
import { isRecord } from '@/llm/tools/util/isRecord.util'
import { parseSingleSelect } from '@/llm/tools/util/sqlAst.util'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import {
  PEOPLE_DBX_CATALOG,
  PEOPLE_DBX_SCHEMA,
} from '@/peopleDb/databricks/peopleDbx.config'
import { PeopleDbxStatementClient } from '@/peopleDb/databricks/peopleDbxStatement.client'
import { defineTool, type ToolContext } from './tool'

// The state column the PMF Engine's broker injected into every query off a
// run's scope ticket, under the same name: the L2 voter file is the only
// source this data is scoped by.
const STATE_COLUMN = 'Residence_Addresses_State'

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000
const MAX_SQL_CHARS = 10_000
const MAX_ERROR_CHARS = 400
const L2_COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

// The run's own slice of the voter file. An agent never chooses it: the
// caller resolves it from the run's organization, not from tool input or the
// model, so no query can read past the jurisdiction the report is about.
export type DatabricksScope = {
  state: string
  // The org's L2 district column and the value it must equal — the same pair
  // the dispatch code puts in a run's l2_district_* params.
  district?: { column: string; value: string } | null
}

export type DatabricksToolOptions = {
  // The agent's manifest scope.allowed_tables, verbatim. This is the whole
  // grant: a query naming anything else is rejected, so there is no implicit
  // access to a table an agent did not declare.
  tables: string[]
  // The manifest's scope.max_rows. Results are cut here.
  maxRows: number
  // Where the run's state and district come from. Null means the org has no
  // jurisdiction to scope to, and every query is refused rather than run
  // unscoped.
  scope: (ctx: ToolContext) => Promise<DatabricksScope | null>
  statementTimeoutMs?: number
}

const queryInput = z.object({
  sql: z
    .string()
    .min(1)
    .max(MAX_SQL_CHARS)
    .describe(
      'One read-only SELECT over an allowed table, with the office jurisdiction filter in its WHERE. Write values as literals, not bind parameters.',
    ),
})

// The run's organization as a Databricks scope: its state, and its L2 district
// column and value when it has one, from the same resolveServeContext the
// dispatch code builds a run's params from. An org with no jurisdiction
// resolves to null, and the tool then refuses every query.
export const orgDatabricksScope = async (
  ctx: ToolContext,
): Promise<DatabricksScope | null> => {
  const organizations = ctx.get(OrganizationsService)
  const organization = await organizations.client.organization.findUnique({
    where: { slug: ctx.organizationSlug },
  })
  if (!organization) return null
  const serveCtx = await organizations.resolveServeContext(organization)
  if (!serveCtx?.state) return null
  // A column name that is not an identifier is not one this can prove a
  // clause against, and guessing would refuse every query forever.
  const district =
    serveCtx.l2DistrictType &&
    serveCtx.l2DistrictName &&
    L2_COLUMN_NAME.test(serveCtx.l2DistrictType)
      ? { column: serveCtx.l2DistrictType, value: serveCtx.l2DistrictName }
      : null
  return { state: serveCtx.state, district }
}

// A table reference as the allowlist spells it: catalog, then schema, then
// name. A quoted dotted name arrives whole in `table` and a bare one arrives
// split across db/schema, so every form is joined and re-split rather than
// read positionally.
const tableRef = (entry: Record<string, unknown>): string =>
  [entry.db, entry.schema, entry.table]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join('.')
    .split('.')
    .filter(Boolean)
    .join('.')

// Every reference must name the same catalog and schema the allowlist does. The
// statement client pins the session's default to `goodparty_data_catalog`.
// `mart_gp_api`, so a bare or partly-qualified name resolves SOMEWHERE ELSE
// than the table the agent was granted — the mart rather than the `dbt` table
// the manifest names. So a reference matches only when its catalog, schema and
// name all match, with any missing leading part taken from the default the
// client sets. A spoofed qualifier (`evil.public.t`) matches nothing.
const DEFAULT_CATALOG = PEOPLE_DBX_CATALOG
const DEFAULT_SCHEMA = PEOPLE_DBX_SCHEMA

const resolvedRef = (ref: string): string => {
  const parts = ref.split('.')
  if (parts.length >= 3) return parts.join('.')
  if (parts.length === 2) return [DEFAULT_CATALOG, ...parts].join('.')
  return [DEFAULT_CATALOG, DEFAULT_SCHEMA, ...parts].join('.')
}

const isAllowedTable = (ref: string, tables: string[]): boolean => {
  const resolved = resolvedRef(ref).toLowerCase()
  return tables.some((allowed) => allowed.toLowerCase() === resolved)
}

const eachNode = (
  node: unknown,
  visit: (node: Record<string, unknown>) => void,
): void => {
  if (Array.isArray(node)) {
    for (const item of node) eachNode(item, visit)
    return
  }
  if (!isRecord(node)) return
  visit(node)
  for (const value of Object.values(node)) eachNode(value, visit)
}

// Every SELECT at any depth: the outer one, each UNION branch, each CTE body,
// each subquery. A filter on the outer query does not scope an unfiltered read
// of the table underneath it, so each one is checked on its own.
const selectsIn = (
  stmt: Record<string, unknown>,
): Record<string, unknown>[] => {
  const selects: Record<string, unknown>[] = []
  eachNode(stmt, (node) => {
    if (node.type === 'select') selects.push(node)
  })
  return selects
}

// A CTE name can mean the CTE in one place and a real table in another: a
// non-recursive CTE cannot see itself, so `WITH s AS (SELECT * FROM s)` reads
// the real `s`, and a reference outside its WITH is the real table too. This
// has no Spark binder to ask which one a name is, so a statement with a CTE is
// refused: a derived table in FROM does the same job and has no name to
// resolve.
const CTE_REFUSED =
  'write the query without WITH/CTE: a CTE name can shadow a real table, so put the subquery in FROM instead'

// The state always, and the district whenever the org has one — the same
// predicates the broker injected, which the model now writes itself and the
// tool has to prove.
const requiredFilters = (scope: DatabricksScope): Array<[string, string]> => [
  [STATE_COLUMN, scope.state],
  ...(scope.district
    ? [[scope.district.column, scope.district.value] as [string, string]]
    : []),
]

const assertScope = (
  where: unknown,
  table: string,
  alias: string,
  scope: DatabricksScope,
): void => {
  for (const [column, value] of requiredFilters(scope)) {
    // Reused from the constituent tool: an AND unions, an OR intersects, so
    // `= 'x' OR 1=1` proves nothing and is rejected.
    const proven = mandatoryValuesForColumn(where, column).has(value)
    if (proven && !qualifiedElsewhere(where, column, alias)) continue
    throw new SqlRejected(
      `every SELECT that reads ${table} must guarantee ${column} = '${value}' on ${table} itself in its own WHERE, with no OR that could step around it`,
    )
  }
}

// mandatoryValuesForColumn drops a column's qualifier, so a predicate on any
// other relation reads as proof for this one. Wherever the column appears in
// this WHERE, it has to be unqualified (unambiguous: the SELECT reads one
// relation, which assertAllowedQuery enforces) or qualified to this table's
// own alias.
const qualifiedElsewhere = (
  node: unknown,
  column: string,
  alias: string,
): boolean => {
  if (Array.isArray(node)) {
    return node.some((item) => qualifiedElsewhere(item, column, alias))
  }
  if (!isRecord(node)) return false
  if (node.type === 'column_ref') {
    const target = node.column
    const name =
      typeof target === 'string'
        ? target
        : isRecord(target) &&
            isRecord(target.expr) &&
            typeof target.expr.value === 'string'
          ? target.expr.value
          : null
    if (name?.toLowerCase() === column.toLowerCase()) {
      const qualifier = node.table
      if (typeof qualifier === 'string' && qualifier !== '') {
        return qualifier.toLowerCase() !== alias.toLowerCase()
      }
    }
  }
  return Object.entries(node).some(
    ([key, value]) => key !== 'loc' && qualifiedElsewhere(value, column, alias),
  )
}

// A comment or a backslash is the one kind of construct whose meaning is
// decided purely by the parser's lexical rules, and the parser here is not the
// one that runs the statement: Spark's escaping and its block-comment nesting
// are both settings a grammar may or may not reproduce. A statement that proves
// a filter here but lexes differently in Spark could have that filter removed,
// so both are refused outright rather than reasoned about. A generated
// aggregation over voter data needs neither.
const assertPlainSql = (sql: string): void => {
  if (sql.includes('/*') || sql.includes('--')) {
    throw new SqlRejected(
      'write the query with no comments: neither /* */ nor --',
    )
  }
  if (sql.includes('\\')) {
    throw new SqlRejected(
      'write the query with no backslash anywhere, in a string or out of one',
    )
  }
}

// Read-only, allowlisted and scoped, proven on the parsed statement. Nothing
// here rewrites the SQL: gp-api has no Spark re-emitter it can trust (Spark
// reads a double-quoted identifier as a string, so a re-emitted query would
// silently compare literals), so a query either already says what is allowed
// or comes back with the fix in the message.
const assertAllowedQuery = (
  sql: string,
  tables: string[],
  scope: DatabricksScope,
): void => {
  assertPlainSql(sql)
  const parsed = parseSingleSelect(sql)
  if (!parsed) {
    throw new SqlRejected(
      'send exactly one SELECT and nothing else: no second statement after a semicolon, and no DDL, SHOW, DESCRIBE or write',
    )
  }
  const { stmt } = parsed
  if (containsWriteNode(stmt)) {
    throw new SqlRejected(
      'only a read is allowed; INSERT, UPDATE, DELETE, MERGE and DDL are rejected even inside a subquery',
    )
  }
  if (isRecord(stmt.into) && stmt.into.expr) {
    throw new SqlRejected('SELECT INTO writes a table, so it is not allowed')
  }

  const allowlist = tables.join(', ') || '(none)'
  for (const select of selectsIn(stmt)) {
    if (Array.isArray(select.with) && select.with.length > 0) {
      throw new SqlRejected(CTE_REFUSED)
    }
    const from = Array.isArray(select.from) ? select.from : []
    let read: string | null = null
    let alias: string | null = null
    for (const entry of from) {
      if (!isRecord(entry)) continue
      if (typeof entry.table !== 'string') {
        // A table function (read_files, range, explode…) is not a table at
        // all, so there is nothing to allowlist. A derived table is a nested
        // SELECT and is checked as one.
        if (!(isRecord(entry.expr) && isRecord(entry.expr.ast))) {
          throw new SqlRejected(`read a table from the allowlist: ${allowlist}`)
        }
        continue
      }
      const ref = tableRef(entry)
      if (!isAllowedTable(ref, tables)) {
        throw new SqlRejected(
          `${ref} is not an allowed table. Allowed: ${allowlist}`,
        )
      }
      if (read !== null) {
        throw new SqlRejected(
          `one table read per SELECT: query ${ref} separately instead of joining it to ${read}`,
        )
      }
      read = ref
      // The name a predicate may be qualified by: the alias when it has one,
      // else the table's own last part.
      alias =
        typeof entry.as === 'string' && entry.as !== ''
          ? entry.as
          : (ref.split('.').pop() ?? ref)
    }
    if (read === null || alias === null) continue
    // The filter proof is over the WHERE, and a second relation in FROM would
    // let a predicate qualified to it stand in as proof for this table, which
    // the qualifier check alone cannot catch once the relation is anonymous.
    if (from.length > 1) {
      throw new SqlRejected(
        `read ${read} on its own: a query that joins it to another relation cannot prove the jurisdiction filter is on ${read}`,
      )
    }
    assertScope(select.where, read, alias, scope)
  }
}

const brief = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(
    0,
    MAX_ERROR_CHARS,
  )

// Rejects as soon as the signal aborts, so the tool's ceiling holds even if a
// statement never settles on its own. The listener goes on the combined signal
// the caller builds for this one call, never on the run's.
const rejectedOnAbort = (signal: AbortSignal): Promise<never> =>
  new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), {
      once: true,
    })
  })

// The agent's Databricks tool, standing in for the PMF Engine broker's
// Databricks scope: the manifest's table allowlist and row cap, the run's
// jurisdiction filter, one read-only statement, and a ceiling on how long it
// may run. Every refusal is a value the model reads and corrects, never a
// throw, so one bad query does not end a run.
export const databricksTool = (options: DatabricksToolOptions) => {
  const statementTimeoutMs =
    options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS
  return defineTool({
    description: `Run one read-only SELECT over internal modeled constituent data (${options.tables.join(', ')}) and get back its columns and at most ${options.maxRows} rows. Every SELECT that reads the table must itself guarantee the office jurisdiction filter in its WHERE, e.g. ${STATE_COLUMN} = 'NC'; a query that does not is rejected with the clause to add. Write values as literals, never as bind parameters. One statement only, no DDL, no writes.`,
    input: queryInput,
    execute: async ({ sql }, ctx) => {
      const scope = await options.scope(ctx)
      if (!scope) {
        return {
          ok: false,
          reason: 'no_scope',
          detail: 'this organization has no jurisdiction to scope the query to',
        }
      }
      try {
        assertAllowedQuery(sql, options.tables, scope)
      } catch (error) {
        return { ok: false, reason: 'rejected', detail: brief(error) }
      }

      const timeout = AbortSignal.timeout(statementTimeoutMs)
      const signal = AbortSignal.any([ctx.signal, timeout])
      let result: { columns: string[]; rows: Array<Array<string | null>> }
      try {
        const query = ctx
          .get(PeopleDbxStatementClient)
          .query({ sql, params: [] }, { signal })
        // The arm that loses the race may still reject later, and an
        // unhandled rejection would take the task down.
        query.catch(() => undefined)
        result = await Promise.race([query, rejectedOnAbort(signal)])
      } catch (error) {
        // The run is being stopped (a deploy, or the job's own timeout), so
        // the loop is going down and this is not the model's to fix.
        if (ctx.signal.aborted) throw error
        if (timeout.aborted) {
          return {
            ok: false,
            reason: 'timeout',
            detail: `the query passed ${statementTimeoutMs}ms and was cancelled; narrow it, aggregate more, or LIMIT less`,
          }
        }
        return { ok: false, reason: 'query_failed', detail: brief(error) }
      }

      const truncated = result.rows.length > options.maxRows
      const rows = truncated
        ? result.rows.slice(0, options.maxRows)
        : result.rows
      return {
        ok: true,
        columns: result.columns,
        rows,
        rowCount: rows.length,
        truncated,
      }
    },
  })
}
