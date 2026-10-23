/**
 * E2E lanes: which Playwright tests gate a merge or a prod promotion, and
 * which run beside the gate without blocking it.
 *
 * Two things move a test out of the gate and into the quarantine lane:
 *   - an entry in e2e-tests/quarantine.json (a known-red test with a ticket,
 *     an owner and an expiry), on PRs and on the release train;
 *   - probation: on the release train only, a spec file that did not exist on
 *     main 3 days before the commit under test. New specs gate their own PR,
 *     so their author sees failures; they just don't hold prod while they
 *     meet dev for the first time.
 *
 * Both lanes are cut from ONE generated Playwright test list: the gate runs
 * with `--test-list-invert <file>`, the quarantine lane with
 * `--test-list <file>`. That pair is a test and its negation, so the lanes are
 * disjoint and together cover the whole suite by construction — no test can
 * fall out of both. `--grep` was not an option: it matches project, file,
 * describes, title and every level's tags joined by spaces, so no regex built
 * from a file and a title is exact. A test-list line is: the file (relative to
 * tests/), then the title path, `›`-separated, matched as a prefix.
 *
 * Usage (from packages/gp-webapp):
 *   npx tsx scripts/e2e-lanes.ts check
 *   npx tsx scripts/e2e-lanes.ts plan --out <file> [--probation-days 3] [--verify]
 *   npx tsx scripts/e2e-lanes.ts retries <results.json>
 */
import { execFileSync } from 'child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { z } from 'zod'

const E2E_DIR = join(__dirname, '../e2e-tests')
const TESTS_DIR = join(E2E_DIR, 'tests')
const QUARANTINE_PATH = join(E2E_DIR, 'quarantine.json')
const TITLE_SEPARATOR = ' › '
const DAY_MS = 24 * 60 * 60 * 1000
// Policy is 5 working days. The cap only stops an entry being written to
// last for months; renewing one is a new PR with a fresh `added`.
export const MAX_QUARANTINE_DAYS = 14

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().startsWith(value),
    'must be a real calendar date',
  )

const trimmed = (label: string) =>
  z
    .string()
    .min(1, `${label} is required`)
    .refine(
      (value) => value === value.trim(),
      `${label} has leading or trailing whitespace`,
    )

export const QuarantineEntrySchema = z
  .strictObject({
    spec: trimmed('spec')
      .regex(/\.spec\.ts$/, 'must name a .spec.ts file')
      .refine(
        (value) => !value.startsWith('/') && !value.startsWith('tests/'),
        'must be relative to e2e-tests/tests/ (e.g. app/polls/polls.spec.ts)',
      )
      .refine((value) => !value.includes('›'), 'must not contain ›'),
    test: trimmed('test')
      .refine(
        (value) =>
          value
            .split(TITLE_SEPARATOR)
            .every((part) => part.length > 0 && part === part.trim()),
        `must be the title path below the file, joined with "${TITLE_SEPARATOR}"`,
      )
      .optional(),
    ticket: z.union(
      [
        z.string().regex(/^ENG-\d+$/),
        z.url().startsWith('https://app.clickup.com/'),
      ],
      { error: 'must be an ENG-<n> id or an https://app.clickup.com/ URL' },
    ),
    owner: trimmed('owner'),
    reason: trimmed('reason'),
    added: isoDate,
    expires: isoDate,
  })
  .superRefine((entry, ctx) => {
    const added = Date.parse(`${entry.added}T00:00:00Z`)
    const expires = Date.parse(`${entry.expires}T00:00:00Z`)
    if (expires <= added) {
      ctx.addIssue({
        code: 'custom',
        path: ['expires'],
        message: 'must be after added',
      })
    } else if (expires - added > MAX_QUARANTINE_DAYS * DAY_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['expires'],
        message: `must be at most ${MAX_QUARANTINE_DAYS} days after added`,
      })
    }
  })

export type QuarantineEntry = z.infer<typeof QuarantineEntrySchema>

export const QuarantineSchema = z.array(QuarantineEntrySchema)

export const entryLine = (entry: Pick<QuarantineEntry, 'spec' | 'test'>) =>
  entry.test ? `${entry.spec}${TITLE_SEPARATOR}${entry.test}` : entry.spec

// Errors fail the check. Everything time-dependent (expiry) is a warning
// instead, so an entry going stale can never turn an unrelated PR red.
export const checkQuarantine = (
  raw: unknown,
  specExists: (spec: string) => boolean,
): { entries: QuarantineEntry[]; errors: string[] } => {
  const parsed = QuarantineSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      entries: [],
      errors: parsed.error.issues.map(
        (issue) => `[${issue.path.join('.')}] ${issue.message}`,
      ),
    }
  }
  const entries = parsed.data
  const errors: string[] = []
  const seen = new Set<string>()
  const wholeFiles = new Set(
    entries.filter((entry) => !entry.test).map((entry) => entry.spec),
  )
  entries.forEach((entry, index) => {
    const line = entryLine(entry)
    if (!specExists(entry.spec)) {
      errors.push(`[${index}.spec] ${entry.spec} does not exist under tests/`)
    }
    if (seen.has(line)) {
      errors.push(`[${index}] duplicate entry for ${line}`)
    }
    seen.add(line)
    if (entry.test && wholeFiles.has(entry.spec)) {
      errors.push(
        `[${index}] ${line} is already covered by a whole-file entry for ${entry.spec}`,
      )
    }
  })
  return { entries, errors }
}

export const isExpired = (entry: QuarantineEntry, today: string) =>
  entry.expires < today

export const buildTestList = (
  entries: QuarantineEntry[],
  probationSpecs: string[],
): string[] => {
  const wholeFiles = new Set([
    ...probationSpecs,
    ...entries.filter((entry) => !entry.test).map((entry) => entry.spec),
  ])
  const tests = entries
    .filter((entry) => entry.test && !wholeFiles.has(entry.spec))
    .map(entryLine)
  return [...[...wholeFiles].sort(), ...tests.sort()]
}

// A spec is new when neither its path nor its exact contents existed at the
// base commit. The contents check keeps a spec that was only moved (a
// directory reorganisation) out of probation; a move with edits still counts
// as new, which only costs it three non-blocking days.
export const findProbationSpecs = (
  headSpecs: Map<string, string>,
  baseSpecs: Map<string, string>,
): string[] => {
  const baseBlobs = new Set(baseSpecs.values())
  return [...headSpecs.entries()]
    .filter(([path, blob]) => !baseSpecs.has(path) && !baseBlobs.has(blob))
    .map(([path]) => path)
    .sort()
}

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: E2E_DIR, encoding: 'utf-8' }).trim()

const specBlobs = (rev: string): Map<string, string> => {
  const prefix = relative(git('rev-parse', '--show-toplevel'), TESTS_DIR)
  const out = git('ls-tree', '-r', '--full-tree', rev, '--', prefix)
  const specs = new Map<string, string>()
  for (const line of out.split('\n')) {
    const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line)
    const blob = match?.[1]
    const path = match?.[2]
    if (!blob || !path || !path.endsWith('.spec.ts')) continue
    specs.set(path.slice(prefix.length + 1), blob)
  }
  return specs
}

type Probation = {
  specs: { spec: string; graduates: string }[]
  note?: string
}

// The clock is the commit under test, not the runner: every job of a run,
// and any re-run of it, then sees the same lanes. A spec graduates with the
// first train whose commit is at least `days` younger than the spec's arrival.
const probationFromGit = (days: number): Probation => {
  const headTime = Number(git('show', '-s', '--format=%ct', 'HEAD')) * 1000
  const cutoff = new Date(headTime - days * DAY_MS).toISOString()
  const base = git(
    'rev-list',
    '-1',
    '--first-parent',
    `--before=${cutoff}`,
    'HEAD',
  )
  if (!base) {
    return {
      specs: [],
      note: `No commit older than ${days} days in the fetched history, so no spec is on probation. Fetch deeper history to enable it.`,
    }
  }
  const head = specBlobs('HEAD')
  const specs = findProbationSpecs(head, specBlobs(base)).map((spec) => {
    const arrived = git(
      'log',
      '--first-parent',
      '--format=%ct',
      '-1',
      `${base}..HEAD`,
      '--',
      join(TESTS_DIR, spec),
    )
    const graduates = arrived
      ? new Date(Number(arrived) * 1000 + days * DAY_MS)
          .toISOString()
          .slice(0, 16)
          .replace('T', ' ')
      : 'unknown'
    return { spec, graduates: `${graduates} UTC` }
  })
  return { specs }
}

const ResultsSchema = z.object({
  suites: z.array(z.lazy(() => SuiteSchema)).optional(),
})

type Suite = {
  title: string
  suites?: Suite[]
  specs?: {
    title: string
    tests: {
      status: string
      results: { status: string }[]
    }[]
  }[]
}

const SuiteSchema: z.ZodType<Suite> = z.object({
  title: z.string(),
  suites: z.array(z.lazy(() => SuiteSchema)).optional(),
  specs: z
    .array(
      z.object({
        title: z.string(),
        tests: z.array(
          z.object({
            status: z.string(),
            results: z.array(z.object({ status: z.string() })),
          }),
        ),
      }),
    )
    .optional(),
})

type ListedTest = { title: string; status: string; attempts: string[] }

export const listTests = (raw: unknown): ListedTest[] => {
  const results = ResultsSchema.parse(raw)
  const walk = (suite: Suite, ancestors: string[]): ListedTest[] => {
    const here = [...ancestors, suite.title]
    return [
      ...(suite.suites ?? []).flatMap((child) => walk(child, here)),
      ...(suite.specs ?? []).flatMap((spec) =>
        spec.tests.map((test) => ({
          title: [...here, spec.title].join(TITLE_SEPARATOR),
          status: test.status,
          attempts: test.results.map((result) => result.status),
        })),
      ),
    ]
  }
  return (results.suites ?? []).flatMap((suite) => walk(suite, []))
}

// Retries hide instability: a test that fails its first attempt and passes a
// later one leaves the run green, so before #3106 a median of 10 to 13 tests
// per train run did exactly that and nobody saw it.
export const renderRetries = (raw: unknown): string => {
  const flaky = listTests(raw).filter((test) => test.status === 'flaky')
  if (flaky.length === 0) {
    return '**Passed only on retry:** none\n'
  }
  const failedAttempts = flaky.reduce(
    (sum, test) => sum + test.attempts.filter((a) => a !== 'passed').length,
    0,
  )
  const lines = flaky.map((test) => {
    const passedOn = test.attempts.indexOf('passed') + 1
    const failed = test.attempts.filter((a) => a !== 'passed').length
    return `- \`${test.title}\`: failed ${failed}, passed on attempt ${passedOn}`
  })
  return [
    `**Passed only on retry (${flaky.length} tests, ${failedAttempts} failed attempts):**`,
    '',
    ...lines,
    '',
  ].join('\n')
}

const inCi = process.env.GITHUB_ACTIONS === 'true'
const QUARANTINE_FILE = 'packages/gp-webapp/e2e-tests/quarantine.json'

const warn = (message: string) => {
  console.log(
    inCi
      ? `::warning file=${QUARANTINE_FILE}::${message}`
      : `warning: ${message}`,
  )
}

const today = () => new Date().toISOString().slice(0, 10)

const loadQuarantine = () => {
  const { entries, errors } = checkQuarantine(
    JSON.parse(readFileSync(QUARANTINE_PATH, 'utf-8')),
    (spec) => existsSync(join(TESTS_DIR, spec)),
  )
  if (errors.length > 0) {
    console.error('e2e-tests/quarantine.json is malformed:\n')
    for (const error of errors) console.error(`  - ${error}`)
    process.exit(1)
  }
  for (const entry of entries.filter((e) => isExpired(e, today()))) {
    warn(
      `Quarantine for ${entryLine(entry)} expired on ${entry.expires} (${entry.ticket}, owner ${entry.owner}). Fix it and remove the entry, or renew it with a reason on the ticket.`,
    )
  }
  return entries
}

const arg = (args: string[], name: string) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

// Lists what the quarantine lane selects, so an entry whose title no longer
// matches anything (renamed test, typo) is reported instead of silently
// leaving the test in the gate. Report-only: a failure here changes nothing.
const listQuarantineLane = (testList: string): ListedTest[] | undefined => {
  try {
    const out = execFileSync(
      'npx',
      [
        'playwright',
        'test',
        `--config=${join(E2E_DIR, 'playwright.config.ts')}`,
        'tests/',
        '--list',
        '--reporter=json',
        `--test-list=${testList}`,
      ],
      {
        cwd: E2E_DIR,
        encoding: 'utf-8',
        maxBuffer: 64 * 1024 * 1024,
        env: {
          ...process.env,
          BASE_URL: process.env.BASE_URL ?? 'https://dev.goodparty.org',
          CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? 'sk_test_list_only',
        },
      },
    )
    return listTests(JSON.parse(out))
  } catch (error) {
    warn(`Could not list the quarantine lane: ${String(error).slice(0, 300)}`)
    return undefined
  }
}

const plan = (args: string[]) => {
  const out = arg(args, '--out')
  if (!out) throw new Error('plan needs --out <file>')
  const days = arg(args, '--probation-days')
  const entries = loadQuarantine()
  const probation: Probation = days
    ? probationFromGit(Number(days))
    : { specs: [] }
  if (probation.note) warn(probation.note)
  const lines = buildTestList(
    entries,
    probation.specs.map((p) => p.spec),
  )
  writeFileSync(out, lines.length ? `${lines.join('\n')}\n` : '')

  const listed =
    args.includes('--verify') && lines.length
      ? listQuarantineLane(out)
      : undefined
  const matches = (line: string) =>
    listed?.filter(
      (test) =>
        test.title === line ||
        test.title.startsWith(`${line}${TITLE_SEPARATOR}`),
    ).length
  for (const entry of entries) {
    if (matches(entryLine(entry)) === 0) {
      warn(
        `Quarantine entry ${entryLine(entry)} matches no test, so nothing is quarantined for it. Copy the title path from the E2E summary.`,
      )
    }
  }

  const summary = [
    '## E2E lanes',
    '',
    lines.length === 0
      ? 'Every test gates. Nothing is quarantined or on probation.'
      : `${listed ? `${listed.length} tests` : 'These tests'} run in **E2E quarantine**, which reports but never blocks. Every other test gates.`,
    '',
  ]
  if (entries.length > 0) {
    summary.push(
      '| Quarantined | Ticket | Owner | Expires | Tests |',
      '|---|---|---|---|---|',
      ...entries.map((entry) => {
        const expired = isExpired(entry, today()) ? ' ⚠️ expired' : ''
        const count = matches(entryLine(entry))
        return `| \`${entryLine(entry)}\` | ${entry.ticket} | ${entry.owner} | ${entry.expires}${expired} | ${count ?? '?'} |`
      }),
      '',
    )
  }
  if (probation.specs.length > 0) {
    summary.push(
      '| On probation (new spec) | Gates from |',
      '|---|---|',
      ...probation.specs.map((p) => `| \`${p.spec}\` | ${p.graduates} |`),
      '',
    )
  }
  if (probation.note) summary.push(`_${probation.note}_`, '')
  console.log(summary.join('\n'))

  const outputFile = process.env.GITHUB_OUTPUT
  if (outputFile) {
    appendFileSync(
      outputFile,
      [
        `quarantine=${lines.length > 0}`,
        `entries=${entries.length}`,
        `expired=${entries.filter((e) => isExpired(e, today())).length}`,
        `probation=${probation.specs.length}`,
        'test-list<<E2E_TEST_LIST',
        ...lines,
        'E2E_TEST_LIST',
        '',
      ].join('\n'),
    )
  }
  const summaryFile = process.env.GITHUB_STEP_SUMMARY
  if (summaryFile) appendFileSync(summaryFile, `${summary.join('\n')}\n`)
}

const main = () => {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'check') {
    const entries = loadQuarantine()
    console.log(
      `e2e-tests/quarantine.json is valid (${entries.length} entries).`,
    )
  } else if (command === 'plan') {
    plan(args)
  } else if (command === 'retries' && args[0]) {
    process.stdout.write(
      renderRetries(JSON.parse(readFileSync(args[0], 'utf-8'))),
    )
  } else {
    console.error(
      'Usage: e2e-lanes.ts check | plan --out <file> [--probation-days <n>] [--verify] | retries <results.json>',
    )
    process.exit(2)
  }
}

if (require.main === module) {
  main()
}
