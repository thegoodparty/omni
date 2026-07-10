import {
  AxiosError,
  AxiosHeaders,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios'
import { describe, expect, it } from 'vitest'
import {
  getPeerlyCvRejectionDetail,
  isPeerlyCvRejection,
} from './peerlyCvRejection.util'

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

// The exact body Peerly returned for the FEC-filing-URL rejection that burned
// through the compliance recovery loop (bot-10dlc-compliance, 2026-07-08).
const fecRejectionBody = {
  Error: 'Campaign Verify API request failed.',
  status_code: 400,
  details:
    '{"error":"FEC filing URLs are not allowed.",' +
    '"errors":["FEC filing URLs are not allowed."]}',
}

describe('isPeerlyCvRejection', () => {
  it('matches the real submit_cv CV rejection (400 + nested 400)', () => {
    expect(isPeerlyCvRejection(createAxiosError(fecRejectionBody))).toBe(true)
  })

  it('does not match when CV itself failed with a 5xx (still transient)', () => {
    const error = createAxiosError({
      Error: 'Campaign Verify API request failed.',
      status_code: 502,
    })

    expect(isPeerlyCvRejection(error)).toBe(false)
  })

  it('does not match the nested-404 "no CV exists" envelope', () => {
    const error = createAxiosError({
      Error: 'Campaign Verify API request failed.',
      status_code: 404,
    })

    expect(isPeerlyCvRejection(error)).toBe(false)
  })

  it('does not match a 400 that is not a Campaign Verify failure', () => {
    const error = createAxiosError({
      Error: 'Invalid identity',
      status_code: 400,
    })

    expect(isPeerlyCvRejection(error)).toBe(false)
  })

  it('does not match a transient 500', () => {
    const error = createAxiosError(
      { Error: 'Campaign Verify API request failed.', status_code: 400 },
      500,
    )

    expect(isPeerlyCvRejection(error)).toBe(false)
  })

  it('does not match a non-axios error', () => {
    expect(isPeerlyCvRejection(new Error('boom'))).toBe(false)
  })
})

describe('getPeerlyCvRejectionDetail', () => {
  it('extracts the error from the JSON-encoded details string', () => {
    expect(getPeerlyCvRejectionDetail(createAxiosError(fecRejectionBody))).toBe(
      'FEC filing URLs are not allowed.',
    )
  })

  it('joins the errors array when no top-level error field is present', () => {
    const error = createAxiosError({
      ...fecRejectionBody,
      details: '{"errors":["first problem","second problem"]}',
    })

    expect(getPeerlyCvRejectionDetail(error)).toBe(
      'first problem; second problem',
    )
  })

  it('falls back to the raw string when details is not JSON', () => {
    const error = createAxiosError({
      ...fecRejectionBody,
      details: 'plain-text rejection reason',
    })

    expect(getPeerlyCvRejectionDetail(error)).toBe(
      'plain-text rejection reason',
    )
  })

  it('returns empty string when details is absent', () => {
    const error = createAxiosError({
      Error: 'Campaign Verify API request failed.',
      status_code: 400,
    })

    expect(getPeerlyCvRejectionDetail(error)).toBe('')
  })
})
