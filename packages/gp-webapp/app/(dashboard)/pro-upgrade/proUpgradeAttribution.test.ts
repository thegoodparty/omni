import { describe, it, expect } from 'vitest'
import {
  parseProUpgradeAttribution,
  proUpgradeHref,
} from './proUpgradeAttribution'

describe('proUpgradeHref', () => {
  it('carries source, channel and cta on the wizard entry path', () => {
    expect(
      proUpgradeHref({
        source: 'navigation',
        channel: 'generic',
        cta: 'Join Pro',
      }),
    ).toBe('/pro-upgrade?source=navigation&channel=generic&cta=Join+Pro')
  })

  it('leaves cta off when there is none', () => {
    expect(proUpgradeHref({ source: 'contacts', channel: 'generic' })).toBe(
      '/pro-upgrade?source=contacts&channel=generic',
    )
  })
})

describe('parseProUpgradeAttribution', () => {
  it('round-trips what proUpgradeHref writes', () => {
    const href = proUpgradeHref({
      source: 'dashboard_banner',
      channel: 'generic',
      cta: 'Get Pro',
    })
    const params = new URLSearchParams(href.split('?')[1])
    expect(parseProUpgradeAttribution(params)).toEqual({
      source: 'dashboard_banner',
      channel: 'generic',
      cta: 'Get Pro',
    })
  })

  it('reads a bare entry as direct and generic', () => {
    expect(parseProUpgradeAttribution(new URLSearchParams())).toEqual({
      source: 'direct',
      channel: 'generic',
    })
  })

  it('drops values outside the allowlist', () => {
    const params = new URLSearchParams({ source: 'evil', channel: 'fax' })
    expect(parseProUpgradeAttribution(params)).toEqual({
      source: 'direct',
      channel: 'generic',
    })
  })

  it('caps the cta length', () => {
    const params = new URLSearchParams({ cta: 'x'.repeat(200) })
    expect(parseProUpgradeAttribution(params).cta).toHaveLength(80)
  })
})
