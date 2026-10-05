import { describe, expect, it } from 'vitest'
import {
  buildMergedEnv,
  findPlaceholderFeatures,
  parseEnvFile,
  serializeBuiltEnv,
  serializeEnvFile,
} from './env'

describe('parseEnvFile', () => {
  it('parses KEY=value, KEY=, and quoted values, ignoring comments/blanks', () => {
    const parsed = parseEnvFile(
      [
        '# a comment',
        '',
        'FOO=bar',
        'EMPTY=',
        'QUOTED="some value"',
        '  SPACED_KEY=trimmed  ',
        'INLINE=false # prod only',
        'QUOTED_INLINE="debug" # levels: https://x#y',
        'HASH_IN_QUOTES="a#b"',
        "SINGLE='2024'",
        "SINGLE_INLINE='a b' # comment",
      ].join('\n'),
    )
    expect(parsed).toEqual({
      FOO: 'bar',
      EMPTY: '',
      QUOTED: 'some value',
      SPACED_KEY: 'trimmed',
      INLINE: 'false',
      QUOTED_INLINE: 'debug',
      HASH_IN_QUOTES: 'a#b',
      SINGLE: '2024',
      SINGLE_INLINE: 'a b',
    })
  })
})

describe('serializeEnvFile', () => {
  it('writes one KEY=value per line in the given key order', () => {
    const out = serializeEnvFile({ B: '2', A: '1' }, ['A', 'B', 'C'])
    expect(out).toBe('A=1\nB=2\nC=\n')
  })
})

describe('serializeBuiltEnv', () => {
  it('leaves blank and missing keys out so code defaults apply', () => {
    const out = serializeBuiltEnv(
      { A: '1', TEST_SEND_COOLDOWN_MS: '', B: '0' },
      ['A', 'TEST_SEND_COOLDOWN_MS', 'B', 'C'],
    )
    expect(out).toBe('A=1\nB=0\n')
  })
})

describe('buildMergedEnv', () => {
  const keys = ['REQUIRED_SECRET', 'DATABASE_URL', 'FEATURE_KEY', 'UNKNOWN']

  it('prefers a copied value over local-only and placeholder', () => {
    const merged = buildMergedEnv(
      keys,
      { DATABASE_URL: 'postgresql://from-copied' },
      { DATABASE_URL: 'postgresql://local-default' },
      { DATABASE_URL: 'postgresql://placeholder' },
    )
    expect(merged.DATABASE_URL).toBe('postgresql://from-copied')
  })

  it('falls back to a local-only default when nothing was copied', () => {
    const merged = buildMergedEnv(
      keys,
      {},
      { DATABASE_URL: 'postgresql://local-default' },
      { DATABASE_URL: 'postgresql://placeholder' },
    )
    expect(merged.DATABASE_URL).toBe('postgresql://local-default')
  })

  it('falls back to the placeholder when neither copied nor local-only have it', () => {
    const merged = buildMergedEnv(keys, {}, {}, { FEATURE_KEY: 'some-key' })
    expect(merged.FEATURE_KEY).toBe('some-key')
  })

  it('respects an intentionally-empty copied value over a non-empty placeholder', () => {
    const merged = buildMergedEnv(
      keys,
      { FEATURE_KEY: '' },
      {},
      { FEATURE_KEY: 'some-key' },
    )
    expect(merged.FEATURE_KEY).toBe('')
  })

  it('respects an intentionally-empty local-only default over a non-empty placeholder', () => {
    const merged = buildMergedEnv(
      keys,
      {},
      { FEATURE_KEY: '' },
      { FEATURE_KEY: 'some-key' },
    )
    expect(merged.FEATURE_KEY).toBe('')
  })

  it('defaults to empty string when no layer has the key', () => {
    const merged = buildMergedEnv(keys, {}, {}, {})
    expect(merged.UNKNOWN).toBe('')
  })

  it('drops keys not present in the schema key list', () => {
    const merged = buildMergedEnv(
      ['ONLY_THIS'],
      { ONLY_THIS: 'a', EXTRA: 'b' },
      {},
      {},
    )
    expect(merged).toEqual({ ONLY_THIS: 'a' })
  })
})

describe('findPlaceholderFeatures', () => {
  const contract = {
    ANTHROPIC_API_KEY: {
      tier: 'degradable',
      feature: 'ai-chat',
      placeholder: 'your-anthropic-key',
    },
    SLACK_APP_ID: { tier: 'degradable', feature: 'slack-notifications' },
    NODE_ENV: { tier: 'optional', placeholder: 'development' },
  }

  it('names a placeholder-declared feature left at its placeholder', () => {
    expect(
      findPlaceholderFeatures(contract, {
        ANTHROPIC_API_KEY: 'your-anthropic-key',
        SLACK_APP_ID: '',
        NODE_ENV: 'development',
      }),
    ).toEqual(['ai-chat (ANTHROPIC_API_KEY)'])
  })

  it('names it when the value is empty', () => {
    expect(
      findPlaceholderFeatures(contract, { ANTHROPIC_API_KEY: '' }),
    ).toEqual(['ai-chat (ANTHROPIC_API_KEY)'])
  })

  it('returns nothing once a real value is set', () => {
    expect(
      findPlaceholderFeatures(contract, { ANTHROPIC_API_KEY: 'sk-ant-real' }),
    ).toEqual([])
  })
})
