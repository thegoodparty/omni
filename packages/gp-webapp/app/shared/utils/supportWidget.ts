import { HELP_CENTER_URL, SUPPORT_CHAT_SCRIPT_ID } from './supportContact'

// HubSpot's Conversations SDK, attached to window by the support script in the
// root layout. Typed here because it arrives at runtime.
interface HubSpotConversations {
  widget: {
    load: (options?: { widgetOpen?: boolean }) => void
    open: () => void
    // Unmounts the widget entirely, launcher included. `load` mounts it again.
    remove: () => void
    // `loaded` means the widget is on screen. `pending` means it is on its
    // way: both false together is the SDK saying it has nothing to show.
    status: () => { loaded: boolean; pending?: boolean }
  }
}

declare global {
  interface Window {
    HubSpotConversations?: HubSpotConversations
    hsConversationsOnReady?: (() => void)[]
    hsConversationsSettings?: { loadImmediately?: boolean }
  }
}

// Re-check this often, and give up only after this long. The wait is generous
// on purpose: the cost of waiting is a slow-feeling click, and the cost of
// being impatient is navigating away from a widget that was about to appear.
const POLL_MS = 500
const GIVE_UP_MS = 10_000

const WIDGET_CONTAINER_ID = 'hubspot-messages-iframe-container'

// HubSpot sizes its container inline, and the two states are far apart:
// measured 92x92 collapsed to the launcher, 448x804 with the panel open.
const OPEN_MIN_HEIGHT = 200

const widgetContainer = () => document.getElementById(WIDGET_CONTAINER_ID)

const widgetStatus = () => window.HubSpotConversations?.widget.status()

// Can support be reached right now? One question, one answer, asked by both
// the click and the watch below.
//
// Splitting it across the two is what let them disagree. The watch waited for
// the status AND the container; the click a few lines above trusted the status
// alone, so on the ordering where `loaded` arrives first it opened a widget
// with no container for the close watcher to attach to, and the launcher then
// stayed in the corner on close. Every guard added to one of them since has
// had to be remembered for the other.
type Reachability = 'ready' | 'loading' | 'absent'

const reachability = (): Reachability => {
  // The root layout injects the chat only where it is enabled, so no script
  // means nothing is coming however long we wait. This is how client code
  // learns a server-side decision: VERCEL_ENV never reaches the browser.
  if (!document.getElementById(SUPPORT_CHAT_SCRIPT_ID)) return 'absent'

  // Both signals, because they arrive in either order. `status()` has reported
  // `{loaded: false, pending: false}` for six seconds after the container was
  // already in the DOM, and on another load flipped to `loaded` before the
  // container existed.
  return widgetStatus()?.loaded && widgetContainer() ? 'ready' : 'loading'
}

// Closing the chat has to take the launcher with it. HubSpot's launcher is a
// fixed button in the bottom-right corner, which is where this product keeps
// the assistant's message box — it sat on top of it, and getting it out from
// over the other tools is the whole point of moving support into the nav. So
// the widget is unmounted on close rather than collapsed back to a button, and
// the next Get help click mounts it again.
//
// The SDK's own `on('widgetClosed')` was tried first and delivered nothing:
// with the listener registered before `load()`, closing the panel raised no
// event, and neither did opening it raise `widgetOpened`. The container's
// inline size is the signal that is actually there.
let closeObserver: MutationObserver | null = null

const removeWhenClosed = (): void => {
  const container = widgetContainer()
  if (!container || closeObserver) return

  let hasOpened = false
  closeObserver = new MutationObserver(() => {
    if (container.getBoundingClientRect().height >= OPEN_MIN_HEIGHT) {
      hasOpened = true
      return
    }
    // The container is mounted at launcher size and grows only once `open()`
    // lands, so a small container means the user closed the panel only after
    // it has been seen open.
    if (!hasOpened) return
    closeObserver?.disconnect()
    closeObserver = null
    window.HubSpotConversations?.widget.remove()
  })
  closeObserver.observe(container, {
    attributes: true,
    attributeFilter: ['style'],
  })
}

// Where a click lands when the chat cannot be reached. A new tab keeps the
// candidate's work where it is, but ten seconds after the click there is no
// user gesture left, so a popup blocker can refuse one — and a refused tab is
// the same dead click this replaced. Same-tab navigation always lands.
//
// `noopener` is deliberately NOT passed. With it, `window.open` returns null
// even when the tab opened, so the return value cannot tell a granted tab from
// a refused one: every click took the fallback as well, opening the help
// center AND navigating the candidate off their dashboard. The destination is
// our own knowledge base, so the reverse-tabnabbing `noopener` guards against
// is not a live concern; losing the only signal that the tab arrived is.
const openHelpCenter = (): void => {
  const opened = window.open(HELP_CENTER_URL, '_blank')
  if (!opened) window.location.href = HELP_CENTER_URL
}

const openWidget = (): void => {
  window.HubSpotConversations?.widget.open()
  removeWhenClosed()
}

// One ready-hook callback is enough for the life of the page, and one watch is
// enough at a time. Without these, an impatient user clicking Get help while
// the SDK is still loading queues a callback and starts a timer per click —
// every callback firing `load()` again, and every timer able to navigate away
// on its own. That accumulation is observable: six clicks against a missing
// SDK left six entries on `hsConversationsOnReady`.
//
// `queuedOnReady` never resets, because the hook only ever needs one callback.
// `watching` resets when a watch settles, so a click after a failed attempt
// gets a fresh one rather than being silently ignored forever.
let queuedOnReady = false
let watching = false

// The root layout configures the widget with `loadImmediately: false`, so
// nothing is on screen until someone asks for help. `load` mounts it the first
// time, and again after a close unmounted it.
//
// `load({widgetOpen: true})` asks for it open and is not enough on its own:
// measured, it renders the launcher and the greeting bubble and leaves the
// panel shut. The option stays because it costs nothing and opens instantly
// where the SDK honours it, but `open()` is what actually opens the panel.
const requestWidget = (): void => {
  const conversations = window.HubSpotConversations
  if (conversations) {
    conversations.widget.load({ widgetOpen: true })
    return
  }

  // The SDK is not here yet, though the script that loads it is on the page:
  // it is still in flight, or an ad blocker stopped it. Queue on HubSpot's own
  // ready hook in case it is still coming.
  if (queuedOnReady) return
  queuedOnReady = true
  window.hsConversationsOnReady = [
    ...(window.hsConversationsOnReady ?? []),
    // Re-enters openSupportChat rather than calling `load` directly. An SDK
    // that shows up after the watch already gave up would otherwise mount the
    // widget with nothing left to open it or to unmount it on close, leaving
    // the launcher parked in the corner, which is the thing this whole file
    // exists to avoid. Re-entering cannot recurse: the SDK is present by the
    // time the hook runs, so it takes the branch above.
    () => openSupportChat(),
  ]
}

// Watch until it is up, rather than checking once. A single check a couple of
// seconds in cannot tell "never coming" from "still coming", and getting that
// wrong means navigating away over the top of a widget mid-animation. Only a
// widget still absent at the deadline counts as a failure, and then the click
// goes to the help center rather than nowhere.
const watchForWidget = (): void => {
  if (watching) return
  watching = true
  const deadline = Date.now() + GIVE_UP_MS

  const check = () => {
    if (reachability() === 'ready') {
      watching = false
      openWidget()
      return
    }
    if (Date.now() >= deadline) {
      watching = false
      // A container on screen that `status()` still denies is a widget, not a
      // failure. Navigating away over the top of it is the one outcome worse
      // than waiting.
      if (widgetContainer()) openWidget()
      else openHelpCenter()
      return
    }
    window.setTimeout(check, POLL_MS)
  }
  window.setTimeout(check, POLL_MS)
}

// Whether the chat worked is asked of the SDK rather than assumed. An earlier
// version set a local flag the instant it called `load()` and treated that as
// success, which hid a whole class of failure: the SDK can be present and
// `load()` can still do nothing, which is what happens on any host the
// chatflow's targeting rules do not cover.
export const openSupportChat = (): void => {
  switch (reachability()) {
    // Nothing to wait for, so the help center answers the click now rather
    // than after ten seconds of a widget that was never coming.
    case 'absent':
      return openHelpCenter()
    case 'ready':
      return openWidget()
    case 'loading':
      requestWidget()
      return watchForWidget()
  }
}
