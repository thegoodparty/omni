import { HttpService } from '@nestjs/axios'
import { BadGatewayException, Injectable } from '@nestjs/common'
import JSZip from 'jszip'
import parseCsv from 'neat-csv'
import { PinoLogger } from 'nestjs-pino'
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
    const csv = await this.downloadText(link, context)
    return this.parseRows(await parseCsv(csv), peerlyCdrCsvRowSchema, context)
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
    return data.link
  }

  private async downloadText(link: string, context: string): Promise<string> {
    try {
      const response = await lastValueFrom(
        this.httpService.get<string>(link, {
          responseType: 'text',
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

  private async downloadBuffer(link: string, context: string): Promise<Buffer> {
    try {
      const response = await lastValueFrom(
        this.httpService.get<ArrayBuffer>(link, {
          responseType: 'arraybuffer',
          timeout: this.httpTimeoutMs,
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
    const csvEntry = entries.find((entry) =>
      entry.name.toLowerCase().endsWith('.csv'),
    )
    if (!csvEntry) {
      throw new BadGatewayException(
        `Peerly ${context} zip archive contains no .csv entry`,
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
