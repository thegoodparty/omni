import { afterEach, describe, expect, it, vi } from 'vitest'

const loadGetMarketingUrl = async (envValue?: string) => {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_MARKETING_SITE_DOMAIN', envValue ?? '')
  const { getMarketingUrl } = await import('./linkhelper')
  return getMarketingUrl
}

describe('getMarketingUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('composes the url from a clean domain', async () => {
    const getMarketingUrl = await loadGetMarketingUrl('goodparty.org')
    expect(getMarketingUrl('/run-for-office')).toBe(
      'https://goodparty.org/run-for-office',
    )
  })

  it('strips a https:// prefix from the domain', async () => {
    const getMarketingUrl = await loadGetMarketingUrl('https://goodparty.org')
    expect(getMarketingUrl('/run-for-office')).toBe(
      'https://goodparty.org/run-for-office',
    )
  })

  it('strips the mangled colon-less https// prefix', async () => {
    const getMarketingUrl = await loadGetMarketingUrl(
      'https//gp-marketing-peach.vercel.app/',
    )
    expect(getMarketingUrl('/run-for-office')).toBe(
      'https://gp-marketing-peach.vercel.app/run-for-office',
    )
  })

  it('strips trailing slashes from the domain', async () => {
    const getMarketingUrl = await loadGetMarketingUrl('goodparty.org/')
    expect(getMarketingUrl('/run-for-office')).toBe(
      'https://goodparty.org/run-for-office',
    )
  })

  it('handles a scheme and trailing slash combined', async () => {
    const getMarketingUrl = await loadGetMarketingUrl('https://goodparty.org/')
    expect(getMarketingUrl('/run-for-office')).toBe(
      'https://goodparty.org/run-for-office',
    )
  })

  it('adds the joining slash when the path has none', async () => {
    const getMarketingUrl = await loadGetMarketingUrl('goodparty.org')
    expect(getMarketingUrl('run-for-office')).toBe(
      'https://goodparty.org/run-for-office',
    )
  })

  it('defaults to goodparty.org when the env var is unset', async () => {
    const getMarketingUrl = await loadGetMarketingUrl()
    expect(getMarketingUrl('/run-for-office')).toBe(
      'https://goodparty.org/run-for-office',
    )
  })
})
