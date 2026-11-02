import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// DATA-2307. The audience step saves lists three ways, and until this change
// none of them fired List Created: since 2026-09-01 the event covered about
// 745 of 2,346 hand-built Win lists. The same step also reported every
// recommended list as `savedList`, because a saved recommendation is selected
// as a plain list and `selectedRecommendation` is dropped on the way.
//
// Asserted against the source for the reason the sibling tests give: mounting
// the hook needs a query provider, an org, an elected-office fetch and a live
// count, none of which is what this guards.
const SOURCE = readFileSync(join(__dirname, 'useOutreachAudience.ts'), 'utf8')
const FLOWS = [
  '../sms/SmsFlow.tsx',
  '../robocall/RobocallFlow.tsx',
  '../phone-banking/PhoneBankingFlow.tsx',
  '../poll/PollFlow.tsx',
].map((path) => [path, readFileSync(join(__dirname, path), 'utf8')] as const)

const bodyOf = (name: string): string => {
  const start = SOURCE.indexOf(`const ${name} = use`)
  expect(start, `${name} not found`).toBeGreaterThan(-1)
  const next = SOURCE.indexOf('\n  const ', start + 10)
  return SOURCE.slice(start, next > start ? next : undefined)
}

describe('List Created from the outreach audience step', () => {
  it('records a list built in the step, naming a recommendation it came from', () => {
    const body = bodyOf('createList')
    const call = body.slice(body.indexOf('trackListCreated('))
    expect(call).toContain(
      "recommendedMeta ? 'recommendedList' : 'outreachBuilder'",
    )
    expect(call).toContain('listId: created.id')
    expect(call).toContain('channel: reachabilityKey')
    // After the save succeeded, never inside its catch.
    expect(body.indexOf('trackListCreated(')).toBeGreaterThan(
      body.indexOf('throw error'),
    )
  })

  it('records a recommendation saved from its card', () => {
    const body = bodyOf('createRecommendedList')
    expect(body).toContain("source: 'recommendedList'")
    expect(body.indexOf('trackListCreated(')).toBeGreaterThan(
      body.indexOf('throw error'),
    )
  })

  it('records the whole-district list only when it is new', () => {
    const body = bodyOf('universeMutation')
    expect(body).toContain("source: 'outreachAllVoters'")
    // A reused list returns before the save, so it is not counted twice.
    expect(body.indexOf('if (existing) return existing')).toBeLessThan(
      body.indexOf('trackListCreated('),
    )
  })

  it('does not record a recommendation that resolved to a list already saved', () => {
    expect(bodyOf('trackRecommendationReused')).not.toContain(
      'trackListCreated(',
    )
  })
})

describe('audienceSource', () => {
  // Every accept marks the list it ended on, so the flows can still say
  // `recommended` once the recommendation itself is no longer selected.
  it.each(['createList', 'createRecommendedList', 'trackRecommendationReused'])(
    '%s marks the list it lands on as recommended',
    (name) => {
      expect(bodyOf(name)).toContain('setRecommendedListId(')
    },
  )

  it('is cleared when the flow resets', () => {
    expect(bodyOf('reset')).toContain('setRecommendedListId(null)')
  })

  it.each(FLOWS)('%s reads it from the hook', (_path, flow) => {
    expect(flow).toContain('audience.audienceSource')
    expect(flow).not.toMatch(
      /audienceSource:\s*audience\.selectedRecommendation/,
    )
  })
})
