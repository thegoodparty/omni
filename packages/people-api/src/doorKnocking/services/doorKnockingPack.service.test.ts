import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DoorKnockingPackManifestSchema } from '@goodparty_org/contracts'
import { Prisma } from 'src/generated/prisma'
import { DoorKnockingPackService } from './doorKnockingPack.service'

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

describe('DoorKnockingPackService', () => {
  let service: DoorKnockingPackService
  let mockClient: { $queryRaw: ReturnType<typeof vi.fn> }
  const mockDistrictService = {
    findDistrictById: vi.fn().mockResolvedValue({
      id: DISTRICT_ID,
      type: 'City',
      name: 'SPRINGFIELD',
      state: 'IL',
    }),
  }

  beforeEach(() => {
    mockClient = { $queryRaw: vi.fn() }
    service = new DoorKnockingPackService(mockDistrictService as never)
    Object.defineProperty(service, '_prisma', {
      get: () => ({ instance: mockClient }),
      configurable: true,
    })
  })

  const parseManifest = (buffer: Buffer) =>
    DoorKnockingPackManifestSchema.parse(
      JSON.parse(
        buffer.subarray(4, 4 + buffer.readUInt32LE(0)).toString('utf8'),
      ),
    )

  it('keyset-paginates until a short batch and encodes every row', async () => {
    // First "batch" boundary is 50k; fake two pages by returning a full-page
    // marker via a smaller-than-limit second page.
    const first = Array.from({ length: 50_000 }, (_, i) =>
      dbRow(`${String(i).padStart(8, '0')}-1111-1111-1111-111111111111`),
    )
    const second = [dbRow('ffffffff-1111-1111-1111-111111111111')]
    mockClient.$queryRaw
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)

    const buffer = await service.build({ districtId: DISTRICT_ID })

    expect(mockClient.$queryRaw).toHaveBeenCalledTimes(2)
    const secondQuery = mockClient.$queryRaw.mock.calls[1]?.[0] as Prisma.Sql
    expect(secondQuery.strings.join('?')).toContain('"id" >')
    expect(parseManifest(buffer).counts.people).toBe(50_001)
  })

  it('drops the DistrictVoter join for statewide districts', async () => {
    mockDistrictService.findDistrictById.mockResolvedValueOnce({
      id: DISTRICT_ID,
      type: 'State',
      name: 'IL',
      state: 'IL',
    })
    mockClient.$queryRaw.mockResolvedValueOnce([])

    await service.build({ districtId: DISTRICT_ID })

    const query = mockClient.$queryRaw.mock.calls[0]?.[0] as Prisma.Sql
    expect(query.strings.join('?')).not.toContain('JOIN')
  })

  it('gates on rooftop geocodes', async () => {
    mockClient.$queryRaw.mockResolvedValueOnce([])

    await service.build({ districtId: DISTRICT_ID })

    const query = mockClient.$queryRaw.mock.calls[0]?.[0] as Prisma.Sql
    expect(query.strings.join('?')).toContain('GeoMatchRooftop')
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
