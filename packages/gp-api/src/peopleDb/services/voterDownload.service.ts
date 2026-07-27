import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { Pool, PoolClient } from 'pg'
import { CopyToStreamQuery, to as copyTo } from 'pg-copy-streams'
import { PeopleDbUrlProvider } from '../peopleDbUrl.provider'
import { DistrictService } from './district.service'
import { DownloadPeopleDTO } from '../schemas/people.schema'
import { DOWNLOAD_COLUMNS, ExcludableVoterColumn } from '../voter.select'
import { buildVoterWhereSql } from '../utils/buildVoterWhereSql.util'
import { buildHouseholdKeySql } from '../utils/buildHouseholdKeySql.util'
import { inlinePrismaSql } from '../utils/inlinePrismaSql.util'
import { resolveDistrict } from '../utils/resolveDistrict.util'

const DATABASE_SCHEMA = 'green'
const VOTER_TABLENAME = 'Voter'
const DISTRICTVOTER_TABLENAME = 'DistrictVoter'

const quoteIdent = (id: string) => `"${id.replace(/"/g, '""')}"`

@Injectable()
export class VoterDownloadService
  implements OnApplicationBootstrap, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(VoterDownloadService.name)
  private pool!: Pool
  private unsubscribe: (() => void) | null = null

  constructor(
    private readonly districtService: DistrictService,
    private readonly peopleDbUrl: PeopleDbUrlProvider,
  ) {}

  async onModuleInit() {
    this.pool = this.buildPool(await this.peopleDbUrl.ensureLoaded())
    this.unsubscribe = this.peopleDbUrl.onChange((url) => {
      const previous = this.pool
      this.pool = this.buildPool(url)
      // end() drains: it waits for checked-out clients (e.g. an in-flight COPY)
      // to be released before closing, so no explicit delay is needed.
      previous.end().catch((err: unknown) => {
        this.logger.warn({ err }, 'Failed to end previous pg pool')
      })
    })
  }

  private buildPool(connectionString: string): Pool {
    // Each COPY holds one session for the entire download. Cap connections so
    // CSV downloads cannot crowd out other workloads.
    //
    // NOTE: `COPY ... TO STDOUT` requires a session-mode Postgres connection.
    // It is INCOMPATIBLE with `pgbouncer` in transaction or statement pooling
    // mode. people-db currently connects directly to Aurora Postgres, which
    // is session-mode. If a transaction-mode pooler is ever introduced in
    // front of the DB, this service must bypass it.
    return new Pool({ connectionString, max: 10 })
  }

  onApplicationBootstrap() {
    // Pay the cold-connect cost up front so the first user-initiated download
    // after a deploy / idle period doesn't include 200-500ms of pg handshake
    // in its TTFB. Fire-and-forget; if it fails the next real request will
    // retry and surface the error normally. Runs only when Nest finishes
    // bootstrapping, so unit tests that instantiate the service directly do
    // not pay this cost or pollute pool-call assertions.
    this.pool
      .connect()
      .then((client) => client.release())
      .catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err))
        this.logger.warn({ err: error }, 'Pre-warm of pg pool failed')
      })
  }

  async onModuleDestroy() {
    this.unsubscribe?.()
    await this.pool.end()
  }

  async streamPeopleCsv(
    dto: DownloadPeopleDTO,
    res: FastifyReply,
  ): Promise<void> {
    const { state, useVoterOnlyPath, districtId } = await resolveDistrict(
      this.districtService,
      dto,
    )
    const effectiveDistrictId = useVoterOnlyPath ? null : districtId

    let client: PoolClient
    try {
      client = await this.pool.connect()
    } catch (err) {
      this.logger.error({ err }, 'Failed to acquire pg client for COPY')
      throw new InternalServerErrorException('Failed to start download')
    }

    // A 1M-row COPY can run for minutes. Disable any inherited
    // `statement_timeout` for this session so the export is not killed
    // mid-stream by a cluster default. Pool clients can be reused, so a
    // future caller may inherit the relaxed value — every subsequent COPY
    // also sets it explicitly, and no non-COPY path uses this pool.
    try {
      await client.query('SET statement_timeout = 0')
    } catch (err) {
      client.release()
      this.logger.error({ err }, 'Failed to disable statement_timeout for COPY')
      throw new InternalServerErrorException('Failed to start download')
    }

    // Build the COPY SQL and start the stream BEFORE committing response
    // headers. A synchronous failure here (bad filter shape, COPY init
    // rejected) must release the pool client and surface a structured 5xx
    // — once headers are flushed the connection becomes a binary download
    // and we can no longer deliver a JSON error.
    let copyStream: CopyToStreamQuery
    try {
      const sql = this.buildCopySql({
        client,
        effectiveDistrictId,
        state,
        filters: dto.filters,
        groupByHousehold: dto.groupByHousehold,
        excludeColumns: dto.excludeColumns,
      })
      copyStream = client.query(copyTo(sql))
    } catch (err) {
      client.release()
      this.logger.error({ err }, 'Failed to start COPY query')
      throw new InternalServerErrorException('Failed to start download')
    }

    // Commit the response headers to the wire now. Postgres can take many
    // seconds to plan + return the first batch of a large COPY, and Fastify
    // would otherwise hold our headers until the first body chunk is
    // written. Flushing here lets the browser display its native download
    // notification and lets gp-api forward its `Set-Cookie` handshake to the
    // client before COPY starts producing bytes. After this point we can no
    // longer return a structured error; the `copyStream.on('error', ...)`
    // handler below destroys the socket on failure, which is the correct
    // behavior for an in-flight streaming response.
    res.raw.setHeader('Content-Type', 'text/csv')
    res.raw.setHeader(
      'Content-Disposition',
      'attachment; filename="people.csv"',
    )
    if (!res.raw.headersSent) {
      res.raw.flushHeaders()
    }

    let released = false
    const release = () => {
      if (released) return
      released = true
      client.release()
    }

    copyStream.on('end', () => {
      release()
    })

    copyStream.on('error', (err: Error) => {
      this.logger.error({ err }, 'COPY stream error')
      release()
      if (!res.raw.headersSent) {
        res.raw.statusCode = 500
      }
      // Headers have likely already been sent for a streaming response, so we
      // cannot deliver a structured error. Terminate the underlying socket
      // without propagating the error event (the client will see a truncated
      // response and we have logged the cause).
      if (!res.raw.destroyed) {
        res.raw.destroy()
      }
    })

    res.raw.on('close', () => {
      if (!copyStream.destroyed) {
        copyStream.destroy()
      }
      release()
    })

    copyStream.pipe(res.raw)

    // Keep the Nest request alive until the response has fully flushed to the
    // client. Real HTTP responses fire `close` once the socket is done; in
    // tests / non-socket wrappers `finish` arrives first after `end()`. We
    // accept either signal.
    await new Promise<void>((resolve) => {
      const done = () => resolve()
      res.raw.once('close', done)
      res.raw.once('finish', done)
    })
  }

  private buildCopySql(args: {
    client: PoolClient
    effectiveDistrictId: string | null
    state: string
    filters: DownloadPeopleDTO['filters']
    groupByHousehold?: boolean
    excludeColumns?: ExcludableVoterColumn[]
  }): string {
    const {
      client,
      effectiveDistrictId,
      state,
      filters,
      groupByHousehold,
      excludeColumns,
    } = args

    const excluded = new Set<string>(excludeColumns ?? [])

    const voterCols = DOWNLOAD_COLUMNS.filter(
      ({ column }) => !excluded.has(column),
    )
      .map(
        ({ column, header }) =>
          `v.${quoteIdent(column)} AS ${quoteIdent(header)}`,
      )
      .join(', ')

    // Mirror the list endpoint's door-knocking de-dup: emit one row per
    // physical household. DISTINCT ON keeps a single representative voter per
    // residence-address composite; its leading ORDER BY must match the key,
    // with v."id" as the deterministic tiebreaker.
    const householdKey = groupByHousehold
      ? inlinePrismaSql(buildHouseholdKeySql('v'), client)
      : ''
    const distinctOn = groupByHousehold ? `DISTINCT ON (${householdKey}) ` : ''
    const orderBy = groupByHousehold ? `ORDER BY ${householdKey}, v."id"` : ''

    const selectList = `SELECT ${distinctOn}${voterCols}`

    const voterTable = `"${DATABASE_SCHEMA}"."${VOTER_TABLENAME}"`
    const dvTable = `"${DATABASE_SCHEMA}"."${DISTRICTVOTER_TABLENAME}"`
    const joinClause = effectiveDistrictId
      ? `JOIN ${dvTable} dv ON v."State" = dv."State" AND v."id" = dv."voter_id"`
      : ''

    const whereSql = buildVoterWhereSql({
      state,
      districtId: effectiveDistrictId,
      filters,
    })
    const whereClause = inlinePrismaSql(whereSql, client)

    return `COPY (
      ${selectList}
      FROM ${voterTable} v
      ${joinClause}
      ${whereClause}
      ${orderBy}
    ) TO STDOUT WITH (FORMAT CSV, HEADER TRUE)`
  }
}
