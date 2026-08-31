import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import type { FastifyReply } from 'fastify'
import { createGzip } from 'node:zlib'
import { once } from 'node:events'
import { DownloadPeopleDTO } from '../schemas/people.schema'
import { buildCsvSql } from './databricksVoterSql.util'
import { DatabricksVoterService } from './databricksVoter.service'
import {
  PeopleDbxStatementClient,
  PeopleDbxStatementTooLargeError,
  PeopleDbxTimeoutError,
  PeopleDbxUnavailableError,
  type PeopleDbxCsvChunk,
} from './peopleDbxStatement.client'

@Injectable()
export class DatabricksVoterDownloadService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly client: PeopleDbxStatementClient,
    private readonly voters: DatabricksVoterService,
  ) {
    this.logger.setContext(DatabricksVoterDownloadService.name)
  }

  async streamPeopleCsv(
    dto: DownloadPeopleDTO,
    res: FastifyReply,
    responseOptions?: {
      filename?: string
      extraHeaders?: Record<string, string>
    },
  ): Promise<void> {
    const district = await this.voters.resolveDistrict(dto.districtId)
    const sql = buildCsvSql({
      district,
      filters: dto.filters,
      idOverrides: dto.idOverrides,
      contactsMadeIdOverrides: dto.contactsMadeIdOverrides,
      excludeColumns: dto.excludeColumns,
    })

    // Start the export BEFORE committing response headers. Everything up to
    // the chunk plan can still fail into a structured 5xx; once headers are
    // flushed the connection is a binary download and we cannot.
    let firstChunk: PeopleDbxCsvChunk
    try {
      firstChunk = (await this.client.startCsvExport(sql)).firstChunk
    } catch (err) {
      this.logger.error({ err }, 'Failed to start Databricks CSV export')
      // Caused by how many people the caller listed individually, so it earns a
      // 400 rather than being flattened into the generic start failure.
      if (err instanceof PeopleDbxStatementTooLargeError) {
        throw new BadRequestException(
          'This selection carries too many individually listed people to ' +
            'export. Narrow it and try again.',
        )
      }
      if (err instanceof PeopleDbxUnavailableError) {
        throw new BadGatewayException(
          'Voter data is temporarily unavailable, so the export could not ' +
            'start. This is a connection problem, not an empty district.',
        )
      }
      // A cold warehouse can take long enough to answer that the statement
      // poll gives up, which is a retry-shortly condition rather than a broken
      // service. DatabricksVoterService maps the same error the same way.
      if (err instanceof PeopleDbxTimeoutError) {
        throw new GatewayTimeoutException(
          'Voter data export timed out before it could start. Try again ' +
            'shortly.',
        )
      }
      throw new InternalServerErrorException('Failed to start download')
    }

    res.raw.setHeader('Content-Type', 'text/csv')
    // gzip on the wire: a statewide export is millions of wide rows and CSV
    // compresses ~8-10x, which is what keeps the transfer under an upstream
    // idle timeout. The browser decompresses transparently.
    res.raw.setHeader('Content-Encoding', 'gzip')
    res.raw.setHeader(
      'Content-Disposition',
      `attachment; filename="${responseOptions?.filename ?? 'people.csv'}"`,
    )
    for (const [key, value] of Object.entries(
      responseOptions?.extraHeaders ?? {},
    )) {
      res.raw.setHeader(key, value)
    }
    if (!res.raw.headersSent) {
      res.raw.flushHeaders()
    }

    const gzip = createGzip()
    let aborted = false
    const abort = (err: Error) => {
      if (aborted) return
      aborted = true
      this.logger.error({ err }, 'Databricks CSV stream error')
      if (!gzip.destroyed) gzip.destroy()
      if (!res.raw.destroyed) res.raw.destroy()
    }
    gzip.on('error', abort)
    res.raw.on('close', () => {
      aborted = true
      if (!gzip.destroyed) gzip.destroy()
    })
    gzip.pipe(res.raw)

    try {
      await this.pumpChunks(firstChunk, gzip, () => aborted)
      gzip.end()
    } catch (err) {
      abort(err instanceof Error ? err : new Error(String(err)))
    }

    // Keep the Nest request alive until the response has fully flushed. Real
    // HTTP responses fire `close`; test/non-socket wrappers fire `finish`
    // first after end(). Either signal is accepted.
    await new Promise<void>((resolve) => {
      const done = () => resolve()
      res.raw.once('close', done)
      res.raw.once('finish', done)
    })
  }

  // Chunks materialize lazily, and their presigned links carry roughly a
  // 15-minute TTL, so links are resolved as the pump reaches them rather than
  // the whole chain up front.
  //
  // The next chunk is started BEFORE the current one is written, so its link
  // round trip and its download overlap the gzip write instead of following it.
  // Drained strictly in series, the link round trips alone measured ~6.5s of a
  // 22.6s drain on a large district -- time spent waiting on nothing. At most
  // two chunks (~8-20MB each at the 76-column projection) are in memory.
  private async pumpChunks(
    first: PeopleDbxCsvChunk,
    gzip: NodeJS.WritableStream,
    isAborted: () => boolean,
  ): Promise<void> {
    let chunk: PeopleDbxCsvChunk | null = first
    let body = this.readChunk(chunk)
    let ahead: Promise<PeopleDbxCsvChunk> | null = null
    try {
      while (chunk && !isAborted()) {
        ahead = chunk.nextChunkLink
          ? this.client.fetchCsvChunk(chunk.nextChunkLink)
          : null
        const current = await body
        if (!gzip.write(current)) {
          await once(gzip, 'drain')
        }
        chunk = ahead ? await ahead : null
        ahead = null
        body = chunk ? this.readChunk(chunk) : Promise.resolve(Buffer.alloc(0))
      }
    } finally {
      // Either read can still be in flight when the loop leaves early -- an
      // abort, or the other one throwing -- and an unhandled rejection takes
      // the process down rather than the download. Both are hoisted so this
      // can reach them: a loop-scoped `ahead` is unreachable by the time
      // `await body` has thrown.
      void body.catch(() => undefined)
      void ahead?.catch(() => undefined)
    }
  }

  private async readChunk(chunk: PeopleDbxCsvChunk): Promise<Buffer> {
    const response = await fetch(chunk.externalLink)
    if (!response.ok) {
      throw new Error(
        `Databricks CSV chunk fetch failed with ${response.status}`,
      )
    }
    return Buffer.from(await response.arrayBuffer())
  }
}
