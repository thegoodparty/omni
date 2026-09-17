import { PassThrough, Readable } from 'stream'
import { createMockLogger } from 'src/shared/test-utils/mockLogger.util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PollResponsesDownloadService } from './pollResponsesDownload.service'

const mockRelease = vi.fn()
const mockPoolEnd = vi.fn()
const mockClientQuery = vi.fn()
const mockPoolConnect = vi.fn()

vi.mock('pg', () => {
  const PoolClass = function () {
    // @ts-expect-error -- mock constructor
    this.connect = mockPoolConnect
    // @ts-expect-error -- mock constructor
    this.end = mockPoolEnd
  }
  return { Pool: PoolClass }
})

vi.mock('pg-copy-streams', () => ({
  to: vi.fn((sql: string) => sql),
}))

async function drainStream(stream: Readable): Promise<string> {
  const chunks: string[] = []
  for await (const chunk of stream) {
    chunks.push(chunk.toString())
  }
  return chunks.join('')
}

describe('PollResponsesDownloadService', () => {
  let service: PollResponsesDownloadService
  let copyStream: PassThrough

  beforeEach(() => {
    vi.clearAllMocks()

    copyStream = new PassThrough()
    mockClientQuery.mockReturnValue(copyStream)
    mockPoolConnect.mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease,
      escapeLiteral: (str: string) => `'${str.replace(/'/g, "''")}'`,
    })

    service = new PollResponsesDownloadService(createMockLogger())
  })

  afterEach(() => {
    if (!copyStream.destroyed) copyStream.destroy()
  })

  describe('buildPollResponsesCsv', () => {
    const VALID_UUID = '01234567-89ab-cdef-0123-456789abcdef'
    const POLL_NAME = 'My Test Poll'
    const FILE_NAME = 'My Test Poll'

    it('returns a StreamableFile with a Content-Length', async () => {
      copyStream.end()

      const result = await service.buildPollResponsesCsv(
        VALID_UUID,
        POLL_NAME,
        FILE_NAME,
      )

      expect(result).toBeDefined()
      expect(result.getHeaders().type).toBe('text/csv; charset=utf-8')
      expect(result.getHeaders().disposition).toContain(FILE_NAME)
      // A fixed length is what keeps the response from being chunked (and
      // truncated) in transit.
      expect(result.getHeaders().length).toBeGreaterThan(0)
    })

    it('writes UTF-8 BOM and poll name as the first line', async () => {
      copyStream.end()

      const result = await service.buildPollResponsesCsv(
        VALID_UUID,
        POLL_NAME,
        FILE_NAME,
      )

      const output = await drainStream(result.getStream())
      expect(output.startsWith('\uFEFF' + POLL_NAME + '\n')).toBe(true)
    })

    it('sanitizes newlines from poll name', async () => {
      copyStream.end()

      const result = await service.buildPollResponsesCsv(
        VALID_UUID,
        'Poll\nWith\rNewlines',
        FILE_NAME,
      )

      const output = await drainStream(result.getStream())
      expect(output.startsWith('\uFEFFPoll With Newlines\n')).toBe(true)
    })

    it('neutralizes a formula-injection poll name in the header line', async () => {
      copyStream.end()

      const result = await service.buildPollResponsesCsv(
        VALID_UUID,
        '=HYPERLINK("http://evil","x")',
        FILE_NAME,
      )

      const output = await drainStream(result.getStream())
      const headerLine = output.split('\n')[0] ?? ''
      expect(headerLine.endsWith('\'=HYPERLINK("http://evil","x")')).toBe(true)
    })

    it('uses fallback when poll name is empty or whitespace', async () => {
      copyStream.end()

      const result = await service.buildPollResponsesCsv(
        VALID_UUID,
        '   ',
        FILE_NAME,
      )

      const output = await drainStream(result.getStream())
      expect(output.startsWith('\uFEFFPoll responses\n')).toBe(true)
    })

    it('strips leading newlines from COPY stream to avoid empty rows', async () => {
      copyStream.write('\n\n\nmessage_content,associated_clusters\n')
      copyStream.write('"Hello world","Issue A"\n')
      copyStream.end()

      const result = await service.buildPollResponsesCsv(
        VALID_UUID,
        POLL_NAME,
        FILE_NAME,
      )

      const output = await drainStream(result.getStream())
      const lines = output.split('\n')
      expect(lines[0]).toBe('\uFEFF' + POLL_NAME)
      expect(lines[1]).toBe('message_content,associated_clusters')
      expect(lines[2]).toBe('"Hello world","Issue A"')
    })

    it('includes the full COPY body after the poll name line', async () => {
      copyStream.write('message_content,associated_clusters\n')
      copyStream.write('"Hello world","Issue A; Issue B"\n')
      copyStream.end()

      const result = await service.buildPollResponsesCsv(
        VALID_UUID,
        POLL_NAME,
        FILE_NAME,
      )

      const output = await drainStream(result.getStream())
      const lines = output.split('\n')
      expect(lines[0]).toBe('\uFEFF' + POLL_NAME)
      expect(lines[1]).toBe('message_content,associated_clusters')
      expect(lines[2]).toBe('"Hello world","Issue A; Issue B"')
    })

    it('does not truncate the tail when many rows are buffered', async () => {
      copyStream.write('message_content,associated_clusters\n')
      for (let i = 0; i < 5000; i++) {
        copyStream.write(`"reply number ${i}","Issue ${i % 7}"\n`)
      }
      copyStream.end()

      const result = await service.buildPollResponsesCsv(
        VALID_UUID,
        POLL_NAME,
        FILE_NAME,
      )

      const output = await drainStream(result.getStream())
      const lines = output.trimEnd().split('\n')
      // header line + column header + 5000 rows, none dropped off the end
      expect(lines).toHaveLength(5002)
      expect(lines[lines.length - 1]).toBe('"reply number 4999","Issue 1"')
    })

    it('builds COPY SQL with the poll ID', async () => {
      const { to: copyTo } = await import('pg-copy-streams')
      copyStream.end()

      await service.buildPollResponsesCsv(VALID_UUID, POLL_NAME, FILE_NAME)

      expect(vi.mocked(copyTo)).toHaveBeenCalledWith(
        expect.stringContaining(`pim.poll_id = '${VALID_UUID}'`),
      )
      expect(vi.mocked(copyTo)).toHaveBeenCalledWith(
        expect.stringContaining('TO STDOUT WITH (FORMAT CSV, HEADER TRUE)'),
      )
    })

    it('neutralizes leading CSV formula characters in message_content', async () => {
      const { to: copyTo } = await import('pg-copy-streams')
      copyStream.end()

      await service.buildPollResponsesCsv(VALID_UUID, POLL_NAME, FILE_NAME)

      const sql = vi.mocked(copyTo).mock.calls[0]?.[0] as string
      expect(sql).toContain(
        "left(pim.content, 1) = ANY (ARRAY['=', '+', '-', '@'])",
      )
      expect(sql).toContain("'''' || pim.content")
    })

    it('SQL includes string_agg with DISTINCT and alphabetical ordering', async () => {
      const { to: copyTo } = await import('pg-copy-streams')
      copyStream.end()

      await service.buildPollResponsesCsv(VALID_UUID, POLL_NAME, FILE_NAME)

      const sql = vi.mocked(copyTo).mock.calls[0]?.[0] as string
      expect(sql).toContain("string_agg(DISTINCT pi.title, '; '")
      expect(sql).toContain('ORDER BY pi.title')
      expect(sql).toContain('_PollIndividualMessageToPollIssue')
      expect(sql).toContain('is_opt_out')
    })

    it('releases the client after building the CSV', async () => {
      copyStream.end()

      await service.buildPollResponsesCsv(VALID_UUID, POLL_NAME, FILE_NAME)

      expect(mockRelease).toHaveBeenCalledTimes(1)
      expect(mockRelease).toHaveBeenCalledWith()
    })

    it('releases the client and propagates error on stream failure', async () => {
      const promise = service.buildPollResponsesCsv(
        VALID_UUID,
        POLL_NAME,
        FILE_NAME,
      )
      // Let the service attach its listeners and start consuming before the
      // source fails, so the error is forwarded rather than emitted into the
      // void.
      await new Promise((resolve) => setImmediate(resolve))
      copyStream.destroy(new Error('pg connection lost'))

      await expect(promise).rejects.toThrow('pg connection lost')
      expect(mockRelease).toHaveBeenCalledTimes(1)
      // Released WITH the error so pg-pool discards the COPY-mode connection.
      expect(mockRelease).toHaveBeenCalledWith(expect.any(Error))
    })
  })

  describe('onModuleDestroy', () => {
    it('closes the pool', () => {
      service.onModuleDestroy()
      expect(mockPoolEnd).toHaveBeenCalledTimes(1)
    })
  })
})
