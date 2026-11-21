import { describe, expect, it } from 'vitest'
import { resolveGuardVerdict } from './guardVerdict'

describe('resolveGuardVerdict', () => {
  it('reads a missing verdicts file as a crash', () => {
    expect(resolveGuardVerdict(['a'], undefined).outcome).toBe('judge crashed')
    expect(resolveGuardVerdict(['a'], []).outcome).toBe('judge crashed')
  })

  it('maps each label', () => {
    for (const label of [
      'BETTER',
      'NO DIFFERENCE FOUND',
      'WORSE',
      "CAN'T JUDGE",
    ]) {
      expect(resolveGuardVerdict(['a'], [{ suite: 'a', label }]).outcome).toBe(
        label,
      )
    }
  })

  it('collapses several suites to the worst and lists each', () => {
    const verdict = resolveGuardVerdict(
      ['a', 'b'],
      [
        { suite: 'a', label: 'BETTER' },
        { suite: 'b', label: 'WORSE' },
      ],
    )
    expect(verdict.outcome).toBe('WORSE')
    expect(verdict.note).toContain('- `a`: BETTER')
    expect(verdict.note).toContain('- `b`: WORSE')
  })

  it('reads a requested suite with no row as a crash', () => {
    expect(
      resolveGuardVerdict(['a', 'b'], [{ suite: 'a', label: 'BETTER' }])
        .outcome,
    ).toBe('judge crashed')
  })

  it('reads an unknown label as a crash', () => {
    expect(
      resolveGuardVerdict(['a'], [{ suite: 'a', label: 'MAYBE' }]).outcome,
    ).toBe('judge crashed')
  })

  it('reports a preview that never served the commit as not ready, not a crash', () => {
    expect(
      resolveGuardVerdict(['chief_of_staff'], undefined, false).outcome,
    ).toBe('preview not ready')
  })
})
