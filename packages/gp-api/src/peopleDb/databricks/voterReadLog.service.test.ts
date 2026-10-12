import { beforeEach, describe, expect, it, vi } from 'vitest'
import { statementIdCollector } from './peopleDbxStatement.client'
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

  it('logs op, districtId, elapsed ms and statement ids', async () => {
    const entry = await measure(async () => 'rows').then(
      () => info.mock.calls[0]?.[0] as Record<string, unknown>,
    )

    expect(info).toHaveBeenCalledWith(expect.anything(), VOTER_READ_MESSAGE)
    expect(entry).toEqual({
      op: 'list',
      districtId: DISTRICT_ID,
      dbxMs: expect.any(Number),
      statementIds: [],
    })
  })

  // The join key for warehouse-side latency attribution. One operation can
  // issue several statements -- a list is a count plus a page -- so this has
  // to accumulate, not overwrite.
  it('collects every statement id the read issued, in order', async () => {
    await measure(async () => {
      statementIdCollector.getStore()?.push('stmt-count')
      await Promise.resolve()
      statementIdCollector.getStore()?.push('stmt-page')
      return 'rows'
    })

    expect(info.mock.calls[0]?.[0]).toMatchObject({
      statementIds: ['stmt-count', 'stmt-page'],
    })
  })

  // A statement that timed out is exactly the sample a cold-start attribution
  // needs, so the line survives the failure even though the error propagates.
  it('logs the read and rethrows when it fails', async () => {
    const failing = measure(async () => {
      statementIdCollector.getStore()?.push('stmt-doomed')
      throw new Error('warehouse unavailable')
    })

    await expect(failing).rejects.toThrow('warehouse unavailable')
    expect(info).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'list',
        districtId: DISTRICT_ID,
        statementIds: ['stmt-doomed'],
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
          statementIdCollector.getStore()?.push(id)
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
