import { describe, expect, it } from 'vitest'
import { cloneId, costFromTranscript, inlineRefs } from './capBackground.js'

describe('cloneId', () => {
  it('derives a publishable id from a branch name', () => {
    expect(cloneId('meeting_briefing', 'pr-1234')).toBe(
      'meeting_briefing_uj_pr_1234',
    )
  })

  it('flattens characters a git ref may carry', () => {
    const id = cloneId('top_community_issues', 'feature/Some-Branch.v2')
    expect(id).toMatch(/^[a-z][a-z0-9_]*$/)
  })

  it('never collides with the baseline experiment it clones', () => {
    expect(cloneId('meeting_briefing', 'main')).not.toBe('meeting_briefing')
  })

  it('refuses a tag that cannot produce a valid id', () => {
    expect(() => cloneId('meeting_briefing', '...')).toThrow(/no usable characters/)
  })
})

describe('inlineRefs', () => {
  const defs = {
    districtInputs: {
      properties: {
        l2DistrictType: { type: 'string' },
        l2DistrictName: { type: 'string' },
      },
    },
  }

  it('replaces a meta-schema ref with the referenced object', () => {
    const inlined = inlineRefs(
      {
        input_schema: {
          $ref: '../_schema/manifest.schema.json#/$defs/districtInputs',
        },
      },
      defs,
    ) as { input_schema: unknown }
    expect(inlined.input_schema).toEqual(defs.districtInputs)
  })

  it('resolves a pointer into a nested path', () => {
    const inlined = inlineRefs(
      { field: { $ref: '#/$defs/districtInputs/properties/l2DistrictName' } },
      defs,
    ) as { field: unknown }
    expect(inlined.field).toEqual({ type: 'string' })
  })

  it('recurses into arrays and nested objects', () => {
    const inlined = inlineRefs(
      { oneOf: [{ a: { $ref: '#/$defs/districtInputs' } }, { b: 1 }] },
      defs,
    ) as { oneOf: { a?: unknown; b?: number }[] }
    expect(inlined.oneOf[0].a).toEqual(defs.districtInputs)
    expect(inlined.oneOf[1].b).toBe(1)
  })

  it('leaves a ref it does not own alone, rather than breaking it', () => {
    const node = { $ref: 'https://example.com/schema.json' }
    expect(inlineRefs(node, defs)).toEqual(node)
  })

  it('fails loudly on a ref into a $defs entry that does not exist', () => {
    expect(() => inlineRefs({ $ref: '#/$defs/nope' }, defs)).toThrow(
      /unknown \$defs entry/,
    )
  })
})

describe('costFromTranscript', () => {
  // Shape taken from a real dev run's logs/session.jsonl: usage hangs off
  // message, and there is no dollar figure anywhere in the file.
  const line = (model: string, usage: Record<string, number>) =>
    JSON.stringify({ type: 'assistant', message: { model, usage } })

  it('prices cache reads far below fresh input', () => {
    const cheap = costFromTranscript(
      line('claude-sonnet-4-6', { cache_read_input_tokens: 1_000_000 }),
    )!
    const dear = costFromTranscript(
      line('claude-sonnet-4-6', { input_tokens: 1_000_000 }),
    )!
    expect(cheap).toBeCloseTo(0.3, 6)
    expect(dear).toBeCloseTo(3, 6)
  })

  it('sums every assistant message in the run', () => {
    const body = [
      line('claude-sonnet-4-6', { output_tokens: 1_000_000 }),
      line('claude-sonnet-4-6', { output_tokens: 1_000_000 }),
    ].join('\n')
    expect(costFromTranscript(body)).toBeCloseTo(30, 6)
  })

  it('prices each model in a mixed run at its own rate', () => {
    const body = [
      line('claude-haiku-4-5', { output_tokens: 1_000_000 }),
      line('claude-opus-4-7', { output_tokens: 1_000_000 }),
    ].join('\n')
    expect(costFromTranscript(body)).toBeCloseTo(80, 6)
  })

  it('ignores lines with no usage and lines that are not JSON', () => {
    const body = [
      'not json at all',
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      line('claude-sonnet-4-6', { output_tokens: 1_000_000 }),
    ].join('\n')
    expect(costFromTranscript(body)).toBeCloseTo(15, 6)
  })

  it('returns undefined for an unrecognised model rather than guessing', () => {
    expect(
      costFromTranscript(line('some-other-model', { output_tokens: 1000 })),
    ).toBeUndefined()
  })

  it('returns undefined for an empty transcript', () => {
    expect(costFromTranscript('')).toBeUndefined()
  })
})
