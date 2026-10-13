import { AxiosError, AxiosHeaders, InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it } from 'vitest'
import { isPeerlyClientRejection } from './peerlyClientRejection.util'

const axiosError = (status: number): AxiosError => {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, {
    data: { Error: 'Not a cell number.' },
    status,
    statusText: '',
    headers: {},
    config,
  })
}

describe('isPeerlyClientRejection', () => {
  it.each([400, 422])('treats a %i as a rejected input', (status) => {
    expect(isPeerlyClientRejection(axiosError(status))).toBe(true)
  })

  it.each([401, 403, 429, 500, 502])('keeps a %i an incident', (status) => {
    expect(isPeerlyClientRejection(axiosError(status))).toBe(false)
  })

  it('ignores errors that are not axios errors', () => {
    expect(isPeerlyClientRejection(new Error('boom'))).toBe(false)
    expect(isPeerlyClientRejection(undefined)).toBe(false)
  })
})
