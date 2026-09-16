import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The module is stateless now, but each test still gets a fresh copy so an
// import-time change can never leak between cases.
const loadWidget = async () => {
  vi.resetModules()
  return (await import('./supportWidget')).openSupportChat
}

// `loaded` is what the real SDK reports, and the only thing that proves the
// widget is actually on screen.
const sdk = (loaded = false) => {
  const state = { loaded }
  return {
    state,
    api: {
      widget: {
        load: vi.fn(() => {
          // A cooperating chatflow renders the widget; an inert one does not.
        }),
        open: vi.fn(),
        status: vi.fn(() => ({ loaded: state.loaded })),
      },
    },
  }
}

// jsdom refuses to navigate, so the email fallback is asserted against a
// stubbed location rather than a real one.
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('location', { href: 'http://localhost:3000/' })
  delete window.HubSpotConversations
  delete window.hsConversationsOnReady
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('openSupportChat', () => {
  it('renders the widget open on the first click', async () => {
    const { api, state } = sdk()
    window.HubSpotConversations = api
    const openSupportChat = await loadWidget()

    openSupportChat()
    state.loaded = true

    expect(api.widget.load).toHaveBeenCalledWith({ widgetOpen: true })
    expect(api.widget.open).not.toHaveBeenCalled()
  })

  it('re-opens rather than re-loading once the widget is up', async () => {
    const { api } = sdk(true)
    window.HubSpotConversations = api
    const openSupportChat = await loadWidget()

    openSupportChat()

    expect(api.widget.open).toHaveBeenCalledTimes(1)
    expect(api.widget.load).not.toHaveBeenCalled()
  })

  // The failure that used to be invisible: the SDK is present, load() is
  // called, and nothing appears — which is what a chatflow whose targeting
  // excludes this host actually does. Trusting load() left this a dead click.
  it('falls back to email when the SDK loads but no widget appears', async () => {
    const { api, state } = sdk()
    window.HubSpotConversations = api
    const openSupportChat = await loadWidget()

    openSupportChat()
    expect(api.widget.load).toHaveBeenCalled()
    expect(state.loaded).toBe(false)

    await vi.advanceTimersByTimeAsync(11_000)

    expect(window.location.href).toBe('mailto:support@goodparty.org')
  })

  it('does not fall back when the widget did come up', async () => {
    const { api, state } = sdk()
    window.HubSpotConversations = api
    const openSupportChat = await loadWidget()

    openSupportChat()
    state.loaded = true
    await vi.advanceTimersByTimeAsync(11_000)

    expect(window.location.href).not.toContain('mailto:')
  })

  // The regression that prompted the watch: a widget that takes longer than a
  // couple of seconds must not be navigated out from under the user.
  it('waits for a slow widget instead of redirecting over the top of it', async () => {
    const { api, state } = sdk()
    window.HubSpotConversations = api
    const openSupportChat = await loadWidget()

    openSupportChat()

    // Well past the old 2.5s deadline, still loading.
    await vi.advanceTimersByTimeAsync(4_000)
    expect(window.location.href).not.toContain('mailto:')

    state.loaded = true
    await vi.advanceTimersByTimeAsync(7_000)
    expect(window.location.href).not.toContain('mailto:')
  })

  it('queues on HubSpot’s ready hook when the SDK has not arrived', async () => {
    const openSupportChat = await loadWidget()

    openSupportChat()

    expect(window.hsConversationsOnReady).toHaveLength(1)

    const { api } = sdk()
    window.HubSpotConversations = api
    window.hsConversationsOnReady?.[0]?.()

    expect(api.widget.load).toHaveBeenCalledWith({ widgetOpen: true })
  })

  it('falls back to email when the SDK never arrives at all', async () => {
    const openSupportChat = await loadWidget()

    openSupportChat()
    await vi.advanceTimersByTimeAsync(11_000)

    expect(window.location.href).toBe('mailto:support@goodparty.org')
  })
})
