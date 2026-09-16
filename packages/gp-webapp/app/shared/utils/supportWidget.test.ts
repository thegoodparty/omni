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
  const api = {
    widget: {
      load: vi.fn(() => {
        // A cooperating chatflow renders the widget; an inert one does not.
      }),
      open: vi.fn(),
      // The real `remove` unmounts the widget: `loaded` goes false and the
      // container leaves the DOM. A mock that keeps the container would let
      // `widgetOnScreen()` stay true over a widget that is gone.
      remove: vi.fn(() => {
        state.loaded = false
        document.getElementById('hubspot-messages-iframe-container')?.remove()
      }),
      status: vi.fn(() => ({ loaded: state.loaded })),
    },
  }
  return { state, api }
}

// The container HubSpot mounts. jsdom has no layout, so its height is stubbed
// and driven by hand — and the style attribute is written alongside it, since
// that is what the real widget changes and what the module observes.
const renderWidgetContainer = (height = 92) => {
  const container = document.createElement('div')
  container.id = 'hubspot-messages-iframe-container'
  container.getBoundingClientRect = () => ({ height }) as DOMRect
  document.body.append(container)
  return {
    resizeTo: async (next: number) => {
      height = next
      container.setAttribute('style', `height: ${next}px`)
      // MutationObserver delivers on a microtask.
      await vi.advanceTimersByTimeAsync(1)
    },
  }
}

// jsdom refuses to navigate, so the email fallback is asserted against a
// stubbed location. It counts writes rather than just holding the last value:
// several timers all setting the same href is invisible otherwise.
let navigations: string[] = []

beforeEach(() => {
  vi.useFakeTimers()
  navigations = []
  vi.stubGlobal('location', {
    get href() {
      return navigations[navigations.length - 1] ?? 'http://localhost:3000/'
    },
    set href(value: string) {
      navigations.push(value)
    },
  })
  delete window.HubSpotConversations
  delete window.hsConversationsOnReady
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('openSupportChat', () => {
  // `widgetOpen: true` was measured to render the launcher and leave the panel
  // shut, so the first click is only done when `open()` has been called too.
  it('opens the panel on the first click, not just the launcher', async () => {
    const { api, state } = sdk()
    window.HubSpotConversations = api
    const openSupportChat = await loadWidget()

    openSupportChat()
    expect(api.widget.load).toHaveBeenCalledWith({ widgetOpen: true })

    renderWidgetContainer()
    state.loaded = true
    await vi.advanceTimersByTimeAsync(1_000)

    expect(api.widget.open).toHaveBeenCalledTimes(1)
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
    renderWidgetContainer()
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

    renderWidgetContainer()
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

  // An impatient user clicking several times must not queue a callback and a
  // timer per click: every callback fires load() again, and every timer can
  // navigate on its own.
  describe('repeated clicks while the widget is still coming', () => {
    it('queues one ready-hook callback no matter how many clicks', async () => {
      const openSupportChat = await loadWidget()

      openSupportChat()
      openSupportChat()
      openSupportChat()

      expect(window.hsConversationsOnReady).toHaveLength(1)
    })

    it('runs one watch, so email is offered once rather than per click', async () => {
      const openSupportChat = await loadWidget()

      openSupportChat()
      openSupportChat()
      openSupportChat()
      await vi.advanceTimersByTimeAsync(11_000)

      expect(navigations).toEqual(['mailto:support@goodparty.org'])
    })

    it('starts a fresh watch for a click after an attempt has settled', async () => {
      const openSupportChat = await loadWidget()

      openSupportChat()
      await vi.advanceTimersByTimeAsync(11_000)
      expect(navigations).toHaveLength(1)

      openSupportChat()
      await vi.advanceTimersByTimeAsync(11_000)
      expect(navigations).toHaveLength(2)
    })
  })

  // The container is created asynchronously after `load()`, so `status()` can
  // admit the widget is loaded before there is anything in the DOM. Acting
  // then leaves nothing to watch for the close.
  it('waits for the container, not just the status, before opening', async () => {
    const { api, state } = sdk()
    window.HubSpotConversations = api
    const openSupportChat = await loadWidget()

    openSupportChat()
    state.loaded = true
    await vi.advanceTimersByTimeAsync(2_000)
    expect(api.widget.open).not.toHaveBeenCalled()

    renderWidgetContainer()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(api.widget.open).toHaveBeenCalledTimes(1)
  })

  // The lag is real: `status()` reported nothing loaded for six seconds after
  // the container was already in the DOM. Believing it at the deadline would
  // send a mail client over the top of a widget the user can see.
  it('opens a widget it can see even while status() still denies it', async () => {
    const { api } = sdk()
    window.HubSpotConversations = api
    const openSupportChat = await loadWidget()

    openSupportChat()
    renderWidgetContainer()
    await vi.advanceTimersByTimeAsync(11_000)

    expect(navigations).toEqual([])
    expect(api.widget.open).toHaveBeenCalledTimes(1)
  })

  // HubSpot's launcher is a fixed button in the corner this product already
  // uses for the assistant's message box. Collapsing back to it would put the
  // hovering button this change exists to remove straight back on screen.
  describe('closing the chat', () => {
    const openThePanel = async (state: { loaded: boolean }) => {
      const widget = renderWidgetContainer()
      state.loaded = true
      await vi.advanceTimersByTimeAsync(1_000)
      await widget.resizeTo(804)
      return widget
    }

    it('unmounts the widget rather than leaving the launcher behind', async () => {
      const { api, state } = sdk()
      window.HubSpotConversations = api
      const openSupportChat = await loadWidget()

      openSupportChat()
      const widget = await openThePanel(state)
      await widget.resizeTo(92)

      expect(api.widget.remove).toHaveBeenCalledTimes(1)
    })

    // The container is mounted at launcher size, so a small container on its
    // own is not a close — treating it as one would unmount the widget in the
    // moment between mounting it and opening it.
    it('leaves a widget that has not opened yet alone', async () => {
      const { api, state } = sdk()
      window.HubSpotConversations = api
      const openSupportChat = await loadWidget()

      openSupportChat()
      const widget = renderWidgetContainer()
      state.loaded = true
      await vi.advanceTimersByTimeAsync(1_000)
      await widget.resizeTo(92)

      expect(api.widget.remove).not.toHaveBeenCalled()
    })

    it('mounts it again on the next click instead of only re-opening', async () => {
      const { api, state } = sdk()
      window.HubSpotConversations = api
      const openSupportChat = await loadWidget()

      openSupportChat()
      const widget = await openThePanel(state)
      await widget.resizeTo(92)

      openSupportChat()

      expect(api.widget.load).toHaveBeenCalledTimes(2)
    })

    it('opens and closes again on a second cycle', async () => {
      const { api, state } = sdk()
      window.HubSpotConversations = api
      const openSupportChat = await loadWidget()

      openSupportChat()
      const first = await openThePanel(state)
      await first.resizeTo(92)
      expect(document.getElementById('hubspot-messages-iframe-container')).toBe(
        null,
      )

      openSupportChat()
      const second = await openThePanel(state)
      await second.resizeTo(92)

      expect(api.widget.open).toHaveBeenCalledTimes(2)
      expect(api.widget.remove).toHaveBeenCalledTimes(2)
    })

    // With no widget left after a close, a click that brings nothing back has
    // to reach a person rather than reopening something that is not there.
    it('offers email when a click after a close brings nothing back', async () => {
      const { api, state } = sdk()
      window.HubSpotConversations = api
      const openSupportChat = await loadWidget()

      openSupportChat()
      const widget = await openThePanel(state)
      await widget.resizeTo(92)

      openSupportChat()
      await vi.advanceTimersByTimeAsync(11_000)

      expect(navigations).toEqual(['mailto:support@goodparty.org'])
      expect(api.widget.open).toHaveBeenCalledTimes(1)
    })

    it('unmounts once per close, not once per size change', async () => {
      const { api, state } = sdk()
      window.HubSpotConversations = api
      const openSupportChat = await loadWidget()

      openSupportChat()
      const widget = await openThePanel(state)
      await widget.resizeTo(92)
      await widget.resizeTo(90)
      await widget.resizeTo(92)

      expect(api.widget.remove).toHaveBeenCalledTimes(1)
    })
  })

  it('falls back to email when the SDK never arrives at all', async () => {
    const openSupportChat = await loadWidget()

    openSupportChat()
    await vi.advanceTimersByTimeAsync(11_000)

    expect(window.location.href).toBe('mailto:support@goodparty.org')
  })
})
