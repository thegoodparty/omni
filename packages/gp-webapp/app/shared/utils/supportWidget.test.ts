import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The module keeps whether the widget has been loaded, so each test needs a
// fresh copy of it.
const loadWidget = async () => {
  vi.resetModules()
  return (await import('./supportWidget')).openSupportChat
}

const sdk = () => ({ widget: { load: vi.fn(), open: vi.fn() } })

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
    const conversations = sdk()
    window.HubSpotConversations = conversations
    const openSupportChat = await loadWidget()

    openSupportChat()

    expect(conversations.widget.load).toHaveBeenCalledWith({
      widgetOpen: true,
    })
    expect(conversations.widget.open).not.toHaveBeenCalled()
  })

  it('re-opens rather than re-loading on later clicks', async () => {
    const conversations = sdk()
    window.HubSpotConversations = conversations
    const openSupportChat = await loadWidget()

    openSupportChat()
    openSupportChat()

    expect(conversations.widget.load).toHaveBeenCalledTimes(1)
    expect(conversations.widget.open).toHaveBeenCalledTimes(1)
  })

  // The script is production-only and an ad blocker can stop it in
  // production, so a click before the SDK exists must still do something.
  it('queues on HubSpot’s ready hook when the SDK has not arrived', async () => {
    const openSupportChat = await loadWidget()

    openSupportChat()

    expect(window.hsConversationsOnReady).toHaveLength(1)

    const conversations = sdk()
    window.HubSpotConversations = conversations
    window.hsConversationsOnReady?.[0]?.()

    expect(conversations.widget.load).toHaveBeenCalledWith({
      widgetOpen: true,
    })
  })

  it('never leaves the click dead: falls back to email', async () => {
    const openSupportChat = await loadWidget()

    openSupportChat()
    vi.advanceTimersByTime(3_000)

    expect(window.location.href).toBe('mailto:support@goodparty.org')
  })

  it('does not fall back once the widget has opened', async () => {
    const openSupportChat = await loadWidget()

    openSupportChat()
    window.HubSpotConversations = sdk()
    window.hsConversationsOnReady?.[0]?.()
    vi.advanceTimersByTime(3_000)

    expect(window.location.href).not.toContain('mailto:')
  })
})
