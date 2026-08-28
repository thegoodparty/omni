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
})
