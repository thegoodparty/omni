import { describe, expect, it } from 'vitest'
import { definePairwiseAgentEvalSuite, isPairwiseAgentEvalSuite } from './suite'

const definition = {
  mode: 'win' as const,
  profile: { race: { zip: '82001', office: 'Cheyenne City Council - Ward 1' } },
  run: async () => 'out',
  cases: [{ id: 'case-1', input: { topic: 't' } }],
}

describe('definePairwiseAgentEvalSuite', () => {
  it('stamps the name and the marker', () => {
    const suite = definePairwiseAgentEvalSuite('a', definition)
    expect(suite.name).toBe('a')
    expect(suite.isPairwiseAgentEvalSuite).toBe(true)
    expect(suite.cases).toBe(definition.cases)
  })

  it('refuses a suite with no name', () => {
    expect(() => definePairwiseAgentEvalSuite('', definition)).toThrow(/name/)
  })

  it('refuses a suite with no cases', () => {
    expect(() =>
      definePairwiseAgentEvalSuite('a', { ...definition, cases: [] }),
    ).toThrow(/no cases/)
  })

  it('refuses two cases with the same id', () => {
    expect(() =>
      definePairwiseAgentEvalSuite('a', {
        ...definition,
        cases: [
          { id: 'same', input: { topic: 'a' } },
          { id: 'same', input: { topic: 'b' } },
        ],
      }),
    ).toThrow(/two cases with id 'same'/)
  })

  it('refuses a case with no id', () => {
    expect(() =>
      definePairwiseAgentEvalSuite('a', {
        ...definition,
        cases: [{ id: '', input: { topic: 'a' } }],
      }),
    ).toThrow(/no id/)
  })
})

describe('isPairwiseAgentEvalSuite', () => {
  it('recognises a suite', () => {
    expect(
      isPairwiseAgentEvalSuite(definePairwiseAgentEvalSuite('a', definition)),
    ).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isPairwiseAgentEvalSuite({ name: 'a' })).toBe(false)
    expect(isPairwiseAgentEvalSuite(null)).toBe(false)
    expect(isPairwiseAgentEvalSuite('a')).toBe(false)
  })
})
