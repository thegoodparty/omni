import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Accepting a recommended list can fail, and until DATA-2539 only the successes
// were recorded — an accept count with no denominator, where a run of save
// failures reads as a fall in interest. There are three accept sites and they
// do not all need a twin, so the split is pinned here rather than left to
// judgement:
//
//   createRecommendedList     — saves; can fail; needs a twin
//   createList                — saves; can fail; needs a twin (the builder-seeded
//                               route, which a first pass missed)
//   trackRecommendationReused — selects an already-saved list; synchronous state
//                               only, nothing to fail; correctly has none
//
// Asserted against the source for the same reason as the reset tests beside
// this file: the hook needs a React Query provider, an org, an elected-office
// fetch and a live count to mount, none of which is what this guards. The
// failure mode is a line missing from a catch block, and that is what this reads.
const SOURCE = readFileSync(join(__dirname, 'useOutreachAudience.ts'), 'utf8')

const ACCEPTED = 'EVENTS.Outreach.RecommendedList.Accepted'
const FAILED = 'EVENTS.Outreach.RecommendedList.Failed'
const SAVERS = ['createRecommendedList', 'createList'] as const

const countOf = (needle: string): number => SOURCE.split(needle).length - 1

// The body of one `const <name> = useCallback(...)`, up to the start of the
// next top-level const. Bounded by name rather than by brace matching so a
// renamed local cannot silently widen it.
const bodyOf = (name: string): string => {
  const start = SOURCE.indexOf(`const ${name} = useCallback`)
  expect(start, `${name} not found`).toBeGreaterThan(-1)
  const next = SOURCE.indexOf('\n  const ', start + 10)
  return SOURCE.slice(start, next > start ? next : undefined)
}

describe('recommended-list accept/fail pairs', () => {
  // Three accepts, two of which can fail. If someone adds a fourth accept,
  // this is the line that should make them decide whether it needs a twin.
  it('has three accept sites and two failure twins', () => {
    expect(countOf(ACCEPTED)).toBe(3)
    expect(countOf(FAILED)).toBe(2)
  })

  it.each(SAVERS)('%s records its failure and still rethrows', (name) => {
    const body = bodyOf(name)
    expect(body).toContain('} catch (error) {')
    expect(body).toContain(FAILED)
    expect(body).toContain('throw error')
    // The event must be inside the catch, not merely somewhere in the function.
    expect(body.indexOf(FAILED)).toBeGreaterThan(
      body.indexOf('} catch (error) {'),
    )
    expect(body.indexOf(FAILED)).toBeLessThan(body.indexOf('throw error'))
  })

  // Same keys as the accept each one pairs with, minus the two only knowable
  // from a response that never arrived (modified, reusedExistingList).
  it.each(SAVERS)('%s carries the keys that make it comparable', (name) => {
    const body = bodyOf(name)
    const failure = body.slice(
      body.indexOf(FAILED),
      body.indexOf('throw error'),
    )
    for (const prop of [
      'variant',
      'channel',
      'intent',
      'count',
      'voteGoalShare',
    ]) {
      expect(failure).toContain(`${prop}:`)
    }
    expect(failure).not.toContain('modified:')
    expect(failure).not.toContain('reusedExistingList:')
  })

  it('does not twin the reuse path, which cannot fail', () => {
    const body = bodyOf('trackRecommendationReused')
    expect(body).toContain(ACCEPTED)
    expect(body).not.toContain(FAILED)
    expect(body).not.toContain('await')
  })
})
