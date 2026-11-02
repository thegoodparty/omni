import { describe, expect, it } from 'vitest'
import { sesTemplateNameFor, sesTenantNameFor } from './ses.service'

describe('SES names', () => {
  it('prefixes the tenant with the environment', () => {
    expect(sesTenantNameFor('campaign-renee-wells')).toBe(
      'test-campaign-renee-wells',
    )
  })

  it('hashes a slug that does not fit SES tenant names', () => {
    const long = `campaign-${'x'.repeat(80)}`
    const name = sesTenantNameFor(long)
    expect(name).toMatch(/^test-org-[0-9a-f]{32}$/)
    expect(sesTenantNameFor(long)).toBe(name)
    expect(sesTenantNameFor('campaign.with.dots')).toMatch(/^test-org-/)
  })

  it('names templates by send under the environment prefix', () => {
    expect(sesTemplateNameFor(7)).toBe('test-email-7')
  })
})
