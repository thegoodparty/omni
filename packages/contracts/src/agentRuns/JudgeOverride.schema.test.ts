import { describe, expect, it } from 'vitest'
import {
  JUDGE_KEY_PREFIX,
  JUDGE_RUN_ID_MAX_LENGTH,
  JUDGE_RUN_ID_PREFIX,
  JudgeOverrideSchema,
  judgeOverrideKeys,
  judgeRunId,
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

describe('judgeRunId', () => {
  // The dispatch Lambda refuses a `_judge_override` on a run id that does not
  // match `^_judge-[A-Za-z0-9_-]{1,29}$`, and five suppression points key on
  // the prefix. A producer that drifts makes every judge run post a callback
  // gp-api cannot match.
  it('is the marker the gp-ai side enforces', () => {
    expect(JUDGE_RUN_ID_PREFIX).toBe('_judge-')
    expect(judgeRunId('sweep-001')).toBe('_judge-sweep-001')
  })

  it('accepts a run id exactly at the ECS startedBy cap', () => {
    const suffix = 'a'.repeat(
      JUDGE_RUN_ID_MAX_LENGTH - JUDGE_RUN_ID_PREFIX.length,
    )

    expect(judgeRunId(suffix)).toHaveLength(JUDGE_RUN_ID_MAX_LENGTH)
  })

  it('refuses a run id one character past the cap', () => {
    // ECS truncates or rejects `startedBy` past 36, and the task reaper reads
    // it back to identify the run — so a longer id claims the job to
    // LAUNCHING and then sticks there when RunTask fails validation.
    const suffix = 'a'.repeat(
      JUDGE_RUN_ID_MAX_LENGTH - JUDGE_RUN_ID_PREFIX.length + 1,
    )

    expect(() => judgeRunId(suffix)).toThrow()
  })

  it('refuses the shape a bare uuid4 suffix would produce', () => {
    expect(() => judgeRunId('0199b4c0-7b1e-7000-8000-0123456789ab')).toThrow()
  })

  it.each([
    ['a slash', 'sweep/001'],
    ['traversal', '..'],
    ['empty', ''],
  ])('refuses %s in the suffix', (_, suffix) => {
    expect(() => judgeRunId(suffix)).toThrow()
  })

  it('cannot collide with a gp-api UUIDv7 run id', () => {
    expect('0199b4c0-7b1e-7000-8000-0123456789ab').not.toContain(
      JUDGE_RUN_ID_PREFIX,
    )
  })
})

describe('the key pair must name one folder', () => {
  // Both Python consumers enforce this; without it here a producer validating
  // against the contract can still build a pair the broker 400s.
  it('refuses a manifest and instruction from different digests', () => {
    expect(
      JudgeOverrideSchema.safeParse({
        manifest_key: '_judge/self_research/aaa/manifest.json',
        instruction_key: '_judge/self_research/bbb/instruction.md',
      }).success,
    ).toBe(false)
  })

  it('refuses a manifest and instruction from different agents', () => {
    expect(
      JudgeOverrideSchema.safeParse({
        manifest_key: '_judge/self_research/aaa/manifest.json',
        instruction_key: '_judge/meeting_briefing/aaa/instruction.md',
      }).success,
    ).toBe(false)
  })

  it('accepts what judgeOverrideKeys builds', () => {
    expect(
      JudgeOverrideSchema.safeParse(judgeOverrideKeys('self_research', 'aaa'))
        .success,
    ).toBe(true)
  })
})

describe('segment bounds match the Python enforcers', () => {
  // The dispatch Lambda and the broker pin each segment to 64 chars. An
  // unbounded builder here would hand them a key they refuse — which is how
  // a producer and its consumer drift when they live in different languages.
  it('accepts a sha256 hex digest', () => {
    const digest = 'a'.repeat(64)

    expect(judgeOverrideKeys('meeting_briefing', digest).manifest_key).toBe(
      `_judge/meeting_briefing/${digest}/manifest.json`,
    )
  })

  it('refuses a segment past 64 characters', () => {
    expect(() =>
      judgeOverrideKeys('meeting_briefing', 'a'.repeat(65)),
    ).toThrow()
  })

  it('refuses a parsed key whose segment is past 64 characters', () => {
    const tooLong = 'a'.repeat(65)

    expect(
      JudgeOverrideSchema.safeParse({
        manifest_key: `_judge/x/${tooLong}/manifest.json`,
        instruction_key: `_judge/x/${tooLong}/instruction.md`,
      }).success,
    ).toBe(false)
  })
})
