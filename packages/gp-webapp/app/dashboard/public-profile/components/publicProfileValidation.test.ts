import { describe, it, expect } from 'vitest'
import {
  fieldErrorsFromApiError,
  GENERIC_SAVE_ERROR,
  normalizeUrl,
  summarize,
  validateContact,
} from './publicProfileValidation'

describe('normalizeUrl', () => {
  it('adds https:// to a bare host, which the API would otherwise reject', () => {
    expect(normalizeUrl('instagram.com/jane')).toBe(
      'https://instagram.com/jane',
    )
    expect(normalizeUrl('www.example.org')).toBe('https://www.example.org')
  })

  it('leaves an explicit scheme alone, including http', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com')
    expect(normalizeUrl('http://example.com')).toBe('http://example.com')
  })

  it('keeps blank blank, so a cleared field stays cleared', () => {
    expect(normalizeUrl('')).toBe('')
    expect(normalizeUrl('   ')).toBe('')
  })
})

describe('validateContact', () => {
  it('rejects an address with no @ — the reported failure', () => {
    const errors = validateContact({
      publicEmail: 'thomasquocthainguyen.com',
    })
    expect(errors.publicEmail).toMatch(/valid email/i)
  })

  it('accepts a deliverable address', () => {
    expect(
      validateContact({ publicEmail: 'thomasquocthainguyen@gmail.com' }),
    ).toEqual({})
  })

  // Blank must never be an error: the editor sends null for an empty field and
  // every server rule is nullable, so flagging it would make clearing a field
  // impossible.
  it('treats blank fields as valid', () => {
    expect(
      validateContact({ publicEmail: '', websiteUrl: '', instagramUrl: '   ' }),
    ).toEqual({})
  })

  it('accepts a bare host, because it is normalized before sending', () => {
    expect(validateContact({ instagramUrl: 'instagram.com/jane' })).toEqual({})
  })

  it('rejects something that is not a link at all', () => {
    const errors = validateContact({ websiteUrl: 'not a url' })
    expect(errors.websiteUrl).toMatch(/valid link/i)
  })

  it('reports every offending field, not just the first', () => {
    const errors = validateContact({
      publicEmail: 'nope',
      websiteUrl: 'not a url',
    })
    expect(Object.keys(errors).sort()).toEqual(['publicEmail', 'websiteUrl'])
  })

  it('ignores phone fields, which the API caps by length but does not format', () => {
    expect(validateContact({ publicPhone: '714-905-9067' })).toEqual({})
  })
})

describe('fieldErrorsFromApiError', () => {
  it('recovers the field from a validation body', () => {
    const errors = fieldErrorsFromApiError({
      data: {
        statusCode: 400,
        errors: [{ path: ['publicEmail'], message: 'Invalid email address' }],
      },
    })
    expect(errors).toEqual({ publicEmail: 'Invalid email address' })
  })

  // The exact envelope is nestjs-zod's to choose, so the body is walked rather
  // than read at a fixed key.
  it('finds issues nested under a different key', () => {
    const errors = fieldErrorsFromApiError({
      data: {
        message: { issues: [{ path: ['websiteUrl'], message: 'Invalid URL' }] },
      },
    })
    expect(errors).toEqual({ websiteUrl: 'Invalid URL' })
  })

  it('returns nothing for a failure that names no field', () => {
    expect(fieldErrorsFromApiError({ data: {} })).toEqual({})
    expect(fieldErrorsFromApiError(new Error('network'))).toEqual({})
    expect(fieldErrorsFromApiError(undefined)).toEqual({})
  })
})

describe('summarize', () => {
  it('names one field', () => {
    expect(summarize({ publicEmail: 'x' }, 'win')).toBe(
      'Check Public email and save again.',
    )
  })

  it('names several', () => {
    expect(summarize({ publicEmail: 'x', instagramUrl: 'y' }, 'win')).toBe(
      'Check Public email and Instagram, then save again.',
    )
  })

  it('falls back when nothing is attributable', () => {
    expect(summarize({}, 'win')).toBe(GENERIC_SAVE_ERROR)
  })

  // The server can reject any column the editor sends, not just the contact
  // ones the client pre-validates, and naming a column is the same as saying
  // nothing.
  it('names the fields the client never validates, in the form\u2019s words', () => {
    expect(summarize({ displayName: 'x' }, 'win')).toBe(
      'Check Display name and save again.',
    )
    expect(summarize({ roleTitleOverride: 'x' }, 'win')).toBe(
      'Check Role / title and save again.',
    )
    expect(summarize({ bioOverride: 'x' }, 'win')).toBe(
      'Check About me and save again.',
    )
    expect(summarize({ publicPhone: 'x', officePhone: 'y' }, 'win')).toBe(
      'Check Phone and Office phone, then save again.',
    )
  })

  it('follows the product when the form renames a field', () => {
    expect(summarize({ whyRunning: 'x' }, 'win')).toBe(
      "Check Why I'm running and save again.",
    )
    expect(summarize({ whyRunning: 'x' }, 'serve')).toBe(
      'Check Why I serve and save again.',
    )
  })

  it('falls back to the key for a field the editor cannot show', () => {
    expect(summarize({ someNewColumn: 'x' }, 'win')).toBe(
      'Check someNewColumn and save again.',
    )
  })
})
