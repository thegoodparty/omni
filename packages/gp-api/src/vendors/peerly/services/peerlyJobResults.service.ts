import { HttpService } from '@nestjs/axios'
import { BadGatewayException, Injectable } from '@nestjs/common'
import csvParser from 'csv-parser'
import JSZip from 'jszip'
import { PinoLogger } from 'nestjs-pino'
import { Readable } from 'node:stream'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
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

// A CDR export can run to 60 MB. Parsed in one piece, that blocked the event
// loop for over 5s on a prod task and stalled every request it was serving
// (ENG-11251). Fed to the parser in slices with a yield between them, the
// longest block is tens of milliseconds.
const CSV_SLICE_BYTES = 65536

async function* slicesOf(csv: Buffer): AsyncGenerator<Buffer> {
  for (let start = 0; start < csv.length; start += CSV_SLICE_BYTES) {
    yield csv.subarray(start, start + CSV_SLICE_BYTES)
    await yieldToEventLoop()
  }
}

@Injectable()
export class PeerlyJobResultsService extends PeerlyBaseConfig {
  constructor(
    protected readonly logger: PinoLogger,
    private readonly peerlyHttpService: PeerlyHttpService,
    private readonly httpService: HttpService,
  ) {
    super(logger)
  }

  async fetchCdrRows(
    jobId: string,
    window: PeerlyReportDateWindow,
  ): Promise<PeerlyCdrCsvRow[]> {
    const context = 'CDR report'
    const link = await this.fetchReportLink(
      `/v2/p2p/${jobId}/cdrs`,
      window,
      context,
    )
    const csv = await this.downloadBuffer(link, context)
    return this.parseRows(csv, peerlyCdrCsvRowSchema, context)
  }

  async fetchQuestionResponseRows(
    jobId: string,
    window: PeerlyReportDateWindow,
  ): Promise<PeerlyQuestionResponsesCsvRow[]> {
    const context = 'question responses report'
    const link = await this.fetchReportLink(
      `/1to1/jobs/${jobId}/questionresponses`,
      window,
      context,
    )
    const zipBuffer = await this.downloadBuffer(link, context)
    const csv = await this.unzipSingleCsv(zipBuffer, context)
    return this.parseRows(csv, peerlyQuestionResponsesCsvRowSchema, context)
  }

  private async fetchReportLink(
    path: string,
    window: PeerlyReportDateWindow,
    context: string,
  ): Promise<string> {
    let data: PeerlyReportLinkResponseDto
    try {
      const response = await this.peerlyHttpService.get(path, {
        params: {
          date_range: 'CUSTOM',
          start_date: window.startDate,
          end_date: window.endDate,
          show_headers: true,
        },
      })
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
      // The link is a signed URL (a credential) and axios errors embed it
      // in their config — log only the message.
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
  ): Promise<Buffer> {
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
    return csvEntry.async('nodebuffer')
  }

  private async parseRows<Schema extends z.ZodTypeAny>(
    csv: Buffer,
    schema: Schema,
    context: string,
  ): Promise<z.infer<Schema>[]> {
    const rows: z.infer<Schema>[] = []
    const records = Readable.from(slicesOf(csv)).pipe(csvParser())
    for await (const record of records) {
      const parsed = schema.safeParse(record)
      if (!parsed.success) {
        // Rows are PII — log issue locations, never row values.
        this.logger.error(
          {
            rowIndex: rows.length,
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
      rows.push(parsed.data)
    }
    return rows
  }
}
