import {
  AxiosError,
  AxiosHeaders,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios'
import { describe, expect, it } from 'vitest'
import { isPeerlyCvPinRejection } from './peerlyCvPinRejection.util'

const createAxiosError = (
  responseData: Record<string, unknown> | undefined,
  status = 400,
  url = '/v2/tdlc/123/verify_pin',
): AxiosError => {
  const config: AxiosRequestConfig = {
    url,
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

// The exact bodies Peerly returns for these two — identical across every
// occurrence in bot-10dlc-compliance from 2026-03 through 2026-08.
const wrongPinBody = {
  Error: 'Campaign Verify Verify PIN API request failed.',
  status_code: 422,
}
const declinedResendBody = {
  Error: 'Campaign Verify Resend PIN API request failed.',
  status_code: 422,
}

describe('isPeerlyCvPinRejection', () => {
  it('detects a wrong PIN on verify_pin', () => {
    expect(isPeerlyCvPinRejection(createAxiosError(wrongPinBody))).toBe(true)
  })

  it('detects a declined resend on resend_pin', () => {
    const error = createAxiosError(
      declinedResendBody,
      400,
      '/v2/tdlc/123/resend_pin',
    )
    expect(isPeerlyCvPinRejection(error)).toBe(true)
  })

  it('does not match a nested 5xx — CampaignVerify being down still pages', () => {
    const error = createAxiosError({
      Error: 'Campaign Verify Verify PIN API request failed.',
      status_code: 500,
    })
    expect(isPeerlyCvPinRejection(error)).toBe(false)
  })

  it('does not match when Peerly itself 5xxs', () => {
    const error = createAxiosError({ Error: 'Internal Server Error' }, 500)
    expect(isPeerlyCvPinRejection(error)).toBe(false)
  })

  it('does not match a 400 from Peerly that is not a CV passthrough', () => {
    const error = createAxiosError({ Error: 'Invalid identity id' })
    expect(isPeerlyCvPinRejection(error)).toBe(false)
  })

  it('does not match a CV envelope with no nested status', () => {
    const error = createAxiosError({
      Error: 'Campaign Verify Verify PIN API request failed.',
    })
    expect(isPeerlyCvPinRejection(error)).toBe(false)
  })

  it('handles a missing response body and non-Axios errors', () => {
    expect(isPeerlyCvPinRejection(createAxiosError(undefined))).toBe(false)
    expect(isPeerlyCvPinRejection(new Error('boom'))).toBe(false)
    expect(isPeerlyCvPinRejection(null)).toBe(false)
  })
})
