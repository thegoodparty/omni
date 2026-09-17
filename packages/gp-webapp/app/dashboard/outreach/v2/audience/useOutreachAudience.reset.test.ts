import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Every builder field has to be cleared by BOTH reset paths, or a selection
// from an abandoned session silently narrows the next list the user builds.
// The flow host stays mounted across close/reopen (`open` just toggles), so a
// field missed here survives indefinitely rather than for one render.
//
// Asserted against the source rather than by driving the hook: the hook needs
// a React Query provider, an org, an elected-office fetch and a live count to
// mount at all, and none of that is what this guards. The failure mode is a
// forgotten line in two small callbacks, and that is exactly what this reads.
const SOURCE = readFileSync(join(__dirname, 'useOutreachAudience.ts'), 'utf8')

const bodyOf = (name: string): string => {
  const start = SOURCE.indexOf(`const ${name} = useCallback(() => {`)
  expect(start, `${name} not found`).toBeGreaterThan(-1)
  const end = SOURCE.indexOf('}, [resetCreateMutation])', start)
  return SOURCE.slice(start, end)
}

describe('useOutreachAudience reset paths', () => {
  const RESETTERS = ['resetBuilder', 'reset']
  const BUILDER_CLEARS = [
    'setBuilderFilters({})',
    'setBuilderSupportStatus([])',
    'setBuilderPrecincts([])',
    "setBuilderName('')",
  ]

  it.each(RESETTERS.flatMap((fn) => BUILDER_CLEARS.map((c) => [fn, c])))(
    '%s clears %s',
    (fn, clearCall) => {
      expect(bodyOf(fn)).toContain(clearCall)
    },
  )

  // A new builder field added without a matching clear is the bug this file
  // exists for, so the count is pinned rather than left open-ended.
  it.each(RESETTERS)('%s clears every builder field, and no more', (fn) => {
    const calls = bodyOf(fn).match(/setBuilder\w+\(/g) ?? []
    expect(calls).toHaveLength(BUILDER_CLEARS.length)
  })
})
