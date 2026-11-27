import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  acknowledgement,
  findDestructive,
  findProblems,
  listAddedMigrations,
  MIGRATION_DIRS,
  resolveBase,
} from './check-destructive-migrations'

const ROOT = join(__dirname, '..', '..', '..')

const MIGRATION_DIR = MIGRATION_DIRS[0]

const PRISMA_HEADER = [
  '/*',
  '  Warnings:',
  '',
  '  - You are about to drop the column `ai_content` on the `campaign` table.',
  '  - You are about to drop the `ai_chat` table.',
  '*/',
].join('\n')

const gitIn = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' })

const commitMigration = (root: string, name: string, sql: string) => {
  const dir = join(root, MIGRATION_DIR, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'migration.sql'), sql)
  gitIn(root, 'add', '--all')
  gitIn(root, 'commit', '--message', name)
}

const newRepository = (branch = 'main'): string => {
  const root = mkdtempSync(join(tmpdir(), 'destructive-migrations-'))
  gitIn(root, 'init', '--quiet', `--initial-branch=${branch}`)
  gitIn(root, 'config', 'user.email', 'test@example.com')
  gitIn(root, 'config', 'user.name', 'Test')
  commitMigration(root, '20260101000000_base', 'CREATE TABLE "campaign" ();')
  return root
}

describe('findDestructive', () => {
  it('finds a dropped column and a dropped table, by line', () => {
    const sql = [
      PRISMA_HEADER,
      '',
      'ALTER TABLE "campaign" DROP COLUMN "x";',
      'DROP TABLE "y";',
    ].join('\n')

    expect(findDestructive(sql)).toEqual([
      { kind: 'DROP COLUMN', line: 8 },
      { kind: 'DROP TABLE', line: 9 },
    ])
  })

  it('finds a rename, split over lines the way a hand-written one is', () => {
    const sql = 'ALTER TABLE "campaign"\n  RENAME COLUMN "a" TO "b";'

    expect(findDestructive(sql)).toEqual([{ kind: 'RENAME COLUMN', line: 2 }])
  })

  it('finds a renamed table', () => {
    expect(findDestructive('ALTER TABLE "x" RENAME TO "y";')).toEqual([
      { kind: 'RENAME TO', line: 1 },
    ])
  })

  it('reads statements, not the prose around them', () => {
    const sql = [
      '-- never DROP TABLE in a release that still reads it',
      '/* DROP COLUMN would break the old client */',
      'ALTER TABLE "campaign" ADD COLUMN "x" text;',
      'ALTER TABLE "campaign" ALTER COLUMN "y" SET NOT NULL;',
    ].join('\n')

    expect(findDestructive(sql)).toEqual([])
  })
})

describe('acknowledgement', () => {
  it('needs a reason, not just the marker', () => {
    expect(acknowledgement('-- expand-contract:\nDROP TABLE "y";')).toBeNull()
    expect(acknowledgement('-- expand-contract: ok\n')).toBeNull()
  })

  it('reads a reason naming the earlier release', () => {
    expect(
      acknowledgement(
        '-- expand-contract: readers removed in #3747, released 2026-11-11',
      ),
    ).toBe('readers removed in #3747, released 2026-11-11')
  })
})

describe('findProblems', () => {
  const drop = 'ALTER TABLE "campaign" DROP COLUMN "ai_content";'

  it('passes an additive migration', () => {
    expect(
      findProblems([
        {
          path: `${MIGRATION_DIR}/a/migration.sql`,
          sql: 'ALTER TABLE "c" ADD COLUMN "d" text;',
        },
      ]),
    ).toEqual([])
  })

  it('fails a destructive migration with no acknowledgement', () => {
    expect(
      findProblems([{ path: `${MIGRATION_DIR}/a/migration.sql`, sql: drop }]),
    ).toEqual([
      expect.stringContaining(`${MIGRATION_DIR}/a/migration.sql: DROP COLUMN`),
    ])
  })

  it('passes a destructive migration that says why it is safe', () => {
    expect(
      findProblems([
        {
          path: `${MIGRATION_DIR}/a/migration.sql`,
          sql: `-- expand-contract: readers removed in the 2026-11-11 release\n${drop}`,
        },
      ]),
    ).toEqual([])
  })

  it('fails the migration that caused ENG-11633', () => {
    const sql = readFileSync(
      join(
        ROOT,
        `${MIGRATION_DIR}/20261111201946_drop_ai_content_and_ai_chat/migration.sql`,
      ),
      'utf8',
    )

    expect(
      findProblems([
        {
          path: `${MIGRATION_DIR}/20261111201946_drop_ai_content_and_ai_chat/migration.sql`,
          sql,
        },
      ]),
    ).toHaveLength(1)
  })
})

describe('listAddedMigrations', () => {
  it('lists only the migrations this change adds', () => {
    const root = newRepository()
    gitIn(root, 'checkout', '--quiet', '-b', 'work')
    commitMigration(root, '20260202000000_drop', 'DROP TABLE "y";')

    expect(listAddedMigrations(root, 'main')).toEqual([
      `${MIGRATION_DIR}/20260202000000_drop/migration.sql`,
    ])
    expect(listAddedMigrations(root, 'HEAD')).toEqual([])
  })
})

describe('resolveBase', () => {
  it('takes an explicit ref', () => {
    expect(resolveBase('HEAD', ROOT)).toBe('HEAD')
  })

  it('refuses when no base resolves', () => {
    const saved = process.env.BASE_REF
    delete process.env.BASE_REF
    try {
      const root = newRepository('trunk')
      expect(() => resolveBase('no-such-ref', root)).toThrow(/--base/)
    } finally {
      if (saved !== undefined) process.env.BASE_REF = saved
    }
  })
})
