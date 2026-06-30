import { describe, it, expect } from 'vitest'
import { CRMCompanyProperties } from 'src/crm/schemas/CRMCompanyProperties.schema'
import { HubSpot } from '../../crm/crm.types'
import {
  CRMCompanyPropertyField,
  filterPropertiesForUpdate,
} from './crmCompanyProperties.util'

// Characterization tests pinning the CURRENT behavior of the helper that was
// lifted verbatim out of CrmCampaignsService.filterPropertiesForUpdate.

// `keyof CRMCompanyProperties` is the HubSpot.OutgoingProperty string-enum
// union, so field selectors must be the enum members (not bare strings).
const P = HubSpot.OutgoingProperty

describe('filterPropertiesForUpdate', () => {
  describe("when fields is exactly ['all']", () => {
    it('returns the same properties object untouched (identity, no copy)', () => {
      const properties: CRMCompanyProperties = {
        state: 'CA',
        city: 'Oakland',
        calls_made: '42',
      }

      const result = filterPropertiesForUpdate(properties, ['all'])

      // includeAll short-circuits and hands back the exact input reference.
      expect(result).toBe(properties)
    })

    it("treats only the length-1 ['all'] sentinel as include-all", () => {
      const properties: CRMCompanyProperties = { state: 'CA', city: 'Oakland' }

      // ['all', 'all'] has length 2, so include-all does NOT trigger; both
      // 'all' entries are skipped in the reduce, yielding an empty object.
      const result = filterPropertiesForUpdate(properties, ['all', 'all'])

      expect(result).not.toBe(properties)
      expect(result).toEqual({})
    })
  })

  describe('include / exclude filtering by fields', () => {
    it('keeps only the requested fields and drops the rest', () => {
      const properties: CRMCompanyProperties = {
        state: 'CA',
        city: 'Oakland',
        zip: '94601',
      }

      const result = filterPropertiesForUpdate(properties, [P.state, P.zip])

      expect(result).toEqual({ state: 'CA', zip: '94601' })
      expect(result).not.toHaveProperty('city')
    })

    it("skips the 'all' sentinel when mixed with real fields", () => {
      const properties: CRMCompanyProperties = { state: 'CA', city: 'Oakland' }

      // length > 1 so include-all is off; 'all' is skipped, 'state' carried.
      const result = filterPropertiesForUpdate(properties, ['all', P.state])

      expect(result).toEqual({ state: 'CA' })
    })
  })

  describe('empty fields array', () => {
    it('returns an empty object', () => {
      const properties: CRMCompanyProperties = { state: 'CA', city: 'Oakland' }

      const result = filterPropertiesForUpdate(properties, [])

      expect(result).toEqual({})
    })
  })

  describe('missing / absent keys', () => {
    it('omits requested fields that are absent from the source', () => {
      const properties: CRMCompanyProperties = { state: 'CA' }

      const result = filterPropertiesForUpdate(properties, [P.state, P.city])

      // 'city' is undefined (falsy, not null) so it is excluded entirely.
      expect(result).toEqual({ state: 'CA' })
      expect(result).not.toHaveProperty('city')
    })
  })

  describe('falsy values', () => {
    it('drops fields whose value is the empty string', () => {
      const properties: CRMCompanyProperties = { state: '', city: 'Oakland' }

      const result = filterPropertiesForUpdate(properties, [P.state, P.city])

      // '' is falsy and not null, so 'state' is filtered out.
      expect(result).toEqual({ city: 'Oakland' })
      expect(result).not.toHaveProperty('state')
    })
  })

  describe('value passthrough', () => {
    it('copies kept values verbatim without transformation', () => {
      const properties: CRMCompanyProperties = {
        state: 'CA',
        candidate_name: 'Jane Doe',
        votegoal: '1234',
      }
      const fields: CRMCompanyPropertyField[] = [
        P.state,
        P.candidate_name,
        P.votegoal,
      ]

      const result = filterPropertiesForUpdate(properties, fields)

      expect(result).toEqual({
        state: 'CA',
        candidate_name: 'Jane Doe',
        votegoal: '1234',
      })
    })
  })
})
