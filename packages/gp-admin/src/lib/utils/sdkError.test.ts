import { describe, it, expect } from 'vitest'
import { SdkError } from '@goodparty_org/sdk'
import { extractApiErrorMessage } from './sdkError'

const FALLBACK = 'Failed to save changes'

describe('extractApiErrorMessage', () => {
  it('formats gp-api Zod validation errors with their field paths', () => {
    const error = new SdkError(400, '[PUT] "/v1/users/42": 400', undefined, {
      statusCode: 400,
      message: 'Validation failed',
      errors: [
        {
          code: 'custom',
          path: ['phone'],
          message: 'Must be valid phone number',
        },
        { code: 'custom', path: ['zip'], message: 'Must be valid Zip code' },
      ],
    })

    expect(extractApiErrorMessage(error, FALLBACK)).toBe(
      'Validation failed: phone: Must be valid phone number; zip: Must be valid Zip code'
    )
  })

  it('falls back to the body message when there are no field errors', () => {
    const error = new SdkError(409, 'Conflict', undefined, {
      statusCode: 409,
      message: 'User was modified by another request',
    })

    expect(extractApiErrorMessage(error, FALLBACK)).toBe(
      'User was modified by another request'
    )
  })

  it('returns the fallback for an SdkError without a parseable body', () => {
    expect(
      extractApiErrorMessage(new SdkError(0, 'network down'), FALLBACK)
    ).toBe(FALLBACK)
    expect(
      extractApiErrorMessage(
        new SdkError(500, 'boom', undefined, 'plain text body'),
        FALLBACK
      )
    ).toBe(FALLBACK)
  })

  it('returns the fallback for non-SdkError values', () => {
    expect(extractApiErrorMessage(new Error('oops'), FALLBACK)).toBe(FALLBACK)
    expect(extractApiErrorMessage(undefined, FALLBACK)).toBe(FALLBACK)
  })
})
