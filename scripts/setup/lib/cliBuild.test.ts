// Runs runBuild against gp-api's real env contract and .env.example, the way
// setup.sh's build_one calls it, to pin what --refresh relies on: the vended
// bundle lands on top of an existing .env without discarding the rest of it.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runBuild } from './cli'
import { parseEnvFile } from './env'

describe('runBuild', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'setup-build-test-'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  const build = async (under?: string) => {
    const bundle = join(dir, 'device-gp-api.env')
    writeFileSync(bundle, 'BALLOT_READY_KEY=br-vended\n')
    const out = join(dir, 'gp-api.env')
    await expect(runBuild('gp-api', bundle, out, under)).rejects.toThrow(
      'process.exit(0)',
    )
    return parseEnvFile(readFileSync(out, 'utf-8'))
  }

  it('lays the bundle over an existing .env and keeps what the bundle lacks', async () => {
    const existing = join(dir, 'existing.env')
    writeFileSync(
      existing,
      'DATABASE_URL=postgres://mine\nBALLOT_READY_KEY=key\n',
    )

    const env = await build(existing)

    expect(env.BALLOT_READY_KEY).toBe('br-vended')
    expect(env.DATABASE_URL).toBe('postgres://mine')
  })

  it('falls back to placeholders for what the bundle lacks with no existing .env', async () => {
    const env = await build()

    expect(env.BALLOT_READY_KEY).toBe('br-vended')
    expect(env.DATABASE_URL).not.toBe('postgres://mine')
  })
})
