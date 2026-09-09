import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// CreateListWizard never unmounts — CrmContactsPage always renders it and only
// toggles `open` — so React resets nothing on close. Every piece of wizard
// state has to be written by the open effect explicitly, or a selection from a
// cancelled build silently carries into the next list: it counts toward the
// CTA's validity gate and lands in the submitted payload. Edit mode raised the
// stakes rather than lowering them — the same effect now seeds from
// `editingSegment`, so a field it forgets doesn't just leak the previous
// create, it leaves the previously-edited list's criteria on screen.
//
// Read off the source rather than driven through the component, for the same
// reason as the outreach builder's twin guard: mounting the wizard needs a
// query provider, an org, a live count and a district, none of which is what
// this protects. The failure is one forgotten line in one effect.
const SOURCE = readFileSync(join(__dirname, 'CreateListWizard.tsx'), 'utf8')

const OPEN_EFFECT = (() => {
  const start = SOURCE.indexOf('    if (!open) return')
  expect(start, 'open-reset effect not found').toBeGreaterThan(-1)
  // The effect's own closing line, not a literal dep array — the deps have
  // changed once already (adding editingSegment?.id) and an anchor that goes
  // stale silently slices past the effect and swallows the count assertion.
  const end = SOURCE.indexOf('\n  }, [', start)
  expect(end, 'open-reset effect end not found').toBeGreaterThan(start)
  return SOURCE.slice(start, end)
})()

describe('CreateListWizard open-reset effect', () => {
  it.each([
    'setStepIndex(0)',
    'setBranch(null)',
    'setDemographicFilters(',
    'setSupportStatus(',
    'setPrecincts(',
    'setActivityConditions(',
    'setName(',
  ])('writes %s', (setterCall) => {
    expect(OPEN_EFFECT).toContain(setterCall)
  })

  // A new field added without a matching write is the bug this guards, so the
  // count is pinned rather than left open-ended.
  it('writes every wizard field, and no more', () => {
    const setters = OPEN_EFFECT.match(/\bset[A-Z]\w*\(/g) ?? []
    expect(setters.filter((s) => s !== 'setOpenSession(')).toHaveLength(7)
  })

  // Each seeded field must still resolve to its empty value when there's no
  // list to seed from — a seed written without a create-mode fallback would
  // carry the last edited list into the next "Create new list".
  it.each([
    ['setDemographicFilters', ': {},'],
    ['setSupportStatus', '?? []'],
    ['setPrecincts', ': [],'],
    ['setActivityConditions', ': [blankActivityCondition()],'],
    ['setName', "?? ''"],
  ])('%s falls back to an empty value with no segment', (_setter, fallback) => {
    expect(OPEN_EFFECT).toContain(fallback)
  })
})
