import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// CreateListWizard never unmounts — CrmContactsPage always renders it and only
// toggles `open` — so React resets nothing on close. Every piece of wizard
// state has to be cleared by the open effect explicitly, or a selection from a
// cancelled build silently carries into the next list: it counts toward the
// CTA's validity gate and lands in the submitted payload.
//
// Read off the source rather than driven through the component, for the same
// reason as the outreach builder's twin guard: mounting the wizard needs a
// query provider, an org, a live count and a district, none of which is what
// this protects. The failure is one forgotten line in one effect.
const SOURCE = readFileSync(join(__dirname, 'CreateListWizard.tsx'), 'utf8')

const OPEN_EFFECT = (() => {
  const start = SOURCE.indexOf('    if (!open) return')
  expect(start, 'open-reset effect not found').toBeGreaterThan(-1)
  return SOURCE.slice(start, SOURCE.indexOf('}, [open])', start))
})()

describe('CreateListWizard open-reset effect', () => {
  it.each([
    'setStepIndex(0)',
    'setBranch(null)',
    'setDemographicFilters({})',
    'setSupportStatus([])',
    'setPrecincts([])',
    'setActivityConditions([blankActivityCondition()])',
    "setName('')",
  ])('clears %s', (clearCall) => {
    expect(OPEN_EFFECT).toContain(clearCall)
  })

  // A new field added without a matching clear is the bug this guards, so the
  // count is pinned rather than left open-ended.
  it('clears every wizard field, and no more', () => {
    const setters = OPEN_EFFECT.match(/\bset[A-Z]\w*\(/g) ?? []
    expect(setters.filter((s) => s !== 'setOpenSession(')).toHaveLength(7)
  })
})
