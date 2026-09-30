import { describe, expect, it } from 'vitest'
import { chatOrgSlug } from './seedChatOrg'

// The slug this derives is `organization.slug`, the table's primary key, and
// the sweep seeds one organization per case PER ATTEMPT — so two attempts
// that derive one slug are the unique-constraint failure the per-attempt key
// exists to close. The derivation shortens, which is what could take the
// attempt suffix away again.
describe('chatOrgSlug', () => {
  const LONG_CASE = 'constituent-count-by-precinct-and-party'

  it('keeps the attempts of a long case id apart', () => {
    const slugs = [1, 2, 3].map((attempt) =>
      chatOrgSlug('chief_of_staff', `${LONG_CASE}-${attempt}`),
    )
    expect(new Set(slugs).size).toBe(3)
  })

  it('keeps two long case ids sharing a prefix apart', () => {
    expect(chatOrgSlug('chief_of_staff', `${LONG_CASE}-north-1`)).not.toBe(
      chatOrgSlug('chief_of_staff', `${LONG_CASE}-south-1`),
    )
  })

  it('keeps two agents on one case id apart', () => {
    expect(chatOrgSlug('chief_of_staff', `${LONG_CASE}-1`)).not.toBe(
      chatOrgSlug('priority_flow', `${LONG_CASE}-1`),
    )
  })

  // Both arms must seed the same slug for a case and attempt, or the system
  // prompts differ and every configDigest with them.
  it('is the same slug for the same case and attempt', () => {
    expect(chatOrgSlug('chief_of_staff', `${LONG_CASE}-2`)).toBe(
      chatOrgSlug('chief_of_staff', `${LONG_CASE}-2`),
    )
  })

  // 100 is what `organization.schema.ts` accepts for a slug.
  it('stays inside the length a slug is allowed', () => {
    expect(
      chatOrgSlug('chief_of_staff', `${'x'.repeat(300)}-1`).length,
    ).toBeLessThanOrEqual(100)
  })

  it('keeps a readable prefix so a seeded row can be recognised', () => {
    expect(chatOrgSlug('chief_of_staff', `${LONG_CASE}-1`)).toMatch(
      /^judge-chief-of-staff-constituent/,
    )
  })
})
