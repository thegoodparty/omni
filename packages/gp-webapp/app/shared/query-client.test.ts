import { describe, expect, it } from 'vitest'
import { queryClientConfig } from './query-client'

const retry = queryClientConfig.defaultOptions?.queries?.retry as (
  failureCount: number,
  error: unknown,
) => boolean

const unauthorized = {
  response: { status: 401 },
  message: '[GET] "/api/v1/onboarding/voter-issues": 401',
}
const serverError = { response: { status: 500 }, message: 'boom' }

describe('queryClientConfig retry', () => {
  // A dead session does not come back between attempts, and clientRequest is
  // already navigating to sign in; retrying a 401 only multiplied the failed
  // requests a page load produced (ENG-11674).
  it('does not retry a 401', () => {
    expect(retry(1, unauthorized)).toBe(false)
  })

  it('still retries other failures twice', () => {
    // failureCount is the number of failures so far, so `retry: 2` compared
    // `failureCount < 2`: three attempts in total.
    expect(retry(0, serverError)).toBe(true)
    expect(retry(1, serverError)).toBe(true)
    expect(retry(2, serverError)).toBe(false)
  })
})
