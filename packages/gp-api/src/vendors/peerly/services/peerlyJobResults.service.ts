import { HttpService } from '@nestjs/axios'
import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
} from '@nestjs/common'
import { AxiosError, isAxiosError } from 'axios'
import csvParser from 'csv-parser'
import JSZip from 'jszip'
import parseCsv from 'neat-csv'
import { PinoLogger } from 'nestjs-pino'
import { Readable, Transform, TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { lastValueFrom } from 'rxjs'
import { z } from 'zod'
import { PeerlyBaseConfig } from '../config/peerlyBaseConfig'
import {
  PeerlyCdrCsvRow,
  peerlyCdrCsvRowSchema,
  PeerlyQuestionResponsesCsvRow,
  peerlyQuestionResponsesCsvRowSchema,
  PeerlyReportLinkResponseDto,
} from '../schemas/peerlyJobResultsReport.schema'
import { PeerlyHttpService } from './peerlyHttp.service'

export interface PeerlyReportDateWindow {
  startDate: string
  endDate: string
}

export interface PeerlyReportRequestOptions {
  timeoutMs: number
  retry: boolean
}

// Per-lead job results only exist as generated report files (ENG-10727):
// the API returns a signed file URL, downloaded without Peerly auth. There
// is no pagination — every call exports the whole window, so callers bound
// the window to the job's lifetime (multi-year ranges 504 upstream) and
// dedupe rows on their side. Report rows carry voter PII: never log row
// contents, only counts.
// Reports are fetched whole (no cursoring) and the zip path decompresses
// in memory a second time; cap the transfer like the sibling Peerly
// services do.
const MAX_REPORT_SIZE = 104857600

// The CDR is streamed and only inbound rows are kept, so memory no longer
// scales with the file; the cap only stops a runaway download. A big job's
// report already passes 60MB and keeps growing as an election nears.
export const MAX_CDR_REPORT_BYTES = 524288000

// Inbound rows read 'received' in prod; anything that is not an outbound
// row is kept rather than matched against that literal, so a vendor rename
// degrades to extra rows, not to silently dropped replies.
const PEERLY_CDR_OUTBOUND_DIRECTION = 'sent'

const isTimeoutError = (error: Error): boolean =>
  isAxiosError(error) &&
  (error.code === AxiosError.ECONNABORTED ||
    error.code === AxiosError.ETIMEDOUT)

@Injectable()
export class PeerlyJobResultsService extends PeerlyBaseConfig {
  constructor(
    protected readonly logger: PinoLogger,
    private readonly peerlyHttpService: PeerlyHttpService,
    private readonly httpService: HttpService,
  ) {
    super(logger)
  }

  // The full CDR is every message of the job (tens of MB for a big send).
  // Parsing it whole on the main thread froze the 1-vCPU container for
  // seconds at a time, so it is parsed as it streams and outbound rows are
  // dropped before validation.
  async fetchInboundCdrRows(
    jobId: string,
    window: PeerlyReportDateWindow,
  ): Promise<PeerlyCdrCsvRow[]> {
    const context = 'CDR report'
    const link = await this.fetchReportLink(
      `/v2/p2p/${jobId}/cdrs`,
      window,
      context,
    )
    const body = await this.downloadStream(link, context)
    return this.parseInboundCdrRows(body, context)
  }

  async fetchQuestionResponseRows(
    jobId: string,
    window: PeerlyReportDateWindow,
    request?: PeerlyReportRequestOptions,
  ): Promise<PeerlyQuestionResponsesCsvRow[]> {
    const context = 'question responses report'
    const link = await this.fetchReportLink(
      `/1to1/jobs/${jobId}/questionresponses`,
      window,
      context,
      request,
    )
    const zipBuffer = await this.downloadBuffer(link, context)
    const csv = await this.unzipSingleCsv(zipBuffer, context)
    return this.parseRows(
      await parseCsv(csv),
      peerlyQuestionResponsesCsvRowSchema,
      context,
    )
  }

  private async fetchReportLink(
    path: string,
    window: PeerlyReportDateWindow,
    context: string,
    request?: PeerlyReportRequestOptions,
  ): Promise<string> {
    const params = {
      date_range: 'CUSTOM',
      start_date: window.startDate,
      end_date: window.endDate,
      show_headers: true,
    }
    let data: PeerlyReportLinkResponseDto
    try {
      const response = await (request
        ? this.peerlyHttpService.get(
            path,
            { params, timeout: request.timeoutMs },
            { retry: request.retry },
          )
        : this.peerlyHttpService.get(path, { params }))
      data = this.peerlyHttpService.validateResponse(
        response.data,
        PeerlyReportLinkResponseDto,
        context,
      )
    } catch (error) {
      if (error instanceof BadGatewayException) throw error
      // Raw axios errors embed the request config (auth headers) — log only
      // the message.
      this.logger.error(
        { message: error instanceof Error ? error.message : String(error) },
        `Failed to fetch Peerly ${context} link`,
      )
      if (error instanceof Error && isTimeoutError(error)) {
        throw new GatewayTimeoutException(
          `Timed out fetching Peerly ${context} link`,
        )
      }
      throw new BadGatewayException(`Failed to fetch Peerly ${context} link`)
    }
    // SSRF guard: the link is vendor-supplied and fetched server-side, so a
    // compromised Peerly response must not steer requests at the instance
    // metadata service or internal hosts. Reports live on GCS/S3 only.
    const { hostname } = new URL(data.link)
    // Any AWS customer's bucket lives under *.amazonaws.com, so only
    // S3-shaped hostnames pass: global (bucket.s3.amazonaws.com,
    // s3.amazonaws.com) and regional (bucket.s3.us-east-1.amazonaws.com) —
    // an over-tight guard breaking on a vendor URL-style change has burned
    // prod fetches before.
    const allowed =
      hostname === 'storage.googleapis.com' ||
      hostname === 's3.amazonaws.com' ||
      hostname.endsWith('.s3.amazonaws.com') ||
      /\.s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(hostname)
    if (!allowed) {
      this.logger.error(
        { hostname },
        `Peerly ${context} link points to unexpected host`,
      )
      throw new BadGatewayException(`Unexpected host in Peerly ${context} link`)
    }
    return data.link
  }

  private async downloadStream(
    link: string,
    context: string,
  ): Promise<Readable> {
    try {
      const response = await lastValueFrom(
        this.httpService.get<Readable>(link, {
          responseType: 'stream',
          timeout: this.httpTimeoutMs,
        }),
      )
      return response.data
    } catch (error) {
      // The link is a signed URL (a credential) and axios errors embed it
      // in their config — log only the message.
      this.logger.error(
        { message: error instanceof Error ? error.message : String(error) },
        `Failed to download Peerly ${context} file`,
      )
      throw new BadGatewayException(`Failed to download Peerly ${context} file`)
    }
  }

  private async parseInboundCdrRows(
    body: Readable,
    context: string,
  ): Promise<PeerlyCdrCsvRow[]> {
    const inboundRows: PeerlyCdrCsvRow[] = []
    let streamedBytes = 0
    let rowCount = 0
    // axios does not enforce maxContentLength on a stream response, so the
    // cap is counted here as bytes arrive.
    const byteCap = new Transform({
      transform: (
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback,
      ) => {
        streamedBytes += chunk.length
        if (streamedBytes > MAX_CDR_REPORT_BYTES) {
          callback(
            new BadGatewayException(
              `Peerly ${context} file exceeds ${MAX_CDR_REPORT_BYTES} bytes`,
            ),
          )
          return
        }
        callback(null, chunk)
      },
    })
    try {
      await pipeline(
        body,
        byteCap,
        csvParser(),
        async (records: AsyncIterable<Record<string, string>>) => {
          for await (const record of records) {
            rowCount += 1
            if (
              record.Direction?.trim().toLowerCase() ===
              PEERLY_CDR_OUTBOUND_DIRECTION
            ) {
              continue
            }
            const parsed = peerlyCdrCsvRowSchema.safeParse(record)
            if (!parsed.success) {
              // Rows are PII — log issue locations, never row values.
              this.logger.error(
                {
                  rowCount,
                  issues: parsed.error.issues
                    .slice(0, 5)
                    .map(({ code, path }) => ({ code, path })),
                },
                `Peerly ${context} rows failed validation`,
              )
              throw new BadGatewayException(
                `Invalid ${context} rows from Peerly report`,
              )
            }
            inboundRows.push(parsed.data)
          }
        },
      )
    } catch (error) {
      if (error instanceof BadGatewayException) throw error
      // A mid-stream socket error can carry the signed URL in its config —
      // log only the message.
      this.logger.error(
        {
          message: error instanceof Error ? error.message : String(error),
          rowCount,
        },
        `Failed to stream Peerly ${context} file`,
      )
      throw new BadGatewayException(`Failed to download Peerly ${context} file`)
    }
    return inboundRows
  }

  private async downloadBuffer(link: string, context: string): Promise<Buffer> {
    try {
      const response = await lastValueFrom(
        this.httpService.get<ArrayBuffer>(link, {
          responseType: 'arraybuffer',
          timeout: this.httpTimeoutMs,
          maxContentLength: MAX_REPORT_SIZE,
          maxBodyLength: MAX_REPORT_SIZE,
        }),
      )
      return Buffer.from(response.data)
    } catch (error) {
      // Same signed-URL concern as downloadText: never log the link.
      this.logger.error(
        { message: error instanceof Error ? error.message : String(error) },
        `Failed to download Peerly ${context} file`,
      )
      throw new BadGatewayException(`Failed to download Peerly ${context} file`)
    }
  }

  private async unzipSingleCsv(
    buffer: Buffer,
    context: string,
  ): Promise<string> {
    let zip: JSZip
    try {
      zip = await JSZip.loadAsync(buffer)
    } catch {
      throw new BadGatewayException(
        `Peerly ${context} file is not a valid zip archive`,
      )
    }
    const entries = Object.values(zip.files).filter((entry) => !entry.dir)
    const [csvEntry, ...extraCsvEntries] = entries.filter((entry) =>
      entry.name.toLowerCase().endsWith('.csv'),
    )
    if (!csvEntry) {
      throw new BadGatewayException(
        `Peerly ${context} zip archive contains no .csv entry`,
      )
    }
    // Entry order is unspecified by the zip format: with two CSVs there is
    // no way to know which is the data file, and guessing risks silently
    // ingesting a manifest.
    if (extraCsvEntries.length > 0) {
      this.logger.error(
        {
          files: [csvEntry, ...extraCsvEntries].map((entry) => entry.name),
        },
        `Peerly ${context} zip archive contains multiple .csv entries`,
      )
      throw new BadGatewayException(
        `Peerly ${context} zip archive contains multiple .csv entries`,
      )
    }
    return csvEntry.async('string')
  }

  private parseRows<Schema extends z.ZodTypeAny>(
    records: Awaited<ReturnType<typeof parseCsv>>,
    schema: Schema,
    context: string,
  ): z.infer<Schema>[] {
    const parsed = z.array(schema).safeParse(records)
    if (!parsed.success) {
      // Rows are PII — log issue locations, never row values.
      this.logger.error(
        {
          rowCount: records.length,
          issues: parsed.error.issues
            .slice(0, 5)
            .map(({ code, path }) => ({ code, path })),
        },
        `Peerly ${context} rows failed validation`,
      )
      throw new BadGatewayException(
        `Invalid ${context} rows from Peerly report`,
      )
    }
    return parsed.data
  }
}
