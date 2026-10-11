import { describe, expect, it } from 'vitest'
import {
  JUDGE_REPLAY_KEY_PREFIX,
  JudgeReplaySchema,
  judgeReplayBaseKey,
  judgeReplaySeedKey,
  judgeReplaySweepKey,
} from './JudgeReplay.schema'

describe('judge replay key builders', () => {
  it('builds the sweep layout', () => {
    expect(judgeReplaySweepKey('judge-123-1', 'self_research', 't2', 1)).toBe(
      '_judge/replay/sweep/judge-123-1/self_research/t2-1',
    )
  })

  it('builds the base cache layout', () => {
    expect(judgeReplayBaseKey('self_research', 'abc123', 't2', 3)).toBe(
      '_judge/replay/base/self_research/abc123/t2-3',
    )
  })

  it('builds the seed layout', () => {
    expect(judgeReplaySeedKey('race_opponent_collection', 'namesake')).toBe(
      '_judge/replay/seed/race_opponent_collection/namesake',
    )
  })

  // A crafted id must not be able to change which store a key addresses.
  it.each([
    ['a slash', 'a/b'],
    ['traversal', '..'],
    ['an absolute path', '/etc/passwd'],
    ['empty', ''],
    ['a dot', 'a.b'],
    ['over 64 characters', 'a'.repeat(65)],
  ])('refuses %s in the sweep id', (_, sweepId) => {
    expect(() =>
      judgeReplaySweepKey(sweepId, 'self_research', 't1', 1),
    ).toThrow()
  })

  it.each([
    ['a capital', 'Self_research'],
    ['a hyphen', 'self-research'],
    ['a leading digit', '1agent'],
    ['traversal', '..'],
    ['over 64 characters', `a${'b'.repeat(64)}`],
  ])('refuses %s in the agent id', (_, agentId) => {
    expect(() => judgeReplaySweepKey('s', agentId, 't1', 1)).toThrow()
    expect(() => judgeReplayBaseKey(agentId, 'd', 't1', 1)).toThrow()
    expect(() => judgeReplaySeedKey(agentId, 't1')).toThrow()
  })

  it.each([
    ['a slash', 't1/../x'],
    ['traversal', '..'],
    ['empty', ''],
    ['over 80 characters', 'a'.repeat(81)],
  ])('refuses %s in the case id', (_, caseId) => {
    expect(() => judgeReplaySweepKey('s', 'self_research', caseId, 1)).toThrow()
    expect(() => judgeReplayBaseKey('self_research', 'd', caseId, 1)).toThrow()
    expect(() => judgeReplaySeedKey('self_research', caseId)).toThrow()
  })

  it.each([
    ['a slash', 'ab/cd'],
    ['traversal', '..'],
    ['over 64 characters', 'a'.repeat(65)],
    ['empty', ''],
  ])('refuses %s in the config digest', (_, digest) => {
    expect(() => judgeReplayBaseKey('self_research', digest, 't1', 1)).toThrow()
  })

  it('accepts the longest ids the case list and digest allow', () => {
    const caseId = 'c'.repeat(80)
    const digest = 'a'.repeat(64)

    expect(judgeReplayBaseKey('self_research', digest, caseId, 99)).toBe(
      `_judge/replay/base/self_research/${digest}/${caseId}-99`,
    )
  })

  // A case id may end in a hyphen, so a negative attempt would build a key
  // that reads as a different case's attempt 1 and share its store.
  it.each([0, -1, 1.5, 100, Number.NaN])('refuses attempt %s', (attempt) => {
    expect(() =>
      judgeReplaySweepKey('s', 'self_research', 'a-', attempt),
    ).toThrow()
    expect(() =>
      judgeReplayBaseKey('self_research', 'd', 'a-', attempt),
    ).toThrow()
  })
})

describe('JudgeReplaySchema', () => {
  const sweepKey = judgeReplaySweepKey('judge-1-1', 'self_research', 't1', 1)
  const baseKey = judgeReplayBaseKey('self_research', 'abc', 't1', 1)
  const seedKey = judgeReplaySeedKey('self_research', 't1')

  it.each([
    ['record', sweepKey],
    ['replay', sweepKey],
    ['record', baseKey],
    ['replay', baseKey],
    ['replay', seedKey],
  ])('accepts %s on a built key %s', (mode, key) => {
    expect(JudgeReplaySchema.safeParse({ mode, key }).success).toBe(true)
  })

  // The bench owns the seed store; a run recording into it would mix live
  // pages into planted ones.
  it('refuses record on a seed key', () => {
    expect(
      JudgeReplaySchema.safeParse({ mode: 'record', key: seedKey }).success,
    ).toBe(false)
  })

  it('refuses an unknown mode', () => {
    expect(
      JudgeReplaySchema.safeParse({ mode: 'write', key: sweepKey }).success,
    ).toBe(false)
  })

  it('refuses an extra field', () => {
    expect(
      JudgeReplaySchema.safeParse({ mode: 'replay', key: sweepKey, x: 1 })
        .success,
    ).toBe(false)
  })

  // Starts with the prefix and escapes it anyway, which is why the shape is
  // validated whole.
  it.each([
    [
      'traversal out of the prefix',
      `${JUDGE_REPLAY_KEY_PREFIX}../manifest.json`,
    ],
    ['traversal inside a store', '_judge/replay/sweep/s/../self_research/t1-1'],
    ['an empty segment', '_judge/replay/sweep/s//self_research/t1-1'],
    ['a trailing slash', `${sweepKey}/`],
    ['an absolute path', `/${sweepKey}`],
    ['an unknown store kind', '_judge/replay/other/self_research/t1'],
    ['the override folder', '_judge/self_research/abc/manifest.json'],
    [
      'a sweep key without an attempt',
      '_judge/replay/sweep/s/self_research/t1',
    ],
    ['a seed key with an extra segment', `${seedKey}/x`],
    [
      'a sweep id over 64 characters',
      `_judge/replay/sweep/${'a'.repeat(65)}/self_research/t1-1`,
    ],
    [
      'a case id over 80 characters',
      `_judge/replay/seed/self_research/${'a'.repeat(81)}`,
    ],
    ['an attempt of 0', '_judge/replay/sweep/s/self_research/t1-0'],
    ['an attempt over 99', '_judge/replay/sweep/s/self_research/t1-100'],
    ['a leading-zero attempt', '_judge/replay/sweep/s/self_research/t1-01'],
    ['a capital in the agent id', '_judge/replay/seed/Self_research/t1'],
    [
      'a digest over 64 characters',
      `_judge/replay/base/self_research/${'a'.repeat(65)}/t1-1`,
    ],
    ['an empty digest', '_judge/replay/base/self_research//t1-1'],
  ])('refuses %s', (_, key) => {
    expect(JudgeReplaySchema.safeParse({ mode: 'replay', key }).success).toBe(
      false,
    )
  })
})
