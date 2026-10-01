import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXPLICIT_SELECTION, SELECTION_ENV } from './sweepEnv'

// The sweep's three processes each read their spend switch from their own
// workflow step, so the steps can disagree — and the first version of this
// workflow did: it set JUDGE_SPEND on both arm captures and not on the
// judging step, so a live sweep paid for two full captures and then graded
// them with the canned panel. `judgeSweep` now refuses that mismatch, but
// refusing costs a sweep to find out. This catches it from the file.
//
// A text scan rather than a YAML parse: gp-api declares no YAML library, and
// what needs checking is one shape in one file we own — which step's `env:`
// block carries which variable.

const WORKFLOW = path.resolve(
  __dirname,
  '../../../../../..',
  '.github/workflows/judge.yml',
)

// The commands that start a judge process, matched on the invocation rather
// than on the variable name: two other steps mention `$SWEEP_SUITE` and
// `$JUDGING_ENTRY` while checking they exist, and those spend nothing.
const SPENDING_COMMANDS = [
  'npx vitest run "$SWEEP_SUITE"',
  'npx tsx "$JUDGING_ENTRY"',
]

interface Step {
  name: string
  body: string
}

// A step's `env:` sits at eight spaces and its entries at ten, so an entry is
// a line at exactly that indent. Anchored rather than searched for with
// `includes`, which matched the variable's name ANYWHERE in the step body —
// so `# JUDGE_SPEND: 'true'` in a comment satisfied the very test that exists
// to catch a switch nobody set.
const ENV_ENTRY = 10

const setsEnv = (body: string, name: string): boolean =>
  new RegExp(`^ {${ENV_ENTRY}}${name}:`, 'm').test(body)

// The VALUE of a step's env entry, not just whether it is there. Two arms that
// each set a data version from a different expression would satisfy `setsEnv`
// and still read two different snapshots of the mart.
const envValue = (body: string, name: string): string | null =>
  new RegExp(`^ {${ENV_ENTRY}}${name}: (.*)$`, 'm').exec(body)?.[1] ?? null

const spendsLive = (body: string): boolean =>
  new RegExp(`^ {${ENV_ENTRY}}JUDGE_SPEND: 'true'$`, 'm').test(body)

// A step's `run: |` block, dedented so it can be executed.
//
// IT HAS TO STOP AT THE END OF THE BLOCK. A step body here runs to the next
// `- name:` entry, and `- uses:` steps carry no name — so the body of a step
// followed by one swallows it and everything after it. Taking the whole tail
// handed bash the next steps' comments and it died on a stray `-`. The block
// ends at the first line that is neither blank nor indented to the script.
const RUN_INDENT = 10

const runBlockOf = (body: string): string => {
  const after = body.split(/^ {8}run: \|\n/m)[1]
  if (after === undefined) return ''
  const lines: string[] = []
  for (const line of after.split('\n')) {
    if (line.trim() === '') {
      lines.push('')
      continue
    }
    if (!line.startsWith(' '.repeat(RUN_INDENT))) break
    lines.push(line.slice(RUN_INDENT))
  }
  return lines.join('\n')
}

// Steps are the six-space `- name:` entries; a step runs until the next one.
// Splitting on the marker keeps each step's `env:` and `run:` together, which
// is the pairing under test.
const stepsOf = (yaml: string): Step[] => {
  const parts = yaml.split(/^ {6}- name: /m).slice(1)
  return parts.map((part) => ({
    name: part.split('\n')[0]?.trim() ?? '',
    body: part,
  }))
}

describe('judge.yml spend switches', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const steps = stepsOf(yaml)

  it('finds the workflow and its steps', () => {
    // Guards the scan itself: a moved file or a changed indent would make
    // every assertion below vacuously true, which is the failure mode of a
    // test that greps.
    expect(steps.length).toBeGreaterThan(10)
    expect(steps.map((s) => s.name)).toContain('Judge both arms')
  })

  const spending = steps.filter((step) =>
    SPENDING_COMMANDS.some((command) => step.body.includes(command)),
  )

  it('finds all three spending steps', () => {
    expect(spending.map((s) => s.name)).toEqual([
      'Capture the base arm',
      'Capture the candidate arm',
      'Judge both arms',
    ])
  })

  it('sets JUDGE_SPEND on every step that starts a judge process', () => {
    const missing = spending
      .filter((step) => !setsEnv(step.body, 'JUDGE_SPEND'))
      .map((step) => step.name)
    expect(missing).toEqual([])
  })

  // THE KEY TRAVELS UNDER A DIFFERENT NAME ON EACH HALF, and the two names
  // are not interchangeable. The arms run under vitest, whose config applies
  // `.env.test` over the process environment, and `.env.test` defines
  // ANTHROPIC_API_KEY as a stub — so the real key has to arrive under a name
  // that file does not define and be moved into place by modelKey.ts. The
  // judging step is tsx, nothing loads over it, and it reads the key
  // directly. The first live sweep set ANTHROPIC_API_KEY on the arms, which
  // satisfied the previous version of this test and failed every model call
  // with `invalid x-api-key`.
  const ARM_STEPS = ['Capture the base arm', 'Capture the candidate arm']
  const arms = spending.filter((step) => ARM_STEPS.includes(step.name))

  it('passes the real key to both arms under the arm name', () => {
    expect(arms.map((s) => s.name)).toEqual(ARM_STEPS)
    const missing = arms
      .filter((step) => !setsEnv(step.body, 'JUDGE_ANTHROPIC_API_KEY'))
      .map((step) => step.name)
    expect(missing).toEqual([])
  })

  it('does not set ANTHROPIC_API_KEY on an arm, where it is dead', () => {
    const shadowed = arms
      .filter((step) => setsEnv(step.body, 'ANTHROPIC_API_KEY'))
      .map((step) => step.name)
    expect(shadowed).toEqual([])
  })

  it('passes the real key to the judging step under its own name', () => {
    const judging = spending.find((step) => step.name === 'Judge both arms')
    expect(judging).toBeDefined()
    expect(setsEnv(judging?.body ?? '', 'ANTHROPIC_API_KEY')).toBe(true)
  })

  it("spends only on the exact string 'true'", () => {
    // `spends()` in sweepEnv.ts compares against 'true' exactly, so a bare
    // `true` — which YAML would hand over as the string 'true' anyway — is
    // one editor away from `yes` or `True` reading as "do not spend".
    const wrong = spending
      .filter((step) => !spendsLive(step.body))
      .map((step) => step.name)
    expect(wrong).toEqual([])
  })

  // The matcher itself, against what an editor most plausibly leaves behind.
  // A commented-out switch is the exact shape this whole file exists to
  // catch, and the substring version could not tell it from a live one.
  it('does not read a commented-out switch as a set one', () => {
    const commented =
      '        env:\n' +
      "          # JUDGE_SPEND: 'true'\n" +
      '        run: |\n'
    expect(setsEnv(commented, 'JUDGE_SPEND')).toBe(false)
    expect(spendsLive(commented)).toBe(false)
    expect(spendsLive("          JUDGE_SPEND: 'true'\n")).toBe(true)
  })
})

// A capture step that fails after the arms have been billed must not take the
// verdict with it: `success()` is the default on a step with no `if:`, so the
// judging step would be skipped and a paid sweep would end with no report.
describe('judge.yml judges what the arms managed to capture', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const judging = stepsOf(yaml).find((step) => step.name === 'Judge both arms')

  it('runs the judging step even when a capture failed', () => {
    expect(judging?.body).toMatch(/^ {8}if: '!cancelled\(\)'$/m)
  })

  // NOT the arm captures. A base arm that failed wrote no manifest, so the
  // judging step refuses anyway — and running the candidate arm on top would
  // spend a second full arm to reach a step that cannot say anything.
  it('leaves the arm captures on the default success() guard', () => {
    const arms = stepsOf(yaml).filter((step) =>
      step.name.startsWith('Capture the '),
    )
    expect(arms).toHaveLength(2)
    for (const arm of arms) {
      expect(arm.body).not.toMatch(/^ {8}if:/m)
    }
  })
})

// THE SAME CLASS OF GUARD AS THE SPEND SWITCH. Both arms are meant to read one
// snapshot of the voter mart, which only holds if they read one value — and
// two arms that each resolved "current" themselves would resolve it an hour
// apart and get two answers. A pin the arms disagree on is worse than none,
// because each one would then report a version nothing held.
describe('judge.yml pins both arms to one voter-mart version', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const steps = stepsOf(yaml)
  const arms = steps.filter((step) => step.name.startsWith('Capture the '))
  const resolvedAt = steps.findIndex((step) =>
    step.body.includes('npx tsx "$DATA_VERSION_ENTRY" "$out"'),
  )

  it('resolves the version once, in a step of its own', () => {
    expect(resolvedAt).toBeGreaterThanOrEqual(0)
    expect(
      steps.filter((step) =>
        step.body.includes('npx tsx "$DATA_VERSION_ENTRY" "$out"'),
      ),
    ).toHaveLength(1)
  })

  it('resolves it before either arm runs', () => {
    expect(arms).toHaveLength(2)
    for (const arm of arms) {
      expect(steps.indexOf(arm)).toBeGreaterThan(resolvedAt)
    }
  })

  it('has both arms read the same step output', () => {
    const values = arms.map((arm) => envValue(arm.body, 'JUDGE_DATA_VERSION'))
    expect(values).toHaveLength(2)
    for (const value of values) {
      // A step output, which is the only shape resolved outside the arms. A
      // literal or a `vars.` reference here would mean nobody looked the
      // version up for this sweep.
      expect(value).toMatch(/^\$\{\{ steps\.\w+\.outputs\.\w+ \}\}$/)
    }
    expect(new Set(values).size).toBe(1)
  })

  it('does not let the resolver fail the sweep', () => {
    const resolver = steps[resolvedAt]
    // Guarded on the resolver's OWN exit code rather than on a pipeline's, and
    // the failure branch annotates instead of exiting: most agents never query
    // the mart, so an unpinnable table must not kill a live sweep.
    expect(resolver?.body).toContain(
      'if ! npx tsx "$DATA_VERSION_ENTRY" "$out"',
    )
    expect(resolver?.body).toContain('::warning::')
    // The file, never stdout: the Databricks driver logs to stdout on every
    // connect, so a `$(npx tsx ...)` here reads driver chatter as the version.
    expect(resolver?.body).toContain('version="$(cat "$out")"')
    expect(resolver?.body).not.toMatch(/^\s*exit 1$/m)
  })
})

// WHETHER THE SAMENESS REFUSALS ARE ARMED travels the same road the spend
// switch does, and can go wrong the same way: three processes each reading
// their own step's `env:`. A judging step left without it would refuse a
// comparison the requester asked for by name; an arm without it is harmless
// today and is one future change away from not being, so all three are pinned
// to the ONE plan-job output rather than to three expressions that agree by
// coincidence.
describe('judge.yml tells every judge process who asked', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const steps = stepsOf(yaml)
  const spending = steps.filter((step) =>
    SPENDING_COMMANDS.some((command) => step.body.includes(command)),
  )

  it('finds the three steps to check', () => {
    // Guards the scan: a moved file or a changed indent would make every
    // assertion below vacuously true.
    expect(spending).toHaveLength(3)
  })

  it('sets JUDGE_SELECTION on all three, from one expression', () => {
    const values = spending.map((step) => ({
      name: step.name,
      value: envValue(step.body, SELECTION_ENV),
    }))
    expect(values.filter((v) => v.value === null).map((v) => v.name)).toEqual(
      [],
    )
    // A job output, which is the only shape resolved where the distinction
    // exists. A literal or an `inputs.` reference here would be a second
    // derivation of it, free to disagree with the one the plan comment printed.
    for (const { value } of values) {
      expect(value).toBe('${{ needs.plan.outputs.selection }}')
    }
  })

  it('resolves it once, in the step that knows the difference', () => {
    const select = steps.find(
      (step) => step.name === 'Resolve the agent selection',
    )
    expect(select).toBeDefined()
    // Built from the parser's own constant rather than from a literal typed
    // twice: `parseSweepEnv` disarms the refusals on exactly this word, and a
    // rename on either side that did not reach the other would otherwise look
    // like a workflow that still says who asked and a judge that stopped
    // listening.
    expect(select?.body).toContain(`echo "selection=${EXPLICIT_SELECTION}"`)
    expect(select?.body).toContain('echo "selection=auto"')
    expect(select?.body).not.toMatch(
      new RegExp(`echo "selection=(?!${EXPLICIT_SELECTION}|auto)`),
    )
  })

  // The price and the guard state belong in the same comment: a reader
  // approving ~$264 of sweep should be able to see whether two arms that hash
  // alike will be judged or refused.
  it('says in the plan comment which mode the request is in', () => {
    const estimate = steps.find(
      (step) => step.name === 'Estimate the cost and case count',
    )
    expect(estimate?.body).toContain('SELECTION: ${{ steps.select.outputs')
    expect(estimate?.body).toContain(
      `if [ "$SELECTION" = "${EXPLICIT_SELECTION}" ]`,
    )
    expect(estimate?.body).toMatch(/\| selection \| named in the request/)
    expect(estimate?.body).toMatch(/\| selection \| \\`auto\\`, from the diff/)
  })
})

// THE HOSTNAME THE REPOSITORY VARIABLE HOLDS IS NOT THE ONE gp-api WANTS.
// `vars.DATABRICKS_HOST` is `https://dbc-....cloud.databricks.com`, the form
// the Python side reads; `resolveDatabricksConnection` wants a bare hostname
// and @databricks/sql prefixes the scheme itself. Passing it straight through
// produced `https://https//dbc-...` and `getaddrinfo EAI_AGAIN https`, and
// the first live sweep ran against an unpinned mart because of it. GitHub
// expressions have no `replace`, so the strip is bash in one step — which
// means the strip is code, and this is what tests it.
describe('judge.yml normalizes the Databricks host', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const steps = stepsOf(yaml)
  const normalize = steps.find(
    (step) => step.name === 'Normalize the Databricks host',
  )

  it('has the step, and it publishes to the job environment', () => {
    expect(normalize).toBeDefined()
    expect(normalize?.body).toContain(
      'echo "DATABRICKS_SERVER_HOSTNAME=$host" >> "$GITHUB_ENV"',
    )
  })

  // The point of doing it once. A step that mapped the variable itself would
  // reintroduce the scheme no matter what the normalize step did, and there
  // were three of them.
  it('leaves no step mapping the raw variable', () => {
    const raw = steps
      .filter((step) =>
        /^ {10}DATABRICKS_SERVER_HOSTNAME: \$\{\{ vars\./m.test(step.body),
      )
      .map((step) => step.name)
    expect(raw).toEqual([])
  })

  it.each([
    [
      'https://dbc-3d8ca484-79f3.cloud.databricks.com',
      'dbc-3d8ca484-79f3.cloud.databricks.com',
    ],
    ['http://dbc-1.cloud.databricks.com', 'dbc-1.cloud.databricks.com'],
    ['dbc-1.cloud.databricks.com', 'dbc-1.cloud.databricks.com'],
    ['https://dbc-1.cloud.databricks.com/', 'dbc-1.cloud.databricks.com'],
    [
      'https://dbc-1.cloud.databricks.com/sql/1.0',
      'dbc-1.cloud.databricks.com',
    ],
    ['', ''],
  ])('strips %s down to %s', (given, expected) => {
    const script = runBlockOf(normalize?.body ?? '')
    // Run the step's own bash, not a reimplementation of it in JavaScript:
    // the bug being fixed was in the shell, and a parallel implementation
    // here would pass while the workflow kept failing.
    expect(script).toContain('host="${DATABRICKS_HOST#https://}"')
    const envFile = path.join(
      mkdtempSync(path.join(tmpdir(), 'judge-host-')),
      'github-env',
    )
    writeFileSync(envFile, '')
    execFileSync('bash', ['-c', script], {
      env: {
        ...process.env,
        DATABRICKS_HOST: given,
        GITHUB_ENV: envFile,
      },
      encoding: 'utf8',
    })
    expect(readFileSync(envFile, 'utf8').trim()).toBe(
      `DATABRICKS_SERVER_HOSTNAME=${expected}`,
    )
  })
})
