import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

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
