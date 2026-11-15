import { describe, expect, it } from 'vitest'
import {
  EnvSchema,
  MESSAGE_BY_OUTCOME,
  buildRuling,
} from './recordGuardRulingCli'

const baseEnv = {
  RULING_PR_NUMBER: '1234',
  RULING_HEAD_SHA: 'abc123',
  RULING_BY: 'daniel',
}

describe('EnvSchema', () => {
  it('accepts an agree ruling with no reason', () => {
    const result = EnvSchema.safeParse({ ...baseEnv, RULING_KIND: 'agree' })
    expect(result.success).toBe(true)
  })

  it('rejects a dispute ruling with no reason', () => {
    const result = EnvSchema.safeParse({ ...baseEnv, RULING_KIND: 'dispute' })
    expect(result.success).toBe(false)
  })

  it('rejects a dispute ruling with a blank reason', () => {
    const result = EnvSchema.safeParse({
      ...baseEnv,
      RULING_KIND: 'dispute',
      RULING_REASON: '   ',
    })
    expect(result.success).toBe(false)
  })

  it('accepts a dispute ruling with a reason', () => {
    const result = EnvSchema.safeParse({
      ...baseEnv,
      RULING_KIND: 'dispute',
      RULING_REASON: 'flaky on main',
    })
    expect(result.success).toBe(true)
  })
})

describe('buildRuling', () => {
  it('builds an agree ruling with no reason field at all', () => {
    const env = EnvSchema.parse({ ...baseEnv, RULING_KIND: 'agree' })
    expect(buildRuling(env)).toEqual({ by: 'daniel', kind: 'agree' })
  })

  it('builds a dispute ruling carrying its reason', () => {
    const env = EnvSchema.parse({
      ...baseEnv,
      RULING_KIND: 'dispute',
      RULING_REASON: 'flaky on main',
    })
    expect(buildRuling(env)).toEqual({
      by: 'daniel',
      kind: 'dispute',
      reason: 'flaky on main',
    })
  })
})

describe('MESSAGE_BY_OUTCOME', () => {
  it('has a message for every non-applied outcome', () => {
    expect(Object.keys(MESSAGE_BY_OUTCOME).sort()).toEqual([
      'already_ruled',
      'no_worse',
      'not_found',
    ])
  })

  it('names the PR and a shortened head SHA', () => {
    const message = MESSAGE_BY_OUTCOME.no_worse(1234, 'abcdef0123456789')
    expect(message).toContain('#1234')
    expect(message).toContain('abcdef012345')
  })
})
