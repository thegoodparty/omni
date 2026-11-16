import { describe, expect, it } from 'vitest'
import { assignSplit, parseDraftResponse } from './drafting.util'
import { extractJsonArray, extractJsonObject } from './extractJson.util'

const caseFields = {
  caseId: 'a-case',
  condition: 'A condition.',
  handledWhen: 'A handled-when.',
}

const parse = (payload: object) => () =>
  parseDraftResponse(JSON.stringify(payload))

describe('extractJson', () => {
  it('reads the first balanced value past fences and prose', () => {
    expect(
      extractJsonObject('Here:\n```json\n{"a": "}{", "b": {"c": 1}}\n```'),
    ).toEqual({ a: '}{', b: { c: 1 } })
    expect(extractJsonArray('Sure. ["x", "]"] done')).toEqual(['x', ']'])
  })

  it('throws on no value or an unbalanced one', () => {
    expect(() => extractJsonObject('no json')).toThrow()
    expect(() => extractJsonObject('{"a": 1')).toThrow()
  })
})

describe('parseDraftResponse', () => {
  it('reads each of the three outcomes', () => {
    expect(
      parse({
        outcome: 'newCase',
        failureSummary: 'f',
        case: { ...caseFields, question: 'q?' },
      })(),
    ).toMatchObject({ outcome: 'newCase' })
    expect(
      parse({
        outcome: 'newCase',
        failureSummary: 'f',
        case: { ...caseFields, turns: ['a', 'b'] },
      })(),
    ).toMatchObject({ case: { turns: ['a', 'b'] } })
    expect(
      parse({ outcome: 'coveredBy', failureSummary: 'f', caseId: 'x' })(),
    ).toMatchObject({ outcome: 'coveredBy', caseId: 'x' })
    expect(
      parse({ outcome: 'needsSetup', failureSummary: 'f', what: 'w' })(),
    ).toMatchObject({ outcome: 'needsSetup', what: 'w' })
  })

  it.each([
    ['a bad caseId', { ...caseFields, caseId: 'bad id', question: 'q' }],
    ['a long caseId', { ...caseFields, caseId: 'x'.repeat(81), question: 'q' }],
    [
      'a long condition',
      { ...caseFields, condition: 'x'.repeat(2001), question: 'q' },
    ],
    [
      'a long handledWhen',
      { ...caseFields, handledWhen: 'x'.repeat(601), question: 'q' },
    ],
    ['both question and turns', { ...caseFields, question: 'q', turns: ['t'] }],
    ['neither question nor turns', caseFields],
    ['eleven turns', { ...caseFields, turns: Array(11).fill('t') }],
  ])('rejects %s', (_label, draftCase) => {
    expect(
      parse({ outcome: 'newCase', failureSummary: 'f', case: draftCase }),
    ).toThrow()
  })

  it('rejects an unknown outcome or a missing summary', () => {
    expect(parse({ outcome: 'maybe', failureSummary: 'f' })).toThrow()
    expect(parse({ outcome: 'coveredBy', caseId: 'x' })).toThrow()
  })
})

describe('assignSplit', () => {
  it('matches the Python crc32 split and lands near two to one', () => {
    expect(assignSplit('turnout-figure-without-source')).toBe('holdout')
    expect([0, 1, 2, 3, 4].map((i) => assignSplit(`case-${i}`))).toEqual([
      'tune',
      'tune',
      'tune',
      'holdout',
      'holdout',
    ])
    const splits = Array.from({ length: 300 }, (_, i) =>
      assignSplit(`case-${i}`),
    )
    const ratio =
      splits.filter((s) => s === 'tune').length /
      splits.filter((s) => s === 'holdout').length
    expect(ratio).toBeGreaterThan(1.3)
    expect(ratio).toBeLessThan(3.3)
  })
})
