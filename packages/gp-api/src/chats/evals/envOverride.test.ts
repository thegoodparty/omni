import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { overrideEnvForEvals } from './envOverride'

// Why this is tested at all: no eval has ever run in CI, because this only
// ever read a gitignored `.env`. The stub key from `.env.test` reached
// Anthropic and failed as though the key were wrong rather than absent.
describe('overrideEnvForEvals', () => {
  const KEYS = ['ANTHROPIC_API_KEY', 'JUDGE_FIXTURE_ONLY'] as const
  const saved = new Map<string, string | undefined>()

  const writeEnvFile = (contents: string): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'judge-env-'))
    const file = path.join(dir, '.env')
    writeFileSync(file, contents)
    return file
  }

  beforeEach(() => {
    for (const key of KEYS) {
      saved.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of KEYS) {
      const value = saved.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  // The CI path: the key arrives as a repo secret, and the file either does
  // not exist or holds something older.
  it('keeps a real key from the environment over the file', () => {
    const file = writeEnvFile('ANTHROPIC_API_KEY=sk-ant-from-the-file\n')
    process.env.ANTHROPIC_API_KEY = 'sk-ant-from-the-secret'

    overrideEnvForEvals(file)

    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-from-the-secret')
  })

  // The local path: vitest has already put the stub there, so the file wins.
  it('lets the file beat the .env.test stub', () => {
    const file = writeEnvFile('ANTHROPIC_API_KEY=sk-ant-from-the-file\n')
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'

    overrideEnvForEvals(file)

    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-from-the-file')
  })

  // The regression an early return would have caused: a developer with the
  // key exported loses every other credential the file carries.
  it('still loads the file when the environment already has a real key', () => {
    const file = writeEnvFile(
      'ANTHROPIC_API_KEY=sk-ant-from-the-file\nJUDGE_FIXTURE_ONLY=present\n',
    )
    process.env.ANTHROPIC_API_KEY = 'sk-ant-from-the-secret'

    overrideEnvForEvals(file)

    expect(process.env.JUDGE_FIXTURE_ONLY).toBe('present')
  })

  it('is safe when the file does not exist', () => {
    const missing = path.join(tmpdir(), 'judge-no-such-dir', '.env')
    expect(() => overrideEnvForEvals(missing)).not.toThrow()
  })
})
