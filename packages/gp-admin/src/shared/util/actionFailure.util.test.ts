import { describe, it, expect } from 'vitest'
import {
  DEPLOY_SKEW_MESSAGE,
  describeActionFailure,
} from './actionFailure.util'

describe('describeActionFailure', () => {
  it('maps a stale-deployment action id to the refresh hint', () => {
    const error = new Error(
      'Failed to find Server Action "abc123". This request might be from ' +
        'an older or newer deployment.'
    )
    expect(describeActionFailure(error, 'Failed')).toBe(DEPLOY_SKEW_MESSAGE)
  })

  it('appends the digest for a prod-redacted server-action throw', () => {
    const error = Object.assign(
      new Error(
        'An error occurred in the Server Action. Please check the server ' +
          'logs for more information.'
      ),
      { digest: '1234567890' }
    )
    expect(describeActionFailure(error, 'Failed to resend CV PIN')).toBe(
      'Failed to resend CV PIN (server error, digest 1234567890)'
    )
  })

  it('passes through an ordinary error message', () => {
    expect(describeActionFailure(new Error('fetch failed'), 'Failed')).toBe(
      'fetch failed'
    )
  })

  it('falls back for non-Error values and empty messages', () => {
    expect(describeActionFailure('boom', 'Failed')).toBe('Failed')
    expect(describeActionFailure(new Error(''), 'Failed')).toBe('Failed')
  })
})
