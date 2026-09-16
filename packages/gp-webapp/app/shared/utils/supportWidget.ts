import { SUPPORT_EMAIL } from './supportContact'

// HubSpot's Conversations SDK, attached to window by the support script in the
// root layout. Typed here because it arrives at runtime.
interface HubSpotConversations {
  widget: {
    load: (options?: { widgetOpen?: boolean }) => void
    open: () => void
  }
}

declare global {
  interface Window {
    HubSpotConversations?: HubSpotConversations
    hsConversationsOnReady?: (() => void)[]
    hsConversationsSettings?: { loadImmediately?: boolean }
  }
}

// How long to wait for the SDK before giving the click somewhere else to go.
const SDK_WAIT_MS = 2_500

// The root layout configures the widget with `loadImmediately: false`, so
// nothing is on screen until someone asks for help. `load` is what renders it
// the first time; `open` re-opens it on later clicks.
let widgetLoaded = false

const openWidget = (): boolean => {
  const conversations = window.HubSpotConversations
  if (!conversations) return false
  if (widgetLoaded) {
    conversations.widget.open()
    return true
  }
  conversations.widget.load({ widgetOpen: true })
  widgetLoaded = true
  return true
}

export const openSupportChat = (): void => {
  if (openWidget()) return

  // The SDK is not here yet, or not coming: the script is production-only, and
  // in production an ad blocker can stop it. Queue on HubSpot's own ready hook,
  // and fall back to email rather than leaving the click dead.
  window.hsConversationsOnReady = [
    ...(window.hsConversationsOnReady ?? []),
    () => {
      openWidget()
    },
  ]
  window.setTimeout(() => {
    if (!widgetLoaded) {
      window.location.href = `mailto:${SUPPORT_EMAIL}`
    }
  }, SDK_WAIT_MS)
}
