import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { HttpService } from '@nestjs/axios'
import { AxiosError } from 'axios'
import JSZip from 'jszip'
import { PinoLogger } from 'nestjs-pino'
import { Readable } from 'node:stream'
import { of, throwError } from 'rxjs'
import { createMockLogger } from 'src/shared/test-utils/mockLogger.util'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_CDR_REPORT_BYTES,
  PeerlyJobResultsService,
} from './peerlyJobResults.service'
import { PeerlyHttpService } from './peerlyHttp.service'

const JOB_ID = '9FFzaTFvt67QZpxzPp52'
const WINDOW = { startDate: '2026-07-01', endDate: '2026-07-18' }

const CDR_HEADERS = [
  'Timestamp',
  'Direction',
  'Agent_id',
  'Agent_name',
  'Conversation_id',
  'From',
  'To',
  'Content',
  'Chunk',
  'Result',
  'Cost',
  'Canvasser_rate',
  'Unicode',
  'MMS',
  'Media Url',
  'Extern_id',
  'Sublist_id',
  'Title',
  'First_name',
  'Mid_name',
  'Last_name',
  'Suffix',
  'Address1',
  'Address2',
  'City',
  'State',
  'Zip',
  'Email',
  'Aux_data1',
  'Aux_data2',
  'Aux_data3',
  'Aux_data4',
  'Aux_data5',
] as const

const QR_HEADERS = [
  'date',
  'conversation_id',
  'agent_id',
  'agent_name',
  'agent_email',
  'from_did',
  'lead_phone',
  'sublist_id',
  'extern_id',
  'first_name',
  'mid_name',
  'last_name',
  'suffix',
  'address1',
  'address2',
  'city',
  'state',
  'zip',
  'email',
  'aux_data1',
  'aux_data2',
  'aux_data3',
  'aux_data4',
  'aux_data5',
  'optout',
] as const

const csvOf = (
  headers: readonly string[],
  rows: Partial<Record<string, string>>[],
): string =>
  [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => row[header] ?? '').join(',')),
  ].join('\n')

// Redacted phone shapes match the ENG-10727 dev capture: bare 11-digit.
const cdrCsv = csvOf(CDR_HEADERS, [
  {
    Timestamp: '2025-08-20 10:23:46',
    Direction: 'sent',
    From: '16255550100',
    To: '13255550101',
    Content: 'EARLY VOTING IS HERE',
    Result: 'SUCCESS',
  },
  {
    Timestamp: '2025-08-20 10:25:00',
    Direction: 'received',
    From: '13255550101',
    To: '16255550100',
    Content: 'STOP',
  },
  {
    Timestamp: '2025-08-20 10:26:00',
    Direction: ' Sent ',
    From: '16255550100',
    To: '13255550101',
    Content: 'You are unsubscribed',
  },
])

// The real download is an axios stream; small chunks make the parser see
// rows split across chunk boundaries the way a network body arrives.
const streamOf = (body: string): Readable =>
  Readable.from(body.match(/[\s\S]{1,16}/g) ?? [])

const zipOf = async (csv: string): Promise<Buffer> => {
  const zip = new JSZip()
  zip.file(`${JOB_ID}-report.csv`, csv)
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('PeerlyJobResultsService', () => {
  let peerlyResultsService: PeerlyJobResultsService
  let mockPeerlyHttp: {
    get: ReturnType<typeof vi.fn>
    validateResponse: ReturnType<typeof vi.fn>
  }
  let mockDownloadHttp: { get: ReturnType<typeof vi.fn> }

  const mockReportLink = (link: string) => {
    mockPeerlyHttp.get.mockResolvedValue({
      data: { result: 'success', link },
    })
  }

  beforeEach(async () => {
    mockPeerlyHttp = {
      get: vi.fn(),
      // Mirrors the real validateResponse: run the DTO, convert failures to
      // a BadGatewayException.
      validateResponse: vi
        .fn()
        .mockImplementation(
          (
            data,
            dto: { create: (input: typeof data) => typeof data },
            context: string,
          ) => {
            try {
              return dto.create(data)
            } catch {
              throw new BadGatewayException(
                `Invalid ${context} response from Peerly API`,
              )
            }
          },
        ),
    }
    mockDownloadHttp = { get: vi.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PeerlyJobResultsService,
        { provide: PinoLogger, useValue: createMockLogger() },
        { provide: PeerlyHttpService, useValue: mockPeerlyHttp },
        { provide: HttpService, useValue: mockDownloadHttp },
      ],
    }).compile()

    peerlyResultsService = module.get(PeerlyJobResultsService)
  })

  describe('fetchInboundCdrRows', () => {
    const CDR_LINK = 'https://storage.googleapis.com/cdr-reports-v2/x.csv'

    it('streams the report and returns only the inbound rows', async () => {
      mockReportLink(CDR_LINK)
      mockDownloadHttp.get.mockReturnValue(of({ data: streamOf(cdrCsv) }))

      const rows = await peerlyResultsService.fetchInboundCdrRows(
        JOB_ID,
        WINDOW,
      )

      expect(mockPeerlyHttp.get).toHaveBeenCalledWith(
        `/v2/p2p/${JOB_ID}/cdrs`,
        {
          params: {
            date_range: 'CUSTOM',
            start_date: WINDOW.startDate,
            end_date: WINDOW.endDate,
            show_headers: true,
          },
        },
      )
      expect(mockDownloadHttp.get).toHaveBeenCalledWith(
        CDR_LINK,
        expect.objectContaining({ responseType: 'stream' }),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.Direction).toBe('received')
      expect(rows[0]?.From).toBe('13255550101')
      expect(rows[0]?.Content).toBe('STOP')
      expect(rows[0]?.['Media Url']).toBe('')
    })

    it('strips columns the schema does not model', async () => {
      mockReportLink(CDR_LINK)
      mockDownloadHttp.get.mockReturnValue(
        of({
          data: streamOf(
            csvOf(
              [...CDR_HEADERS, 'Carrier'],
              [{ Direction: 'received', From: '13255550101', Carrier: 'x' }],
            ),
          ),
        }),
      )

      const rows = await peerlyResultsService.fetchInboundCdrRows(
        JOB_ID,
        WINDOW,
      )

      expect(rows).toHaveLength(1)
      expect(rows[0]).not.toHaveProperty('Carrier')
    })

    it('returns no rows for a zero-traffic job (header-only CSV)', async () => {
      mockReportLink(CDR_LINK)
      mockDownloadHttp.get.mockReturnValue(
        of({ data: streamOf(csvOf(CDR_HEADERS, [])) }),
      )

      await expect(
        peerlyResultsService.fetchInboundCdrRows(JOB_ID, WINDOW),
      ).resolves.toEqual([])
    })

    it('throws a BadGatewayException when the report-link response has no link', async () => {
      mockPeerlyHttp.get.mockResolvedValue({ data: { result: 'error' } })

      await expect(
        peerlyResultsService.fetchInboundCdrRows(JOB_ID, WINDOW),
      ).rejects.toBeInstanceOf(BadGatewayException)
      expect(mockDownloadHttp.get).not.toHaveBeenCalled()
    })

    it('rejects a report link on a non-GCS/S3 host without fetching it', async () => {
      mockReportLink('http://169.254.169.254/latest/meta-data/')

      await expect(
        peerlyResultsService.fetchInboundCdrRows(JOB_ID, WINDOW),
      ).rejects.toBeInstanceOf(BadGatewayException)
      expect(mockDownloadHttp.get).not.toHaveBeenCalled()
    })

    it('throws a BadGatewayException when the report download fails', async () => {
      mockReportLink(CDR_LINK)
      mockDownloadHttp.get.mockReturnValue(
        throwError(() => new Error('403 signature expired')),
      )

      await expect(
        peerlyResultsService.fetchInboundCdrRows(JOB_ID, WINDOW),
      ).rejects.toBeInstanceOf(BadGatewayException)
    })

    it('throws a BadGatewayException when the body fails mid-stream', async () => {
      mockReportLink(CDR_LINK)
      const body = new Readable({ read: () => undefined })
      body.push(`${CDR_HEADERS.join(',')}\n`)
      setImmediate(() => body.destroy(new Error('socket hang up')))
      mockDownloadHttp.get.mockReturnValue(of({ data: body }))

      await expect(
        peerlyResultsService.fetchInboundCdrRows(JOB_ID, WINDOW),
      ).rejects.toBeInstanceOf(BadGatewayException)
    })

    it('throws a BadGatewayException when an inbound row is missing expected columns', async () => {
      mockReportLink(CDR_LINK)
      mockDownloadHttp.get.mockReturnValue(
        of({ data: streamOf('Timestamp,Direction\n2025-08-20,received') }),
      )

      await expect(
        peerlyResultsService.fetchInboundCdrRows(JOB_ID, WINDOW),
      ).rejects.toBeInstanceOf(BadGatewayException)
    })

    it('drops outbound rows before validating them', async () => {
      mockReportLink(CDR_LINK)
      mockDownloadHttp.get.mockReturnValue(
        of({ data: streamOf('Timestamp,Direction\n2025-08-20,sent') }),
      )

      await expect(
        peerlyResultsService.fetchInboundCdrRows(JOB_ID, WINDOW),
      ).resolves.toEqual([])
    })

    it('aborts with a BadGatewayException once the body passes the byte cap', async () => {
      mockReportLink(CDR_LINK)
      // allocUnsafe leaves the pages untouched, so the oversized chunk costs
      // no real memory; the cap trips before the parser ever sees it.
      mockDownloadHttp.get.mockReturnValue(
        of({
          data: Readable.from([
            Buffer.from(`${CDR_HEADERS.join(',')}\n`),
            Buffer.allocUnsafe(MAX_CDR_REPORT_BYTES),
          ]),
        }),
      )

      await expect(
        peerlyResultsService.fetchInboundCdrRows(JOB_ID, WINDOW),
      ).rejects.toBeInstanceOf(BadGatewayException)
    })
  })

  describe('fetchQuestionResponseRows', () => {
    it('unzips the report and strips dynamic per-question columns', async () => {
      const qrCsv = csvOf(
        [...QR_HEADERS, 'Do you support Jane?'],
        [
          {
            date: '2025-08-20 10:25:00',
            lead_phone: '13255550101',
            optout: 'true',
            'Do you support Jane?': 'yes',
          },
        ],
      )
      mockReportLink('https://ivr-platform-reports.s3.amazonaws.com/x.csv.zip')
      mockDownloadHttp.get.mockReturnValue(of({ data: await zipOf(qrCsv) }))

      const rows = await peerlyResultsService.fetchQuestionResponseRows(
        JOB_ID,
        WINDOW,
      )

      expect(mockPeerlyHttp.get).toHaveBeenCalledWith(
        `/1to1/jobs/${JOB_ID}/questionresponses`,
        {
          params: {
            date_range: 'CUSTOM',
            start_date: WINDOW.startDate,
            end_date: WINDOW.endDate,
            show_headers: true,
          },
        },
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.lead_phone).toBe('13255550101')
      expect(rows[0]?.optout).toBe('true')
      expect(rows[0]).not.toHaveProperty('Do you support Jane?')
    })

    it('sends a per-call timeout and turns off retries when asked', async () => {
      mockReportLink('https://ivr-platform-reports.s3.amazonaws.com/x.csv.zip')
      mockDownloadHttp.get.mockReturnValue(
        of({ data: await zipOf(csvOf(QR_HEADERS, [])) }),
      )

      await peerlyResultsService.fetchQuestionResponseRows(JOB_ID, WINDOW, {
        timeoutMs: 180000,
        retry: false,
      })

      expect(mockPeerlyHttp.get).toHaveBeenCalledWith(
        `/1to1/jobs/${JOB_ID}/questionresponses`,
        expect.objectContaining({ timeout: 180000 }),
        { retry: false },
      )
    })

    it('throws a GatewayTimeoutException when Peerly times out building the report', async () => {
      mockPeerlyHttp.get.mockRejectedValue(
        new AxiosError('timeout of 180000ms exceeded', AxiosError.ECONNABORTED),
      )

      await expect(
        peerlyResultsService.fetchQuestionResponseRows(JOB_ID, WINDOW, {
          timeoutMs: 180000,
          retry: false,
        }),
      ).rejects.toBeInstanceOf(GatewayTimeoutException)
      expect(mockDownloadHttp.get).not.toHaveBeenCalled()
    })

    it('throws a BadGatewayException when the downloaded file is not a zip', async () => {
      mockReportLink('https://ivr-platform-reports.s3.amazonaws.com/x.csv.zip')
      mockDownloadHttp.get.mockReturnValue(
        of({ data: Buffer.from('not a zip') }),
      )

      await expect(
        peerlyResultsService.fetchQuestionResponseRows(JOB_ID, WINDOW),
      ).rejects.toBeInstanceOf(BadGatewayException)
    })
  })
})
