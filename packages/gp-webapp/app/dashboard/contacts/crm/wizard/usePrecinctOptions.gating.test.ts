import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The precinct option list is fetched by a component that NEVER unmounts —
// CrmContactsPage always renders CreateListWizard and only toggles `open`, and
// the outreach flow host does the same. An ungated fetch therefore runs on
// every page load rather than when the control can render: in prod that gave
// GET /v1/contacts/precincts a 29% error rate (a non-Pro page load 400s on the
// Pro gate) while the sibling count queries, gated this way, took zero across
// 269 calls.
//
// Read off the source for the same reason the reset guards are: mounting either
// caller needs a query provider, an org, an elected-office fetch and a live
// count, none of which is what this protects. The failure is one missing
// condition in one argument.
const read = (relative: string): string =>
  readFileSync(join(__dirname, relative), 'utf8')

const callArgs = (source: string): string => {
  const at = source.indexOf('usePrecinctOptions(')
  expect(at, 'usePrecinctOptions call not found').toBeGreaterThan(-1)
  return source.slice(at, source.indexOf(')', at))
}

describe('usePrecinctOptions is gated to when the control can render', () => {
  it('the CRM wizard gates on open, mode and district resolution', () => {
    const args = callArgs(read('CreateListWizard.tsx'))
    expect(args).toContain('open')
    expect(args).toContain('!isElectedOfficial')
    expect(args).toContain('!voterDataUnavailable')
  })

  it('the outreach builder gates on open, active and the filters mode', () => {
    const args = callArgs(
      read('../../../outreach/v2/audience/useOutreachAudience.ts'),
    )
    expect(args).toContain('open')
    expect(args).toContain('active')
    expect(args).toContain("mode !== 'picker'")
    expect(args).toContain('!isElectedOfficial')
  })
})
