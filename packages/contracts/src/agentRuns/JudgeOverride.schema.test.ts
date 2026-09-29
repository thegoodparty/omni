import { describe, expect, it } from 'vitest'
import {
  JUDGE_KEY_PREFIX,
  JudgeOverrideSchema,
  judgeOverrideKeys,
} from './JudgeOverride.schema'

describe('judgeOverrideKeys', () => {
  it('builds the content-addressed folder layout', () => {
    expect(judgeOverrideKeys('meeting_briefing', 'abc123')).toEqual({
      manifest_key: '_judge/meeting_briefing/abc123/manifest.json',
      instruction_key: '_judge/meeting_briefing/abc123/instruction.md',
    })
  })

  it('is idempotent for the same content', () => {
    expect(judgeOverrideKeys('self_research', 'deadbeef')).toEqual(
      judgeOverrideKeys('self_research', 'deadbeef'),
    )
  })

  it('never collides across digests', () => {
    const a = judgeOverrideKeys('self_research', 'aaa')
    const b = judgeOverrideKeys('self_research', 'bbb')
    expect(a.manifest_key).not.toBe(b.manifest_key)
  })

  // A crafted id must not be able to change what the key addresses, because
  // the ticket allowlists whatever key it is handed.
  it.each([
    ['a slash', 'meeting/briefing'],
    ['traversal', '..'],
    ['an absolute path', '/etc/passwd'],
    ['empty', ''],
  ])('refuses %s in the agent id', (_, agentId) => {
    expect(() => judgeOverrideKeys(agentId, 'abc')).toThrow()
  })

  it.each([
    ['a slash', 'ab/cd'],
    ['traversal', '..'],
  ])('refuses %s in the digest', (_, digest) => {
    expect(() => judgeOverrideKeys('meeting_briefing', digest)).toThrow()
  })
})

describe('JudgeOverrideSchema', () => {
  it('accepts keys the builder produced', () => {
    const keys = judgeOverrideKeys('top_community_issues', 'f00d')
    expect(JudgeOverrideSchema.safeParse(keys).success).toBe(true)
  })

  it('rejects a key outside the judge prefix', () => {
    const result = JudgeOverrideSchema.safeParse({
      manifest_key: 'meeting_briefing/manifest.json',
      instruction_key: '_judge/meeting_briefing/x/instruction.md',
    })
    expect(result.success).toBe(false)
  })

  // Starts with the prefix and escapes it anyway, which is why the prefix
  // check alone is not the control.
  it('rejects traversal out of the prefix', () => {
    const result = JudgeOverrideSchema.safeParse({
      manifest_key: `${JUDGE_KEY_PREFIX}../compliance_setup/manifest.json`,
      instruction_key: `${JUDGE_KEY_PREFIX}a/b/instruction.md`,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a manifest key pointing at the wrong filename', () => {
    const result = JudgeOverrideSchema.safeParse({
      manifest_key: '_judge/a/b/instruction.md',
      instruction_key: '_judge/a/b/instruction.md',
    })
    expect(result.success).toBe(false)
  })
})
