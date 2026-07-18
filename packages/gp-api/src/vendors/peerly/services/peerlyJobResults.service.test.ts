import { BadGatewayException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { HttpService } from '@nestjs/axios'
import JSZip from 'jszip'
import { PinoLogger } from 'nestjs-pino'
import { of, throwError } from 'rxjs'
import { createMockLogger } from 'src/shared/test-utils/mockLogger.util'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PeerlyJobResultsService } from './peerlyJobResults.service'
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
])

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

  describe('fetchCdrRows', () => {
    it('requests the report window and parses the downloaded CSV', async () => {
      mockReportLink('https://storage.googleapis.com/cdr-reports-v2/x.csv')
      mockDownloadHttp.get.mockReturnValue(of({ data: cdrCsv }))

      const rows = await peerlyResultsService.fetchCdrRows(JOB_ID, WINDOW)

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
      expect(rows).toHaveLength(2)
      expect(rows[0]?.Direction).toBe('sent')
      expect(rows[1]?.Direction).toBe('received')
      expect(rows[1]?.From).toBe('13255550101')
      expect(rows[1]?.['Media Url']).toBe('')
    })

    it('returns no rows for a zero-traffic job (header-only CSV)', async () => {
      mockReportLink('https://storage.googleapis.com/cdr-reports-v2/x.csv')
      mockDownloadHttp.get.mockReturnValue(of({ data: csvOf(CDR_HEADERS, []) }))

      await expect(
        peerlyResultsService.fetchCdrRows(JOB_ID, WINDOW),
      ).resolves.toEqual([])
    })

    it('throws a BadGatewayException when the report-link response has no link', async () => {
      mockPeerlyHttp.get.mockResolvedValue({ data: { result: 'error' } })

      await expect(
        peerlyResultsService.fetchCdrRows(JOB_ID, WINDOW),
      ).rejects.toBeInstanceOf(BadGatewayException)
      expect(mockDownloadHttp.get).not.toHaveBeenCalled()
    })

    it('rejects a report link on a non-GCS/S3 host without fetching it', async () => {
      mockReportLink('http://169.254.169.254/latest/meta-data/')

      await expect(
        peerlyResultsService.fetchCdrRows(JOB_ID, WINDOW),
      ).rejects.toBeInstanceOf(BadGatewayException)
      expect(mockDownloadHttp.get).not.toHaveBeenCalled()
    })

    it('throws a BadGatewayException when the report download fails', async () => {
      mockReportLink('https://storage.googleapis.com/cdr-reports-v2/x.csv')
      mockDownloadHttp.get.mockReturnValue(
        throwError(() => new Error('403 signature expired')),
      )

      await expect(
        peerlyResultsService.fetchCdrRows(JOB_ID, WINDOW),
      ).rejects.toBeInstanceOf(BadGatewayException)
    })

    it('throws a BadGatewayException when the CSV is missing expected columns', async () => {
      mockReportLink('https://storage.googleapis.com/cdr-reports-v2/x.csv')
      mockDownloadHttp.get.mockReturnValue(
        of({ data: 'Timestamp,Direction\n2025-08-20,sent' }),
      )

      await expect(
        peerlyResultsService.fetchCdrRows(JOB_ID, WINDOW),
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
