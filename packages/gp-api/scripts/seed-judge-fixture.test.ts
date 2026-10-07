import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SeedReport } from '../src/chats/evals/judge/judgeFixtureSeed'
import { main } from './seed-judge-fixture'

const DEV_URL =
  'postgresql://gpuser:s3cret@gp-api-db.cluster-abc123.us-west-2.rds.' +
  'amazonaws.com:5432/gpdb'
const PROD_URL =
  'postgresql://gpuser:s3cret@gp-api-db-prod.cluster-abc123.us-west-2.rds.' +
  'amazonaws.com:5432/gpdb'

const report: SeedReport = { created: ['user x'], updated: [], unchanged: [] }

const deps = () => {
  const lines: string[] = []
  return {
    lines,
    seed: vi.fn(async () => report),
    log: (line: string) => {
      lines.push(line)
    },
  }
}

describe('seed-judge-fixture main', () => {
  it('refuses without --confirm-dev, before reading the database url', async () => {
    const d = deps()
    await expect(main([], { DATABASE_URL: DEV_URL }, d)).rejects.toThrow(
      /--confirm-dev/,
    )
    expect(d.seed).not.toHaveBeenCalled()
  })

  it('refuses without DATABASE_URL', async () => {
    const d = deps()
    await expect(main(['--confirm-dev'], {}, d)).rejects.toThrow(/DATABASE_URL/)
    expect(d.seed).not.toHaveBeenCalled()
  })

  it.each([
    [PROD_URL, /production/],
    ['postgresql://postgres:postgres@localhost:5432/gpdb', /not the dev/],
  ])('refuses %s before seeding', async (url, message) => {
    const d = deps()
    await expect(
      main(['--confirm-dev'], { DATABASE_URL: url }, d),
    ).rejects.toThrow(message)
    expect(d.seed).not.toHaveBeenCalled()
  })

  it('seeds the dev cluster, printing the host but not the password', async () => {
    const d = deps()
    expect(await main(['--confirm-dev'], { DATABASE_URL: DEV_URL }, d)).toEqual(
      report,
    )
    expect(d.seed).toHaveBeenCalledWith(DEV_URL)
    expect(d.lines[0]).toContain(
      'gp-api-db.cluster-abc123.us-west-2.rds.amazonaws.com',
    )
    expect(d.lines.join('\n')).not.toContain('s3cret')
  })

  // The README's command, run as written minus the flag: the path resolves,
  // the entry point runs, and a missing flag is a non-zero exit.
  it('exits 1 from the command line without the flag', () => {
    const result = spawnSync(
      'npx',
      ['tsx', join('scripts', 'seed-judge-fixture.ts')],
      {
        cwd: join(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: DEV_URL },
        encoding: 'utf8',
        timeout: 60_000,
      },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('--confirm-dev')
  }, 60_000)
})
