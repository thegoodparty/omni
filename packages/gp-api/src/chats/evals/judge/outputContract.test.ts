import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { contractFor, contractLines, contractOf } from './outputContract'

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

  it('lists the fields, and says nothing about a change when there is none', () => {
    expect(contractLines(AB, AB)).toBe(
      'Output contract: the artifact must include these top-level fields: ' +
        'a (string), b.',
    )
  })

  it('names the base contract when this PR changed it', () => {
    expect(contractLines(AB, A)).toContain(
      'The output contract changed in this PR. Before it, the required ' +
        'fields were: a (string).',
    )
    expect(contractLines(AB, null)).toContain(
      'Before it, the required fields were: none.',
    )
  })

  // An unread base says nothing about whether the contract moved.
  it('claims no change when the base was not read', () => {
    expect(contractLines(AB, undefined)).not.toContain('changed')
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
})
