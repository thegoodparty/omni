import { describe, expect, it } from 'vitest'
import {
  DATA_SOURCE_ROUTING_RULES,
  dataSourceRoutingRules,
} from './dataSourceRouting'

describe('DATA_SOURCE_ROUTING_RULES', () => {
  // Win and Serve mandate opposite audience nouns for this data ("voters" vs
  // "constituents"); shared rule text has to use neither.
  it('uses neither product audience noun', () => {
    expect(DATA_SOURCE_ROUTING_RULES).not.toMatch(/\bconstituents\b/i)
    expect(DATA_SOURCE_ROUTING_RULES).not.toMatch(/\bvoters\b/i)
  })

  it('is the voters dataset text', () => {
    expect(DATA_SOURCE_ROUTING_RULES).toBe(
      dataSourceRoutingRules({ base: 'voters' }),
    )
    expect(DATA_SOURCE_ROUTING_RULES).not.toMatch(/not registered to vote/i)
  })
})

describe('dataSourceRoutingRules on the constituents dataset', () => {
  const rules = dataSourceRoutingRules({ base: 'constituents' })

  it('stops calling the mart a voter file', () => {
    expect(rules).not.toMatch(/voter-file/i)
    expect(rules).toMatch(/district constituent mart/i)
  })

  it('tells the model which base a total counts', () => {
    expect(rules).toMatch(/not registered to vote/i)
  })

  it('still uses neither product audience noun', () => {
    expect(rules).not.toMatch(/\bconstituents\b/i)
    expect(rules).not.toMatch(/\bvoters\b/i)
  })
})

describe('dataSourceRoutingRules with the imported-contact overlay', () => {
  const withOverlay = dataSourceRoutingRules({
    base: 'constituents',
    overlayOrgSlug: 'eo-office',
  })

  it('routes uploaded-list and email questions to the constituent query', () => {
    expect(withOverlay).toMatch(/uploaded lists, imported contacts/)
    expect(withOverlay).toContain(
      'call query_constituent_data with on_uploaded_list = true',
    )
    expect(withOverlay).toContain('has_email = true')
  })

  it('says imported people are already in contact counts and saved lists', () => {
    expect(withOverlay).toMatch(
      /everyone an upload matched or added counts in contact counts, saved lists/,
    )
    expect(withOverlay).toMatch(/never answer these from saved lists/)
  })

  it('works on the voters base too', () => {
    const rules = dataSourceRoutingRules({
      base: 'voters',
      overlayOrgSlug: 'eo-office',
    })
    expect(rules).toContain('on_uploaded_list = true')
    expect(rules).toContain('voter-file mart')
  })

  it('stays out of the rules for an org without the overlay', () => {
    expect(dataSourceRoutingRules({ base: 'constituents' })).not.toMatch(
      /on_uploaded_list|has_email/,
    )
    expect(DATA_SOURCE_ROUTING_RULES).not.toMatch(/on_uploaded_list|has_email/)
  })

  it('still uses neither product audience noun', () => {
    expect(withOverlay).not.toMatch(/\bconstituents\b/i)
    expect(withOverlay).not.toMatch(/\bvoters\b/i)
  })
})

describe('dataSourceRoutingRules for a Win campaign with imported contacts', () => {
  const rules = dataSourceRoutingRules({
    base: 'voters',
    overlayOrgSlug: 'campaign-springfield',
    overlayDistrictId: 'district-1',
  })

  it('names people only an import added new contacts added, never voters', () => {
    expect(rules).toContain(
      'A person an upload added who is not in the voter file is a new contact added, never a voter',
    )
    expect(rules).toContain(
      'give voters and new contacts added as two separate numbers',
    )
  })

  it('points the CRM catalog at the source dimension and the mart at new_contact', () => {
    expect(rules).toContain('source ["voterFile"] for voters')
    expect(rules).toContain('["imported"] for new contacts added')
    expect(rules).toContain('new_contact = true marks a new contact added')
    expect(rules).toContain('add new_contact = false to any total')
  })

  it('drops the Serve rule that only the mart can single them out', () => {
    expect(rules).not.toMatch(/never answer these from saved lists/)
    expect(rules).not.toMatch(/\bconstituents?\b/i)
  })
})
