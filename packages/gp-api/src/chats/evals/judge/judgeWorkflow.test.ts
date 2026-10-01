import { readFileSync } from 'node:fs'
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

  it.each(['JUDGE_SPEND', 'ANTHROPIC_API_KEY'])(
    'sets %s on every step that starts a judge process',
    (variable) => {
      const missing = spending
        .filter((step) => !setsEnv(step.body, variable))
        .map((step) => step.name)
      expect(missing).toEqual([])
    },
  )

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
