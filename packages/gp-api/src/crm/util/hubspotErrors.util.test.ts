import { ApiException } from '@hubspot/api-client/lib/codegen/crm/contacts'
import { describe, expect, it } from 'vitest'
import { extractExistingContactId } from './hubspotErrors.util'

describe('extractExistingContactId', () => {
  it('extracts the id from a 409 duplicate-email create rejection', () => {
    const err = new ApiException(
      409,
      'Conflict',
      { message: 'Contact already exists. Existing ID: 12345' },
      {},
    )
    expect(extractExistingContactId(err)).toBe('12345')
  })

  it('returns undefined for a 409 with a null body instead of throwing', () => {
    const err = new ApiException(409, 'Conflict', null, {})
    expect(extractExistingContactId(err)).toBeUndefined()
  })

  it('returns undefined for a 409 whose message has no existing id', () => {
    const err = new ApiException(409, 'Conflict', { message: 'nope' }, {})
    expect(extractExistingContactId(err)).toBeUndefined()
  })

  it('returns undefined for a non-409 ApiException', () => {
    const err = new ApiException(
      500,
      'Server Error',
      { message: 'Contact already exists. Existing ID: 12345' },
      {},
    )
    expect(extractExistingContactId(err)).toBeUndefined()
  })

  it('returns undefined for a plain Error', () => {
    expect(extractExistingContactId(new Error('boom'))).toBeUndefined()
  })
})
