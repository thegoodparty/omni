import { SUPPORT_CHAT_ENABLED } from 'appEnv'
import { SUPPORT_EMAIL } from './supportContact'

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

// `status()` lags reality: on a cold load it reported
// `{loaded: false, pending: false}` for six seconds after the container was
// already in the DOM. So a widget that is visibly on screen is never treated
// as a failure, whatever the SDK says about it.
const widgetOnScreen = () => widgetContainer() !== null

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

const openWidget = (): void => {
  window.HubSpotConversations?.widget.open()
  removeWhenClosed()
}

// One ready-hook callback is enough for the life of the page, and one watch is
// enough at a time. Without these, an impatient user clicking Get help while
// the SDK is still loading queues a callback and starts a timer per click —
// every callback firing `load()` again, and every timer able to navigate to
// `mailto:` on its own. That accumulation is observable: six clicks against a
// missing SDK left six entries on `hsConversationsOnReady`.
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
// where the SDK honours it, but `open()` is what actually opens the panel, so
// the watch below calls it as soon as the widget exists.
//
// Whether it worked is asked of the SDK rather than assumed. An earlier
// version set a local flag the instant it called `load()` and treated that as
// success, which hid a whole class of failure: the SDK can be present and
// `load()` can still do nothing, which is what happens on any host the
// chatflow's targeting rules do not cover — `status()` stays
// `{loaded: false, pending: false}` and no container is ever created, even
// when `load()` is called straight from the console.
export const openSupportChat = (): void => {
  // Nav item renders everywhere; the chat script only loads in production or
  // behind NEXT_PUBLIC_SUPPORT_CHAT. Where it was never injected there is
  // nothing to wait for, so email answers the click immediately rather than
  // after ten seconds of a widget that is not coming.
  if (!SUPPORT_CHAT_ENABLED) {
    window.location.href = `mailto:${SUPPORT_EMAIL}`
    return
  }

  const conversations = window.HubSpotConversations

  if (conversations) {
    // Same pair the watch below waits for, and for the same reason: a
    // `loaded` the container has not caught up with would open a widget and
    // find nothing to attach the close observer to, leaving the launcher
    // behind on close. Without the container, fall through and load, and let
    // the watch open it once both are true.
    if (widgetStatus()?.loaded && widgetOnScreen()) {
      openWidget()
      return
    }
    conversations.widget.load({ widgetOpen: true })
  } else if (!queuedOnReady) {
    // The SDK is not here yet: outside production it loads only behind
    // NEXT_PUBLIC_SUPPORT_CHAT, and in production an ad blocker can stop it.
    // Queue on HubSpot's own ready hook in case it is still coming.
    queuedOnReady = true
    window.hsConversationsOnReady = [
      ...(window.hsConversationsOnReady ?? []),
      // Re-enters here rather than calling `load` directly. An SDK that shows
      // up after the watch already gave up would otherwise mount the widget
      // with nothing left to open it or to unmount it on close, leaving the
      // launcher parked in the corner — the exact thing this change removes.
      // Re-entering cannot recurse: `window.HubSpotConversations` is set by
      // the time the hook runs, so this takes the branch above instead of
      // queueing another callback.
      () => openSupportChat(),
    ]
  }

  // Watch until it is up, rather than checking once. A single check a couple
  // of seconds in cannot tell "never coming" from "still coming", and getting
  // that wrong means redirecting to a mail client over the top of a widget
  // mid-animation. Only a widget that is still absent at the deadline counts
  // as a failure, and then the click goes somewhere a person will answer
  // rather than nowhere.
  if (watching) return
  watching = true
  const deadline = Date.now() + GIVE_UP_MS
  const check = () => {
    // Both, because the two arrive in either order: the container has been
    // seen in the DOM six seconds before `status()` admitted the widget was
    // loaded, and `status()` has also flipped first. Waiting for the later of
    // the two is what guarantees `openWidget` has a container to watch.
    if (widgetStatus()?.loaded && widgetOnScreen()) {
      watching = false
      openWidget()
      return
    }
    if (Date.now() >= deadline) {
      watching = false
      if (widgetOnScreen()) {
        openWidget()
        return
      }
      window.location.href = `mailto:${SUPPORT_EMAIL}`
      return
    }
    window.setTimeout(check, POLL_MS)
  }
  window.setTimeout(check, POLL_MS)
}
