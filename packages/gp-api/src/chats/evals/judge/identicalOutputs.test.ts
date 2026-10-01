import { describe, expect, it } from 'vitest'
import { CHAT_PAIR } from './fixtures/records'
import { identicalOutputs, sameOutput } from './identicalOutputs'
import { normalizeAgent } from './normalize'
import type { RunRecord } from './record'

// IDENTICAL_DIGEST_PAIR in the fixtures is the config-level case, which
// normalize.ts refuses on its own. This is the output-level case, which fires
// even when the digests differ — so the pairs here are built locally.

const [BASE, CANDIDATE] = CHAT_PAIR

const rng = () => 0

// One case, two arms, with the candidate's answer under the caller's control.
// Digests are left different, which is the whole point: this catches a sweep
// that got past the identical-config refusal.
const pair = (
  caseId: string,
  baseAnswer: string,
  candidateAnswer: string,
): RunRecord[] => [
  {
    ...BASE,
    caseId,
    runId: `${BASE.sweepId}:${caseId}:base:1`,
    output: { kind: 'text', value: baseAnswer },
  },
  {
    ...CANDIDATE,
    caseId,
    runId: `${CANDIDATE.sweepId}:${caseId}:candidate:1`,
    output: { kind: 'text', value: candidateAnswer },
  },
]

const over = (records: RunRecord[]) =>
  identicalOutputs(BASE.agentId, normalizeAgent(records, rng).judgeable)

describe('sameOutput', () => {
  it('matches equal payloads', () => {
    expect(
      sameOutput({ kind: 'text', value: 'a' }, { kind: 'text', value: 'a' }),
    ).toBe(true)
  })

  it('does not match across kinds', () => {
    expect(
      sameOutput(
        { kind: 'text', value: 'a' },
        { kind: 'artifact', value: 'a' },
      ),
    ).toBe(false)
  })

  // Canonical, not raw stringify: two arms' objects can serialize differently
  // with the same content, and missing an identical pair is the direction
  // that hides the bug this exists to catch.
  it('matches an object whose keys are in a different order', () => {
    expect(
      sameOutput(
        { kind: 'artifact', value: { a: 1, b: { c: 2, d: 3 } } },
        { kind: 'artifact', value: { b: { d: 3, c: 2 }, a: 1 } },
      ),
    ).toBe(true)
  })

  it('distinguishes an array from a reordered array', () => {
    expect(
      sameOutput(
        { kind: 'artifact', value: [1, 2] },
        { kind: 'artifact', value: [2, 1] },
      ),
    ).toBe(false)
  })

  // Two absent outputs mean both arms were infraErrors, which is not evidence
  // that the arms match.
  it('never matches two absent outputs', () => {
    expect(sameOutput(null, null)).toBe(false)
  })
})

describe('identicalOutputs', () => {
  it('reports the count and the cases, not just a flag', () => {
    const result = over([
      ...pair('same-one', 'identical', 'identical'),
      ...pair('same-two', 'also', 'also'),
      ...pair('differs', 'left', 'right'),
    ])
    expect(result.identical).toBe(2)
    expect(result.of).toBe(3)
    expect(result.caseIds).toEqual(['same-one', 'same-two'])
    // One or two matching pairs is ordinary: a deterministic agent answering
    // a question the branch did not touch will match.
    expect(result.allIdentical).toBe(false)
  })

  // The failure this exists for. Every pair matching means the candidate was
  // never applied, and reporting that as SAME is indistinguishable from a
  // real verdict.
  it('flags a sweep where every pair came back identical', () => {
    const result = over([
      ...pair('one', 'same', 'same'),
      ...pair('two', 'same', 'same'),
    ])
    expect(result.allIdentical).toBe(true)
    expect(result.identical).toBe(2)
    expect(result.of).toBe(2)
  })

  // Nothing to compare is a different failure with its own refusal; calling
  // it "every pair identical" would be a second wrong explanation for it.
  it('does not flag an empty pairing', () => {
    const result = identicalOutputs(BASE.agentId, [])
    expect(result.allIdentical).toBe(false)
    expect(result.of).toBe(0)
  })

  // One differing pair out of many is enough to show the candidate applied.
  it('does not flag when a single pair differs', () => {
    const result = over([
      ...pair('a', 'same', 'same'),
      ...pair('b', 'same', 'same'),
      ...pair('c', 'same', 'different'),
    ])
    expect(result.allIdentical).toBe(false)
    expect(result.identical).toBe(2)
  })
})
