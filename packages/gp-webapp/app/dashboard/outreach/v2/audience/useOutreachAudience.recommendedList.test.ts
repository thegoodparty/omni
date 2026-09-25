import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Accepting a recommended list can fail, and until DATA-2539 only the success
// was recorded — an accept count with no denominator, where a rise in save
// failures reads as a fall in interest. The twin has to stay attached to the
// catch that owns the failure, and carry the same identifying properties as
// the success, or the two cannot be compared as one rate.
//
// Asserted against the source for the same reason as the reset tests beside
// this file: the hook needs a React Query provider, an org, an elected-office
// fetch and a live count to mount, none of which is what this guards. The
// failure mode is a line deleted from a catch block, and that is what this reads.
const SOURCE = readFileSync(join(__dirname, 'useOutreachAudience.ts'), 'utf8')

const CREATE_CATCH = (() => {
  const start = SOURCE.indexOf(
    'setCreateRecommendedListError("We couldn\'t save this list. Try again.")',
  )
  expect(start, 'create-recommended-list catch not found').toBeGreaterThan(-1)
  // Back up to the catch that owns it, forward to the throw that closes it.
  const open = SOURCE.lastIndexOf('} catch (error) {', start)
  const close = SOURCE.indexOf('throw error', start)
  return SOURCE.slice(open, close)
})()

describe('recommended-list accept/fail pair', () => {
  it('fires the failure event from the catch that shows the error', () => {
    expect(CREATE_CATCH).toContain('EVENTS.Outreach.RecommendedList.Failed')
  })

  // Same keys as Accepted, minus the two only knowable from the response that
  // never arrived (modified, reusedExistingList).
  it.each(['variant', 'channel', 'intent', 'count', 'voteGoalShare'])(
    'carries %s so it can be compared with the accept',
    (prop) => {
      expect(CREATE_CATCH).toContain(`${prop}:`)
    },
  )

  it('still records the success it is the twin of', () => {
    expect(SOURCE).toContain('EVENTS.Outreach.RecommendedList.Accepted')
  })
})
