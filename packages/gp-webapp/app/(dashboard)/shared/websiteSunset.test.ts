import { describe, it, expect } from 'vitest'
import { isWebsiteSunsetEligible } from './websiteSunset'
import type { Website } from 'helpers/types'

const websiteWithDomain = {
  id: 1,
  vanityPath: 'jane',
  status: 'published',
  content: null,
  domain: { name: 'janeforcity.com', status: 'registered' },
} as Website

const websiteWithoutDomain = {
  id: 2,
  vanityPath: 'john',
  status: 'published',
  content: null,
  domain: null,
} as Website

describe('isWebsiteSunsetEligible', () => {
  it('is eligible when the website has a purchased domain', () => {
    expect(isWebsiteSunsetEligible(websiteWithDomain)).toBe(true)
  })

  it('is not eligible for an auto-generated site with no purchased domain', () => {
    expect(isWebsiteSunsetEligible(websiteWithoutDomain)).toBe(false)
  })

  it('is not eligible when there is no website', () => {
    expect(isWebsiteSunsetEligible(null)).toBe(false)
  })
})
