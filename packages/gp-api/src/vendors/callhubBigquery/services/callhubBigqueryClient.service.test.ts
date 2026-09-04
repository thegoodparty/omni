import { BadGatewayException } from '@nestjs/common'
import { createMockLogger } from 'src/shared/test-utils/mockLogger.util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BigqueryPermanentError } from '../errors/bigqueryPermanentError'
import { BigqueryErrorHandlingService } from './bigqueryErrorHandling.service'
import { CallhubBigqueryClientService } from './callhubBigqueryClient.service'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

// vi.mock is hoisted above the imports, so the service constructs this mock.
// BigQuery is `new`-ed, so the mock must be a real constructor (an arrow fn
// factory is not constructable).
vi.mock('@google-cloud/bigquery', () => ({
  BigQuery: class {
    query = queryMock
  },
}))

const makeService = () =>
  new CallhubBigqueryClientService(
    createMockLogger(),
    new BigqueryErrorHandlingService(),
  )

describe('CallhubBigqueryClientService.query', () => {
  const savedProject = process.env.CALLHUB_BQ_PROJECT_ID

  beforeEach(() => {
    process.env.CALLHUB_BQ_PROJECT_ID = 'callhub-project'
    queryMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    if (savedProject === undefined) {
      delete process.env.CALLHUB_BQ_PROJECT_ID
    } else {
      process.env.CALLHUB_BQ_PROJECT_ID = savedProject
    }
  })

  it('returns typed rows on success', async () => {
    queryMock.mockResolvedValueOnce([[{ n: 3 }]])
    const rows = await makeService().query<{ n: number }>('SELECT 1 AS n')
    expect(rows).toEqual([{ n: 3 }])
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it('retries a transient error and then succeeds', async () => {
    vi.useFakeTimers()
    queryMock
      .mockRejectedValueOnce({ code: 503 })
      .mockResolvedValueOnce([[{ ok: true }]])
    const promise = makeService().query('SELECT 1')
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toEqual([{ ok: true }])
    expect(queryMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after a bounded number of transient retries', async () => {
    vi.useFakeTimers()
    queryMock.mockRejectedValue({ code: 503 })
    const result = makeService()
      .query('SELECT 1')
      .catch((error: unknown) => error)
    await vi.runAllTimersAsync()
    const thrown = await result
    expect(thrown).toBeInstanceOf(BadGatewayException)
    expect(thrown).not.toBeInstanceOf(BigqueryPermanentError)
    expect(queryMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry a permanent error', async () => {
    queryMock.mockRejectedValue({ code: 403 })
    await expect(makeService().query('SELECT 1')).rejects.toBeInstanceOf(
      BigqueryPermanentError,
    )
    expect(queryMock).toHaveBeenCalledTimes(1)
  })
})
