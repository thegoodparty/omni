import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@/generated/election-prisma'
import { retryReadOperation } from './retryOnLockConflict.util'

const modelError = (code: string) =>
  new Prisma.PrismaClientUnknownRequestError(
    `PostgresError { code: "${code}", message: "lock lost" }`,
    { clientVersion: '6.19.3' },
  )

const rawError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(
    `Raw query failed. Code: \`${code}\`. Message: \`lock lost\``,
    { code: 'P2010', clientVersion: '6.19.3' },
  )

const run = (operation: string, query: (args: unknown) => Promise<unknown>) =>
  retryReadOperation({ operation, args: {}, query })

describe('retryReadOperation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['a deadlock', 'findMany', modelError('40P01')],
    ['a lock timeout', 'findMany', modelError('55P03')],
    ['a raw query lock timeout', '$queryRaw', rawError('55P03')],
  ])('retries a read that hit %s', async (_label, operation, err) => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce(['race'])
    const result = run(operation, query)
    await vi.runAllTimersAsync()
    await expect(result).resolves.toEqual(['race'])
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('gives up after 20 retries and surfaces the error', async () => {
    const query = vi.fn().mockRejectedValue(modelError('55P03'))
    const assertion = expect(run('findMany', query)).rejects.toThrow(/55P03/)
    await vi.runAllTimersAsync()
    await assertion
    expect(query).toHaveBeenCalledTimes(21)
  })

  it('does not retry writes', async () => {
    const query = vi.fn().mockRejectedValue(modelError('40P01'))
    await expect(run('update', query)).rejects.toThrow(/40P01/)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('does not retry other errors', async () => {
    const query = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(run('findMany', query)).rejects.toThrow('boom')
    expect(query).toHaveBeenCalledTimes(1)
  })
})
