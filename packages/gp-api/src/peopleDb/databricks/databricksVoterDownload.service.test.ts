import { InternalServerErrorException } from '@nestjs/common'
import { Writable } from 'node:stream'
import { gunzipSync } from 'node:zlib'
import type { FastifyReply } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadPeopleSchema } from '../schemas/people.schema'
import { DatabricksVoterDownloadService } from './databricksVoterDownload.service'
import type { DatabricksVoterService } from './databricksVoter.service'
import type { PeopleDbxStatementClient } from './peopleDbxStatement.client'
import type { DbxDistrict } from './databricksVoterSql.util'

const DISTRICT_ID = '635757db-1111-4111-8111-111111111111'

const DISTRICT: DbxDistrict = {
  districtId: DISTRICT_ID,
  state: 'CA',
  districtType: 'US_Congressional_District',
  districtName: '29',
  useVoterOnlyPath: false,
}

type Sink = {
  reply: FastifyReply
  headers: Record<string, string>
  flushedBeforeFirstByte: boolean
  body: () => Buffer
  finished: Promise<void>
}

// Stands in for the Node ServerResponse the service writes to, recording the
// order of header commit vs first body byte.
const createSink = (): Sink => {
  const headers: Record<string, string> = {}
  const chunks: Buffer[] = []
  let flushed = false
  let flushedFirst = false

  const raw = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (chunks.length === 0) flushedFirst = flushed
      chunks.push(Buffer.from(chunk))
      callback()
    },
  }) as Writable & Record<string, unknown>

  raw.setHeader = (key: string, value: string) => {
    headers[key] = value
    return raw
  }
  raw.flushHeaders = () => {
    flushed = true
  }
  raw.headersSent = false
  raw.statusCode = 200

  const finished = new Promise<void>((resolve) => {
    raw.once('finish', () => resolve())
    raw.once('close', () => resolve())
  })

  return {
    reply: { raw } as unknown as FastifyReply,
    headers,
    get flushedBeforeFirstByte() {
      return flushedFirst
    },
    body: () => Buffer.concat(chunks),
    finished,
  }
}

describe('DatabricksVoterDownloadService', () => {
  let startCsvExport: ReturnType<typeof vi.fn>
  let fetchCsvChunk: ReturnType<typeof vi.fn>
  let service: DatabricksVoterDownloadService
  let fetchMock: ReturnType<typeof vi.fn>

  const dto = downloadPeopleSchema.parse({ districtId: DISTRICT_ID })

  beforeEach(() => {
    startCsvExport = vi.fn()
    fetchCsvChunk = vi.fn()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    service = new DatabricksVoterDownloadService(
      { startCsvExport, fetchCsvChunk } as unknown as PeopleDbxStatementClient,
      {
        resolveDistrict: vi.fn().mockResolvedValue(DISTRICT),
      } as unknown as DatabricksVoterService,
    )
  })

  const chunkResponse = (text: string) => ({
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(Buffer.from(text)),
  })

  it('commits the streaming headers before the first body byte', async () => {
    startCsvExport.mockResolvedValue({
      firstChunk: { externalLink: 'https://s3/chunk0', nextChunkLink: null },
    })
    fetchMock.mockResolvedValue(chunkResponse('Voter ID\nLAL1\n'))
    const sink = createSink()

    await service.streamPeopleCsv(dto, sink.reply)
    await sink.finished

    expect(sink.headers['Content-Type']).toBe('text/csv')
    expect(sink.headers['Content-Encoding']).toBe('gzip')
    expect(sink.headers['Content-Disposition']).toBe(
      'attachment; filename="people.csv"',
    )
    expect(sink.flushedBeforeFirstByte).toBe(true)
  })

  it('gzips the CSV onto the wire', async () => {
    startCsvExport.mockResolvedValue({
      firstChunk: { externalLink: 'https://s3/chunk0', nextChunkLink: null },
    })
    fetchMock.mockResolvedValue(chunkResponse('Voter ID\nLAL1\n'))
    const sink = createSink()

    await service.streamPeopleCsv(dto, sink.reply)
    await sink.finished

    expect(gunzipSync(sink.body()).toString('utf8')).toBe('Voter ID\nLAL1\n')
  })

  it('follows the chunk chain, requesting each link only when it gets there', async () => {
    startCsvExport.mockResolvedValue({
      firstChunk: {
        externalLink: 'https://s3/chunk0',
        nextChunkLink: '/api/2.0/sql/statements/s1/result/chunks/1',
      },
    })
    fetchCsvChunk.mockResolvedValue({
      externalLink: 'https://s3/chunk1',
      nextChunkLink: null,
    })
    fetchMock
      .mockResolvedValueOnce(chunkResponse('Voter ID\nLAL1\n'))
      .mockResolvedValueOnce(chunkResponse('LAL2\n'))
    const sink = createSink()

    await service.streamPeopleCsv(dto, sink.reply)
    await sink.finished

    expect(gunzipSync(sink.body()).toString('utf8')).toBe(
      'Voter ID\nLAL1\nLAL2\n',
    )
    expect(fetchCsvChunk).toHaveBeenCalledTimes(1)
  })

  it('applies the caller filename and extra headers', async () => {
    startCsvExport.mockResolvedValue({
      firstChunk: { externalLink: 'https://s3/chunk0', nextChunkLink: null },
    })
    fetchMock.mockResolvedValue(chunkResponse('Voter ID\n'))
    const sink = createSink()

    await service.streamPeopleCsv(dto, sink.reply, {
      filename: 'contacts.csv',
      extraHeaders: { 'X-Trace': 'abc' },
    })
    await sink.finished

    expect(sink.headers['Content-Disposition']).toBe(
      'attachment; filename="contacts.csv"',
    )
    expect(sink.headers['X-Trace']).toBe('abc')
  })

  // Before headers are committed we can still answer with a structured error;
  // afterwards the connection is a binary download and we cannot.
  it('throws a structured 5xx when the export fails to start', async () => {
    startCsvExport.mockRejectedValue(new Error('INSUFFICIENT_PERMISSIONS'))
    const sink = createSink()

    await expect(service.streamPeopleCsv(dto, sink.reply)).rejects.toThrow(
      InternalServerErrorException,
    )
    expect(sink.headers).toEqual({})
  })

  it('tears the response down when a chunk fetch fails mid-stream', async () => {
    startCsvExport.mockResolvedValue({
      firstChunk: { externalLink: 'https://s3/chunk0', nextChunkLink: null },
    })
    fetchMock.mockResolvedValue({ ok: false, status: 403 })
    const sink = createSink()

    await service.streamPeopleCsv(dto, sink.reply)

    // The socket is destroyed rather than ended, so a truncated download can't
    // be mistaken for a complete one.
    expect(sink.reply.raw.destroyed).toBe(true)
  })
})
