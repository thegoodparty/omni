import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import {
  PEOPLE_DBX_CATALOG,
  PEOPLE_DBX_SCHEMA,
  resolvePeopleDbxConfig,
  type PeopleDbxConfig,
} from './peopleDbx.config'
import type { DbxParam, DbxStatement } from './databricksVoterSql.util'

// Serverless warehouse resume can eat the first 10-20s after an idle period,
// so this ceiling is deliberately looser than the Postgres path's 25s. That
// one guards against a pathological plan on a warm cluster; here the long
// tail is compute startup, and killing it would turn every post-idle request
// into a 504.
const STATEMENT_TIMEOUT_MS = 60_000

// The API's hard ceiling on the statement field, measured against it directly:
// a 20MB statement is rejected with "must not exceed a length of 16777216
// bytes". Reachable because id sets are inlined rather than bound — the
// contract permits 100k ids per set, and a request carrying `filters.id` plus
// both id-override pairs can exceed this where the Postgres path (one bound
// array per set) would not.
const MAX_STATEMENT_BYTES = 16_777_216

// Measured against the API: "20000 parameters were given but the limit is
// 10000". Bound values are the norm here, so this is the ceiling that a
// pathologically wide filter selection would hit first.
const MAX_STATEMENT_PARAMETERS = 10_000
const POLL_INTERVAL_MS = 500
const TOKEN_EXPIRY_SKEW_MS = 60_000

const RESULT_ROW = z.array(z.string().nullable())

const statementResponseSchema = z.object({
  statement_id: z.string().optional(),
  status: z.object({
    state: z.string(),
    error: z.object({ message: z.string().optional() }).optional(),
  }),
  manifest: z
    .object({
      total_row_count: z.number().optional(),
      total_chunk_count: z.number().optional(),
      schema: z
        .object({ columns: z.array(z.object({ name: z.string() })) })
        .optional(),
    })
    .optional(),
  result: z
    .object({
      data_array: z.array(RESULT_ROW).optional(),
      next_chunk_internal_link: z.string().optional(),
      external_links: z
        .array(
          z.object({
            chunk_index: z.number(),
            external_link: z.string(),
            row_count: z.number().optional(),
            next_chunk_internal_link: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
})

const chunkResponseSchema = z.object({
  data_array: z.array(RESULT_ROW).optional(),
  next_chunk_internal_link: z.string().optional(),
  external_links: z
    .array(
      z.object({
        chunk_index: z.number(),
        external_link: z.string(),
        row_count: z.number().optional(),
        next_chunk_internal_link: z.string().optional(),
      }),
    )
    .optional(),
})

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
})

type StatementResponse = z.infer<typeof statementResponseSchema>

export type PeopleDbxRows = {
  columns: string[]
  rows: Array<Array<string | null>>
}

export type PeopleDbxCsvChunk = {
  externalLink: string
  nextChunkLink: string | null
}

export type PeopleDbxCsvExport = {
  statementId: string
  totalRows: number
  totalChunks: number
  firstChunk: PeopleDbxCsvChunk
}

// A statement that outlived the ceiling. Distinct from a query error so the
// caller can classify it the way the Postgres path classifies 57014: a loud,
// alertable 504 rather than a generic 500.
export class PeopleDbxTimeoutError extends Error {
  constructor(elapsedMs: number) {
    super(`Databricks statement exceeded ${elapsedMs}ms`)
  }
}

// Caused by the size of the caller's selection, so the caller translates this
// to a 400 rather than a 500: it is actionable input, not a broken service.
export class PeopleDbxStatementTooLargeError extends Error {
  constructor(bytes: number) {
    super(
      `Databricks statement is ${bytes} bytes, over the ` +
        `${MAX_STATEMENT_BYTES}-byte limit`,
    )
  }
}

// Voter data has no second source behind it, so every way of failing to reach
// Databricks funnels through this one type and the caller answers 502. That
// matters beyond tidiness: a district with no voters is a MEANINGFUL null that
// the product renders as "no constituent data for this office", so an auth or
// connectivity failure must never be able to present as that.
export class PeopleDbxUnavailableError extends Error {
  constructor(reason: string) {
    super(`Databricks voter data is unreachable: ${reason}`)
  }
}

const TERMINAL_FAILURE_STATES = new Set(['FAILED', 'CANCELED', 'CLOSED'])
// 404 belongs here: the statement id in a poll URL comes from a submit we just
// made, so a miss means the warehouse expired the result out from under us, not
// that we built a bad route.
const UNREACHABLE_STATUSES = new Set([401, 403, 404, 429, 502, 503, 504])
const SUCCEEDED = 'SUCCEEDED'

@Injectable()
export class PeopleDbxStatementClient {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(PeopleDbxStatementClient.name)
  }

  private token: { value: string; expiresAt: number } | null = null

  private config(): PeopleDbxConfig {
    const config = resolvePeopleDbxConfig()
    if (!config) {
      throw new PeopleDbxUnavailableError(
        'PEOPLE_DATABRICKS_SERVER_HOSTNAME, PEOPLE_DATABRICKS_HTTP_PATH and a ' +
          'credential must all be set',
      )
    }
    return config
  }

  // Rows come back positionally as strings (or null) under JSON_ARRAY, which
  // is why callers coerce per column rather than trusting a driver's typing.
  async query(statement: DbxStatement): Promise<PeopleDbxRows> {
    const config = this.config()
    const startedAt = Date.now()
    const first = await this.post(config, statement, {
      statement: statement.sql,
      catalog: PEOPLE_DBX_CATALOG,
      schema: PEOPLE_DBX_SCHEMA,
      format: 'JSON_ARRAY',
      disposition: 'INLINE',
      wait_timeout: '30s',
      on_wait_timeout: 'CONTINUE',
    })
    const settled = await this.awaitCompletion(config, first, startedAt)
    const columns =
      settled.manifest?.schema?.columns.map((column) => column.name) ?? []
    const rows = [...(settled.result?.data_array ?? [])]
    let next = settled.result?.next_chunk_internal_link ?? null
    while (next) {
      const chunk = await this.fetchJson(config, next, chunkResponseSchema)
      rows.push(...(chunk.data_array ?? []))
      next = chunk.next_chunk_internal_link ?? null
    }
    return { columns, rows }
  }

  // Kicks off a CSV export and returns as soon as the chunk PLAN is ready.
  // SUCCEEDED here does NOT mean every byte is written — chunks materialize
  // lazily on fetch, which is what lets the download start streaming within
  // seconds of the request instead of after the whole export.
  async startCsvExport(statement: DbxStatement): Promise<PeopleDbxCsvExport> {
    const config = this.config()
    const startedAt = Date.now()
    const first = await this.post(config, statement, {
      statement: statement.sql,
      catalog: PEOPLE_DBX_CATALOG,
      schema: PEOPLE_DBX_SCHEMA,
      format: 'CSV',
      disposition: 'EXTERNAL_LINKS',
      wait_timeout: '0s',
    })
    const settled = await this.awaitCompletion(config, first, startedAt)
    const [link] = settled.result?.external_links ?? []
    // A succeeded export always carries chunk 0, even for an empty result set
    // (verified: that chunk holds the header row alone, matching what Postgres
    // COPY ... HEADER TRUE writes). No link means something is wrong, and an
    // empty download would present as a legitimate answer.
    if (!link) {
      throw new Error('Databricks CSV export returned no first chunk')
    }
    return {
      statementId: settled.statement_id ?? '',
      totalRows: settled.manifest?.total_row_count ?? 0,
      totalChunks: settled.manifest?.total_chunk_count ?? 0,
      firstChunk: {
        externalLink: link.external_link,
        nextChunkLink: link.next_chunk_internal_link ?? null,
      },
    }
  }

  // Presigned links expire in ~15 minutes, so a long export has to re-request
  // them as it goes rather than resolving the whole chain up front. A chunk the
  // manifest promised but that comes back linkless throws rather than ending
  // the chain: silently stopping there would hand the user a truncated voter
  // export that looks complete.
  async fetchCsvChunk(link: string): Promise<PeopleDbxCsvChunk> {
    const config = this.config()
    const chunk = await this.fetchJson(config, link, chunkResponseSchema)
    const [external] = chunk.external_links ?? []
    if (!external) {
      throw new Error(`Databricks CSV chunk ${link} returned no link`)
    }
    return {
      externalLink: external.external_link,
      nextChunkLink: external.next_chunk_internal_link ?? null,
    }
  }

  private async awaitCompletion(
    config: PeopleDbxConfig,
    initial: StatementResponse,
    startedAt: number,
  ): Promise<StatementResponse> {
    let current = initial
    while (current.status.state !== SUCCEEDED) {
      if (TERMINAL_FAILURE_STATES.has(current.status.state)) {
        throw new Error(
          `Databricks statement ${current.status.state}: ` +
            (current.status.error?.message ?? 'no error message'),
        )
      }
      const elapsed = Date.now() - startedAt
      if (elapsed > STATEMENT_TIMEOUT_MS) {
        this.cancel(config, current.statement_id)
        throw new PeopleDbxTimeoutError(elapsed)
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      if (!current.statement_id) {
        throw new Error('Databricks statement is pending with no statement_id')
      }
      current = await this.fetchJson(
        config,
        `/api/2.0/sql/statements/${current.statement_id}`,
        statementResponseSchema,
      )
    }
    return current
  }

  // Fire-and-forget: an abandoned statement keeps the warehouse busy, but a
  // failed cancel must not replace the timeout the caller needs to see.
  private cancel(config: PeopleDbxConfig, statementId?: string): void {
    if (!statementId) return
    this.request(
      config,
      `/api/2.0/sql/statements/${statementId}/cancel`,
      'POST',
    ).catch((err: unknown) => {
      this.logger.warn({ err, statementId }, 'Failed to cancel dbx statement')
    })
  }

  private async post(
    config: PeopleDbxConfig,
    statement: DbxStatement,
    body: Record<string, string>,
  ): Promise<StatementResponse> {
    const bytes = Buffer.byteLength(body.statement ?? '', 'utf8')
    if (bytes > MAX_STATEMENT_BYTES) {
      throw new PeopleDbxStatementTooLargeError(bytes)
    }
    if (statement.params.length > MAX_STATEMENT_PARAMETERS) {
      throw new PeopleDbxStatementTooLargeError(statement.params.length)
    }
    const response = await this.request(
      config,
      '/api/2.0/sql/statements',
      'POST',
      body,
      statement.params,
    )
    return statementResponseSchema.parse(await response.json())
  }

  private async fetchJson<T extends z.ZodTypeAny>(
    config: PeopleDbxConfig,
    path: string,
    schema: T,
  ): Promise<z.infer<T>> {
    const response = await this.request(config, path, 'GET')
    return schema.parse(await response.json())
  }

  private async request(
    config: PeopleDbxConfig,
    path: string,
    method: 'GET' | 'POST',
    body?: Record<string, string>,
    params?: DbxParam[],
  ): Promise<Response> {
    const token = await this.accessToken(config)
    const response = await fetch(`https://${config.hostname}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body
        ? JSON.stringify({
            ...body,
            warehouse_id: config.warehouseId,
            ...(params && params.length > 0 ? { parameters: params } : {}),
          })
        : undefined,
    })
    if (!response.ok) {
      const body = await response.text()
      // 401/403 is an expired or under-granted credential — the failure this
      // cutover is most likely to hit, and the one worth naming precisely.
      if (UNREACHABLE_STATUSES.has(response.status)) {
        throw new PeopleDbxUnavailableError(
          `${method} ${path} returned ${response.status}: ${body}`,
        )
      }
      throw new Error(
        `Databricks ${method} ${path} failed with ${response.status}: ${body}`,
      )
    }
    return response
  }

  private async accessToken(config: PeopleDbxConfig): Promise<string> {
    if (config.accessToken) return config.accessToken
    const cached = this.token
    if (cached && cached.expiresAt > Date.now()) return cached.value
    if (!config.oauthClientId || !config.oauthClientSecret) {
      throw new PeopleDbxUnavailableError('no usable credential is configured')
    }
    const credential = Buffer.from(
      `${config.oauthClientId}:${config.oauthClientSecret}`,
    ).toString('base64')
    const response = await fetch(`https://${config.hostname}/oidc/v1/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credential}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials&scope=all-apis',
    })
    if (!response.ok) {
      throw new PeopleDbxUnavailableError(
        `token request returned ${response.status}: ${await response.text()}`,
      )
    }
    const parsed = tokenResponseSchema.parse(await response.json())
    this.token = {
      value: parsed.access_token,
      expiresAt:
        Date.now() + (parsed.expires_in ?? 3600) * 1000 - TOKEN_EXPIRY_SKEW_MS,
    }
    return parsed.access_token
  }
}
