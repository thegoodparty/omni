import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DoorKnockingPackRequest } from '@goodparty_org/contracts'
import { VoterPackService } from './voterPack.service'

const DISTRICT_ID = '11111111-2222-3333-4444-555555555555'

const request = (
  overrides: Partial<DoorKnockingPackRequest> = {},
): DoorKnockingPackRequest =>
  ({
    districtId: DISTRICT_ID,
    knockStatuses: [],
    contactsMade: [],
    ...overrides,
  }) as DoorKnockingPackRequest

describe('VoterPackService', () => {
  let build: ReturnType<typeof vi.fn>
  let measure: ReturnType<typeof vi.fn>
  let service: VoterPackService

  beforeEach(() => {
    build = vi.fn().mockResolvedValue(Buffer.from('pack'))
    measure = vi.fn(
      (args: { read: () => Promise<Buffer> }) => args.read() as Promise<Buffer>,
    )
    service = new VoterPackService({ build } as never, { measure } as never)
  })

  it('builds the pack from the Databricks pack service', async () => {
    await expect(service.build(request())).resolves.toEqual(Buffer.from('pack'))
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('logs the read under the dk-pack op and the request district', async () => {
    await service.build(request())

    expect(measure).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'dk-pack', districtId: DISTRICT_ID }),
    )
  })

  // The signal is the caller's response stream: a build with nobody left to
  // read it has to stop at the next chunk rather than read the rest of the
  // district, so it must reach the arm that does the reading.
  it('forwards the abort signal', async () => {
    const controller = new AbortController()
    await service.build(request(), controller.signal)

    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({ districtId: DISTRICT_ID }),
      controller.signal,
    )
  })

  // Voter data has one store, so there is nothing to fall back to and a
  // failure must surface rather than resolve to a partial pack.
  it('propagates a failure from the pack build', async () => {
    build.mockRejectedValue(new Error('warehouse unavailable'))

    await expect(service.build(request())).rejects.toThrow(
      'warehouse unavailable',
    )
  })
})
