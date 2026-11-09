import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const initializeFaro = vi.fn()

vi.mock('@sentry/nextjs', () => ({
  init: vi.fn(),
  replayIntegration: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
}))
vi.mock('@sentry/browser', () => ({ browserProfilingIntegration: vi.fn() }))
vi.mock('@grafana/faro-web-sdk', () => ({
  initializeFaro,
  getWebInstrumentations: () => [],
  TransportItemType: { EVENT: 'event' },
}))
vi.mock('@grafana/faro-web-tracing', () => ({
  TracingInstrumentation: vi.fn(),
}))

const loadWith = async ({
  webdriver = false,
  userAgent = 'Mozilla/5.0 Chrome/149.0.0.0 Safari/537.36',
}: {
  webdriver?: boolean
  userAgent?: string
}) => {
  Object.defineProperty(navigator, 'webdriver', {
    value: webdriver,
    configurable: true,
  })
  Object.defineProperty(navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  })
  await import('./instrumentation-client')
}

describe('instrumentation-client Faro init', () => {
  beforeEach(() => {
    vi.resetModules()
    initializeFaro.mockClear()
    vi.stubEnv('NEXT_PUBLIC_FARO_COLLECTOR_URL', 'https://faro.example/collect')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    Reflect.deleteProperty(navigator, 'webdriver')
    Reflect.deleteProperty(navigator, 'userAgent')
  })

  it('initializes Faro in a real browser', async () => {
    await loadWith({})
    expect(initializeFaro).toHaveBeenCalledTimes(1)
  })

  it('skips Faro when navigator.webdriver is set', async () => {
    await loadWith({ webdriver: true })
    expect(initializeFaro).not.toHaveBeenCalled()
  })

  it('skips Faro for the E2E user agent marker', async () => {
    await loadWith({
      userAgent: 'Mozilla/5.0 Chrome/149.0.0.0 Safari/537.36 gp-e2e',
    })
    expect(initializeFaro).not.toHaveBeenCalled()
  })

  it('skips Faro when no collector is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_FARO_COLLECTOR_URL', '')
    await loadWith({})
    expect(initializeFaro).not.toHaveBeenCalled()
  })
})
