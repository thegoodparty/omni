import type {
  DatabricksProvider,
  DatabricksRowSet,
} from './queryDatabricks.tool'
import { isRecord } from './util/isRecord.util'

export interface DbsqlOperationLike {
  fetchAll: () => Promise<unknown[]>
  close: () => Promise<void>
  getSchema?: () => Promise<
    { columns?: Array<{ columnName: string }> } | null | undefined
  >
}

export interface DbsqlSessionInstanceLike {
  executeStatement: (
    sql: string,
    opts?: { runAsync?: boolean },
  ) => Promise<DbsqlOperationLike>
  close: () => Promise<void>
}

export interface DbsqlSessionLike {
  openSession: () => Promise<DbsqlSessionInstanceLike>
  close: () => Promise<void>
}

export type DbsqlConnectOptions = { host: string; path: string } & (
  | { token: string }
  | {
      authType: 'databricks-oauth'
      oauthClientId: string
      oauthClientSecret: string
    }
)

export interface DbsqlClientLike {
  connect: (opts: DbsqlConnectOptions) => Promise<DbsqlSessionLike>
}

export interface DatabricksSqlProviderOptions {
  hostname: string
  httpPath: string
  // Provide either a PAT (accessToken) or OAuth M2M service-principal creds
  // (oauthClientId + oauthClientSecret). OAuth wins when both are present.
  accessToken?: string
  oauthClientId?: string
  oauthClientSecret?: string
  catalog?: string
  schema?: string
  clientFactory?: () => DbsqlClientLike
  queryTimeoutMs?: number
}

// The driver's own floors are useless here: 15min socket timeout and an
// UNBOUNDED operation-status poll loop, while the chat stream's heartbeat
// keeps a hung turn alive forever. 60s comfortably covers serverless
// warehouse auto-resume.
const DEFAULT_QUERY_TIMEOUT_MS = 60_000

class QueryTimedOutError extends Error {
  constructor(timeoutMs: number) {
    super(`DatabricksSqlProvider: query timed out after ${timeoutMs}ms`)
  }
}

const noop = (): undefined => undefined

const SQL_IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

const assertSqlIdent = (field: 'catalog' | 'schema', value: string): void => {
  if (!SQL_IDENT_RE.test(value)) {
    throw new Error(
      `DatabricksSqlProvider: invalid ${field} "${value}" — must match ` +
        `${SQL_IDENT_RE.source}`,
    )
  }
}

const isClientLike = (v: unknown): v is DbsqlClientLike =>
  isRecord(v) && typeof v.connect === 'function'

const isConstructor = (v: unknown): v is new (...args: never[]) => unknown =>
  typeof v === 'function'

const defaultClientFactory = (): DbsqlClientLike => {
  // WHY: lazy require so tests injecting a clientFactory never load the
  // native @databricks/sql package (heavy native deps, not needed for unit tests).
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  const mod = require('@databricks/sql')
  if (!isRecord(mod)) {
    throw new Error('@databricks/sql module did not load')
  }
  const Ctor = mod.DBSQLClient
  if (!isConstructor(Ctor)) {
    throw new Error('@databricks/sql did not export DBSQLClient')
  }
  const instance: unknown = new Ctor()
  if (!isClientLike(instance)) {
    throw new Error('@databricks/sql DBSQLClient is missing connect')
  }
  return instance
}

const toRowRecords = (rows: unknown[]): Array<Record<string, unknown>> => {
  const out: Array<Record<string, unknown>> = []
  for (const r of rows) {
    if (isRecord(r)) out.push(r)
  }
  return out
}

export class DatabricksSqlProvider implements DatabricksProvider {
  private readonly opts: DatabricksSqlProviderOptions
  private readonly clientFactory: () => DbsqlClientLike
  private clientConn?: DbsqlSessionLike
  private session?: DbsqlSessionInstanceLike
  private connectPromise?: Promise<void>
  private closed = false
  private generation = 0

  constructor(opts: DatabricksSqlProviderOptions) {
    if (opts.catalog !== undefined) assertSqlIdent('catalog', opts.catalog)
    if (opts.schema !== undefined) assertSqlIdent('schema', opts.schema)
    this.opts = opts
    this.clientFactory = opts.clientFactory ?? defaultClientFactory
  }

  // One bad statement must not poison this process-lifetime singleton: the
  // cached session can outlive its OAuth token or its server-side session
  // (2026-07-29 prod outage: every voter-data query failed for 12+ hours
  // until the ECS task was recycled). On failure, drop the session and retry
  // once on a fresh connection; a timed-out attempt is not retried because a
  // hung warehouse would just consume a second full deadline.
  async query(sql: string): Promise<DatabricksRowSet> {
    const gen = this.generation
    try {
      return await this.attempt(sql)
    } catch (err) {
      if (this.closed) throw err
      this.resetSession(gen)
      if (err instanceof QueryTimedOutError) throw err
      const retryGen = this.generation
      try {
        return await this.attempt(sql)
      } catch (retryErr) {
        if (!this.closed) this.resetSession(retryGen)
        throw retryErr
      }
    }
  }

  private async attempt(sql: string): Promise<DatabricksRowSet> {
    const timeoutMs = this.opts.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    let currentOp: DbsqlOperationLike | undefined
    const work = this.runQuery(sql, (op) => {
      currentOp = op
    })
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // The hung attempt's finally never runs, so close its operation
        // here or the handle leaks on the warehouse. The abandoned attempt
        // may still settle later — keep it handled.
        currentOp?.close().catch(noop)
        work.catch(noop)
        reject(new QueryTimedOutError(timeoutMs))
      }, timeoutMs)
    })
    try {
      return await Promise.race([work, deadline])
    } finally {
      clearTimeout(timer)
    }
  }

  private async runQuery(
    sql: string,
    onOperation?: (op: DbsqlOperationLike) => void,
  ): Promise<DatabricksRowSet> {
    const session = await this.ensureSession()
    const op = await session.executeStatement(sql, { runAsync: true })
    onOperation?.(op)
    try {
      const rawRows = await op.fetchAll()
      const rows = toRowRecords(rawRows)
      const columns = await this.resolveColumns(op, rows)
      return { columns, rows }
    } finally {
      await op.close().catch(noop)
    }
  }

  // Generation-checked: a no-op when another caller already reset the same
  // dead session, so concurrent failures share one reconnect instead of
  // tearing down each other's in-flight retries. Closes are fire-and-forget —
  // a hung transport must not block the caller's error path past the deadline.
  private resetSession(gen: number): void {
    if (gen !== this.generation) return
    this.generation++
    const session = this.session
    const conn = this.clientConn
    this.session = undefined
    this.clientConn = undefined
    this.connectPromise = undefined
    session?.close().catch(noop)
    conn?.close().catch(noop)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const session = this.session
    const conn = this.clientConn
    this.session = undefined
    this.clientConn = undefined
    this.connectPromise = undefined
    if (session) {
      await session.close().catch(noop)
    }
    if (conn) {
      await conn.close().catch(noop)
    }
  }

  private async ensureSession(): Promise<DbsqlSessionInstanceLike> {
    if (this.closed) {
      throw new Error('DatabricksSqlProvider: provider is closed')
    }
    if (this.session) return this.session
    if (!this.connectPromise) {
      // Only clear the slot if it still holds this attempt — a reset may
      // have installed a newer connect underneath a late failure.
      const pending = this.openSession(this.generation).catch((err) => {
        if (this.connectPromise === pending) {
          this.connectPromise = undefined
        }
        throw err
      })
      this.connectPromise = pending
    }
    await this.connectPromise
    if (!this.session) {
      throw new Error(
        'DatabricksSqlProvider: session unavailable after connect',
      )
    }
    return this.session
  }

  private connectOptions(): DbsqlConnectOptions {
    const host = this.opts.hostname
    const path = this.opts.httpPath
    if (this.opts.oauthClientId && this.opts.oauthClientSecret) {
      return {
        host,
        path,
        authType: 'databricks-oauth',
        oauthClientId: this.opts.oauthClientId,
        oauthClientSecret: this.opts.oauthClientSecret,
      }
    }
    if (this.opts.accessToken) {
      return { host, path, token: this.opts.accessToken }
    }
    throw new Error(
      'DatabricksSqlProvider: no credential — set oauthClientId + ' +
        'oauthClientSecret, or accessToken',
    )
  }

  private async openSession(gen: number): Promise<void> {
    const client = this.clientFactory()
    const conn = await client.connect(this.connectOptions())
    let session: DbsqlSessionInstanceLike
    try {
      session = await conn.openSession()
      if (this.opts.catalog) {
        await this.runStatement(session, `USE CATALOG ${this.opts.catalog}`)
      }
      if (this.opts.schema) {
        await this.runStatement(session, `USE SCHEMA ${this.opts.schema}`)
      }
    } catch (err) {
      await conn.close().catch(noop)
      throw err
    }
    // A close() or a reset may have landed while we were connecting; both
    // already zeroed their handles, so publishing these live ones would leak
    // them — tear down here instead.
    if (this.closed || gen !== this.generation) {
      await session.close().catch(noop)
      await conn.close().catch(noop)
      throw new Error(
        this.closed
          ? 'DatabricksSqlProvider: provider is closed'
          : 'DatabricksSqlProvider: connection superseded',
      )
    }
    this.clientConn = conn
    this.session = session
  }

  private async runStatement(
    session: DbsqlSessionInstanceLike,
    sql: string,
  ): Promise<void> {
    const op = await session.executeStatement(sql, { runAsync: true })
    try {
      // Await completion so USE CATALOG / USE SCHEMA actually applies before
      // the next statement runs. Closing without fetching leaves the session on
      // the warehouse's default catalog/schema, so unqualified table names fail
      // to resolve (TABLE_OR_VIEW_NOT_FOUND).
      await op.fetchAll()
    } finally {
      await op.close().catch(noop)
    }
  }

  private async resolveColumns(
    op: DbsqlOperationLike,
    rows: Array<Record<string, unknown>>,
  ): Promise<string[]> {
    if (op.getSchema) {
      try {
        const schema = await op.getSchema()
        if (
          schema &&
          isRecord(schema) &&
          Array.isArray(schema.columns) &&
          schema.columns.length > 0
        ) {
          return schema.columns
            .map((c) => (isRecord(c) ? c.columnName : undefined))
            .filter((v): v is string => typeof v === 'string')
        }
      } catch {
        // fall through to first-row derivation
      }
    }
    const [firstRow] = rows
    if (!firstRow) return []
    return Object.keys(firstRow)
  }
}
