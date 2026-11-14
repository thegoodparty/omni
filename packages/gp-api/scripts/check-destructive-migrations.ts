/**
 * CI ban: a schema-destructive migration cannot ship in the release that stops
 * reading it (ENG-11633).
 *
 * Every gp-api task runs `prisma migrate deploy` in its entrypoint, and prod's
 * ECS service keeps every old task serving until a new one is healthy. So a
 * DROP COLUMN is applied by the new revision while the previous revision's
 * generated Prisma client, which still selects that column, is still taking
 * traffic: every read of the model fails with P2022 for the length of the
 * handover.
 *
 * Fails on a migration this change adds that drops or renames a column or
 * table, unless the migration carries a `-- expand-contract: <reason>` line.
 *
 * Usage: npx tsx scripts/check-destructive-migrations.ts [--base <git-ref>]
 */
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'

export const MIGRATION_DIRS = [
  'packages/gp-api/prisma/schema/migrations',
  'packages/gp-api/prisma-election/schema/migrations',
] as const

const MIGRATION_FILE = 'migration.sql'

const DESTRUCTIVE = [
  { kind: 'DROP COLUMN', pattern: /\bDROP\s+COLUMN\b/gi },
  { kind: 'DROP TABLE', pattern: /\bDROP\s+TABLE\b/gi },
  { kind: 'RENAME COLUMN', pattern: /\bRENAME\s+COLUMN\b/gi },
  { kind: 'RENAME TO', pattern: /\bRENAME\s+TO\b/gi },
]

const ACKNOWLEDGEMENT = /^[ \t]*--[ \t]*expand-contract:[ \t]*(\S.*)$/im

const MIN_REASON_LENGTH = 10

export type Finding = { kind: string; line: number }

export type Migration = { path: string; sql: string }

export const stripComments = (sql: string): string =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ''))
    .replace(/--[^\n]*/g, '')

const lineAt = (sql: string, index: number): number =>
  sql.slice(0, index).split('\n').length

export const findDestructive = (sql: string): Finding[] => {
  const statements = stripComments(sql)
  const findings: Finding[] = []
  for (const { kind, pattern } of DESTRUCTIVE) {
    for (const match of statements.matchAll(pattern)) {
      findings.push({ kind, line: lineAt(statements, match.index) })
    }
  }
  return findings.sort((a, b) => a.line - b.line)
}

export const acknowledgement = (sql: string): string | null => {
  const reason = ACKNOWLEDGEMENT.exec(sql)?.[1]?.trim() ?? ''
  return reason.length >= MIN_REASON_LENGTH ? reason : null
}

export const findProblems = (migrations: Migration[]): string[] =>
  migrations.flatMap(({ path, sql }) => {
    const findings = findDestructive(sql)
    if (findings.length === 0 || acknowledgement(sql)) return []
    const statements = findings
      .map((finding) => `${finding.kind} line ${finding.line}`)
      .join(', ')
    return [
      `${path}: ${statements}. That drop lands while the previous release is ` +
        'still serving, and its Prisma client still selects it (#11633). ' +
        'Remove the readers one release earlier, or add ' +
        '`-- expand-contract: <why this drop is safe>`.',
    ]
  })

const git = (args: string[], cwd: string): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

export const repositoryRoot = (cwd: string): string =>
  git(['rev-parse', '--show-toplevel'], cwd)

const refExists = (ref: string, cwd: string): boolean => {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd)
    return true
  } catch {
    return false
  }
}

export const resolveBase = (requested: string | null, cwd: string): string => {
  const candidates = [requested, process.env.BASE_REF, 'origin/main', 'main']
  const base = candidates.find((ref) => ref && refExists(ref, cwd))
  if (!base) {
    throw new Error(
      'No base ref to diff against. Pass --base <git-ref> or set BASE_REF.',
    )
  }
  return base
}

export const listAddedMigrations = (root: string, base: string): string[] =>
  git(
    [
      'diff',
      '--no-renames',
      '--name-only',
      '--diff-filter=AM',
      base,
      'HEAD',
      '--',
      ...MIGRATION_DIRS,
    ],
    root,
  )
    .split('\n')
    .filter((path) => path.endsWith(`/${MIGRATION_FILE}`))

const baseArgument = (argv: string[]): string | null => {
  const index = argv.indexOf('--base')
  if (index === -1) return null
  const value = argv[index + 1]
  if (!value) throw new Error('--base needs a git ref')
  return value
}

const main = () => {
  const root = repositoryRoot(__dirname)
  const base = resolveBase(baseArgument(process.argv.slice(2)), root)
  const migrations = listAddedMigrations(root, base).map((path) => ({
    path,
    sql: readFileSync(join(root, path), 'utf8'),
  }))
  const problems = findProblems(migrations)
  if (problems.length === 0) {
    console.log(`Destructive migrations: none in ${migrations.length} added.`)
    return
  }
  for (const problem of problems) console.error(`- ${problem}`)
  process.exit(1)
}

if (require.main === module) main()
