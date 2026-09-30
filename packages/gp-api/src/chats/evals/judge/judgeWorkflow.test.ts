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
        .filter((step) => !step.body.includes(`${variable}:`))
        .map((step) => step.name)
      expect(missing).toEqual([])
    },
  )

  it("spends only on the exact string 'true'", () => {
    // `spends()` in sweepEnv.ts compares against 'true' exactly, so a bare
    // `true` — which YAML would hand over as the string 'true' anyway — is
    // one editor away from `yes` or `True` reading as "do not spend".
    for (const step of spending) {
      expect(step.body).toContain("JUDGE_SPEND: 'true'")
    }
  })
})
