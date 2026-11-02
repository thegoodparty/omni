import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@/generated/election-prisma'
import { retryReadOperation } from './retryOnDeadlock.util'

const deadlock = () =>
  new Prisma.PrismaClientUnknownRequestError(
    'PostgresError { code: "40P01", message: "deadlock detected" }',
    { clientVersion: '6.19.3' },
  )

const run = (operation: string, query: (args: unknown) => Promise<unknown>) =>
  retryReadOperation({ operation, args: {}, query })

describe('retryReadOnDeadlock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries a read that lost a deadlock and returns the retry result', async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(deadlock())
      .mockResolvedValueOnce(['race'])
    const result = run('findMany', query)
    await vi.runAllTimersAsync()
    await expect(result).resolves.toEqual(['race'])
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('gives up after two retries and surfaces the deadlock', async () => {
    const query = vi.fn().mockRejectedValue(deadlock())
    const assertion = expect(run('findMany', query)).rejects.toThrow(/40P01/)
    await vi.runAllTimersAsync()
    await assertion
    expect(query).toHaveBeenCalledTimes(3)
  })

  it('does not retry writes', async () => {
    const query = vi.fn().mockRejectedValue(deadlock())
    await expect(run('update', query)).rejects.toThrow(/40P01/)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('does not retry other errors', async () => {
    const query = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(run('findMany', query)).rejects.toThrow('boom')
    expect(query).toHaveBeenCalledTimes(1)
  })
})
