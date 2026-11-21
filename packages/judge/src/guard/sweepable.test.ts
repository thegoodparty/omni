import { describe, expect, it } from 'vitest'
import {
  splitSweepable,
  unsweepableNote,
  unsweepableReasonFor,
} from './sweepable'

describe('unsweepableReasonFor', () => {
  const reason = unsweepableReasonFor((suite) =>
    suite === 'gone'
      ? undefined
      : suite === 'gate'
        ? 'defineExpectedResultEvalSuite(...)'
        : 'export default definePairwiseAgentEvalSuite(...)',
  )

  it('drops a suite whose eval file is missing at the PR head', () => {
    expect(reason('gone')).toBe('missing_at_head')
  })

  it('drops a suite that is not pairwise', () => {
    expect(reason('gate')).toBe('not_pairwise')
  })

  it('keeps a pairwise suite', () => {
    expect(reason('trending_issues')).toBeUndefined()
  })
})

describe('splitSweepable', () => {
  it('keeps order and names each suite left out', () => {
    const split = splitSweepable(['a', 'gate', 'b'], (s) =>
      s === 'gate' ? 'not_pairwise' : undefined,
    )
    expect(split.sweepable).toEqual(['a', 'b'])
    expect(split.unsweepable).toEqual([
      { suite: 'gate', reason: 'not_pairwise' },
    ])
  })
})

describe('unsweepableNote', () => {
  it('is empty when nothing was left out', () => {
    expect(unsweepableNote([])).toBe('')
  })

  it('names each suite with its reason', () => {
    expect(
      unsweepableNote([
        { suite: 'gate', reason: 'not_pairwise' },
        { suite: 'gone', reason: 'missing_at_head' },
      ]),
    ).toBe(
      ' Not run, because judge-eval cannot run them: ' +
        '`gate` (not a pairwise suite), `gone` (no eval file at the PR head).',
    )
  })
})
