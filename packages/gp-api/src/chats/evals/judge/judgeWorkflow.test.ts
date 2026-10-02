import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ARM_BUDGET_MS } from './runners/backgroundDispatch'
import { budgetOutputLines } from './armBudget'
import { JUDGE_FIXTURE_ENV_NAMES } from './caseParams'
import { fixtureOutputLines } from './judgeFixture'
import { ARM_KEY_ENV, KEY_ENV, restoreRealModelKey } from './modelKey'
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
  //
  // DERIVED FROM THE COMMAND, not from a list of step names. A fourth step
  // running the arm suite under a name nobody added to an allowlist would
  // otherwise be filtered out of every assertion below, and the only test to
  // complain would be the step-name one — which a developer clears by adding
  // the name, never noticing that the key checks skipped it.
  const [ARM_COMMAND, JUDGING_COMMAND] = SPENDING_COMMANDS
  const arms = spending.filter((step) => step.body.includes(ARM_COMMAND ?? ''))
  const judging = spending.filter((step) =>
    step.body.includes(JUDGING_COMMAND ?? ''),
  )

  // The value, not only the name. `${{ secrets.ANTHROPIC_API_KEY_OLD }}` and
  // `${{ vars.ANTHROPIC_API_KEY }}` both satisfy a name-only check, and the
  // preflight step reads the correct secret itself — so a wrong expression
  // here is only discovered after both arms have been billed.
  const SECRET = '${{ secrets.ANTHROPIC_API_KEY }}'

  it('passes the real key to both arms under the arm name', () => {
    expect(arms).toHaveLength(2)
    expect(arms.map((step) => envValue(step.body, ARM_KEY_ENV))).toEqual([
      SECRET,
      SECRET,
    ])
  })

  it('does not set ANTHROPIC_API_KEY on an arm, where it is dead', () => {
    // Asserted first, because an absence cannot fail by the subject being
    // empty: `arms` filtered down to nothing would satisfy the rest for free.
    expect(arms).toHaveLength(2)
    const shadowed = arms
      .filter((step) => setsEnv(step.body, KEY_ENV))
      .map((step) => step.name)
    expect(shadowed).toEqual([])
  })

  it('passes the real key to the judging step under its own name', () => {
    expect(judging).toHaveLength(1)
    expect(envValue(judging[0]?.body ?? '', KEY_ENV)).toBe(SECRET)
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

  const HOST = 'dbc-3d8ca484-79f3.cloud.databricks.com'

  it.each([
    [`https://${HOST}`, HOST],
    [`http://${HOST}`, HOST],
    [HOST, HOST],
    [`https://${HOST}/`, HOST],
    [`https://${HOST}/sql/1.0/warehouses/18583d8b`, HOST],
    ['', ''],
    // EVERYTHING BELOW SURVIVES THE STRIPS AND IS NON-EMPTY, so a step that
    // only asked "did we get something" would pass each one through and
    // reproduce the getaddrinfo failure. They have to come out empty, which
    // is what routes them into the warning instead of into the job.
    [`HTTPS://${HOST}`, ''],
    [` https://${HOST}`, ''],
    [`https://user:pw@${HOST}`, ''],
    // The one that is not merely a wrong host: $GITHUB_ENV is line-oriented
    // and `%%/*` does not strip a newline, so this would otherwise inject
    // INJECTED=1 into every later step of the job.
    [`https://${HOST}\nINJECTED=1`, ''],
  ])('strips %j down to %j', (given, expected) => {
    const script = runBlockOf(normalize?.body ?? '')
    // Run the step's own bash, not a reimplementation of it in JavaScript:
    // the bug being fixed was in the shell, and a parallel implementation
    // here would pass while the workflow kept failing.
    // Guards the extraction without pinning the script's text: a quoted
    // line reds out on every edit to the step, which is a trip-wire rather
    // than a test. These three say "this is the real block" and survive a
    // rewrite of what is inside it. A `run: |-` would yield '' and fail here
    // loudly rather than passing vacuously.
    expect(script).not.toBe('')
    expect(script.split('\n')[0]).toBe('set -euo pipefail')
    expect(script).toContain('>> "$GITHUB_ENV"')
    const envFile = path.join(
      mkdtempSync(path.join(tmpdir(), 'judge-host-')),
      'github-env',
    )
    writeFileSync(envFile, '')
    const stdout = execFileSync('bash', ['-c', script], {
      env: {
        ...process.env,
        DATABRICKS_HOST: given,
        GITHUB_ENV: envFile,
      },
      encoding: 'utf8',
    })
    // The WHOLE file, not a substring: this is what catches the newline
    // case, where a second line would otherwise inject a variable into every
    // later step of the job.
    expect(readFileSync(envFile, 'utf8').trim()).toBe(
      `DATABRICKS_SERVER_HOSTNAME=${expected}`,
    )
    // AND SOMEBODY IS TOLD. The `case` filter above sends every malformed
    // host into the empty branch, so without this the tests would prove the
    // value came out empty and nothing would prove the sweep says it ran
    // against an unpinned mart.
    expect(stdout.includes('::warning::')).toBe(expected === '')
  })
})

// THE BASE ARM RUNS THE BASE REF'S CODE, not this branch's. The workflow is
// resolved from the default branch, so it exports the arm key name to both
// arms — but only a suite that calls `restoreRealModelKey` moves that into
// the name the SDK reads, and `.env.test`'s stub shadows the direct name on
// the base side exactly as it does on the candidate side. A ref predating the
// handoff therefore authenticates with the stub and fails every turn, after
// the OTHER arm has been billed in full. Both sides are refused before any
// install; these tests are what keep the sentinel the workflow greps for and
// the call the suite actually makes from drifting apart.
describe('judge.yml refuses a ref that cannot reach the model', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const steps = stepsOf(yaml)
  // Workflow-level `env:` sits at two spaces, not the ten a step's entry
  // does, so this needs its own matcher rather than `envValue`.
  const sentinel = /^ {2}ARM_KEY_CALL: (.+)$/m.exec(yaml)?.[1]

  it('declares the sentinel at the workflow level', () => {
    // Not inside a job: the plan job and the sweep job both read it, and a
    // job-scoped value would be invisible to one of them.
    expect(sentinel).toBeDefined()
  })

  // DERIVED FROM THE FUNCTION, not merely compared against the suite's text.
  // "Does the suite contain the sentinel" is satisfied by any substring the
  // file happens to carry — `import`, `const`, a brace — and a sentinel that
  // loose makes the guard pass for every ref forever, which is the whole
  // failure mode it exists to prevent. Reading the name off the function also
  // means a rename breaks in one place.
  it('greps for the call the arm suite makes, spelled exactly', () => {
    expect(sentinel).toBe(`${restoreRealModelKey.name}()`)
    const suite = readFileSync(
      path.resolve(__dirname, 'sweep.eval.test.ts'),
      'utf8',
    )
    expect(suite).toContain(sentinel)
  })

  it('checks the base ref in the step that creates its worktree', () => {
    const base = steps.find((step) =>
      step.name.startsWith('Check out the base arm'),
    )
    expect(base).toBeDefined()
    // Both halves: the sentinel is useless without the read, and the read is
    // useless without the grep.
    expect(base?.body).toContain('grep -qF "$ARM_KEY_CALL"')
    expect(base?.body).toContain(
      'git cat-file -p "origin/$BASE_REF:$WORKSPACE/$SWEEP_SUITE"',
    )
    expect(base?.body).toMatch(/::error::.*does not call \$ARM_KEY_CALL/)
  })

  // THE CANDIDATE SIDE, which is the expensive direction: the base arm runs
  // first, so a head that predates the handoff means a fully paid base arm
  // and then a candidate that fails every turn. Refused in the plan job,
  // before the comment promises a sweep.
  it('checks the candidate ref before the plan promises a sweep', () => {
    const cli = steps.find((step) =>
      step.name.startsWith('Check the judge CLI'),
    )
    expect(cli?.body).toContain('grep -qF "$ARM_KEY_CALL" "$SWEEP_SUITE"')
    expect(cli?.body).toContain('sweep_capable=false')
  })

  // BEFORE THE MONEY. A guard that runs after an arm has dialled is worth
  // nothing, and step order inside a job is the only thing deciding that.
  it('refuses before either arm spends', () => {
    const names = steps.map((step) => step.name)
    const guard = names.findIndex((name) =>
      name.startsWith('Check out the base arm'),
    )
    const firstSpend = names.findIndex((name) => name.startsWith('Capture the'))
    expect(guard).toBeGreaterThan(-1)
    expect(firstSpend).toBeGreaterThan(guard)
  })
})

// A BACKGROUND DISPATCH NEEDS A DESTINATION, and getting there takes two
// steps that have to happen in order and before either arm runs. Both of them
// fail quietly by design — the credential exchange is continue-on-error and
// the queue lookup warns — so a dropped line here does not go red in CI. It
// shows up as every background agent refused by name, one step after the
// workspace build and possibly after the other arm has been billed.
describe('judge.yml tells both arms where a background run goes', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const steps = stepsOf(yaml)
  const arms = steps.filter((step) =>
    step.body.includes('npx vitest run "$SWEEP_SUITE"'),
  )
  const resolver = steps.find((step) =>
    step.name.startsWith('Resolve where a background dispatch goes'),
  )

  const DESTINATION = [
    'JUDGE_METADATA_BUCKET',
    'JUDGE_ARTIFACT_BUCKET',
    'JUDGE_DISPATCH_QUEUE_URL',
  ]

  // A $GITHUB_ENV write, which `setsEnv` cannot see: that matcher looks for a
  // `NAME:` entry under a step's own `env:` block, and these are exported by
  // an earlier step instead.
  //
  // Anchored on `echo "` immediately followed by the name, and on the
  // redirect, so a comment cannot satisfy it and neither can a line that
  // merely contains the name inside some other string — a `::warning::`
  // mentioning a variable, or a `NAME_OLD=` prefix collision.
  //
  // WHAT IT STILL CANNOT SEE: that the line RUNS. The queue URL is exported
  // inside the success branch of an `if url="$(aws sqs get-queue-url …)"`,
  // so a line moved into the `else` branch satisfies every assertion here.
  const exportsVar = (body: string, name: string): boolean =>
    new RegExp(`^\\s*echo "${name}=.*>> "\\$GITHUB_ENV"`, 'm').test(body)

  it('finds both arm steps and the resolver', () => {
    expect(arms).toHaveLength(2)
    expect(resolver).toBeDefined()
  })

  it.each(DESTINATION)('exports %s to the job environment', (name) => {
    expect(exportsVar(resolver?.body ?? '', name)).toBe(true)
  })

  // ONE resolver for both arms, which is how they are guaranteed the same
  // destination. The data version is kept in step by the same argument — two
  // arms that each resolved their own would compare two different worlds —
  // but here it is structural rather than asserted value-by-value: there is
  // one step, so there is one value.
  it('resolves the destination once, not per arm', () => {
    const resolvers = steps.filter((step) =>
      DESTINATION.every((name) => exportsVar(step.body, name)),
    )
    expect(resolvers).toHaveLength(1)
    for (const arm of arms) {
      for (const name of DESTINATION) {
        expect(setsEnv(arm.body, name)).toBe(false)
      }
    }
  })

  // Derived, not hardcoded. A literal bucket name here would be a second
  // place the environment is written down, and the one that silently stopped
  // matching. What is asserted is that both come off the same variable the
  // step sets once.
  it('names one environment and derives every destination from it', () => {
    expect(resolver?.body).toMatch(/^ {10}JUDGE_ENVIRONMENT: dev$/m)
    for (const name of DESTINATION) {
      const line = new RegExp(`echo "${name}=([^"]*)"`).exec(
        resolver?.body ?? '',
      )?.[1]
      expect(line, `${name} is not exported`).toBeDefined()
    }
    expect(resolver?.body).toContain(
      'agent-experiment-metadata-$JUDGE_ENVIRONMENT',
    )
    expect(resolver?.body).toContain('gp-agent-artifacts-$JUDGE_ENVIRONMENT')
    expect(resolver?.body).toContain('agent-dispatch-$JUDGE_ENVIRONMENT.fifo')
  })

  // BOTH ORDERINGS MATTER AND NEITHER IS ENFORCED BY ANYTHING ELSE. The
  // credential exchange has to precede the queue lookup, which uses it, and
  // the lookup has to precede both arms, which read what it exported. A step
  // reordering is the kind of edit that looks harmless in a diff.
  it('gets credentials, then resolves, then runs the arms', () => {
    const names = steps.map((step) => step.name)
    const credentials = names.findIndex((name) =>
      name.startsWith('Get credentials for staging'),
    )
    const resolved = names.findIndex((name) =>
      name.startsWith('Resolve where a background dispatch goes'),
    )
    const firstArm = names.findIndex((name) => name.startsWith('Capture the'))
    expect(credentials).toBeGreaterThan(-1)
    expect(resolved).toBeGreaterThan(credentials)
    expect(firstArm).toBeGreaterThan(resolved)
  })
})

// THE ROLE IS THE WHOLE BLAST RADIUS. This job stages an agent config and
// sends a dispatch that starts a Fargate run, so what it may do is decided
// entirely by which role it assumes — and the convenient wrong answer, the
// admin deploy role every other workflow in this repo uses, is one word away.
describe('judge.yml assumes a role scoped to the judge', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const credentials = stepsOf(yaml).find((step) =>
    step.name.startsWith('Get credentials for staging'),
  )

  it('exchanges the OIDC token for credentials at all', () => {
    expect(credentials?.body).toContain(
      'uses: aws-actions/configure-aws-credentials@v5',
    )
  })

  it('assumes the judge role and not the admin deploy role', () => {
    expect(credentials?.body).toContain(
      'role-to-assume: arn:aws:iam::333022194791:role/github-actions-judge-sweep',
    )
    expect(credentials?.body).not.toContain('AWS_ROLE_ARN')
    expect(credentials?.body).not.toContain('pulumi-deploy')
  })

  // A chat-only sweep touches no AWS. Failing the job on a role that is not
  // deployed yet would mean one missing IAM grant stops every sweep of every
  // shape, rather than the background ones that actually need it.
  it('does not fail a chat-only sweep when the role is unavailable', () => {
    expect(credentials?.body).toContain('continue-on-error: true')
  })

  // THE SESSION HAS TO OUTLAST THE JOB. A background case polls S3 until a
  // Fargate artifact lands, and the agents declare timeouts up to an hour
  // each. At the action's one-hour default the credentials expire mid-poll —
  // after the dispatch, so the task keeps billing while the poll dies on an
  // auth error recorded as an infraError: paid for, then excluded.
  //
  // THE SWEEP JOB'S TIMEOUT, not the first one in the file. Written as a bare
  // search for `timeout-minutes` this read the PLAN job's 20 minutes, so a
  // one-hour session cleared a 20-minute bar and the assertion passed on
  // exactly the bug it was written for. The sweep job is the one holding
  // these credentials.
  it('holds credentials longer than the job that uses them can run', () => {
    const sweepJob = yaml.slice(yaml.indexOf('\n  sweep:'))
    const jobMinutes = Number(
      /timeout-minutes: (\d+)/.exec(sweepJob)?.[1] ?? '0',
    )
    expect(jobMinutes).toBeGreaterThan(0)
    const seconds = Number(
      /role-duration-seconds: (\d+)/.exec(credentials?.body ?? '')?.[1],
    )
    expect(seconds).toBeGreaterThan(jobMinutes * 60)
  })

  // The permission without the exchange is the state this replaced: a token
  // minted and nothing that accepts it.
  it('holds the permission that makes the exchange possible', () => {
    expect(yaml).toContain('id-token: write')
  })
})

// ONE BACKGROUND BUDGET, AND ONE ADMITTED LIST, FOR BOTH ARMS. The base arm
// reads the base ref's config.ts and manifests, so a budget or an admission
// each arm decided for itself would differ whenever a branch changed either.
// The workflow decides once instead, and these pin the plumbing exactly:
// every way it can go wrong here leaves both arms quietly walking their own.
describe('judge.yml hands both arms one background budget', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const steps = stepsOf(yaml)
  const names = steps.map((step) => step.name)
  const resolver = steps.find((step) =>
    step.name.startsWith('Resolve the background case and attempt budget'),
  )
  const arms = steps.filter((step) => step.name.startsWith('Capture the '))

  // The resolver's OWN output keys, read off the function that writes them —
  // not restated here, where a rename in one place would leave the two
  // agreeing with each other and with nothing else.
  const OUTPUT_KEYS = budgetOutputLines()
    .trim()
    .split('\n')
    .map((line) => line.split('=')[0])
  const ENV_FOR: Record<string, string> = {
    attempts: 'JUDGE_BACKGROUND_ATTEMPTS',
    max_cases: 'JUDGE_BACKGROUND_MAX_CASES',
    admitted: 'JUDGE_BACKGROUND_ADMITTED',
    refused: 'JUDGE_BACKGROUND_REFUSED',
    arm_budget_ms: 'JUDGE_ARM_BUDGET_MS',
  }

  it('covers every output the resolver writes', () => {
    expect([...OUTPUT_KEYS].sort()).toEqual(Object.keys(ENV_FOR).sort())
  })

  // EXACT, because GitHub resolves an unknown output to '' and '' reads as
  // "no cap" and "none admitted". A misspelled output name on both arms used
  // to pass: the two agreed with each other and both silently walked the
  // full list. Each arm must read exactly the key the resolver writes.
  it.each(Object.entries(ENV_FOR))(
    'gives both arms %s as %s, from the resolver',
    (key, name) => {
      expect(arms).toHaveLength(2)
      for (const arm of arms) {
        expect(envValue(arm.body, name)).toBe(
          `\${{ steps.budget.outputs.${key} }}`,
        )
      }
    },
  )

  // EXACTLY THIS SCRIPT. `toContain` accepted `npx tsx … || true`, which
  // swallows a failure and leaves every output blank — and blank reads as
  // "no budget resolved", which drops both arms back onto their own config.
  it('runs the resolver and nothing that could swallow its failure', () => {
    // Trimmed only because runBlockOf keeps the blank lines that trail a
    // block; `|| true`, a second command or a dropped `set -e` all still
    // change what is compared.
    expect(runBlockOf(resolver?.body ?? '').trim()).toBe(
      'set -euo pipefail\nnpx tsx "$BUDGET_ENTRY" "$GITHUB_OUTPUT"',
    )
    expect(resolver?.body).not.toContain('continue-on-error')
    // Nor skipped. An `if:` that skipped it leaves every output blank, and a
    // blank attempts count reads as "nothing resolved" — so both arms would
    // quietly go back to deciding for themselves.
    expect(resolver?.body).not.toMatch(/^ {8}if:/m)
    expect(yaml).toContain('BUDGET_ENTRY: src/chats/evals/judge/armBudget.ts')
  })

  // The working directory is what makes it read the CANDIDATE: it runs this
  // checkout's armBudget.ts. The two env values are what make it read the
  // BASE and the same selection the arms walk.
  it('reads the candidate checkout, the base worktree and the selection', () => {
    expect(resolver?.body).toMatch(
      /^ {8}working-directory: \$\{\{ env\.WORKSPACE \}\}$/m,
    )
    expect(envValue(resolver?.body ?? '', 'BASE_DIR')).toBe(
      '${{ steps.base.outputs.dir }}',
    )
    // The resolver AND both arms, each pinned to the one source. Compared to
    // each other, two wrong values agreed; and the candidate arm's was never
    // checked at all, so it could select something the resolver never saw.
    for (const step of [resolver, ...arms]) {
      expect(envValue(step?.body ?? '', 'JUDGE_AGENTS')).toBe(
        '${{ needs.plan.outputs.agents }}',
      )
    }
  })

  // After the base worktree exists, because it reads it; before either arm,
  // because nothing may have been spent when it decides.
  it('runs between the base checkout and the first capture', () => {
    const resolved = names.findIndex((name) =>
      name.startsWith('Resolve the background case and attempt budget'),
    )
    const baseCheckout = names.findIndex((name) =>
      name.startsWith('Check out the base arm'),
    )
    const firstCapture = names.findIndex((name) =>
      name.startsWith('Capture the '),
    )
    expect(baseCheckout).toBeGreaterThan(-1)
    expect(resolved).toBeGreaterThan(baseCheckout)
    expect(firstCapture).toBeGreaterThan(resolved)
  })
})

// THE ARM BUDGET HAS TO FIT TWICE IN THE JOB. Both arms run one after the
// other inside the one sweep job, then the judging step. If two arm budgets
// exceed the job's timeout, an arm that is inside its own budget is still
// killed by GitHub — with no manifest written, so judging fails on a missing
// arm. The budget is a constant in TypeScript and the timeout is a number in
// YAML, and nothing else connects them.
describe('the arm budget fits the sweep job', () => {
  it('leaves room for both arms and the judging step', () => {
    const yaml = readFileSync(WORKFLOW, 'utf8')
    const sweepJob = yaml.slice(yaml.indexOf('\n  sweep:'))
    const jobMinutes = Number(
      /timeout-minutes: (\d+)/.exec(sweepJob)?.[1] ?? '0',
    )
    expect(jobMinutes).toBeGreaterThan(0)
    // Twenty minutes for the workspace build and the judging step.
    expect(2 * (ARM_BUDGET_MS / 60_000) + 20).toBeLessThanOrEqual(jobMinutes)
  })
})

// THE TEST ORGANIZATION CROSSES THE SAME SEAM AS THE BUDGET, minted once and
// read by two arms in two worktrees. And minting takes a secret whose token
// opens every admin route on dev, so WHERE it runs is pinned as tightly as
// what it writes: on its own runner, from main's code, never on a runner the
// branch's code has touched.
describe('judge.yml mints one test organization for both arms', () => {
  const WORKFLOWS = path.dirname(WORKFLOW)
  const yaml = readFileSync(WORKFLOW, 'utf8')

  // A job runs from its two-space key to the next one. Jobs are the only
  // two-space keys after `jobs:`.
  const jobsText = yaml.slice(yaml.indexOf('\njobs:\n'))
  const jobs = new Map(
    jobsText
      .split(/^(?= {2}[a-z][a-z-]*:$)/m)
      .slice(1)
      .map((text) => [text.split(':')[0]?.trim() ?? '', text] as const),
  )
  const job = (name: string): string => jobs.get(name) ?? ''
  const arms = stepsOf(job('sweep')).filter((step) =>
    step.name.startsWith('Capture the '),
  )
  const FIXTURE_JOBS = ['fixture', 'fixture-cleanup']

  // Read off the function that writes them, as the budget's are. user_id is
  // the cleanup job's and must not reach an arm.
  const OUTPUT_KEYS = fixtureOutputLines({
    identifiers: { orgSlug: 'o', raceId: 'r', userEmail: 'e' },
    userId: 1,
  })
    .trim()
    .split('\n')
    .map((line) => line.split('=')[0] ?? '')
  const ENV_FOR: Record<string, string> = {
    org_slug: JUDGE_FIXTURE_ENV_NAMES.orgSlug,
    race_id: JUDGE_FIXTURE_ENV_NAMES.raceId,
    user_email: JUDGE_FIXTURE_ENV_NAMES.userEmail,
  }

  it('finds the jobs it is about', () => {
    for (const name of ['plan', 'sweep', ...FIXTURE_JOBS]) {
      expect(job(name)).not.toBe('')
    }
  })

  it('covers every identifier the mint writes', () => {
    expect([...OUTPUT_KEYS].sort()).toEqual(
      [...Object.keys(ENV_FOR), 'user_id'].sort(),
    )
  })

  // Job outputs are declared, unlike step outputs: one left off here is ''
  // downstream with no error anywhere.
  it.each(OUTPUT_KEYS)('publishes %s from the mint step', (key) => {
    expect(job('fixture')).toMatch(
      new RegExp(
        `^ {6}${key}: \\$\\{\\{ steps\\.mint\\.outputs\\.${key} \\}\\}$`,
        'm',
      ),
    )
  })

  // EXACT, for the reason the budget's are: an unknown output resolves to '',
  // which reads as "not minted", so a misspelling on both arms would agree
  // with itself and refuse every background agent for no visible reason.
  it.each(Object.entries(ENV_FOR))(
    'gives both arms %s as %s, from the fixture job',
    (key, name) => {
      expect(arms).toHaveLength(2)
      for (const arm of arms) {
        expect(envValue(arm.body, name)).toBe(
          `\${{ needs.fixture.outputs.${key} }}`,
        )
      }
    },
  )

  it('keeps the user id away from the arms', () => {
    for (const arm of arms) {
      expect(arm.body).not.toContain('outputs.user_id')
    }
  })

  // THE TRUST BOUNDARY. The secret is in the two fixture jobs and in no other
  // job, no workflow-level env and no caller: every other job runs, or runs
  // after, the branch's own code.
  it('reads the machine secret in the two fixture jobs and nowhere else', () => {
    const holders = [...jobs]
      .filter(([, text]) => text.includes('JUDGE_CLERK_MACHINE_SECRET'))
      .map(([name]) => name)
    expect(holders.sort()).toEqual([...FIXTURE_JOBS].sort())
    const beforeJobs = yaml.slice(0, yaml.indexOf('\njobs:\n'))
    expect(beforeJobs).not.toContain('JUDGE_CLERK_MACHINE_SECRET')
  })

  // An environment secret, not a repository one passed through workflow_call:
  // a caller that can pass it can be a branch's own edited copy.
  it.each(['judge-request.yml', 'judge-comment.yml'])(
    '%s does not pass the machine secret',
    (caller) => {
      expect(readFileSync(path.join(WORKFLOWS, caller), 'utf8')).not.toContain(
        'JUDGE_CLERK_MACHINE_SECRET',
      )
    },
  )

  // Each fixture job checks out main, installs, runs the one entry, and
  // nothing else: no candidate ref, no AWS role, no other command.
  it.each(FIXTURE_JOBS)('runs %s from main and nothing else', (name) => {
    const text = job(name)
    expect(text).toMatch(/^ {4}environment: judge-fixture$/m)
    expect(text).toMatch(/^ {10}ref: main$/m)
    expect(text.match(/uses: actions\/checkout@/g)).toHaveLength(1)
    expect(text).not.toMatch(/candidate_sha|steps\.base|id-token/)
    expect(text).toMatch(/^ {4}permissions:\n {6}contents: read\n {4}\S/m)
    const runs = [
      ...text.matchAll(/^ {8}run: \|\n([\s\S]*?)(?=^ {0,8}\S|$(?![\s\S]))/gm),
    ]
    // Two scripts: the install, and the entry. The install exactly, so
    // nothing else can be slipped in front of the secret.
    expect(runs).toHaveLength(2)
    expect(runs[0]?.[1]?.trimEnd()).toBe(
      '          set -euo pipefail\n' +
        '          npm ci --no-audit --no-fund\n' +
        '          npm run build -w packages/contracts',
    )
    expect(runs[1]?.[1]).toMatch(/npx tsx "\$FIXTURE_ENTRY" (mint|delete) /)
    // NOTHING RESTORED. A cache the branch's code can write in main's scope
    // would hand this job a tampered tsx; the shared setup action restores
    // one, and setup-node turns its own on for a declared package manager.
    expect(text).not.toMatch(/uses: \S*(setup-node-workspace|actions\/cache)/)
    expect(text).toMatch(/^ {10}package-manager-cache: false$/m)
    expect(text.match(/uses: /g)).toHaveLength(2)
    const entry = stepsOf(text).at(-1)?.body ?? ''
    expect(envValue(entry, 'JUDGE_FIXTURE_API_URL')).toBe(
      'https://gp-api-dev.goodparty.org',
    )
    // From the repo root, `src/chats/...` resolves to nothing and every mint
    // fails in a way that looks like a missing secret.
    expect(entry).toMatch(
      /^ {8}working-directory: \$\{\{ env\.WORKSPACE \}\}$/m,
    )
    // Nothing it does may outlive the step.
    expect(text).not.toContain('GITHUB_ENV')
  })

  // THE PREMISE THE ENVIRONMENT RESTS ON. No caller runs on a pull request
  // event, whose workflow files come from the PR's own branch; the two that
  // exist run from main (`issue_comment`) or from the ref a person dispatched,
  // which the environment's main-only branch rule refuses. A pull request
  // trigger added later would need its own answer for the fixture jobs.
  it.each(['judge-request.yml', 'judge-comment.yml'])(
    '%s has no pull request trigger',
    (caller) => {
      const text = readFileSync(path.join(WORKFLOWS, caller), 'utf8')
      expect(text).toMatch(/^on:$/m)
      expect(text).not.toMatch(/^ {2}pull_request(_target)?:/m)
    },
  )

  it('never hands every secret to anything', () => {
    expect(yaml).not.toMatch(/toJSON\(\s*secrets\s*\)/)
  })

  // The job outputs read `steps.mint`, so the step has to BE `mint`. Renamed,
  // every output is '' and the arms refuse every background agent silently.
  it('names the mint step what the job outputs read', () => {
    const mint = stepsOf(job('fixture')).find(
      (step) => step.name === 'Mint the test organization',
    )
    expect(mint?.body).toMatch(/^ {8}id: mint$/m)
  })

  it('points the entry at the file that exists', () => {
    // Anchored: a commented-out line contains the same text.
    expect(yaml).toMatch(
      /^ {2}FIXTURE_ENTRY: src\/chats\/evals\/judge\/judgeFixture\.ts$/m,
    )
  })

  // Live only, and alongside the plan rather than after it.
  it('mints on a live run, without waiting for the plan', () => {
    expect(job('fixture')).toMatch(/^ {4}if: inputs\.live == true$/m)
    expect(job('fixture')).not.toMatch(/^ {4}needs:/m)
  })

  // The sweep needs the fixture job's OUTPUTS and must not need its success:
  // a failed mint still leaves the chat agents worth judging.
  it('waits for the fixture without depending on it succeeding', () => {
    const sweep = job('sweep')
    expect(sweep).toMatch(/^ {4}needs: \[plan, fixture\]$/m)
    expect(sweep).toMatch(/^ {4}if: >-\n {6}!cancelled\(\)\n/m)
    expect(sweep).not.toContain('needs.fixture.result')
  })

  // `always()`, because a failed or cancelled sweep is the one most likely to
  // leak; gated on the id so a run that minted nothing deletes nothing.
  it('deletes after the sweep on every outcome', () => {
    const cleanup = job('fixture-cleanup')
    expect(cleanup).toMatch(/^ {4}needs: \[fixture, sweep\]$/m)
    expect(cleanup).toMatch(
      /^ {4}if: always\(\) && needs\.fixture\.outputs\.user_id != ''$/m,
    )
    expect(envValue(cleanup, 'FIXTURE_USER_ID')).toBe(
      '${{ needs.fixture.outputs.user_id }}',
    )
  })

  // THE DELETE'S RUN BLOCK, EXECUTED: nothing else reads it, so a block that
  // echoed the id instead of deleting it would leak every fixture to the cron.
  it('deletes the minted id when run', () => {
    const cleanup = stepsOf(job('fixture-cleanup')).find(
      (step) => step.name === 'Delete the test organization',
    )
    const dir = mkdtempSync(path.join(tmpdir(), 'judge-delete-'))
    const seen = path.join(dir, 'argv')
    writeFileSync(
      path.join(dir, 'npx'),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${seen}"\n`,
    )
    chmodSync(path.join(dir, 'npx'), 0o755)
    const script = path.join(dir, 'run.sh')
    writeFileSync(script, runBlockOf(cleanup?.body ?? ''))
    execFileSync('bash', [script], {
      cwd: dir,
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        FIXTURE_ENTRY: 'the-entry',
        FIXTURE_USER_ID: '77',
      },
    })
    expect(readFileSync(seen, 'utf8')).toBe('tsx\nthe-entry\ndelete\n77\n')
  })

  // THE MINT'S RUN BLOCK, EXECUTED, against a stand-in `npx`. What it must do
  // is a property of the shell, not of any string in it: a failed mint must
  // leave the outputs empty and the job green; a good one must reach the
  // outputs whole.
  describe('the mint step, run', () => {
    const mint = stepsOf(job('fixture')).find(
      (step) => step.name === 'Mint the test organization',
    )
    // The stand-in refuses any invocation but the real one, so the command,
    // the entry and the subcommand are all under test, not just the shell.
    const runMint = (npx: string) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'judge-mint-'))
      writeFileSync(
        path.join(dir, 'npx'),
        '#!/usr/bin/env bash\n' +
          '[ "$1" = tsx ] && [ "$2" = the-entry ] && [ "$3" = mint ] || exit 97\n' +
          `${npx}\n`,
      )
      chmodSync(path.join(dir, 'npx'), 0o755)
      const output = path.join(dir, 'github-output')
      writeFileSync(output, '')
      const script = path.join(dir, 'run.sh')
      writeFileSync(script, runBlockOf(mint?.body ?? ''))
      const stdout = execFileSync('bash', [script], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          PATH: `${dir}:${process.env.PATH}`,
          RUNNER_TEMP: dir,
          GITHUB_OUTPUT: output,
          FIXTURE_ENTRY: 'the-entry',
        },
      })
      return { stdout, outputs: readFileSync(output, 'utf8') }
    }

    it('copies a good mint into the outputs', () => {
      const lines = fixtureOutputLines({
        identifiers: {
          orgSlug: 'judge-org-1',
          raceId: 'race-2',
          userEmail: 'qa@goodparty.org',
        },
        userId: 77,
      })
      // $1 tsx, $2 the entry, $3 `mint`, $4 the file.
      const { outputs } = runMint(`printf '%s' '${lines}' >> "$4"`)
      expect(outputs).toBe(lines)
    })

    // A mint that wrote part of its file and then failed leaves NOTHING, not
    // the part: an org slug with no user id would dispatch against a fixture
    // nobody deletes.
    it('leaves the outputs empty and the job green when the mint fails', () => {
      const { stdout, outputs } = runMint(
        `printf 'org_slug=judge-half\\n' >> "$4"; exit 1`,
      )
      expect(outputs).toBe('')
      expect(stdout).toContain('::warning::')
    })
  })
})
