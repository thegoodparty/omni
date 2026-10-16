import { AxiosError, AxiosHeaders, InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it } from 'vitest'
import {
  isPeerlyNotCellRejection,
  peerlyTestSendRejectionMessage,
} from './peerlyTestSendRejection.util'

const axiosError = (
  status: number,
  data: Record<string, unknown> | undefined,
): AxiosError => {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, {
    data,
    status,
    statusText: '',
    headers: {},
    config,
  })
}

describe('isPeerlyNotCellRejection', () => {
  it('matches the 403 Peerly returns from addcontact', () => {
    expect(
      isPeerlyNotCellRejection(
        axiosError(403, { Error: 'Not a cell number.' }),
      ),
    ).toBe(true)
  })

  it('does not match a 5xx that carries the same wording', () => {
    expect(
      isPeerlyNotCellRejection(
        axiosError(500, { Error: 'Not a cell number.' }),
      ),
    ).toBe(false)
  })

  it('does not match other client errors', () => {
    expect(
      isPeerlyNotCellRejection(axiosError(403, { Error: 'Forbidden' })),
    ).toBe(false)
  })

  it('ignores errors that are not axios errors', () => {
    expect(isPeerlyNotCellRejection(new Error('Not a cell number'))).toBe(false)
    expect(isPeerlyNotCellRejection(undefined)).toBe(false)
  })
})

describe('peerlyTestSendRejectionMessage', () => {
  it.each([
    "test_contact_phone '5551234567' not in test_list_id '3226903'.",
    'Lead already exists in leads table',
  ])('explains a 400 "%s" to the reviewer', (text) => {
    expect(
      peerlyTestSendRejectionMessage(axiosError(400, { Error: text })),
    ).toMatch(/Try a different number/)
  })

  it('keeps a 400 caused by our own request a fault', () => {
    expect(
      peerlyTestSendRejectionMessage(
        axiosError(400, { Error: "'test_list_id' is a required parameter" }),
      ),
    ).toBeNull()
  })

  it('keeps known wording on a non-400 status a fault', () => {
    expect(
      peerlyTestSendRejectionMessage(
        axiosError(500, { Error: 'Lead already exists in leads table' }),
      ),
    ).toBeNull()
  })

  it('handles a missing body and non-axios errors', () => {
    expect(
      peerlyTestSendRejectionMessage(axiosError(400, undefined)),
    ).toBeNull()
    expect(peerlyTestSendRejectionMessage(new Error('boom'))).toBeNull()
  })
})
