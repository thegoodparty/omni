import { SUPPORT_EMAIL } from './supportContact'

// HubSpot's Conversations SDK, attached to window by the support script in the
// root layout. Typed here because it arrives at runtime.
interface HubSpotConversations {
  widget: {
    load: (options?: { widgetOpen?: boolean }) => void
    open: () => void
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

const widgetStatus = () => window.HubSpotConversations?.widget.status()

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
// nothing is on screen until someone asks for help. `load` renders it the
// first time; `open` re-opens it once it is up.
//
// Whether it worked is asked of the SDK rather than assumed. An earlier
// version set a local flag the instant it called `load()` and treated that as
// success, which hid a whole class of failure: the SDK can be present and
// `load()` can still do nothing, which is what happens on any host the
// chatflow's targeting rules do not cover — `status()` stays
// `{loaded: false, pending: false}` and no container is ever created, even
// when `load()` is called straight from the console.
export const openSupportChat = (): void => {
  const conversations = window.HubSpotConversations

  if (conversations) {
    if (widgetStatus()?.loaded) {
      conversations.widget.open()
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
      () => {
        window.HubSpotConversations?.widget.load({ widgetOpen: true })
      },
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
    if (widgetStatus()?.loaded) {
      watching = false
      return
    }
    if (Date.now() >= deadline) {
      watching = false
      window.location.href = `mailto:${SUPPORT_EMAIL}`
      return
    }
    window.setTimeout(check, POLL_MS)
  }
  window.setTimeout(check, POLL_MS)
}
