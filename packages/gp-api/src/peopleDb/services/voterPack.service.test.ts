import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DoorKnockingPackManifestSchema } from '@goodparty_org/contracts'
import { Prisma } from '../../generated/people-prisma'
import { CURSOR_FETCH_SIZE } from '../utils/cursorScan.util'
import { VoterPackService } from './voterPack.service'
import type { PeopleDbService } from '../peopleDb.service'

const DISTRICT_ID = '457a1cd7-4184-f823-49d3-f207af693521'

const dbRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  lat: 41.9,
  lng: -87.65,
  hhKey: `HH-${id}`,
  Parties_Description: null,
  Age_Int: null,
  Gender: null,
  Voter_Status: null,
  Marital_Status: null,
  Veteran_Status: null,
  Presence_Of_Children: null,
  Homeowner_Probability_Model: null,
  Business_Owner: null,
  Education_Of_Person: null,
  Estimated_Income_Amount_Int: null,
  Language_Code: null,
  EthnicGroups_EthnicGroup1Desc: null,
  registered: true,
  hasCellPhone: false,
  hasLandline: false,
  ...overrides,
})

describe('VoterPackService', () => {
  let service: VoterPackService
  let mockClient: {
    $queryRaw: ReturnType<typeof vi.fn>
    $executeRaw: ReturnType<typeof vi.fn>
    $transaction: ReturnType<typeof vi.fn>
  }
  const mockDistrictService = {
    findDistrictById: vi.fn().mockResolvedValue({
      id: DISTRICT_ID,
      type: 'City',
      name: 'SPRINGFIELD',
      state: 'IL',
    }),
  }

  beforeEach(() => {
    // The scan runs inside an interactive transaction: SET LOCAL, DECLARE, then
    // a FETCH per chunk, all on the one connection the callback is handed.
    mockClient = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(0),
      $transaction: vi.fn((run: (tx: unknown) => Promise<unknown>) =>
        run(mockClient),
      ),
    }
    service = new VoterPackService(mockDistrictService as never)
    ;(service as unknown as { _peopleDb: PeopleDbService })._peopleDb = {
      get instance() {
        return mockClient
      },
    } as unknown as PeopleDbService
  })

  const parseManifest = (buffer: Buffer) =>
    DoorKnockingPackManifestSchema.parse(
      JSON.parse(
        buffer.subarray(4, 4 + buffer.readUInt32LE(0)).toString('utf8'),
      ),
    )

  const executed = (index: number) =>
    (mockClient.$executeRaw.mock.calls[index]?.[0] as Prisma.Sql).strings.join(
      '?',
    )

  const declaredScan = () =>
    mockClient.$executeRaw.mock.calls
      .map(([sql]) => (sql as Prisma.Sql).strings.join('?'))
      .find((text) => text.includes('CURSOR FOR')) ?? ''

  const fetches = () =>
    mockClient.$queryRaw.mock.calls.map(([sql]) =>
      (sql as Prisma.Sql).strings.join('?'),
    )

  // The production defect. Keyset pagination re-executed the whole joined
  // statement per page, and the page predicate only ever reached the Voter side
  // of the join, so each page re-walked DistrictVoter from the start of the
  // district — 11.5 GB read from storage for a 16 MB response. One statement,
  // read in chunks, is the fix; every FETCH must be a fetch and not a re-query.
  it('scans the district with one statement and fetches from it', async () => {
    mockClient.$queryRaw
      .mockResolvedValueOnce(
        Array.from({ length: CURSOR_FETCH_SIZE }, (_, i) =>
          dbRow(`${String(i).padStart(8, '0')}-1111-1111-1111-111111111111`),
        ),
      )
      .mockResolvedValueOnce([dbRow('ffffffff-1111-1111-1111-111111111111')])

    const buffer = await service.build({ districtId: DISTRICT_ID })

    expect(declaredScan()).toContain('SELECT')
    expect(
      mockClient.$executeRaw.mock.calls.filter(([sql]) =>
        (sql as Prisma.Sql).strings.join('?').includes('SELECT'),
      ),
    ).toHaveLength(1)
    expect(fetches()).toEqual([
      expect.stringContaining('FETCH FORWARD'),
      expect.stringContaining('FETCH FORWARD'),
    ])
    expect(fetches().join('')).not.toContain('SELECT')
    expect(parseManifest(buffer).counts.people).toBe(CURSOR_FETCH_SIZE + 1)
  })

  // Sorting a whole district exists only to make a keyset cursor work, and it
  // is not free. Nothing downstream can observe row order: the pack carries no
  // person identity, the client aggregates positionally, and turfs are stored
  // as polygons rather than as pack indices.
  it('asks for no particular row order', async () => {
    await service.build({ districtId: DISTRICT_ID })

    expect(declaredScan()).not.toContain('ORDER BY')
    expect(declaredScan()).not.toContain('LIMIT')
    expect(declaredScan()).not.toContain('"id" >')
  })

  it('drops the DistrictVoter join for statewide districts', async () => {
    mockDistrictService.findDistrictById.mockResolvedValueOnce({
      id: DISTRICT_ID,
      type: 'State',
      name: 'IL',
      state: 'IL',
    })

    await service.build({ districtId: DISTRICT_ID })

    expect(declaredScan()).not.toContain('JOIN')
  })

  it('gates on rooftop geocodes', async () => {
    await service.build({ districtId: DISTRICT_ID })

    expect(declaredScan()).toContain('GeoMatchRooftop')
  })

  // Unguarded, a pathological plan here runs past the client's socket timeout
  // and keeps burning people-db CPU after the request is gone — the
  // amplification peopleDb/AGENTS.md documents.
  it('runs the scan under a statement timeout', async () => {
    await service.build({ districtId: DISTRICT_ID })

    expect(mockClient.$transaction).toHaveBeenCalledTimes(1)
    expect(executed(0)).toContain('statement_timeout')
  })

  // A cursor tells the planner "a page will do", which is how it justifies a
  // fast-start plan — exactly the shape whose total cost this change exists to
  // escape. This scan always drains, so the whole result has to be costed.
  it('costs the plan for the whole result, not the first page', async () => {
    await service.build({ districtId: DISTRICT_ID })

    expect(executed(1)).toContain('cursor_tuple_fraction = 1')
  })

  // Killing the connection does not cancel the scan, so a build nobody is
  // reading has to stop asking for more of the district.
  it('stops fetching once the caller has abandoned the build', async () => {
    const abort = new AbortController()
    mockClient.$queryRaw.mockImplementation(() => {
      abort.abort()
      return Promise.resolve(
        Array.from({ length: CURSOR_FETCH_SIZE }, (_, i) =>
          dbRow(`${String(i).padStart(8, '0')}-1111-1111-1111-111111111111`),
        ),
      )
    })

    await expect(
      service.build({ districtId: DISTRICT_ID }, abort.signal),
    ).rejects.toThrow('abandoned')
    expect(mockClient.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it('threads knock statuses into the canvassStatus plane', async () => {
    const personId = '99999999-1111-1111-1111-111111111111'
    mockClient.$queryRaw.mockResolvedValueOnce([dbRow(personId)])

    const buffer = await service.build({
      districtId: DISTRICT_ID,
      knockStatuses: [{ personId, status: 'refused' }],
    })

    const manifest = parseManifest(buffer)
    const plane = manifest.arrays.find((a) => a.name === 'dim:canvassStatus')!
    const byte = new Uint8Array(buffer)[plane.byteOffset]
    const values = manifest.dims.find((d) => d.key === 'canvassStatus')!.values
    expect(values[byte ?? 0]).toBe('refused')
  })
})
