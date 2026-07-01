import { describe, it, expect } from 'vitest'
import {
  MIN_BIO_LENGTH,
  MIN_POLICY_FOCUS_LENGTH,
  getBioError,
  getPolicyPrioritiesError,
  getPolicyFormValidation,
  isCandidateProfileComplete,
} from './candidateProfile.utils'
import type { Website } from 'helpers/types'

const websiteWith = (
  bio: string,
  issues: { title: string; description: string }[],
): Website => ({ content: { about: { bio, issues } } }) as unknown as Website

const genuineBio = `<p>${'a'.repeat(MIN_BIO_LENGTH)}</p>`
const realIssue = { title: 'Clean Water', description: 'Protect our lakes.' }

describe('getBioError', () => {
  it('asks the user to add a bio when it is empty', () => {
    expect(getBioError(0)).toBe('Please add your bio')
  })

  it('reports the character requirement when the bio is too short', () => {
    expect(getBioError(MIN_BIO_LENGTH - 1)).toBe(
      `Your bio requires ${MIN_BIO_LENGTH} characters`,
    )
  })

  it('returns null once the bio meets the minimum length', () => {
    expect(getBioError(MIN_BIO_LENGTH)).toBeNull()
  })
})

describe('isCandidateProfileComplete', () => {
  it('is true for a genuine bio and a real issue', () => {
    expect(
      isCandidateProfileComplete(websiteWith(genuineBio, [realIssue])),
    ).toBe(true)
  })

  it('is false for a genuine bio but only the default-title issue', () => {
    // The old count-only check said complete; the API submit gate rejects it,
    // so the UI must agree (this was the real regression, e.g. a legacy site
    // with a real bio but only the fallback default issue).
    expect(
      isCandidateProfileComplete(
        websiteWith(genuineBio, [
          {
            title: 'Local Solutions, Not Party Politics',
            description: 'focused on practical, community-first leadership',
          },
        ]),
      ),
    ).toBe(false)
  })

  it('is false for a genuine bio but an issue with an empty description', () => {
    expect(
      isCandidateProfileComplete(
        websiteWith(genuineBio, [{ title: 'Roads', description: '' }]),
      ),
    ).toBe(false)
  })

  it('is false when the bio is under the minimum length', () => {
    expect(
      isCandidateProfileComplete(websiteWith('<p>short</p>', [realIssue])),
    ).toBe(false)
  })
})

describe('getPolicyPrioritiesError', () => {
  it('asks for at least one priority when there are none', () => {
    expect(getPolicyPrioritiesError(0)).toBe(
      'Please add at least one policy priority',
    )
  })

  it('returns null once at least one priority exists', () => {
    expect(getPolicyPrioritiesError(1)).toBeNull()
  })
})

describe('getPolicyFormValidation', () => {
  it('asks to add both fields when both are empty (matches Figma)', () => {
    const result = getPolicyFormValidation(0, 0)
    expect(result.message).toBe('Please add a Policy title and Policy focus')
    expect(result.titleInvalid).toBe(true)
    expect(result.focusInvalid).toBe(true)
  })

  it('reports the focus length requirement when the title is set but focus is too short (matches Figma)', () => {
    const result = getPolicyFormValidation(
      'Education'.length,
      MIN_POLICY_FOCUS_LENGTH - 1,
    )
    expect(result.message).toBe(
      `Policy focus requires ${MIN_POLICY_FOCUS_LENGTH} characters`,
    )
    expect(result.titleInvalid).toBe(false)
    expect(result.focusInvalid).toBe(true)
  })

  it('asks to add the title alone when only the title is missing', () => {
    const result = getPolicyFormValidation(0, MIN_POLICY_FOCUS_LENGTH)
    expect(result.message).toBe('Please add a Policy title')
    expect(result.titleInvalid).toBe(true)
    expect(result.focusInvalid).toBe(false)
  })

  it('asks to add the focus alone when only the focus is empty', () => {
    const result = getPolicyFormValidation(5, 0)
    expect(result.message).toBe('Please add a Policy focus')
    expect(result.titleInvalid).toBe(false)
    expect(result.focusInvalid).toBe(true)
  })

  it('surfaces both problems when the title is missing and the focus is present but too short', () => {
    const result = getPolicyFormValidation(0, MIN_POLICY_FOCUS_LENGTH - 1)
    expect(result.titleInvalid).toBe(true)
    expect(result.focusInvalid).toBe(true)
    // Both fields render red, so the message must explain both.
    expect(result.message).toContain('Policy title')
    expect(result.message).toContain('Policy focus')
  })

  it('returns no message when both fields satisfy their requirements', () => {
    const result = getPolicyFormValidation(5, MIN_POLICY_FOCUS_LENGTH)
    expect(result.message).toBeNull()
    expect(result.titleInvalid).toBe(false)
    expect(result.focusInvalid).toBe(false)
  })
})
