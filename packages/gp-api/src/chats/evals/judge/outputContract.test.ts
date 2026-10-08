import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  contractFor,
  contractLines,
  contractOf,
  readOutputContracts,
} from './outputContract'

const manifest = (outputSchema: object): string =>
  JSON.stringify({ id: 'x', output_schema: outputSchema })

describe('contractOf', () => {
  it('reads the required top-level fields with their types', () => {
    expect(
      contractOf(
        manifest({
          required: ['generated_at', 'field_analysis', 'news'],
          properties: {
            generated_at: { type: 'string' },
            field_analysis: { $ref: '#/definitions/fa' },
            news: { type: ['object', 'null'] },
            ignored: { type: 'string' },
          },
        }),
      ),
    ).toEqual([
      { name: 'generated_at', type: 'string' },
      { name: 'field_analysis' },
      { name: 'news', type: 'object or null' },
    ])
  })

  // meeting_briefing is a oneOf: no top-level requirement to show.
  it('is null when nothing is required at the top level', () => {
    expect(contractOf(manifest({ oneOf: [] }))).toBeNull()
    expect(contractOf(manifest({ required: [] }))).toBeNull()
  })

  it('throws on something that is not a manifest', () => {
    expect(() => contractOf('not json')).toThrow()
    expect(() => contractOf(JSON.stringify({ id: 'x' }))).toThrow()
  })

  // Every real manifest must parse, so a schema shape this reader does not
  // know fails here rather than as a silently missing line in a sweep.
  it('parses every published manifest', () => {
    const root = path.resolve(__dirname, '../../../../../runbooks/experiments')
    const ids = readdirSync(root).filter(
      (id) => !id.startsWith('_') && !id.endsWith('.md'),
    )
    expect(ids.length).toBeGreaterThan(10)
    for (const id of ids) {
      const text = readFileSync(path.join(root, id, 'manifest.json'), 'utf8')
      expect(() => contractOf(text), id).not.toThrow()
    }
  })
})

describe('contractLines', () => {
  const A = [{ name: 'a', type: 'string' }]
  const AB = [...A, { name: 'b' }]
  const AC = [...A, { name: 'c', type: 'array' }]

  it('lists the fields when both refs require the same set', () => {
    expect(contractLines(AB, AB)).toBe(
      'Output contract: the artifact must include these top-level fields: ' +
        'a (string), b.',
    )
  })

  it('lists only the shared fields, then both sets, when they differ', () => {
    expect(contractLines(AB, AC)).toBe(
      'Output contract: the artifact must include these top-level fields: ' +
        'a (string).\n' +
        'The two runs may have been produced under different output ' +
        'contracts. One required: a (string), b; the other required: ' +
        'a (string), c (array). A field in only one of these sets is ' +
        'neither an addition nor an omission.',
    )
  })

  // The judge must not learn which run is the candidate: a line that named
  // "this PR" or "before it" would say so, and would fault the base run for
  // a field its own contract never asked for.
  it.each([
    [AB, A],
    [AB, AC],
    [AB, null],
    [null, A],
    [[{ name: 'a', type: 'string' }], [{ name: 'a', type: 'number' }]],
  ] as const)('renders the same bytes whichever arm is which', (x, y) => {
    expect(contractLines(x, y)).toBe(contractLines(y, x))
    expect(contractLines(x, y)).not.toMatch(/this PR|before it|base|candidate/i)
  })

  it('says "none" for a ref that required nothing', () => {
    expect(contractLines(AB, null)).toContain('the other required: none')
  })

  // An unread base says nothing about whether the contract moved.
  it('claims no change when the base was not read', () => {
    expect(contractLines(AB, undefined)).not.toContain('different')
  })
})

describe('contractFor', () => {
  it('notes why no line was shown', () => {
    expect(contractFor({ candidate: 'unread' })).toEqual({
      lines: null,
      note: 'unread',
    })
    expect(contractFor({ candidate: null })).toEqual({
      lines: null,
      note: 'noRequired',
    })
  })

  it('shows the contract and notes it when the base manifest was unread', () => {
    const read = contractFor({
      candidate: [{ name: 'a' }],
      base: 'unread',
    })
    expect(read.note).toBe('baseUnread')
    expect(read.lines).toContain('must include these top-level fields: a.')
  })
})

// The real reader, so a wrong root path fails here and not as an agent
// silently judged without its contract.
describe('readOutputContracts', () => {
  it('finds race_opponent_summary in this checkout', () => {
    const read = readOutputContracts('race_opponent_summary', undefined)
    expect(read.candidate).not.toBe('unread')
    expect(read.candidate).not.toBeNull()
    expect(read.base).toBeUndefined()
  })

  it('marks a base it cannot read', () => {
    const read = readOutputContracts(
      'race_opponent_summary',
      '/nonexistent-judge-base',
    )
    expect(read.base).toBe('unread')
  })
})
