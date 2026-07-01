import { describe, it, expect } from 'vitest'
import {
  MIN_BIO_LENGTH,
  isGenuineBioPlainText,
  hasGenuineIssue,
} from './compliance'

describe('MIN_BIO_LENGTH', () => {
  it('is the shared 500-character genuineness threshold', () => {
    expect(MIN_BIO_LENGTH).toBe(500)
  })
})

describe('isGenuineBioPlainText', () => {
  const longText = 'a genuine sentence about the candidate. '.repeat(20)

  it('is false for too-short or template text', () => {
    expect(isGenuineBioPlainText('short bio')).toBe(false)
    expect(
      isGenuineBioPlainText(
        'X is a candidate in IA, running on local solutions over party ' +
          'politics and committed to putting the community first.',
      ),
    ).toBe(false)
  })

  it('is true for real text at or over the minimum length', () => {
    expect(isGenuineBioPlainText(longText)).toBe(true)
  })

  it('rejects the template marker even when long enough', () => {
    const longTemplate =
      'a '.repeat(300) + 'running on local solutions over party politics'
    expect(longTemplate.length).toBeGreaterThanOrEqual(MIN_BIO_LENGTH)
    expect(isGenuineBioPlainText(longTemplate)).toBe(false)
  })
})

describe('hasGenuineIssue', () => {
  it('is false for empty, malformed, or default-only issues', () => {
    expect(hasGenuineIssue([])).toBe(false)
    expect(hasGenuineIssue([null as never])).toBe(false)
    expect(hasGenuineIssue([{ title: 'X', description: '' }])).toBe(false)
    expect(
      hasGenuineIssue([
        {
          title: 'Local Solutions, Not Party Politics',
          description: 'focused on practical, community-first leadership',
        },
      ]),
    ).toBe(false)
  })

  it('is true when a real non-default issue exists', () => {
    expect(
      hasGenuineIssue([
        { title: 'Addressing PFAS', description: 'clean water for families' },
      ]),
    ).toBe(true)
  })
})
