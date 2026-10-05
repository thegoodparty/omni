import {
  AxiosError,
  AxiosHeaders,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios'
import { describe, expect, it } from 'vitest'
import {
  getPeerlyCvNestedStatus,
  getPeerlyCvRejectionDetail,
  isPeerlyCvRefusal,
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

// The body Peerly relayed for campaign 327336 on 2026-10-02: Campaign Verify
// refused the request with its edge's HTML 403 page, naming nothing to
// correct. Fifteen registration attempts in 75 minutes were made against it
// because it travelled as a transient 502.
const cvRefusalBody = {
  Error: 'Campaign Verify API request failed.',
  status_code: 403,
  details:
    '<html>\r\n<head><title>403 Forbidden</title></head>\r\n' +
    '<body>\r\n<center><h1>403 Forbidden</h1></center>\r\n' +
    '<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n',
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

  it('does not match CV refusing the request (nested 403)', () => {
    expect(isPeerlyCvRejection(createAxiosError(cvRefusalBody))).toBe(false)
  })
})

describe('isPeerlyCvRefusal', () => {
  it('matches the real submit_cv refusal (400 + nested 403, HTML body)', () => {
    expect(isPeerlyCvRefusal(createAxiosError(cvRefusalBody))).toBe(true)
  })

  it('matches a nested 429 (CV throttling us)', () => {
    const error = createAxiosError({
      Error: 'Campaign Verify API request failed.',
      status_code: 429,
    })

    expect(isPeerlyCvRefusal(error)).toBe(true)
  })

  it('leaves a nested 400 to the data-rejection path', () => {
    expect(isPeerlyCvRefusal(createAxiosError(fecRejectionBody))).toBe(false)
  })

  it('does not match a nested 5xx (CV down, still transient)', () => {
    const error = createAxiosError({
      Error: 'Campaign Verify API request failed.',
      status_code: 502,
    })

    expect(isPeerlyCvRefusal(error)).toBe(false)
  })

  it('does not match a 403 that is not a Campaign Verify failure', () => {
    const error = createAxiosError({
      Error: 'Identity not yours',
      status_code: 403,
    })

    expect(isPeerlyCvRefusal(error)).toBe(false)
  })

  it('does not match a non-axios error', () => {
    expect(isPeerlyCvRefusal(new Error('boom'))).toBe(false)
  })
})

describe('getPeerlyCvNestedStatus', () => {
  it('reports the status Campaign Verify itself returned', () => {
    expect(getPeerlyCvNestedStatus(createAxiosError(cvRefusalBody))).toBe(403)
  })

  it('returns null when this is not the Campaign Verify envelope', () => {
    expect(getPeerlyCvNestedStatus(new Error('boom'))).toBeNull()
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

  it('reduces an HTML error page to one readable line', () => {
    expect(getPeerlyCvRejectionDetail(createAxiosError(cvRefusalBody))).toBe(
      '403 Forbidden 403 Forbidden nginx',
    )
  })

  it('caps a long detail so it cannot flood Slack or a candidate message', () => {
    const error = createAxiosError({
      ...cvRefusalBody,
      details: 'x'.repeat(500),
    })

    const detail = getPeerlyCvRejectionDetail(error)

    expect(detail).toHaveLength(301)
    expect(detail.endsWith('…')).toBe(true)
  })

  it('returns empty string when details is absent', () => {
    const error = createAxiosError({
      Error: 'Campaign Verify API request failed.',
      status_code: 400,
    })

    expect(getPeerlyCvRejectionDetail(error)).toBe('')
  })
})
