import {
  AxiosError,
  AxiosHeaders,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios'
import { describe, expect, it } from 'vitest'
import {
  isPeerlyBillingError,
  PEERLY_NO_PAYMENT_METHOD_MESSAGE,
} from './peerlyBillingError.util'

const createAxiosError = (
  responseData: Record<string, unknown> | undefined,
  status = 400,
): AxiosError => {
  const config: AxiosRequestConfig = {
    url: '/v2/tdlc/123/submit_cv',
    method: 'POST',
    headers: new AxiosHeaders(),
  }
  const response: AxiosResponse = {
    data: responseData,
    status,
    statusText: 'Bad Request',
    headers: {},
    config: config as AxiosResponse['config'],
  }
  return new AxiosError(
    'Request failed',
    'ERR_BAD_REQUEST',
    config as AxiosError['config'],
    {},
    response,
  )
}

describe('isPeerlyBillingError', () => {
  it('matches the real submit_cv billing body (400 + nested details)', () => {
    const error = createAxiosError({
      message: 'Campaign Verify API request failed',
      details: { message: PEERLY_NO_PAYMENT_METHOD_MESSAGE },
    })

    expect(isPeerlyBillingError(error)).toBe(true)
  })

  it('matches when the billing message is a string details field', () => {
    const error = createAxiosError({
      details: PEERLY_NO_PAYMENT_METHOD_MESSAGE,
    })

    expect(isPeerlyBillingError(error)).toBe(true)
  })

  it('matches when the billing message is at the top level', () => {
    const error = createAxiosError({
      message: PEERLY_NO_PAYMENT_METHOD_MESSAGE,
    })

    expect(isPeerlyBillingError(error)).toBe(true)
  })

  it('does not match a transient 500 (must still retry)', () => {
    const error = createAxiosError({ message: 'Internal Server Error' }, 500)

    expect(isPeerlyBillingError(error)).toBe(false)
  })

  it('does not match a 400 that is not the billing error', () => {
    const error = createAxiosError({
      message: 'Invalid filing_url',
      details: { message: 'filing_url must be a valid election filing' },
    })

    expect(isPeerlyBillingError(error)).toBe(false)
  })

  it('does not match the billing message returned with a non-400 status', () => {
    const error = createAxiosError(
      { details: { message: PEERLY_NO_PAYMENT_METHOD_MESSAGE } },
      502,
    )

    expect(isPeerlyBillingError(error)).toBe(false)
  })

  it('does not match a non-axios error', () => {
    expect(isPeerlyBillingError(new Error('boom'))).toBe(false)
  })
})
