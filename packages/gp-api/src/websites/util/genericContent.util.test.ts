import { describe, it, expect } from 'vitest'
import {
  isBioGenuine,
  hasGenuineIssue,
  isGenericComplianceContent,
} from './genericContent.util'

const realBio = `<p>${'a genuine sentence about the candidate. '.repeat(20)}</p>`
const templateBio =
  '<p>Lucas Hewitt is a candidate in IA, running on local solutions ' +
  'over party politics and committed to putting the community first.</p>'

describe('isBioGenuine', () => {
  it('is false for empty, template, or too-short bios', () => {
    expect(isBioGenuine(null)).toBe(false)
    expect(isBioGenuine('<p>Short bio.</p>')).toBe(false)
    expect(isBioGenuine(templateBio)).toBe(false)
  })
  it('is true for a real bio at or over the minimum length', () => {
    expect(isBioGenuine(realBio)).toBe(true)
  })
  it('is false for a long bio that still contains the template marker', () => {
    const longTemplateBio = `<p>${templateBio.repeat(10)}</p>`
    expect(longTemplateBio.length).toBeGreaterThanOrEqual(500)
    expect(isBioGenuine(longTemplateBio)).toBe(false)
  })
})

describe('hasGenuineIssue', () => {
  it('is false for empty, malformed, or default-only issues', () => {
    expect(hasGenuineIssue([])).toBe(false)
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
  it('is false, not throwing, for a null element', () => {
    expect(hasGenuineIssue([null as never])).toBe(false)
  })
  it('finds the genuine issue and skips a null element without throwing', () => {
    expect(
      hasGenuineIssue([
        { title: 'PFAS', description: 'clean water' },
        null as never,
      ]),
    ).toBe(true)
  })
})

describe('isGenericComplianceContent', () => {
  it('is true when bio or issues are not genuine', () => {
    expect(isGenericComplianceContent({ about: {} })).toBe(true)
    expect(
      isGenericComplianceContent({
        about: {
          bio: templateBio,
          issues: [{ title: 'Addressing PFAS', description: 'clean water' }],
        },
      }),
    ).toBe(true)
  })
  it('is false when bio and issues are both genuine', () => {
    expect(
      isGenericComplianceContent({
        about: {
          bio: realBio,
          issues: [{ title: 'Addressing PFAS', description: 'clean water' }],
        },
      }),
    ).toBe(false)
  })
})
