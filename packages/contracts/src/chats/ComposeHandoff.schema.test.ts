import { describe, expect, it } from 'vitest'
import {
  COMPOSE_HANDOFF_CHANNEL_SCHEMAS,
  ComposeHandoffPayloadSchema,
} from './ComposeHandoff.schema'

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

  it('accepts a valid win_social payload with draftText only', () => {
    const result = ComposeHandoffPayloadSchema.parse({
      channel: 'win_social',
      draftText: 'hello',
    })
    expect(result.channel).toBe('win_social')
  })

  it('accepts a valid win_social payload with purpose', () => {
    expect(() =>
      ComposeHandoffPayloadSchema.parse({
        channel: 'win_social',
        draftText: 'hello',
        purpose: 'persuade_voters',
      }),
    ).not.toThrow()
  })

  it('rejects win_social draftText of empty string (min 1)', () => {
    expect(() =>
      ComposeHandoffPayloadSchema.parse({
        channel: 'win_social',
        draftText: '',
      }),
    ).toThrow()
  })

  it('rejects win_social draftText longer than 2000 chars (max 2000)', () => {
    expect(() =>
      ComposeHandoffPayloadSchema.parse({
        channel: 'win_social',
        draftText: 'x'.repeat(2001),
      }),
    ).toThrow()
  })
})

describe('COMPOSE_HANDOFF_CHANNEL_SCHEMAS', () => {
  it('exposes exactly one top-level object schema per channel', () => {
    expect(
      COMPOSE_HANDOFF_CHANNEL_SCHEMAS.serve_social.parse({
        channel: 'serve_social',
        draftText: 'hello',
      }),
    ).toEqual({ channel: 'serve_social', draftText: 'hello' })
    expect(
      COMPOSE_HANDOFF_CHANNEL_SCHEMAS.win_social.parse({
        channel: 'win_social',
        draftText: 'hello',
      }),
    ).toEqual({ channel: 'win_social', draftText: 'hello' })
  })

  it('rejects the other channel on each per-channel schema', () => {
    expect(() =>
      COMPOSE_HANDOFF_CHANNEL_SCHEMAS.serve_social.parse({
        channel: 'win_social',
        draftText: 'hello',
      }),
    ).toThrow()
    expect(() =>
      COMPOSE_HANDOFF_CHANNEL_SCHEMAS.win_social.parse({
        channel: 'serve_social',
        draftText: 'hello',
      }),
    ).toThrow()
  })
})
