import { describe, expect, it } from 'vitest'
import { ComposeHandoffPayloadSchema } from './ComposeHandoff.schema'

describe('ComposeHandoffPayloadSchema', () => {
  it('accepts a valid serve_social payload with draftText only', () => {
    const result = ComposeHandoffPayloadSchema.parse({
      channel: 'serve_social',
      draftText: 'hello',
    })
    expect(result.channel).toBe('serve_social')
  })

  it('accepts a valid serve_social payload with purpose', () => {
    expect(() =>
      ComposeHandoffPayloadSchema.parse({
        channel: 'serve_social',
        draftText: 'hello',
        purpose: 'community update',
      }),
    ).not.toThrow()
  })

  it('accepts a serve_social payload without purpose', () => {
    expect(() =>
      ComposeHandoffPayloadSchema.parse({
        channel: 'serve_social',
        draftText: 'hello',
      }),
    ).not.toThrow()
  })

  it('rejects draftText of empty string (min 1)', () => {
    expect(() =>
      ComposeHandoffPayloadSchema.parse({
        channel: 'serve_social',
        draftText: '',
      }),
    ).toThrow()
  })

  it('rejects draftText longer than 2000 chars (max 2000)', () => {
    expect(() =>
      ComposeHandoffPayloadSchema.parse({
        channel: 'serve_social',
        draftText: 'x'.repeat(2001),
      }),
    ).toThrow()
  })

  it('accepts draftText of exactly 2000 chars', () => {
    expect(() =>
      ComposeHandoffPayloadSchema.parse({
        channel: 'serve_social',
        draftText: 'x'.repeat(2000),
      }),
    ).not.toThrow()
  })

  it('rejects purpose longer than 120 chars (max 120)', () => {
    expect(() =>
      ComposeHandoffPayloadSchema.parse({
        channel: 'serve_social',
        draftText: 'hello',
        purpose: 'a'.repeat(121),
      }),
    ).toThrow()
  })

  it('rejects an unknown channel', () => {
    expect(() =>
      ComposeHandoffPayloadSchema.parse({
        channel: 'unknown',
        draftText: 'hi',
      }),
    ).toThrow()
  })
})
