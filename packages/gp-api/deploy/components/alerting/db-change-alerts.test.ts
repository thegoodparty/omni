import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GLOBAL_ALERTS } from '../alerts'

const alert = GLOBAL_ALERTS.find(
  (a) => a.slug === 'db-change-health-check-failed',
)

// Read from the service rather than restated here: this is the test that
// notices when somebody rewords a log line and silently unhooks the alert from
// the event it was written for. deploy/ does not compile against src/, so a
// string it shares with the service can only be checked by reading the file.
const SERVICE = readFileSync(
  path.join(__dirname, '../../../src/dbChanges/dbChangeHealth.service.ts'),
  'utf8',
)

const context = /this\.logger\.setContext\(([^)]+)\)/.exec(SERVICE)?.[1]

const SERVICE_LINES = [...SERVICE.matchAll(/'(db change [^']+)'/g)].map(
  ([, line]) => line!,
)

describe('db-change-health-check-failed', () => {
  it('is registered', () => {
    expect(alert).toBeDefined()
  })

  // Grafana promotes OTel log attributes to structured metadata, so the
  // `context` the service sets with setContext() is a filter, not something a
  // JSON parser has to extract. A rename on either side leaves a rule that
  // matches nothing and reports all-clear forever.
  it('filters on the context the service logs under', () => {
    expect(context).toBe('DbChangeHealthService.name')
    expect(alert!.expr).toContain('| context = "DbChangeHealthService"')
  })

  // An error line is the only thing that should page. The check logs one per
  // broken invariant, so the level filter is what keeps a future info line
  // from turning into a page.
  it('pages only on the error lines', () => {
    expect(alert!.expr).toContain('| detected_level = "error"')
  })

  // Every line the alert's message names has to be one the service can
  // actually emit, or a responder follows the instruction and searches for
  // nothing.
  it('names every invariant the check logs', () => {
    expect(SERVICE_LINES.length).toBeGreaterThan(0)
    for (const line of SERVICE_LINES) {
      expect(alert!.message).toContain(line)
    }
  })

  // The schedule runs every five minutes, so anything shorter than a gap
  // between runs lets a broken invariant resolve between two lines and page
  // again on the next one.
  it('holds the page past the gap between checks', () => {
    expect(alert!.keepFiringFor).toBe('30m')
    expect(alert!.timeRangeSeconds).toBe(60)
    expect(alert!.timeRangeOffsetSeconds).toBe(30)
    expect(alert!.threshold).toBe(0)
    expect(alert!.for).toBe('0m')
  })

  // keepFiringFor only holds through an evaluation that ran and failed its
  // threshold, and an idle count returns no series.
  it('evaluates to zero when idle, so the hold is not skipped', () => {
    expect(alert!.expr).toMatch(/ or vector\(0\)$/)
  })
})
