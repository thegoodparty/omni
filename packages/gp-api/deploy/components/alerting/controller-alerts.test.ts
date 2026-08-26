import { describe, expect, it } from 'vitest'
import { controllerAlerts } from './controller-alerts'

// Mirrors grafana.ts's `alert.timeRangeSeconds ?? 600` — the window the
// alerting engine actually fetches when an alert does not pin its own.
const DEFAULT_FETCH_SECONDS = 600

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

const toSeconds = (amount: string, unit: string) =>
  Number(amount) * (UNIT_SECONDS[unit.charAt(0)] ?? 0)

/** Seconds covered by the range vector in a LogQL expression. */
const rangeSeconds = (expr: string) => {
  const match = /\[(\d+)([smhd])\]/.exec(expr)
  const [, amount, unit] = match ?? []
  if (!amount || !unit) {
    throw new Error(`no range vector in expr: ${expr}`)
  }
  return toSeconds(amount, unit)
}

/** Seconds the notification tells the reader it looked back over. */
const promisedSeconds = (message: string) => {
  const match = /in the last (\d+) (seconds|minutes|hours)/.exec(message)
  const [, amount, unit] = match ?? []
  if (!amount || !unit) {
    throw new Error(`message does not state a numeric window: ${message}`)
  }
  return toSeconds(amount, unit)
}

describe('controllerAlerts', () => {
  const alerts = controllerAlerts('door-knocking')

  it('builds an alert for every route on the controller', () => {
    expect(alerts.length).toBeGreaterThan(0)
  })

  // The regression: the vector was written `[1h]` while these alerts take the
  // default 600s fetch, which silently caps it. The rule only ever saw ten
  // minutes of logs, so the extra fifty minutes of vector bought nothing.
  it('keeps the range vector inside the window the engine fetches', () => {
    for (const alert of alerts) {
      const fetched = alert.timeRangeSeconds ?? DEFAULT_FETCH_SECONDS
      expect(rangeSeconds(alert.expr)).toBeLessThanOrEqual(fetched)
    }
  })

  // The other half of that regression, and the one a responder pays for: the
  // message said "in the last hour", so triage swept an hour of logs for
  // errors that could only have come from the last ten minutes.
  it('promises the reader the window it actually queried', () => {
    for (const alert of alerts) {
      expect(promisedSeconds(alert.message)).toEqual(rangeSeconds(alert.expr))
    }
  })

  // SERVER_ERRORS_ONLY: door knocking answers an over-budget knock with 429
  // and an ineligible district with 400, so paging on 4xx would page on the
  // feature working.
  it('pages on 5xx only for door-knocking', () => {
    for (const alert of alerts) {
      expect(alert.expr).toContain('response_statusCode >= 500')
      expect(alert.expr).not.toContain('response_statusCode >= 400')
    }
  })

  // The blind spot this closes: a request the gateway kills mid-flight logs
  // `statusCode: null`, which is neither 4xx nor 5xx, so no status-range
  // filter matched it. Two door-knocking pack timeouts in seven days paged
  // nobody. Loki drops a null field and reads a missing label as empty, so
  // the empty-string comparison is what catches it either way.
  it('pages when a request completes with no status at all', () => {
    for (const alert of alerts) {
      expect(alert.expr).toContain('response_statusCode = ""')
      expect(alert.message).toContain('null')
    }
  })

  // It has to catch the timeout without dragging the 4xx vocabulary back in —
  // a null status is the absence of one, so it can't overlap with 429 or 400.
  it('admits no 4xx alongside the null-status clause', () => {
    for (const alert of alerts) {
      expect(alert.expr).not.toMatch(/response_statusCode\s*[<>=!]+\s*4\d\d/)
    }
  })

  // `A and B or C` is one precedence misread away from paging on every 401.
  it('parenthesizes the status clauses', () => {
    for (const alert of alerts) {
      expect(alert.expr).toContain('( response_statusCode >= 500 ) or (')
    }
  })
})
