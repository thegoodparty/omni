import { basename } from 'path'
import { expect, test, type Page } from '@playwright/test'

// Records the analytics events a test fires, so a spec can assert that the
// flow it drives also fires the events that measure it (DATA-2754).
//
// It reads `trackEvent` calls (gp-webapp `helpers/analyticsHelper.ts`), not
// network traffic: preview and dev builds carry no Segment write key, so
// Segment never loads there and nothing reaches `/mx/evs`. `trackEvent` hands
// every call to `window.__gpAnalyticsEvents` when that exists, and only the
// init script below creates it. Recording goes through an exposed function,
// so a call made just before a full navigation is not lost with the page.
declare global {
  interface Window {
    __gpAnalyticsEvents?: { push: (call: CapturedEvent) => void }
    __gpRecordAnalyticsEvent?: (call: CapturedEvent) => Promise<void>
  }
}

// off | shadow | block, set by `E2E_EVENT_ASSERTIONS` in
// `.github/workflows/gp-webapp.yml`. Shadow reports a missing event in the E2E
// comment and summary without failing the test; block fails it.
export type EventAssertionMode = 'off' | 'shadow' | 'block'

export const MISSING_EVENT_ANNOTATION = 'analytics-event-missing'

export const eventAssertionMode = (): EventAssertionMode => {
  const raw = process.env.E2E_EVENT_ASSERTIONS || 'shadow'
  if (raw === 'off' || raw === 'shadow' || raw === 'block') return raw
  throw new Error(
    `E2E_EVENT_ASSERTIONS must be off, shadow or block, got "${raw}"`,
  )
}

export interface CapturedEvent {
  event: string
  properties: Record<string, unknown>
}

interface AsymmetricMatcher {
  asymmetricMatch: (actual: unknown) => boolean
}

const isAsymmetricMatcher = (value: unknown): value is AsymmetricMatcher =>
  typeof value === 'object' &&
  value !== null &&
  'asymmetricMatch' in value &&
  typeof value.asymmetricMatch === 'function'

const valueMatches = (expected: unknown, actual: unknown): boolean =>
  isAsymmetricMatcher(expected)
    ? expected.asymmetricMatch(actual)
    : JSON.stringify(expected) === JSON.stringify(actual)

const describeValue = (value: unknown): string =>
  isAsymmetricMatcher(value) ? String(value) : JSON.stringify(value)

const mismatches = (
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): string[] =>
  Object.entries(expected)
    .filter(([key, value]) => !valueMatches(value, actual[key]))
    .map(
      ([key, value]) =>
        `${key}: expected ${describeValue(value)}, got ${
          key in actual ? JSON.stringify(actual[key]) : 'nothing'
        }`,
    )

export interface ExpectEventOptions {
  // How long to wait for the event. Many fire after the network round trip
  // that triggers them, so one can land well after the UI has moved on.
  timeout?: number
}

export interface AnalyticsCapture {
  readonly events: CapturedEvent[]
  expectEvent: (
    name: string,
    properties?: Record<string, unknown>,
    options?: ExpectEventOptions,
  ) => Promise<CapturedEvent | undefined>
}

// Call once per test, before the first navigation, so no call is missed. It
// installs on the context, so a flow that opens a new tab is covered too.
export const captureAnalyticsEvents = async (
  page: Page,
): Promise<AnalyticsCapture> => {
  const events: CapturedEvent[] = []
  const context = page.context()
  await context.exposeFunction(
    '__gpRecordAnalyticsEvent',
    (call: CapturedEvent) => {
      events.push(call)
    },
  )
  await context.addInitScript(() => {
    window.__gpAnalyticsEvents = {
      push: (call) => {
        void window.__gpRecordAnalyticsEvent?.(call)
      },
    }
  })

  const find = (name: string, properties: Record<string, unknown>) =>
    events.find(
      (captured) =>
        captured.event === name &&
        mismatches(properties, captured.properties).length === 0,
    )

  const explainMiss = (
    name: string,
    properties: Record<string, unknown>,
  ): string => {
    const wanted = Object.keys(properties).length
      ? ` with ${Object.entries(properties)
          .map(([key, value]) => `${key}=${describeValue(value)}`)
          .join(', ')}`
      : ''
    const sameName = events.filter((captured) => captured.event === name)
    if (sameName.length > 0) {
      const closest = sameName
        .map((captured) => mismatches(properties, captured.properties))
        .sort((a, b) => a.length - b.length)[0]
      return `"${name}" fired ${sameName.length}x but never${wanted} (${closest?.join('; ')})`
    }
    if (events.length === 0) {
      return `"${name}"${wanted} did not fire, and no trackEvent call was recorded at all: check that this build's trackEvent has the __gpAnalyticsEvents seam`
    }
    const seen = [...new Set(events.map((captured) => captured.event))]
    return `"${name}"${wanted} did not fire. Fired instead: ${seen.join(', ')}`
  }

  const expectEvent: AnalyticsCapture['expectEvent'] = async (
    name,
    properties = {},
    { timeout = 15_000 } = {},
  ) => {
    const mode = eventAssertionMode()
    if (mode === 'off') return undefined

    const deadline = Date.now() + timeout
    let match = find(name, properties)
    while (!match && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      match = find(name, properties)
    }
    if (match) return match

    const info = test.info()
    const reason = explainMiss(name, properties)
    info.annotations.push({
      type: MISSING_EVENT_ANNOTATION,
      description: `${basename(info.file)} › ${info.title}: ${reason}`,
    })
    if (mode === 'block') {
      expect(match, `Missing analytics event: ${reason}`).toBeDefined()
    } else {
      console.warn(`[analytics shadow] missing event: ${reason}`)
    }
    return undefined
  }

  return { events, expectEvent }
}
