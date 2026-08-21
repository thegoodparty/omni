import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { createGzip } from 'node:zlib'
import { once } from 'node:events'
import { DownloadPeopleDTO } from '../schemas/people.schema'
import { buildCsvSql } from './databricksVoterSql.util'
import { DatabricksVoterService } from './databricksVoter.service'
import {
  PeopleDbxStatementClient,
  type PeopleDbxCsvChunk,
} from './peopleDbxStatement.client'

@Injectable()
export class DatabricksVoterDownloadService {
  private readonly logger = new Logger(DatabricksVoterDownloadService.name)

  constructor(
    private readonly client: PeopleDbxStatementClient,
    private readonly voters: DatabricksVoterService,
  ) {}

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
    let firstChunk: PeopleDbxCsvChunk | null
    try {
      firstChunk = (await this.client.startCsvExport(sql)).firstChunk
    } catch (err) {
      this.logger.error({ err }, 'Failed to start Databricks CSV export')
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
  // 15-minute TTL, so each link is requested only when the pump reaches it
  // rather than resolving the whole chain up front. Each chunk is read whole
  // (~8-20MB at the 76-column projection) and then awaited onto the gzip
  // stream, so at most one chunk per download is ever in memory.
  private async pumpChunks(
    first: PeopleDbxCsvChunk | null,
    gzip: NodeJS.WritableStream,
    isAborted: () => boolean,
  ): Promise<void> {
    let chunk = first
    while (chunk && !isAborted()) {
      const response = await fetch(chunk.externalLink)
      if (!response.ok) {
        throw new Error(
          `Databricks CSV chunk fetch failed with ${response.status}`,
        )
      }
      const body = Buffer.from(await response.arrayBuffer())
      if (!gzip.write(body)) {
        await once(gzip, 'drain')
      }
      chunk = chunk.nextChunkLink
        ? await this.client.fetchCsvChunk(chunk.nextChunkLink)
        : null
    }
  }
}
