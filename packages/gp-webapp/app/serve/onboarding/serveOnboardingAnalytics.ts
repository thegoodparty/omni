import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

/**
 * Funnel events for the net-new (sales-sent magic link) elected-official
 * onboarding. "Link sent" is emitted server-side at magic-link creation time;
 * the events here cover the client-side stages (link activated, BR suggestion
 * changed, onboarding completed).
 */
export const SERVE_ONBOARDING_EVENTS = {
  Activated: EVENTS.ServeOnboarding.LinkActivated,
  SuggestionChanged: EVENTS.ServeOnboarding.BrSuggestionChanged,
  Completed: EVENTS.ServeOnboarding.NetNewCompleted,
} as const

export const trackServeOnboarding = (
  name: string,
  properties?: Record<string, string | number | boolean | null | undefined>,
): void => {
  trackEvent(name, properties)
}
