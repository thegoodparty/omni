import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VoterPackService } from './voterPack.service'
import type { PeopleDbService } from '../peopleDb.service'

const DISTRICT_ID = '457a1cd7-4184-f823-49d3-f207af693521'

type CompareArgs = {
  op: string
  districtId: string
  authoritative: () => Promise<Buffer>
  comparison: () => Promise<Buffer>
  fingerprintAuthoritative: (value: Buffer) => string | number | null
}

describe('VoterPackService dual read', () => {
  let service: VoterPackService
  let mockClient: {
    $queryRaw: ReturnType<typeof vi.fn>
    $executeRaw: ReturnType<typeof vi.fn>
    $transaction: ReturnType<typeof vi.fn>
  }
  let databricksPack: { build: ReturnType<typeof vi.fn> }
  let compared: CompareArgs | null
  let shadow: { enabled: boolean; compare: ReturnType<typeof vi.fn> }

  const mockDistrictService = {
    findDistrictById: vi.fn().mockResolvedValue({
      id: DISTRICT_ID,
      type: 'City',
      name: 'SPRINGFIELD',
      state: 'IL',
    }),
  }

  const request = { districtId: DISTRICT_ID, contactsMade: [] }

  beforeEach(() => {
    mockClient = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(0),
      $transaction: vi.fn((run: (tx: unknown) => Promise<unknown>) =>
        run(mockClient),
      ),
    }
    databricksPack = { build: vi.fn().mockResolvedValue(Buffer.alloc(64)) }
    compared = null
    shadow = {
      enabled: true,
      compare: vi.fn((args: CompareArgs) => {
        compared = args
        return args.authoritative()
      }),
    }
    service = new VoterPackService(
      mockDistrictService as never,
      shadow as never,
      databricksPack as never,
    )
    ;(service as unknown as { _peopleDb: PeopleDbService })._peopleDb = {
      get instance() {
        return mockClient
      },
    } as unknown as PeopleDbService
  })

  it('builds from Postgres alone when the flag is off', async () => {
    shadow.enabled = false
    await service.build(request as never)
    expect(databricksPack.build).not.toHaveBeenCalled()
    expect(shadow.compare).not.toHaveBeenCalled()
    expect(mockClient.$transaction).toHaveBeenCalled()
  })

  it('makes Databricks authoritative when the flag is on', async () => {
    const pack = await service.build(request as never)
    expect(compared?.op).toBe('dk-pack')
    expect(compared?.districtId).toBe(DISTRICT_ID)
    expect(databricksPack.build).toHaveBeenCalledOnce()
    expect(pack).toHaveLength(64)
    expect(mockClient.$transaction).not.toHaveBeenCalled()
  })

  it('passes the response signal to the authoritative arm', async () => {
    const controller = new AbortController()
    await service.build(request as never, controller.signal)
    expect(databricksPack.build).toHaveBeenCalledWith(
      expect.anything(),
      controller.signal,
    )
  })

  // The comparison arm is never awaited, so a build that stopped early would
  // report a length the authoritative arm never had — a false disagreement
  // rather than a missing measurement.
  it('gives the comparison arm no signal', async () => {
    const controller = new AbortController()
    await service.build(request as never, controller.signal)
    await compared?.comparison()
    const scanOptions = mockClient.$transaction.mock.calls.length
    expect(scanOptions).toBeGreaterThan(0)
    expect(compared?.comparison.length).toBe(0)
  })

  // The encoded planes are positional and fixed-width per person, so a length
  // mismatch is a population mismatch.
  it('fingerprints by encoded byte length', async () => {
    await service.build(request as never)
    expect(compared?.fingerprintAuthoritative(Buffer.alloc(128))).toBe(128)
  })
})
