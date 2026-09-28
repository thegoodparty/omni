import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The universe count is `GET /v1/contacts/list-detail` over the WHOLE
// district — measured at 12s p50 / 17s p95 under concurrency, which is why
// `useListRowDetail` caps itself at 3 in flight. Nothing shows that number
// until the saved-list popover is up, so firing it when the FLOW opens spends
// a slow warehouse read on every candidate who never touches the picker, on
// three channels across both products.
//
// Asserted against the source for the reason `useOutreachAudience.reset.test`
// gives: mounting this hook needs a React Query provider, an org, an
// elected-office fetch and a live count, none of which is what this guards.
// The failure mode is someone deleting two words from an `enabled`, and that
// is exactly what this reads. It is a weak test of a real invariant — a
// behavioural one would have to mount the whole hook to watch a fetch that
// should not happen.
const SOURCE = readFileSync(join(__dirname, 'useOutreachAudience.ts'), 'utf8')

describe('the universe count is gated on the picker, not the flow', () => {
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
