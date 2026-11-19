import { describe, expect, it } from 'vitest'
import { resolveJudgeModel } from './model'

// `--judge-model` names the provider as its prefix, so the key the run needs is
// that provider's own — not the AI Gateway's.

describe('resolveJudgeModel', () => {
  it('resolves a known prefix to that provider, so its own key is the one used', () => {
    const model = resolveJudgeModel('anthropic/claude-sonnet-4-6')
    expect(typeof model).toBe('object')
    expect(model).not.toBe('anthropic/claude-sonnet-4-6')
    expect(JSON.stringify(model)).not.toContain('"anthropic/claude-sonnet-4-6"')
  })

  it('leaves an unknown prefix to the AI SDK default provider', () => {
    expect(resolveJudgeModel('some-gateway/anthropic/claude')).toBe(
      'some-gateway/anthropic/claude',
    )
  })

  it('refuses an id with no provider prefix', () => {
    expect(() => resolveJudgeModel('claude-sonnet-4-6')).toThrow(
      /must be an AI SDK model id/,
    )
  })

  it('refuses a prefix with no model', () => {
    expect(() => resolveJudgeModel('anthropic/')).toThrow(
      /must be an AI SDK model id/,
    )
  })
})
