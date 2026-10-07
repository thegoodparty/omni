import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Three invariants of the whole-constituency row that live inside the hook.
//
// Asserted against the source for the reason `useOutreachAudience.reset.test`
// gives: mounting this hook needs a React Query provider, an org, an
// elected-office fetch and a live count, none of which is what these guard.
// They are weak tests of real invariants — each failure mode is a line
// deleted from the hook, and that is what they read. Two of them exist
// because the behavioural tests provably did NOT catch the bug: the step's
// own test passes `universeName: null` directly, which proves the step
// withholds the row but says nothing about the hook ever producing null.
const SOURCE = readFileSync(join(__dirname, 'useOutreachAudience.ts'), 'utf8')

describe('the universe count is gated on the picker, not the flow', () => {
  // The count is `GET /v1/contacts/list-detail` over the WHOLE district —
  // 12s p50 / 17s p95 under concurrency, which is why `useListRowDetail` caps
  // itself at 3 in flight. Nothing shows it until the popover is up, so
  // firing it on flow open spent a slow warehouse read on every candidate
  // who never touched the picker, across three channels and both products.
  it('waits for the popover before reading the whole district', () => {
    expect(SOURCE).toContain('enabled: open && pickerOpen')
  })

  // Without this the gate leaks across flow opens: the step unmounts between
  // steps and never reports the popover closing, so a second open of the flow
  // would fire the read immediately — the exact thing the gate prevents.
  it('forgets the popover when the flow resets', () => {
    expect(SOURCE).toContain('setPickerOpen(false)')
  })
})

describe('the universe row waits for its label', () => {
  // While the elected-office query is in flight its data is undefined, which
  // reads as Win. On a cold cache a Serve org was offered a row called "All
  // voters" and, if they picked it, had a list SAVED under that name.
  it('has no name until the elected-office query has settled', () => {
    expect(SOURCE).toContain('universeName = electedOfficeFetched')
  })

  it('reads that settled flag off the query, not off its data', () => {
    expect(SOURCE).toContain('isFetched: electedOfficeFetched')
  })
})

describe('the universe create does not outlive the flow', () => {
  // A create still in flight when the flow closes otherwise leaves the row
  // disabled and spinning on the next open, with no way back to it.
  it('is reset when the flow resets', () => {
    const reset = SOURCE.slice(SOURCE.indexOf('const reset = useCallback('))
    const body = reset.slice(0, reset.indexOf('}, ['))
    expect(body).toContain('resetUniverseMutation()')
  })
})
