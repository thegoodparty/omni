import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ARM_BUDGET_MS } from './runners/backgroundDispatch'
import { AGENTS } from './agents'
import { budgetOutputLines } from './armBudget'
import { JUDGE_FIXTURE_ENV_NAMES } from './caseParams'
import { formatPlan, selectAgents } from './cli'
import { estimateAgent } from './planCost'
import { identifierOutputLines } from './judgeIdentifiers'
import { ARM_KEY_ENV, KEY_ENV, restoreRealModelKey } from './modelKey'
import { ARM_AWS_ENV } from './awsCredentials'
import { EXPLICIT_SELECTION, SELECTION_ENV } from './sweepEnv'
import { JUDGE_PREFIX } from './records'

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
//
// Read from the step's `env:` block only: a `run: |` line sits at the same
// indent, so a value moved into the script would otherwise still match.
const envBlockOf = (body: string): string =>
  /^ {8}env:\n((?: {10}.*\n|\s*\n)*)/m.exec(body)?.[1] ?? ''

const envValue = (body: string, name: string): string | null =>
  new RegExp(`^ {${ENV_ENTRY}}${name}: (.*)$`, 'm').exec(
    envBlockOf(body),
  )?.[1] ?? null

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

// The estimate printed in three places and the bill in none. The judging
// step prints the bill at the top of its report and hands the total to the
// closing table, so the two sit side by side in both places.
describe('judge.yml reports what the sweep actually spent', () => {
  const steps = stepsOf(readFileSync(WORKFLOW, 'utf8'))
  const judging = steps.find((step) => step.name === 'Judge both arms')
  const summary = steps.find((step) => step.name === 'Summarise the sweep')

  it('hands the judging step the estimate to print beside it', () => {
    expect(judging?.body).toMatch(
      /^ {10}JUDGE_ESTIMATE_USD: \$\{\{ needs\.plan\.outputs\.estimate_usd \}\}$/m,
    )
  })

  it('prints the judging step total in the closing table', () => {
    expect(judging?.body).toMatch(/^ {8}id: judging$/m)
    expect(summary?.body).toMatch(
      /^ {10}ACTUAL_USD: \$\{\{ steps\.judging\.outputs\.actual_usd \}\}$/m,
    )
    expect(summary?.body).toContain(
      'echo "| actually spent | ${ACTUAL_USD:-not measured} |"',
    )
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
  // The plan job's `outputs:` entries sit at six spaces, so the indent is what
  // tells a published output from a mention of one in a comment.
  const PUBLISHES_SELECTION =
    /^ {6}selection: \$\{\{ steps\.select\.outputs\.selection \}\}$/m

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

  // THE ONE HOP THAT CROSSES A JOB BOUNDARY, and the only unguarded link in
  // the chain: the arms read a `needs.plan.outputs.*` expression, so if the
  // plan job stops publishing that output every explicit sweep silently
  // refuses again with this file fully green. JUDGE_DATA_VERSION needs no
  // equivalent — it is a same-job `steps.*.outputs.*` read.
  it('has the plan job publish what the sweep job reads', () => {
    // Anchored at the job-output indent, not matched as a substring, for the
    // reason the spend-switch scan above gives at length: `toContain` is
    // satisfied by `# selection: ...`, and commenting a line out is the exact
    // shape this is written to catch.
    expect(yaml).toMatch(PUBLISHES_SELECTION)
    // The matcher itself, against what an editor most plausibly leaves behind.
    expect(
      '      # selection: ${{ steps.select.outputs.selection }}',
    ).not.toMatch(PUBLISHES_SELECTION)
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

  // ON EVERY BRANCH, not merely somewhere in the step. The step has three
  // exits that publish `agents`, and one of them losing its `selection` line
  // would publish an empty value — which reads as `auto`, so the guards come
  // back on for that whole path and nothing goes red. Counted against the
  // `agents` writes rather than against a literal 3, so adding a fourth exit
  // is not a test to update but a test that fails until it publishes both.
  it('publishes it on every branch that publishes an agent list', () => {
    const body =
      steps.find((step) => step.name === 'Resolve the agent selection')?.body ??
      ''
    const occurrences = (pattern: RegExp): number =>
      (body.match(pattern) ?? []).length
    expect(occurrences(/echo "agents=/g)).toBeGreaterThan(1)
    expect(occurrences(/echo "selection=/g)).toBe(occurrences(/echo "agents=/g))
  })

  // The price and the guard state belong in the same comment: a reader
  // approving ~$681 of sweep should be able to see whether two arms that hash
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

// `auto` picks chat agents off the directories a PR touches, through a table
// in the select step. A chat agent missing from it is never judged unless
// someone names it, which is a gap nobody sees. Derived from the registry, so
// a new chat scope without a row fails here by name.
describe('judge.yml auto-selects every chat agent', () => {
  const select = stepsOf(readFileSync(WORKFLOW, 'utf8')).find(
    (step) => step.name === 'Resolve the agent selection',
  )

  it.each(AGENTS.filter((a) => a.shape === 'chat').map((a) => a.agentId))(
    'maps a source directory to %s',
    (agentId) => {
      expect(select?.body).toMatch(
        new RegExp(
          `packages/gp-api/src/chats/\\S+/\\*\\)\\s+add ${agentId} ;;`,
        ),
      )
    },
  )

  it('maps the briefing chat module to briefing_annotation', () => {
    expect(select?.body).toMatch(
      /packages\/gp-api\/src\/chats\/briefing-chats\/\*\)\s+add briefing_annotation ;;/,
    )
  })
})

// Without it the judging step cannot read the base ref's controls, and every
// case the branch marks `scored: false` is scored — safe, and silently not
// what the bench author asked for.
describe('judge.yml hands the judging step the base worktree', () => {
  it('passes the base worktree as JUDGE_BASE_DIR', () => {
    const judging = stepsOf(readFileSync(WORKFLOW, 'utf8')).find(
      (step) => step.name === 'Judge both arms',
    )
    expect(judging?.body).toMatch(
      /^\s+JUDGE_BASE_DIR: \$\{\{ steps\.base\.outputs\.dir \}\}$/m,
    )
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

// RECORDS GO TO THE PRIVATE BUCKET, through ONE variable. The base arm runs
// the base ref's parser, which refuses a blank JUDGE_RECORDS_DIR, so the
// choice is written to $GITHUB_ENV rather than mapped in each step's `env`
// with one side empty. Run as the step's own bash, both ways.
describe('judge.yml keeps records in the private bucket', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const steps = stepsOf(yaml)
  const names = steps.map((step) => step.name)
  const choose = steps.find(
    (step) => step.name === 'Choose where records are kept',
  )
  const POLICY = path.resolve(
    __dirname,
    '../../../../../gp-ai/infrastructure/modules/universal-judge-sweep-policy/main.tf',
  )

  const run = (credentials: string): { env: string; stdout: string } => {
    const script = runBlockOf(choose?.body ?? '')
    expect(script.split('\n')[0]).toBe('set -euo pipefail')
    const dir = mkdtempSync(path.join(tmpdir(), 'judge-records-'))
    const envFile = path.join(dir, 'github-env')
    writeFileSync(envFile, '')
    const stdout = execFileSync('bash', ['-c', script], {
      env: {
        ...process.env,
        CREDENTIALS: credentials,
        GITHUB_ENV: envFile,
        RUNNER_TEMP: dir,
        SWEEP_ID: 'judge-1-1',
      },
      encoding: 'utf8',
    })
    return { env: readFileSync(envFile, 'utf8').trim(), stdout }
  }

  it('uses the bucket when the judge role was assumed', () => {
    const { env, stdout } = run('success')
    expect(env).toBe('JUDGE_RECORDS_BUCKET=gp-agent-artifacts-dev')
    expect(stdout).not.toContain('::warning::')
  })

  it('falls back to the job, and says so, when it was not', () => {
    const { env, stdout } = run('failure')
    expect(env).toMatch(/^JUDGE_RECORDS_DIR=\S+\/judge-records$/)
    expect(stdout).toContain('::warning::')
  })

  // The bucket the step names is the one the role may write, under the
  // prefix the store writes.
  it('names the bucket the policy grants', () => {
    const tf = readFileSync(POLICY, 'utf8')
    const bucket = /artifacts_bucket\s*=\s*"([^"]+)"/
      .exec(tf)?.[1]
      ?.replace('${var.environment}', 'dev')
    expect(bucket).toBe('gp-agent-artifacts-dev')
    expect(tf).toMatch(/Sid\s*=\s*"KeepJudgeRecords"/)
  })

  it('leaves no step mapping a records variable itself', () => {
    const mapped = steps
      .filter((step) => /^ {10}JUDGE_RECORDS_(DIR|BUCKET):/m.test(step.body))
      .map((step) => step.name)
    expect(mapped).toEqual([])
  })

  it('chooses after the role is assumed and before the first capture', () => {
    const at = names.indexOf('Choose where records are kept')
    expect(at).toBeGreaterThan(
      names.indexOf('Get credentials for staging and dispatching'),
    )
    expect(at).toBeLessThan(names.indexOf('Capture the base arm'))
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

// THE ROLE'S TRUST, held from the workflow side. It lives in gp-ai's
// Terraform beside the policy it attaches, so a merged omni PR can change who
// gets AWS credentials; these are the review that change does not otherwise
// get. Text scans, like the rest of this file: gp-api declares no HCL parser,
// and what matters is a handful of exact values in one block we own.
describe('the judge role trusts exactly judge.yml on main', () => {
  const MODULE = path.resolve(
    __dirname,
    '../../../../../gp-ai/infrastructure/modules/universal-judge-sweep-policy/main.tf',
  )
  const tf = readFileSync(MODULE, 'utf8')
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const role = tf.slice(tf.indexOf('resource "aws_iam_role" "judge_sweep"'))
  const roleBlock = role.slice(0, role.indexOf('\n}\n') + 2)
  const trust = roleBlock.slice(roleBlock.indexOf('assume_role_policy'))
  // The `{ ... }` that follows `key =`, braces balanced, quotes optional on
  // the key: HCL accepts `Effect` and `"Effect"` alike, and a check that saw
  // only one spelling let a second statement through in the other.
  const KEY = (name: string) => `(?:"${name}"|\\b${name})\\s*=`
  const blockAfter = (text: string, name: string): string[] => {
    const out: string[] = []
    const re = new RegExp(`${KEY(name)}\\s*\\{`, 'g')
    for (const match of text.matchAll(re)) {
      let depth = 0
      const start = (match.index ?? 0) + match[0].length - 1
      for (let at = start; at < text.length; at += 1) {
        if (text[at] === '{') depth += 1
        if (text[at] === '}') depth -= 1
        if (depth === 0) {
          out.push(text.slice(start + 1, at))
          break
        }
      }
    }
    return out
  }
  // The keys written at the top level of an object body, quoted or not.
  const topKeys = (body: string): string[] => {
    const keys: string[] = []
    let depth = 0
    for (const line of body.split('\n')) {
      if (depth === 0) {
        const key = /^\s*"?([A-Za-z0-9_:.-]+)"?\s*=/.exec(line)?.[1]
        if (key) keys.push(key)
      }
      depth += (line.match(/[{[]/g) ?? []).length
      depth -= (line.match(/[}\]]/g) ?? []).length
    }
    return keys
  }
  const condition = (key: string): string[] =>
    [
      ...trust.matchAll(
        new RegExp(
          `"token\\.actions\\.githubusercontent\\.com:${key}"\\s*=\\s*"([^"]*)"`,
          'g',
        ),
      ),
    ].map((match) => match[1] ?? '')

  it('finds the role and its trust', () => {
    expect(roleBlock).toContain('assume_role_policy')
    expect(trust).toContain('jsonencode(')
  })

  // The name judge.yml assumes, read off judge.yml rather than restated: a
  // rename on one side leaves the sweep with credentials for nothing.
  it('is the role judge.yml assumes', () => {
    const arn = /role-to-assume: (arn:aws:iam::\d+:role\/(\S+))/.exec(yaml)
    expect(arn?.[2]).toBeDefined()
    expect(tf).toMatch(
      new RegExp(`judge_role_name\\s*=\\s*"${arn?.[2] ?? 'missing'}"`),
    )
    expect(roleBlock).toMatch(/^ {2}name\s*=\s*local\.judge_role_name$/m)
  })

  it('trusts exactly one statement, by web identity, from GitHub', () => {
    for (const name of ['Effect', 'Principal', 'Action', 'Condition']) {
      expect(trust.match(new RegExp(KEY(name), 'g'))).toHaveLength(1)
    }
    const principal = blockAfter(trust, 'Principal')
    expect(principal).toHaveLength(1)
    expect(topKeys(principal[0] ?? '')).toEqual(['Federated'])
    expect(trust).toMatch(/Action\s*=\s*"sts:AssumeRoleWithWebIdentity"/)
    expect(trust).toMatch(
      /Federated\s*=\s*"arn:aws:iam::\$\{data\.aws_caller_identity\.current\.account_id\}:oidc-provider\/\$\{local\.github_oidc\}"/,
    )
    expect(tf).toMatch(
      /github_oidc\s*=\s*"token\.actions\.githubusercontent\.com"/,
    )
  })

  // StringEquals only: a StringLike or ForAnyValue operator is how a pattern
  // or a list would sneak a second subject in.
  it('compares every claim exactly', () => {
    const conditions = blockAfter(trust, 'Condition')
    expect(conditions).toHaveLength(1)
    expect(topKeys(conditions[0] ?? '')).toEqual(['StringEquals'])
    const equals = blockAfter(conditions[0] ?? '', 'StringEquals')
    expect(topKeys(equals[0] ?? '').sort()).toEqual(
      [
        'token.actions.githubusercontent.com:aud',
        'token.actions.githubusercontent.com:job_workflow_ref',
        'token.actions.githubusercontent.com:sub',
      ].sort(),
    )
    expect(trust).not.toMatch(/StringLike|ForAnyValue|ForAllValues/)
    expect(trust).not.toContain('*')
    expect(trust).not.toContain('pull_request')
  })

  it('pins the audience, the ref and the one workflow file', () => {
    expect(condition('aud')).toEqual(['sts.amazonaws.com'])
    expect(condition('sub')).toEqual([
      'repo:thegoodparty/omni:ref:refs/heads/main',
    ])
    expect(condition('job_workflow_ref')).toEqual([
      `thegoodparty/omni/.github/workflows/${path.basename(WORKFLOW)}@refs/heads/main`,
    ])
  })

  // The two claims have to name the same ref, or neither pin means anything:
  // judge.yml is reached by relative path, so GitHub resolves it from the
  // caller's ref, and a job on a branch presents that branch in both claims.
  it('names the same ref in both claims', () => {
    const subjectRef = condition('sub')[0]?.split(':ref:')[1]
    const workflowRef = condition('job_workflow_ref')[0]?.split('@')[1]
    expect(subjectRef).toBe('refs/heads/main')
    expect(workflowRef).toBe(subjectRef)
  })

  // Exactly what judge.yml asks for, which is longer than the sweep job and
  // no longer than four hours. A shorter cap makes the assume FAIL, not
  // shorten: the request names a duration the role refuses.
  it('allows exactly the session judge.yml asks for', () => {
    const asked = Number(/role-duration-seconds: (\d+)/.exec(yaml)?.[1])
    const allowed = Number(
      /max_session_duration\s*=\s*(\d+)/.exec(roleBlock)?.[1],
    )
    expect(asked).toBeGreaterThan(0)
    expect(allowed).toBe(asked)
    expect(allowed).toBeLessThanOrEqual(4 * 3600)
  })

  // The judge's own policy, and no other: attaching the deploy role's would
  // undo the point of a role of its own.
  it('attaches the judge policy and nothing else', () => {
    const attachments = [
      ...tf.matchAll(
        /resource "aws_iam_role_policy_attachment" "\w+" \{([^}]*)\}/g,
      ),
    ].map((match) => match[1] ?? '')
    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatch(/role\s*=\s*aws_iam_role\.judge_sweep\.name/)
    expect(attachments[0]).toMatch(
      /policy_arn\s*=\s*aws_iam_policy\.judge_sweep\.arn/,
    )
    expect(tf).not.toMatch(
      /aws_iam_role_policy"|managed_policy_arns|inline_policy/,
    )
  })
})

// WHAT judge.yml ASKS AWS FOR, THE POLICY HAS TO GRANT. The first live
// background sweep assumed the role and then could not look the dispatch queue
// up, because the policy granted SendMessage and not GetQueueUrl, so every
// background agent was refused. Pinned from both files, so neither can drift.
describe('the judge policy grants what the sweep job calls', () => {
  const POLICY = path.resolve(
    __dirname,
    '../../../../../gp-ai/infrastructure/modules/universal-judge-sweep-policy/main.tf',
  )
  const tf = readFileSync(POLICY, 'utf8')
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const statement = (sid: string): string => {
    // Alignment is terraform fmt's, so it moves with the neighbouring keys.
    const at = tf.search(new RegExp(`Sid\\s*=\\s*"${sid}"`))
    expect(at, `no ${sid} statement`).toBeGreaterThan(-1)
    // To the end of the Resource list: an ARN interpolates `${...}`, so the
    // first `}` is inside it, not the statement's end.
    return tf.slice(at, tf.indexOf(']', tf.indexOf('Resource', at)) + 1)
  }
  const actions = (sid: string): string[] =>
    [
      ...(/Action\s*=\s*\[([^\]]*)\]/.exec(statement(sid))?.[1] ?? '').matchAll(
        /"([^"]+)"/g,
      ),
    ].map((match) => match[1] ?? '')

  it('grants the queue lookup the sweep job runs', () => {
    expect(yaml).toContain('aws sqs get-queue-url --queue-name "$queue"')
    expect(actions('DispatchJudgeRuns')).toContain('sqs:GetQueueUrl')
  })

  // Send and look up, nothing else: receiving or deleting would let a sweep
  // consume the queue the platform dispatches real runs from.
  it('grants the dispatch queue nothing but send and look up', () => {
    expect(actions('DispatchJudgeRuns').sort()).toEqual([
      'sqs:GetQueueUrl',
      'sqs:SendMessage',
    ])
    expect(statement('DispatchJudgeRuns')).toContain('${local.dispatch_queue}')
  })

  // The record store writes under one head prefix, and real run artifacts
  // share this bucket, so the grant is pinned to that prefix and to the two
  // actions the store calls. Derived from records.ts so a renamed prefix fails
  // here rather than as a denied write after both arms were paid for.
  it('keeps records under the store prefix only, with no delete', () => {
    expect(actions('KeepJudgeRecords').sort()).toEqual([
      's3:GetObject',
      's3:PutObject',
    ])
    // The whole list, so a second and wider ARN beside this one fails too.
    const resources = statement('KeepJudgeRecords').match(
      /Resource\s*=\s*\[([^\]]*)\]/,
    )?.[1]
    expect(resources?.split(',').map((one) => one.trim())).toEqual([
      `"arn:aws:s3:::\${local.artifacts_bucket}/${JUDGE_PREFIX}/*"`,
    ])
    // Read off the Action lists, not the whole file: the header comment names
    // DeleteObject in order to say it is absent.
    const granted = [...tf.matchAll(/Action\s*=\s*\[([^\]]*)\]/g)]
      .map((match) => match[1] ?? '')
      .join(',')
    expect(granted).toContain('s3:PutObject')
    expect(granted).not.toMatch(/Delete|Acl|Tagging/)
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
    extra_cases: 'JUDGE_BACKGROUND_EXTRA_CASES',
    agent_attempts: 'JUDGE_BACKGROUND_AGENT_ATTEMPTS',
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

// THE BACKGROUND AGENTS' IDENTIFIERS CROSS THE SAME SEAM AS THE BUDGET:
// resolved once by one step, read by two arms in two worktrees. No credential
// is involved, and these hold it that way.
describe('judge.yml resolves one set of identifiers for both arms', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const sweepJob = yaml.slice(yaml.indexOf('\n  sweep:\n'))
  const steps = stepsOf(sweepJob)
  const names = steps.map((step) => step.name)
  const resolver = steps.find(
    (step) => step.name === "Resolve the background agents' identifiers",
  )
  const arms = steps.filter((step) => step.name.startsWith('Capture the '))

  // Read off the function that writes them, not restated.
  const OUTPUT_KEYS = identifierOutputLines({
    orgSlug: 'o',
    raceId: 'r',
    userEmail: 'e',
  })
    .trim()
    .split('\n')
    .map((line) => line.split('=')[0] ?? '')
  const ENV_FOR: Record<string, string> = {
    org_slug: JUDGE_FIXTURE_ENV_NAMES.orgSlug,
    race_id: JUDGE_FIXTURE_ENV_NAMES.raceId,
    user_email: JUDGE_FIXTURE_ENV_NAMES.userEmail,
  }

  it('covers every output the resolver writes', () => {
    expect([...OUTPUT_KEYS].sort()).toEqual(Object.keys(ENV_FOR).sort())
  })

  // EXACT: an unknown output resolves to '', which reads as "not resolved",
  // so a misspelling on both arms would agree with itself and refuse every
  // background agent for no visible reason.
  it.each(Object.entries(ENV_FOR))(
    'gives both arms %s as %s, from the resolver',
    (key, name) => {
      expect(arms).toHaveLength(2)
      for (const arm of arms) {
        expect(envValue(arm.body, name)).toBe(
          `\${{ steps.identifiers.outputs.${key} }}`,
        )
      }
    },
  )

  it('resolves before either arm, under the id the arms read', () => {
    const at = names.indexOf("Resolve the background agents' identifiers")
    expect(at).toBeGreaterThan(-1)
    expect(names.findIndex((name) => name.startsWith('Capture the '))).toBe(
      names.indexOf('Capture the base arm'),
    )
    expect(names.indexOf('Capture the base arm')).toBeGreaterThan(at)
    expect(resolver?.body).toMatch(/^ {8}id: identifiers$/m)
    // Never skipped and never soft: skipped, every output is '' and every
    // background agent is refused on both arms with no visible cause. The
    // script already turns its own failure into a warning.
    expect(resolver?.body).not.toMatch(/^ {8}(if|continue-on-error):/m)
  })

  it('derives the slug from the sweep id and reads only the dev API', () => {
    expect(envValue(resolver?.body ?? '', 'JUDGE_SWEEP_ID')).toBe(
      '${{ env.SWEEP_ID }}',
    )
    expect(envValue(resolver?.body ?? '', 'JUDGE_FIXTURE_API_URL')).toBe(
      'https://gp-api-dev.goodparty.org',
    )
    expect(resolver?.body).toMatch(
      /^ {8}working-directory: \$\{\{ env\.WORKSPACE \}\}$/m,
    )
    expect(yaml).toMatch(
      /^ {2}IDENTIFIERS_ENTRY: src\/chats\/evals\/judge\/judgeIdentifiers\.ts$/m,
    )
  })

  // NOTHING SECRET. The identifiers need no credential, so the step holds
  // none, and the sweep depends on no job but the plan.
  it('holds no secret and depends on nothing but the plan', () => {
    expect(resolver?.body).not.toContain('secrets.')
    expect(yaml).not.toContain('JUDGE_CLERK_MACHINE_SECRET')
    expect(yaml).not.toMatch(/^ {4}environment:/m)
    expect(yaml).not.toMatch(/^ {2}fixture(-cleanup)?:$/m)
    expect(sweepJob).toMatch(/^ {4}needs: plan$/m)
  })

  // THE RESOLVER'S RUN BLOCK, EXECUTED against a stand-in `npx` that refuses
  // any invocation but the real one. A failed resolution must leave the
  // outputs empty and the sweep running; a good one must reach them whole.
  describe('the resolver, run', () => {
    const runResolver = (npx: string) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'judge-identifiers-'))
      writeFileSync(
        path.join(dir, 'npx'),
        '#!/usr/bin/env bash\n' +
          '[ "$1" = tsx ] && [ "$2" = the-entry ] || exit 97\n' +
          `${npx}\n`,
      )
      chmodSync(path.join(dir, 'npx'), 0o755)
      const output = path.join(dir, 'github-output')
      writeFileSync(output, '')
      const script = path.join(dir, 'run.sh')
      writeFileSync(script, runBlockOf(resolver?.body ?? ''))
      const stdout = execFileSync('bash', [script], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          PATH: `${dir}:${process.env.PATH}`,
          RUNNER_TEMP: dir,
          GITHUB_OUTPUT: output,
          IDENTIFIERS_ENTRY: 'the-entry',
        },
      })
      return { stdout, outputs: readFileSync(output, 'utf8') }
    }

    it('copies a good resolution into the outputs', () => {
      const lines = identifierOutputLines({
        orgSlug: 'judge-1-1',
        raceId: 'race-2',
        userEmail: 'judge-sweep@example.com',
      })
      // $1 tsx, $2 the entry, $3 the file.
      const { outputs } = runResolver(`printf '%s' '${lines}' >> "$3"`)
      expect(outputs).toBe(lines)
    })

    it('leaves the outputs empty and the sweep running when it fails', () => {
      const { stdout, outputs } = runResolver(
        `printf 'org_slug=judge-half\\n' >> "$3"; exit 1`,
      )
      expect(outputs).toBe('')
      expect(stdout).toContain('::warning::')
    })
  })
})

// THE PLAN COMMENT AND THE SUMMARIES LINK WHAT THEY NAME: the candidate commit,
// the base branch, and each case list at the commit being judged. Run through
// bash rather than matched as text, so what is checked is the markdown a
// reader gets, quoting and all.
describe('judge.yml links the commits, the base and the case lists', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const SHA = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0'
  const ENV = {
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'thegoodparty/omni',
    CANDIDATE_SHA: SHA,
    // Not `main`, so a link hardcoded to the default branch cannot pass.
    BASE_REF: 'feat/x-1',
    BASE_SHA: 'f'.repeat(40),
    WORKSPACE: 'packages/gp-api',
  }
  const bash = (script: string, env: Record<string, string> = {}) =>
    execFileSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ...ENV, ...env },
    })
  const lines = (prefix: string) =>
    yaml
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith(prefix))

  it('links the candidate commit on every row that names it', () => {
    const rows = lines('echo "| candidate |')
    expect(rows.length).toBeGreaterThanOrEqual(7)
    for (const row of rows) {
      expect(bash(row)).toBe(
        `| candidate | [\`${SHA.slice(0, 12)}\`](https://github.com/thegoodparty/omni/commit/${SHA}) |\n`,
      )
    }
  })

  it('links the base branch on every row that names it', () => {
    const rows = lines('echo "| base |')
    expect(rows.length).toBeGreaterThanOrEqual(7)
    for (const row of rows) {
      // Exactly, on the rows that carry no base commit; the one that does is
      // checked exactly below.
      if (row.includes('$base_commit')) continue
      expect(bash(row)).toBe(
        '| base | [`feat/x-1`](https://github.com/thegoodparty/omni/tree/feat/x-1) |\n',
      )
    }
  })

  // The summary's base row also links the resolved base commit, and says
  // `unresolved` when the worktree step never ran.
  it('links the resolved base commit, or says it is unresolved', () => {
    const at = yaml.indexOf('base_commit=unresolved')
    const prelude = yaml.slice(at, yaml.indexOf('fi\n', at) + 2)
    const [row] = lines('echo "| base |').filter((one) =>
      one.includes('$base_commit'),
    )
    expect(at).toBeGreaterThan(-1)
    expect(row).toBeDefined()
    const render = (env: Record<string, string>) =>
      bash(`${prelude}\n${row ?? ''}`, env)
    expect(render({})).toBe(
      `| base | [\`feat/x-1\`](https://github.com/thegoodparty/omni/tree/feat/x-1) ([\`ffffffffffff\`](https://github.com/thegoodparty/omni/commit/${'f'.repeat(40)})) |\n`,
    )
    expect(render({ BASE_SHA: '' })).toBe(
      '| base | [`feat/x-1`](https://github.com/thegoodparty/omni/tree/feat/x-1) (unresolved) |\n',
    )
  })

  // THE RUN PAGE IS NOT ON THE PR, so both summaries say which PR they judged.
  // Only a numeric PR number becomes a link; anything else links nowhere.
  describe('the pull request on the run page', () => {
    // Supplied by the tests below, so they cannot see a step that lacks it:
    // without it the link is silently never rendered.
    it('gives both summary steps the PR number', () => {
      const holders = stepsOf(yaml).filter(
        (step) =>
          step.body.includes('pull_request=none') ||
          step.body.includes('echo "Pull request:'),
      )
      expect(holders).toHaveLength(2)
      for (const step of holders) {
        expect(envValue(step.body, 'PR_NUMBER')).toBe('${{ inputs.pr_number }}')
      }
    })

    it.each<[string, string, string]>([
      [
        '2371',
        '[#2371](https://github.com/thegoodparty/omni/pull/2371)',
        'links',
      ],
      ['', 'none', 'says none for'],
      ['12)](https://evil.example', 'none', 'refuses'],
    ])('the sweep summary %s', (pr, expected) => {
      const at = yaml.indexOf('pull_request=none')
      const prelude = yaml.slice(at, yaml.indexOf('fi\n', at) + 2)
      const [row] = lines('echo "| pull request |')
      expect(at).toBeGreaterThan(-1)
      expect(bash(`${prelude}\n${row ?? ''}`, { PR_NUMBER: pr })).toBe(
        `| pull request | ${expected} |\n`,
      )
    })

    it.each<[string, string]>([
      [
        '2371',
        'Pull request: [#2371](https://github.com/thegoodparty/omni/pull/2371)\n\nPLAN\n',
      ],
      ['', 'PLAN\n'],
      ['1; echo pwned', 'PLAN\n'],
    ])('puts the plan summary under PR %j as expected', (pr, expected) => {
      const at = yaml.indexOf(
        'if [[ "${PR_NUMBER:-}" =~ ^[0-9]+$ ]]; then\n              echo "Pull request:',
      )
      expect(at).toBeGreaterThan(-1)
      const block = yaml.slice(at, yaml.indexOf('fi\n', at) + 2)
      const dir = mkdtempSync(path.join(tmpdir(), 'judge-plan-summary-'))
      writeFileSync(path.join(dir, 'plan.md'), 'PLAN\n')
      expect(
        bash(`{\n${block}\ncat "${dir}/plan.md"\n}`, { PR_NUMBER: pr }),
      ).toBe(expected)
    })
  })

  // The case list is arbitrary CLI output, so it is a link only when it is a
  // plain file name; anything else stays a code span and points nowhere.
  describe('the case-list cell', () => {
    const start = yaml.indexOf('if [[ "$safe_cases" =~')
    const block = yaml.slice(start, yaml.indexOf('fi\n', start) + 2)
    const cell = (safeCases: string) =>
      bash(`${block}\nprintf '%s' "$cell"`, { safe_cases: safeCases })

    it('links a plain case-list file at the commit being judged', () => {
      expect(cell('chief_of_staff.json')).toBe(
        `[\`chief_of_staff.json\`](https://github.com/thegoodparty/omni/blob/${SHA}/packages/gp-api/src/chats/evals/judge/cases/chief_of_staff.json)`,
      )
    })

    it.each([
      'x.json](https://evil.example)',
      '../../secrets.json',
      'NO CASE LIST YET',
      'Chief.json',
    ])('leaves %j as a code span', (value) => {
      expect(cell(value)).toBe(`\`${value}\``)
    })
  })
})

// THE WORKFLOW ADDS UP, AND THE CLI PRICES. Every per-agent number comes from
// planCost.ts through the plan rows, so a budget, a measurement or a case
// list that moves a price moves it here without a workflow edit. What the
// workflow still owns is refusing when it cannot read a price from every row.
describe('judge.yml sums the prices the CLI puts on the plan', () => {
  const estimate = stepsOf(readFileSync(WORKFLOW, 'utf8')).find(
    (step) => step.name === 'Estimate the cost and case count',
  )
  const script = runBlockOf(estimate?.body ?? '')

  const dollars = (cents: number) =>
    `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`

  // Run, not read, with the WHOLE run block and a fake `npx` standing in for
  // the CLI, so no slice boundary decides what is tested. The step is
  // `set -u`, so a variable read before it is set fails here too.
  const runEstimate = (
    plan: string,
    agents: string,
    gh: 'ok' | '404' | '403' | 'error' = 'ok',
    defaultRef = 'trunk',
    // The CLI's first, unpriced run exits 1, and its second exits this.
    cliFails?: number,
  ) => {
    // Real, because the step builds the base copy's path from `$PWD`.
    const dir = realpathSync(
      mkdtempSync(path.join(tmpdir(), 'judge-estimate-')),
    )
    // The base copy is written beside the candidate's CLI, so the CLI path
    // has to be inside the scratch directory.
    const cli = path.join(dir, 'judge/cli.ts')
    execFileSync('mkdir', [path.dirname(cli)])
    const bin = path.join(dir, 'bin')
    execFileSync('mkdir', [bin])
    writeFileSync(path.join(dir, 'plan.fixture'), plan)
    writeFileSync(
      path.join(bin, 'npx'),
      `#!/bin/bash\necho "$*" >> "${path.join(dir, 'npx.args')}"\n` +
        (cliFails === undefined
          ? ''
          : `[[ "$*" == *--reference* ]] || exit 1\n`) +
        `cat "${path.join(dir, 'plan.fixture')}"\n` +
        (cliFails === undefined ? '' : `exit ${cliFails}\n`),
    )
    // Stands in for the base ref's files; a GitHub API that does not answer
    // must not fail the step.
    writeFileSync(
      path.join(bin, 'gh'),
      `#!/bin/bash\necho "$*" >> "${path.join(dir, 'gh.args')}"\n` +
        {
          ok: `echo "// $*"\n`,
          '404': 'echo "gh: Not Found (HTTP 404)" >&2; exit 1\n',
          '403': 'echo "gh: Forbidden (HTTP 403)" >&2; exit 1\n',
          error: 'echo "gh: Bad Gateway (HTTP 502)" >&2; exit 1\n',
        }[gh],
    )
    chmodSync(path.join(bin, 'npx'), 0o755)
    chmodSync(path.join(bin, 'gh'), 0o755)
    const output = path.join(dir, 'output')
    writeFileSync(output, '')
    writeFileSync(path.join(dir, 'summary'), '')
    let status = 0
    try {
      execFileSync('bash', ['--noprofile', '--norc', '-c', script], {
        // The step's working directory is the workspace, and CLI is relative
        // to it.
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe',
        env: {
          PATH: `${bin}:${process.env.PATH ?? ''}`,
          RUNNER_TEMP: dir,
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: path.join(dir, 'summary'),
          GITHUB_SERVER_URL: 'https://github.com',
          GITHUB_REPOSITORY: 'thegoodparty/omni',
          WORKSPACE: 'packages/gp-api',
          CLI: path.relative(dir, cli),
          AGENTS: agents,
          REQUESTED: agents,
          SELECTION: EXPLICIT_SELECTION,
          LIVE: 'false',
          SWEEP_CAPABLE: 'true',
          REQUESTED_BY: 'octocat',
          CANDIDATE_SHA: 'a'.repeat(40),
          BASE_REF: 'feature-x',
          DEFAULT_REF: defaultRef,
          PR_NUMBER: '1',
          RUN_URL: 'https://github.com/thegoodparty/omni/actions/runs/1',
        },
      })
    } catch (err) {
      status = (err as { status?: number }).status ?? -1
    }
    const read = (file: string) => {
      try {
        return readFileSync(path.join(dir, file), 'utf8')
      } catch {
        return ''
      }
    }
    return {
      status,
      dir,
      npxArgs: read('npx.args'),
      ghArgs: read('gh.args'),
      outputs: readFileSync(output, 'utf8'),
      comment: read('plan-comment.md'),
      refusal: read('estimate-refusal-comment.md'),
    }
  }

  it('keeps no background price of its own', () => {
    expect(script.split('\n')[0]).toBe('set -euo pipefail')
    expect(script).not.toMatch(/^\s*background_cents=/m)
  })

  // The plan is the real CLI's, so a format change on either side fails here.
  it('sums the real plan for a chat, a measured and an unmeasured agent', () => {
    const ids = ['chief_of_staff', 'race_opponent_summary', 'self_research']
    const selection = selectAgents({ kind: 'list', ids })
    const plan = formatPlan(selection)
    const cents = selection.selected.map((agent) => estimateAgent(agent).cents)
    expect(cents).toEqual([900, 900, 4900])

    const result = runEstimate(plan, ids.join(','))
    expect(result.status).toBe(0)
    expect(result.outputs).toMatch(/^usd=67\.00$/m)
    expect(result.outputs).toMatch(
      /^sweep_agents=chief_of_staff,race_opponent_summary,self_research$/m,
    )
    const row = (id: string, shape: string, price: string) =>
      new RegExp(`^\\| ${id} \\| ${shape} \\| .* \\| ~${price} \\|$`, 'm')
    expect(result.comment).toMatch(row('chief_of_staff', 'chat', dollars(900)))
    expect(result.comment).toMatch(
      row('race_opponent_summary', 'background', dollars(900)),
    )
    expect(result.comment).toMatch(
      row('self_research', 'background', `${dollars(4900)} \\(unmeasured\\)`),
    )
  })

  // A PR prices its own sweep, so the base ref's prices are fetched and
  // handed to the CLI, which takes the higher of the two.
  // A PR prices its own sweep, so the base ref's AND the default branch's
  // price files, configs and case lists are fetched and handed to the CLI,
  // which takes the highest. The base ref is not the default branch here, so
  // each ref is seen to be fetched by name.
  it('hands the CLI the base ref and the default branch', () => {
    const result = runEstimate(
      'Universal Judge — plan (1 agents)\n\n' +
        '  chief_of_staff  [chat]  cents: 900 (measured)  cases: chief_of_staff.json\n',
      'chief_of_staff',
    )
    expect(result.status).toBe(0)
    const contents = 'repos/thegoodparty/omni/contents/packages/gp-api/judge'
    for (const [name, ref] of [
      ['base', 'feature-x'],
      ['default', 'trunk'],
    ]) {
      const cost = path.join(result.dir, `judge/planCost.${name}.ts`)
      const dir = path.join(result.dir, `ref-${name}`)
      for (const file of [
        'planCost.ts',
        'config.ts',
        'cases/chief_of_staff.json',
      ]) {
        expect(result.ghArgs).toContain(`${contents}/${file}?ref=${ref}`)
      }
      expect(readFileSync(cost, 'utf8')).toContain(`planCost.ts?ref=${ref}`)
      expect(
        readFileSync(path.join(dir, 'cases/chief_of_staff.json'), 'utf8'),
      ).toContain(`chief_of_staff.json?ref=${ref}`)
      expect(result.npxArgs).toContain(
        `--reference=${cost},${dir}/config.ts,${dir}/cases`,
      )
    }
  })

  // Nothing is fetched for a default branch that is not a plain name, and the
  // CLI then fails closed on its empty files.
  it('fetches nothing for a default branch that is not a branch name', () => {
    const result = runEstimate(
      'Universal Judge — plan (1 agents)\n\n' +
        '  self_research  [background]  cents: 4800 (base-unread)  cases: self_research.json\n',
      'self_research',
      'ok',
      '--upload-pack=x',
    )
    expect(result.status).toBe(0)
    expect(result.ghArgs).not.toContain('upload-pack')
    expect(
      readFileSync(path.join(result.dir, 'judge/planCost.default.ts'), 'utf8'),
    ).toBe('fetch failed\n')
  })

  // A 404 is a file the ref does not have, and is left empty: the CLI reads
  // an empty list as none. Anything else is left as a line that is not a
  // file, which the CLI reads as unreadable and prices at the worst case.
  it.each([
    ['404', ''],
    // Not just any 4xx: a 403 or a rate limit is not a file that is absent.
    ['403', 'fetch failed\n'],
    ['error', 'fetch failed\n'],
  ] as const)('leaves what a %s fetch says for the CLI', (gh, written) => {
    const result = runEstimate(
      'Universal Judge — plan (1 agents)\n\n' +
        '  chief_of_staff  [chat]  cents: 3750 (base-unread)  cases: chief_of_staff.json\n',
      'chief_of_staff',
      gh,
    )
    expect(result.status).toBe(0)
    for (const name of ['base', 'default']) {
      for (const file of [
        `judge/planCost.${name}.ts`,
        `ref-${name}/config.ts`,
        `ref-${name}/cases/chief_of_staff.json`,
      ]) {
        expect(readFileSync(path.join(result.dir, file), 'utf8')).toBe(written)
      }
    }
  })

  // The first, unpriced run is only for the ids. When it fails, the step goes
  // on to the real run, which answers on the thread.
  it('reaches the priced run when the unpriced one fails', () => {
    const result = runEstimate(
      'Universal Judge — plan (1 agents)\n\n' +
        '  chief_of_staff  [chat]  cents: 900 (measured)  cases: chief_of_staff.json\n\n' +
        '  unknown agent ids: typo\n',
      'chief_of_staff,typo',
      'ok',
      'trunk',
      1,
    )
    expect(result.status).not.toBe(0)
    expect(result.npxArgs.split('\n').filter(Boolean)).toHaveLength(2)
    expect(result.npxArgs).toContain('--reference=')
    expect(result.refusal).toContain('would not accept this request')
  })

  // `all` is the selector, not an id: the lists fetched are the chat agents
  // the CLI plans.
  it('fetches every planned chat list for `all`, from both refs', () => {
    const result = runEstimate(
      'Universal Judge — plan (2 agents)\n\n' +
        '  chief_of_staff  [chat]  cents: 900 (measured)  cases: chief_of_staff.json\n' +
        '  self_research  [background]  cents: 4800 (unmeasured)  cases: self_research.json\n',
      'all',
    )
    expect(result.status).toBe(0)
    const contents = 'repos/thegoodparty/omni/contents/packages/gp-api/judge'
    for (const ref of ['feature-x', 'trunk']) {
      expect(result.ghArgs).toContain(
        `${contents}/cases/chief_of_staff.json?ref=${ref}`,
      )
    }
    expect(result.ghArgs).not.toContain('cases/all.json')
    expect(result.ghArgs).not.toContain('cases/self_research.json')
  })

  it('refuses when it can read fewer priced rows than the CLI planned', () => {
    const result = runEstimate(
      'Universal Judge — plan (2 agents)\n\n' +
        '  chief_of_staff  [chat]  cents: 700 (design-doc)  cases: chief_of_staff.json\n' +
        '  self_research  [background]  cents: lots (unmeasured)  cases: self_research.json\n',
      'chief_of_staff,self_research',
    )
    expect(result.status).not.toBe(0)
    expect(result.outputs).not.toMatch(/^usd=/m)
    expect(result.refusal).toContain('could read only 1 of them')
  })

  // A branch whose CLI predates per-agent pricing prints unpriced rows, and
  // is priced at the worst case rather than refused — never below what this
  // branch's planCost.ts charges an unmeasured agent.
  it('prices a plan from an older CLI at the worst case', () => {
    const worst = (id: string) => {
      const agent = selectAgents({ kind: 'list', ids: [id] }).selected[0]
      return agent === undefined ? -1 : estimateAgent(agent).cents
    }
    expect(worst('ordinance_flow')).toBe(3750)
    expect(worst('self_research')).toBe(4900)
    const result = runEstimate(
      'Universal Judge — plan (4 agents)\n\n' +
        '  chief_of_staff  [chat]  cases: chief_of_staff.json\n' +
        '  ordinance_flow  [chat]  cases: ordinance_flow.json\n' +
        '  self_research  [background]  cases: self_research.json\n' +
        '  campaign_tracker_tasks  [background]  cases: NO CASE LIST YET\n',
      'chief_of_staff,ordinance_flow,self_research,campaign_tracker_tasks',
    )
    expect(result.status).toBe(0)
    expect(result.outputs).toMatch(/^usd=124\.00$/m)
    expect(result.outputs).toMatch(
      /^sweep_agents=chief_of_staff,ordinance_flow,self_research$/m,
    )
    const label = '\\(old branch, worst case\\)'
    const row = (id: string, price: string) =>
      new RegExp(`^\\| ${id} \\| .* \\| ~${price} ${label} \\|$`, 'm')
    expect(result.comment).toMatch(row('chief_of_staff', '37\\.50'))
    expect(result.comment).toMatch(row('ordinance_flow', '37\\.50'))
    expect(result.comment).toMatch(row('self_research', '49\\.00'))
  })
})

// THE SECOND KEY `.env.test` SHADOWS. The first live background sweep that got
// past the queue lookup assumed the role, then signed with `.env.test`'s stub
// access key beside the role's real session token, and AWS refused the key
// before anything was staged. Pinned on both sides: the workflow passes the
// three names, and the arm suite and the store build their clients from them.
describe('the arms reach AWS on the role, not on the stub', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const arms = stepsOf(yaml).filter((step) =>
    step.name.startsWith('Capture the '),
  )

  it.each(Object.entries(ARM_AWS_ENV))(
    'passes the %s to both arms under the arm name',
    (_field, name) => {
      expect(arms).toHaveLength(2)
      const sdkName = name.replace(/^JUDGE_/, '')
      expect(arms.map((step) => envValue(step.body, name))).toEqual([
        `\${{ env.${sdkName} }}`,
        `\${{ env.${sdkName} }}`,
      ])
    },
  )

  it('the credentials step exports the role to env, before both arms', () => {
    const steps = stepsOf(yaml)
    const names = steps.map((step) => step.name)
    const credentials = steps.find(
      (step) => step.name === 'Get credentials for staging and dispatching',
    )
    expect(credentials?.body).toContain(
      'uses: aws-actions/configure-aws-credentials@',
    )
    // Absent, not merely not `false`: `'false'` and `${{ false }}` turn the
    // export off just as well, and the action's default is the one we want.
    expect(credentials?.body).not.toMatch(/output-env-credentials:/)
    expect(names.indexOf(credentials?.name ?? '')).toBeGreaterThan(-1)
    expect(names.indexOf(credentials?.name ?? '')).toBeLessThan(
      names.indexOf('Capture the base arm'),
    )
  })

  // Every file in the judge, not a list of the ones that have clients today:
  // a client added anywhere else would sign with the stub. Unit tests are
  // skipped, because records.test.ts builds a mocked client on purpose.
  //
  // Line comments go first: a `/*` inside one (background.ts has
  // ``_judge/*``) would otherwise open a block that swallows real code up to
  // the next `*/`. `(^|[^:])` keeps a URL's `//` from eating its line.
  const strip = (source: string): string =>
    source.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '')
  // Every client this file imports from the SDK, not only S3 and SQS: any
  // AWS client the judge builds would sign with the stub.
  const sdkClients = (source: string): Set<string> =>
    new Set(
      [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@aws-sdk\/[^']+'/g)]
        .flatMap((match) => (match[1] ?? '').split(','))
        .map((name) => name.trim().split(/\s+as\s+/))
        // The imported name says it is a client; the local name, which an
        // alias can make anything, is what `new` is called on.
        .filter(([imported]) => imported?.endsWith('Client') === true)
        .map((names) => names[names.length - 1] ?? ''),
    )
  const built = (source: string, pattern: RegExp): number =>
    [...source.matchAll(pattern)].filter((match) =>
      sdkClients(source).has(match[1] ?? ''),
    ).length
  const tsFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) return tsFiles(full)
      const unit = full.endsWith('.test.ts') && !full.endsWith('.eval.test.ts')
      return full.endsWith('.ts') && !unit ? [full] : []
    })

  it('builds every AWS client from judgeAwsClientConfig()', () => {
    const found = tsFiles(__dirname)
      .map((file) => {
        const source = strip(readFileSync(file, 'utf8'))
        return {
          file: path.relative(__dirname, file),
          any: built(source, /new\s*\(?\s*(\w+)\b/g),
          exact: built(
            source,
            /new (\w+)\(\s*judgeAwsClientConfig\(\),?\s*\)/g,
          ),
        }
      })
      .filter((client) => client.any > 0)
    expect(found).toEqual([
      { file: 'sweep.eval.test.ts', any: 2, exact: 2 },
      { file: 'sweepEnv.ts', any: 1, exact: 1 },
    ])
  })

  const readme = readFileSync(path.resolve(__dirname, 'README.md'), 'utf8')
  it.each(Object.values(ARM_AWS_ENV))('the env table documents %s', (name) => {
    expect(readme).toMatch(new RegExp(`^\\| .*\`${name}\``, 'm'))
  })
})

// GITHUB'S 21,000-CHARACTER EXPRESSION LIMIT. A `run:` script that contains
// `${{` anywhere, even inside a shell comment, is evaluated as one expression,
// and past 21,000 characters the whole workflow fails to parse: every
// /judge request is then refused with "Exceeded max expression length". A
// prose mention of `${{ runner.temp }}` in a comment did exactly that to the
// estimate step once it grew past the limit.
describe('judge workflows stay under the expression length limit', () => {
  const LIMIT = 21_000
  const files = ['judge.yml', 'judge-comment.yml', 'judge-request.yml'].map(
    (name) => path.resolve(path.dirname(WORKFLOW), name),
  )

  it.each(files)(
    '%s has no run script over the limit with ${{ in it',
    (file) => {
      const lines = readFileSync(file, 'utf8').split('\n')
      const offenders: string[] = []
      lines.forEach((line, index) => {
        const match = /^(\s*)run: \|\s*$/.exec(line)
        if (match === null) return
        const indent = (match[1] ?? '').length
        const body: string[] = [line]
        for (let next = index + 1; next < lines.length; next += 1) {
          const text = lines[next] ?? ''
          if (
            text.trim() !== '' &&
            text.length - text.trimStart().length <= indent
          )
            break
          body.push(text)
        }
        const script = body.join('\n')
        if (script.includes('${{') && script.length >= LIMIT) {
          offenders.push(`line ${index + 1}: ${script.length} chars`)
        }
      })
      expect(offenders).toEqual([])
    },
  )
})

// THE API IS ASKED ABOUT THE SCHEMA BEFORE ANYTHING IS PAID FOR. Every judge
// test drives a fake model, so a verdict schema the API refuses passed the
// suite and failed every judgment of the next sweep (#2534). The preflight
// makes one real panel call at the largest schema, and it only helps if it
// runs before the base worktree is made and before either arm dispatches.
describe('judge.yml checks the judge schema before spending', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const steps = stepsOf(yaml)
  const names = steps.map((step) => step.name)
  const PREFLIGHT = "Check the model API accepts the judge's schema"
  const preflight = steps.find((step) => step.name === PREFLIGHT)

  it('runs before the base worktree and both arms', () => {
    const at = names.indexOf(PREFLIGHT)
    expect(at).toBeGreaterThan(-1)
    for (const later of [
      'Check out the base arm into its own worktree',
      'Capture the base arm',
      'Capture the candidate arm',
    ]) {
      expect(names.indexOf(later)).toBeGreaterThan(at)
    }
  })

  it('runs the preflight entry, only under spend, with the real key', () => {
    expect(preflight?.body).toContain('npx tsx "$PREFLIGHT_ENTRY"')
    expect(spendsLive(preflight?.body ?? '')).toBe(true)
    expect(envValue(preflight?.body ?? '', KEY_ENV)).toBe(
      '${{ secrets.ANTHROPIC_API_KEY }}',
    )
  })

  it('points at an entry that exists', () => {
    const entry = /^ {2}PREFLIGHT_ENTRY: (.+)$/m.exec(yaml)?.[1]
    expect(entry).toBe('src/chats/evals/judge/schemaPreflight.ts')
    expect(
      statSync(path.resolve(__dirname, '../../../..', entry ?? '')).isFile(),
    ).toBe(true)
  })

  // A branch from before the check has no entry; the sweep goes on rather
  // than failing on a file the branch never had.
  it('skips a branch that predates the entry', () => {
    const stdout = execFileSync(
      'bash',
      ['-c', runBlockOf(preflight?.body ?? '')],
      {
        env: {
          ...process.env,
          PREFLIGHT_ENTRY: '/nonexistent/schemaPreflight.ts',
        },
        encoding: 'utf8',
      },
    )
    expect(stdout).toContain('predates the schema preflight')
  })
})

// THE POST-MERGE CHECK RUNS MAIN'S CODE ONLY. omni gives same-repo pull
// request workflows its secrets, so a PR trigger would hand the Anthropic key
// to unreviewed code.
describe('judge-schema-check.yml', () => {
  const yaml = readFileSync(
    path.resolve(path.dirname(WORKFLOW), 'judge-schema-check.yml'),
    'utf8',
  )
  const triggers = /^on:\n((?: {2}.*\n|\s*\n)*)/m.exec(yaml)?.[1] ?? ''

  it('never runs on a pull request', () => {
    expect(triggers).not.toMatch(/pull_request/)
    expect(triggers).toMatch(/^ {2}push:\n {4}branches: \[main\]/m)
  })

  it('runs when the judge changes', () => {
    expect(triggers).toContain("'packages/gp-api/src/chats/evals/judge/**'")
  })

  it('reads the repository and nothing more', () => {
    expect(/^permissions:\n((?: {2}.*\n)*)/m.exec(yaml)?.[1]).toBe(
      '  contents: read\n',
    )
  })

  it('runs the preflight under spend with the real key', () => {
    expect(yaml).toContain('npx tsx src/chats/evals/judge/schemaPreflight.ts')
    expect(yaml).toMatch(/^ {10}JUDGE_SPEND: 'true'$/m)
    expect(yaml).toContain(
      'ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}',
    )
  })
})
