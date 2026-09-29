import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ANONYMOUS_ID_COOKIE } from 'helpers/anonymousId'

const load = vi.fn()
const setAnonymousId = vi.fn()
const anonymousId = vi.fn(() => 'segment-generated-id')
const cookieGet = vi.fn<(name: string) => string | undefined>()

vi.mock('@segment/analytics-next', () => ({
  AnalyticsBrowser: {
    load: (...args: unknown[]) => load(...args),
  },
}))

vi.mock('js-cookie', () => ({
  default: { get: (name: string) => cookieGet(name) },
}))

vi.mock('appEnv', () => ({
  NEXT_PUBLIC_SEGMENT_WRITE_KEY: 'test-write-key',
}))

const instance = {
  user: () => ({ anonymousId }),
  setAnonymousId,
  ready: vi.fn().mockResolvedValue(undefined),
}

// The module runs `AnalyticsBrowser.load()` at import time, so each case needs
// a fresh module registry rather than a shared top-level import.
const importAnalytics = async () => {
  vi.resetModules()
  return import('./analytics')
}

describe('segment analytics loading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    load.mockReturnValue(Promise.resolve(instance))
    cookieGet.mockReturnValue(undefined)
    anonymousId.mockReturnValue('segment-generated-id')
  })

  it('loads the CDN through the first-party proxy, not cdn.segment.com', async () => {
    const { analytics } = await importAnalytics()
    await analytics

    const settings = load.mock.calls[0]?.[0]
    expect(settings).toMatchObject({
      writeKey: 'test-write-key',
      cdnURL: `${window.location.origin}/mx`,
    })
    expect(settings.cdnURL).not.toContain('segment.com')
  })

  it('sends events through the first-party proxy, not api.segment.io', async () => {
    const { analytics } = await importAnalytics()
    await analytics

    const apiHost = load.mock.calls[0]?.[1].integrations['Segment.io'].apiHost

    expect(apiHost).toBe(`${window.location.host}/mx/evs`)
    expect(apiHost).not.toContain('segment.io')
  })

  // `apiHost` is appended to by analytics-next as `https://<apiHost>/<t|i|p>`,
  // so it must carry no scheme and no trailing slash or events 404.
  it('builds an apiHost analytics-next can append an event path to', async () => {
    const { analytics } = await importAnalytics()
    await analytics

    const apiHost: string =
      load.mock.calls[0]?.[1].integrations['Segment.io'].apiHost

    expect(apiHost.startsWith('http')).toBe(false)
    expect(apiHost.endsWith('/')).toBe(false)
  })

  it('adopts the server-minted anonymous id when one is present', async () => {
    cookieGet.mockImplementation((name) =>
      name === ANONYMOUS_ID_COOKIE ? 'server-minted-id' : undefined,
    )

    const { analytics } = await importAnalytics()
    await analytics

    expect(setAnonymousId).toHaveBeenCalledWith('server-minted-id')
  })

  it('leaves the anonymous id alone when no cookie was minted', async () => {
    const { analytics } = await importAnalytics()
    await analytics

    expect(setAnonymousId).not.toHaveBeenCalled()
  })

  it('does not rewrite the anonymous id that is already in effect', async () => {
    cookieGet.mockImplementation((name) =>
      name === ANONYMOUS_ID_COOKIE ? 'already-applied' : undefined,
    )
    anonymousId.mockReturnValue('already-applied')

    const { analytics } = await importAnalytics()
    await analytics

    expect(setAnonymousId).not.toHaveBeenCalled()
  })

  it('resolves to null instead of throwing when the proxy is unreachable', async () => {
    load.mockReturnValue(Promise.reject(new Error('network down')))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const { analytics, getReadyAnalytics } = await importAnalytics()

    await expect(analytics).resolves.toBeNull()
    await expect(getReadyAnalytics()).resolves.toBeNull()
  })
})
