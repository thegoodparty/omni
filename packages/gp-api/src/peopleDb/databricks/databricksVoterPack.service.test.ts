import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DoorKnockingPackManifestSchema } from '@goodparty_org/contracts'
import { DatabricksVoterPackService } from './databricksVoterPack.service'
import {
  PeopleDbxTimeoutError,
  PeopleDbxUnavailableError,
} from './peopleDbxStatement.client'
import { PACK_CSV_COLUMNS } from './databricksVoterSql.util'

const DISTRICT_ID = '457a1cd7-4184-f823-49d3-f207af693521'

const HEADER = PACK_CSV_COLUMNS.join(',')

// One CSV row in projection order. Nullable columns arrive as '' because the
// projection coalesces them; booleans arrive as the text true/false.
const csvRow = (
  id: string,
  overrides: Partial<Record<string, string>> = {},
) => {
  const values: Record<string, string> = {
    id,
    lat: '41.9',
    lng: '-87.65',
    hhKey: `HH-${id}`,
    Parties_Description: '',
    Age_Int: '',
    Gender: '',
    Voter_Status: '',
    Marital_Status: '',
    Veteran_Status: '',
    Presence_Of_Children: '',
    Homeowner_Probability_Model: '',
    Business_Owner: '',
    Education_Of_Person: '',
    Estimated_Income_Amount_Int: '',
    Language_Code: '',
    EthnicGroups_EthnicGroup1Desc: '',
    registered: 'true',
    hasCellPhone: 'false',
    hasLandline: 'false',
    ...overrides,
  }
  return PACK_CSV_COLUMNS.map((column) => values[column] ?? '').join(',')
}

describe('DatabricksVoterPackService', () => {
  let service: DatabricksVoterPackService
  let client: {
    startCsvExport: ReturnType<typeof vi.fn>
    fetchCsvChunk: ReturnType<typeof vi.fn>
  }
  let bodies: Map<string, string>
  let logger: {
    setContext: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
    warn: ReturnType<typeof vi.fn>
  }

  const request = { districtId: DISTRICT_ID, contactsMade: [] }

  beforeEach(() => {
    bodies = new Map()
    client = {
      startCsvExport: vi.fn(),
      fetchCsvChunk: vi.fn(),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: () =>
            Promise.resolve(Buffer.from(bodies.get(url) ?? '')),
        }),
      ),
    )
    logger = { setContext: vi.fn(), error: vi.fn(), warn: vi.fn() }
    service = new DatabricksVoterPackService(
      logger as never,
      client as never,
      {
        resolveDistrict: vi.fn().mockResolvedValue({
          districtId: DISTRICT_ID,
          state: 'IL',
          districtType: 'City',
          districtName: 'SPRINGFIELD',
          useVoterOnlyPath: false,
        }),
      } as never,
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const chunk = (link: string, body: string, next: string | null = null) => {
    bodies.set(link, body)
    return { externalLink: link, nextChunkLink: next }
  }

  const manifestOf = (buffer: Buffer) =>
    DoorKnockingPackManifestSchema.parse(
      JSON.parse(
        buffer.subarray(4, 4 + buffer.readUInt32LE(0)).toString('utf8'),
      ),
    )

  it('drops the header row rather than encoding it as a person', async () => {
    client.startCsvExport.mockResolvedValue({
      firstChunk: chunk('c0', [HEADER, csvRow('a'), csvRow('b')].join('\n')),
    })
    const pack = await service.build(request as never)
    expect(manifestOf(pack).counts.people).toBe(2)
  })

  it('follows the chunk chain to the end', async () => {
    client.startCsvExport.mockResolvedValue({
      firstChunk: chunk('c0', [HEADER, csvRow('a')].join('\n'), 'link-1'),
    })
    client.fetchCsvChunk.mockResolvedValueOnce(
      chunk('c1', csvRow('b'), 'link-2'),
    )
    client.fetchCsvChunk.mockResolvedValueOnce(chunk('c2', csvRow('c')))
    const pack = await service.build(request as never)
    expect(manifestOf(pack).counts.people).toBe(3)
    expect(client.fetchCsvChunk).toHaveBeenCalledTimes(2)
  })

  it('requests each chunk link only when it reaches it', async () => {
    client.startCsvExport.mockResolvedValue({
      firstChunk: chunk('c0', [HEADER, csvRow('a')].join('\n'), 'link-1'),
    })
    client.fetchCsvChunk.mockResolvedValue(chunk('c1', csvRow('b')))
    await service.build(request as never)
    // Presigned links expire in ~15 minutes, so resolving the whole chain up
    // front would hand a long export dead links.
    expect(client.fetchCsvChunk).toHaveBeenCalledWith('link-1')
  })

  it('stops at the next chunk once the caller has gone away', async () => {
    const controller = new AbortController()
    client.startCsvExport.mockResolvedValue({
      firstChunk: chunk('c0', [HEADER, csvRow('a')].join('\n'), 'link-1'),
    })
    controller.abort()
    const pack = await service.build(request as never, controller.signal)
    expect(client.fetchCsvChunk).not.toHaveBeenCalled()
    expect(manifestOf(pack).counts.people).toBe(0)
  })

  it('surfaces a warehouse timeout as a 504, not a partial pack', async () => {
    client.startCsvExport.mockRejectedValue(new PeopleDbxTimeoutError(1))
    await expect(service.build(request as never)).rejects.toThrow(
      GatewayTimeoutException,
    )
  })

  it('surfaces an unreachable warehouse rather than an empty district', async () => {
    client.startCsvExport.mockRejectedValue(
      new PeopleDbxUnavailableError('down'),
    )
    await expect(service.build(request as never)).rejects.toThrow(
      /temporarily unavailable/,
    )
  })

  // A presigned chunk link expires in ~15 minutes, so losing one mid-build is
  // an upstream fetch failure, not a bug in the pack. It has to reach the
  // caller classified, and be logged on the way, or it is invisible.
  it('classifies a lost chunk link as a 502 rather than a bare 500', async () => {
    client.startCsvExport.mockResolvedValue({
      firstChunk: { externalLink: 'missing', nextChunkLink: null },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 403 })),
    )
    await expect(service.build(request as never)).rejects.toThrow(
      BadGatewayException,
    )
  })

  it('logs a lost chunk link rather than failing silently', async () => {
    client.startCsvExport.mockResolvedValue({
      firstChunk: { externalLink: 'missing', nextChunkLink: null },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 403 })),
    )
    await expect(service.build(request as never)).rejects.toThrow()
    expect(logger.error).toHaveBeenCalled()
  })

  // A district is drained in many chunks and the whole build dies with any one
  // of them, so a blip that would be unnoticeable on a single request is close
  // to routine across a full scan. This is what took the voter map down in
  // prod: three builds in one 32-second window, each losing one chunk.
  //
  // Which failures are retried is csvChunkBody.util's own business and is
  // covered there. What matters here is that the retry survives the read-ahead
  // pipeline: two chunk reads are in flight at once and a rejection that goes
  // unhandled takes the process down rather than the request.
  describe('a chunk that fails in transit', () => {
    const socketClosed = () =>
      Object.assign(new TypeError('fetch failed'), {
        cause: new Error('other side closed'),
      })

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    const buildThrough = async () => {
      const pending = service.build(request as never)
      // Settled-but-unobserved while the timers run counts as unhandled, and
      // the failure cases here reject before the await below can reach them.
      void pending.catch(() => undefined)
      await vi.runAllTimersAsync()
      return pending
    }

    it('retries a lost chunk and still builds the whole pack', async () => {
      client.startCsvExport.mockResolvedValue({
        firstChunk: { externalLink: 'c0', nextChunkLink: 'link-1' },
      })
      client.fetchCsvChunk.mockResolvedValue({
        externalLink: 'c1',
        nextChunkLink: null,
      })
      // The second chunk is the one lost, so the retry has to survive the
      // read-ahead: it is in flight while the first chunk is still parsing.
      const fetchMock = vi.fn((url: string) =>
        url === 'c1' && fetchMock.mock.calls.length === 2
          ? Promise.reject(socketClosed())
          : Promise.resolve({
              ok: true,
              status: 200,
              arrayBuffer: () =>
                Promise.resolve(
                  Buffer.from(
                    url === 'c0'
                      ? [HEADER, csvRow('a')].join('\n')
                      : csvRow('b'),
                  ),
                ),
            }),
      )
      vi.stubGlobal('fetch', fetchMock)

      const pack = await buildThrough()

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(manifestOf(pack).counts.people).toBe(2)
    })

    // Bounded: something failing this persistently is not transient, and the
    // client is holding the build open the whole time.
    it('gives up as a classified 502 rather than retrying forever', async () => {
      client.startCsvExport.mockResolvedValue({
        firstChunk: { externalLink: 'c0', nextChunkLink: null },
      })
      const fetchMock = vi.fn().mockRejectedValue(socketClosed())
      vi.stubGlobal('fetch', fetchMock)

      await expect(buildThrough()).rejects.toThrow(BadGatewayException)
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
  })
})
