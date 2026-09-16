import { describe, expect, it } from 'vitest'
import {
  checkProductMapCoverage,
  formatCoverageFailure,
} from './productMapCoverage'
import { PRODUCT_AREAS } from './productMap'

// THIS is the CI gate. Both gp-api.yml and gp-webapp.yml run on every pull
// request with no path filters, so a PR that adds a dashboard tab without a
// product-map entry fails here whichever package it touched.
describe('product map coverage', () => {
  it('describes every tab in the dashboard nav, and nothing that is gone', () => {
    const result = checkProductMapCoverage()
    expect(formatCoverageFailure(result)).toBe('')
  })

  it('reports an unmapped tab in words the fixer can act on', () => {
    const message = formatCoverageFailure({
      navIds: ['new-thing-dashboard'],
      unmapped: ['new-thing-dashboard'],
      stale: [],
    })
    expect(message).toContain('new-thing-dashboard')
    expect(message).toContain('productMap.ts')
  })

  it('reports a stale entry separately, since the fix is the opposite', () => {
    const message = formatCoverageFailure({
      navIds: [],
      unmapped: [],
      stale: ['removed-dashboard'],
    })
    expect(message).toContain('removed-dashboard')
    expect(message).toContain('no longer exist')
  })
})

describe('product map content', () => {
  it('gives every area at least one product', () => {
    for (const area of PRODUCT_AREAS) {
      expect(area.modes.length, area.name).toBeGreaterThan(0)
    }
  })

  // The assistant tells users to click these strings, so a trailing space or
  // a sentence in the name field is a real bug in a real answer.
  it('names areas as a tab reads, not as a sentence', () => {
    for (const area of PRODUCT_AREAS) {
      expect(area.name, area.name).toBe(area.name.trim())
      expect(area.name.length, area.name).toBeLessThan(40)
      expect(area.name, area.name).not.toContain('.')
    }
  })

  it('says what the user does in every area', () => {
    for (const area of PRODUCT_AREAS) {
      expect(area.does.length, area.name).toBeGreaterThan(20)
    }
  })
})
