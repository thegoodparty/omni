import { beforeEach, describe, expect, it, vi } from 'vitest'
import { statementCollector } from './peopleDbxStatement.client'
import { VOTER_READ_MESSAGE, VoterReadLogService } from './voterReadLog.service'

const DISTRICT_ID = '11111111-2222-3333-4444-555555555555'

describe('VoterReadLogService', () => {
  let info: ReturnType<typeof vi.fn>
  let warn: ReturnType<typeof vi.fn>
  let service: VoterReadLogService

  beforeEach(() => {
    info = vi.fn()
    warn = vi.fn()
    service = new VoterReadLogService({
      info,
      warn,
      setContext: vi.fn(),
    } as never)
  })

  const measure = <T>(read: () => Promise<T>) =>
    service.measure({ op: 'list', districtId: DISTRICT_ID, read })

  it('returns the value the read produced', async () => {
    await expect(measure(async () => 'rows')).resolves.toBe('rows')
  })

  it('logs op, districtId, elapsed ms, statement ids and statement sizes', async () => {
    const entry = await measure(async () => 'rows').then(
      () => info.mock.calls[0]?.[0] as Record<string, unknown>,
    )

    expect(info).toHaveBeenCalledWith(expect.anything(), VOTER_READ_MESSAGE)
    expect(entry).toEqual({
      op: 'list',
      districtId: DISTRICT_ID,
      dbxMs: expect.any(Number),
      statementIds: [],
      statementBytes: [],
    })
  })

  // The join key for warehouse-side latency attribution, and the size beside
  // it. One operation can issue several statements -- a list is a count plus a
  // page -- so this has to accumulate, not overwrite.
  it('collects every statement the read issued, in order, with its size', async () => {
    await measure(async () => {
      statementCollector.getStore()?.push({ id: 'stmt-count', bytes: 420 })
      await Promise.resolve()
      statementCollector.getStore()?.push({ id: 'stmt-page', bytes: 1_200_000 })
      return 'rows'
    })

    expect(info.mock.calls[0]?.[0]).toMatchObject({
      statementIds: ['stmt-count', 'stmt-page'],
      statementBytes: [420, 1_200_000],
    })
  })

  // A statement that timed out is exactly the sample a cold-start attribution
  // needs, so the line survives the failure even though the error propagates.
  it('logs the read and rethrows when it fails', async () => {
    const failing = measure(async () => {
      statementCollector
        .getStore()
        ?.push({ id: 'stmt-doomed', bytes: 7_400_000 })
      throw new Error('warehouse unavailable')
    })

    await expect(failing).rejects.toThrow('warehouse unavailable')
    expect(info).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'list',
        districtId: DISTRICT_ID,
        statementIds: ['stmt-doomed'],
        // The size of the statement that failed is the whole point of keeping
        // the line on the error path: a 7MB statement is a planning cost, not
        // a cold warehouse.
        statementBytes: [7_400_000],
        err: expect.any(Error),
      }),
      VOTER_READ_MESSAGE,
    )
  })

  // Concurrent reads must not pool their ids into one line, or every
  // attribution join picks up statements from a neighbouring request.
  it('keeps concurrent reads statement ids apart', async () => {
    const read = (id: string) =>
      service.measure({
        op: 'list',
        districtId: DISTRICT_ID,
        read: async () => {
          await Promise.resolve()
          statementCollector.getStore()?.push({ id, bytes: 1 })
          return id
        },
      })

    await Promise.all([read('stmt-a'), read('stmt-b')])

    const logged = info.mock.calls.map(
      (call) => (call[0] as { statementIds: string[] }).statementIds,
    )
    expect(logged).toEqual(expect.arrayContaining([['stmt-a'], ['stmt-b']]))
  })
})
