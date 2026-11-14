import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// ENG-11591's resume (resolved on the ClickUp card): the judge sweep role's
// trust condition is pinned to job_workflow_ref=judge.yml@refs/heads/main
// and judgeWorkflow.test.ts's own test forbids the word `pull_request`
// anywhere in it, so a `pull_request_target` workflow like this one can
// never assume it. These tests pin the two things that answer gave
// instead: no AWS anywhere in this file, and the kill switch gates the one
// job and its concurrency group.
const WORKFLOW = path.resolve(
  __dirname,
  '../../../../../../..',
  '.github/workflows/judge-guard.yml',
)

interface Step {
  name: string
  body: string
}

// Steps are the six-space `- name:` entries. An unnamed `- uses:`/`- if:`
// step is kept too — anonymous, with whatever immediately precedes the next
// name — so a test below can still see the `uses:`/`with:` it carries.
const stepsOf = (yaml: string): Step[] => {
  const parts = yaml.split(/^ {6}- /m).slice(1)
  return parts.map((part) => ({
    name: /^name: (.*)/.exec(part)?.[1]?.trim() ?? '',
    body: part,
  }))
}

describe('judge-guard.yml has no AWS anywhere in it', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')

  it('requests no id-token and configures no AWS credentials', () => {
    expect(yaml).not.toContain('id-token: write')
    expect(yaml).not.toContain('aws-actions/configure-aws-credentials')
  })

  it('names no S3 bucket, S3 client, or judge records bucket', () => {
    expect(yaml).not.toMatch(/S3Client|JUDGE_RECORDS_BUCKET|s3:/)
  })

  // ENG-11592: the sweep must run through a separately-dispatched workflow
  // run, never through a `uses:` job in this file — that is exactly the
  // shape that would force this job to hold `id-token: write` itself (this
  // file's own header note, and judge-request.yml's "GRANTED HERE BECAUSE
  // judge.yml CANNOT GRANT IT TO ITSELF").
  it('never calls judge.yml as a reusable workflow job', () => {
    expect(yaml).not.toMatch(/uses: \.\/\.github\/workflows\/judge\.yml/)
  })

  it('grants only what the spend relay, the checks, and the sweep dispatch need', () => {
    const permissions = /^permissions:\n((?: {2}.*\n|\s*\n)*)/m.exec(yaml)?.[1]
    expect(permissions).toBeDefined()
    const granted = [...(permissions ?? '').matchAll(/^ {2}([\w-]+): (\w+)/gm)]
      .map((m) => `${m[1]}:${m[2]}`)
      .sort()
    // `actions:write` (ENG-11592), not `actions:read`: this job both lists
    // the spend-so-far artifacts and dispatches/watches the
    // sweep it starts on `judge-request.yml` — see this file's own header
    // for why that dispatch, not a direct `uses:`, is how the sweep runs
    // with no AWS credentials in this job.
    expect(granted).toEqual(
      [
        'actions:write',
        'checks:write',
        'contents:read',
        'pull-requests:write',
      ].sort(),
    )
  })
})

describe('judge-guard.yml gates the job and its concurrency group on the switch', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const guardJob = yaml.slice(yaml.indexOf('\n  guard:\n'))

  it('gates the only job on the kill switch', () => {
    const jobIf = /^ {4}if: >-\n((?: {6}.*\n)*)/m.exec(guardJob)?.[1] ?? ''
    expect(jobIf).toContain("vars.JUDGE_GUARD_ENABLED == 'true'")
  })

  it('gates the concurrency group on the same switch, not just PR state', () => {
    const group = /^concurrency:\n {2}group: >-\n((?: {4}.*\n)*)/m.exec(
      yaml,
    )?.[1]
    expect(group).toBeDefined()
    expect(group).toContain("vars.JUDGE_GUARD_ENABLED == 'true'")
    // ENG-11592: its own `universal-judge-guard-pr-<n>` key, not the shared
    // `universal-judge-pr-<n>` every other judge entry point uses — sharing
    // it made the guard's own dispatch of a `judge-request.yml` run cancel
    // the guard job still watching that run (see judge-guard.yml's own
    // concurrency comment). Off (or draft/fork) still falls back to a
    // per-run group so a disabled run can never cancel one.
    expect(group).toContain(
      "format('universal-judge-guard-pr-{0}', github.event.pull_request.number)",
    )
    expect(group).toContain(
      "format('universal-judge-guard-noop-{0}', github.run_id)",
    )
  })
})

describe('judge-guard.yml sets every variable the steps it runs read', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const steps = stepsOf(yaml)

  // A step that reads $GH_REPO in its own `run:` but never sets it in its own
  // `env:` is exactly the bug that disabled this workflow on main before
  // this PR's rewrite (ENG-11591's resume): GH_REPO unbound in the old
  // no-agent "quiet pass" step put a failed check on almost every PR.
  it('on every step reading $GH_REPO', () => {
    const readers = steps.filter((step) => step.body.includes('$GH_REPO'))
    // Guards the scan itself: if nothing in the file matches, every assertion
    // below is vacuously true — the exact failure mode a grepping test has.
    expect(readers.length).toBeGreaterThan(0)
    // 10, not 8: GH_REPO is set inside the step's own `env:` block, one
    // indent level deeper than the step's direct keys (`id:`, `if:`, ...) —
    // the same ENV_ENTRY convention judgeWorkflow.test.ts uses for judge.yml.
    const offenders = readers
      .filter((step) => !/^ {10}GH_REPO: /m.test(step.body))
      .map((step) => step.name || '(unnamed)')
    expect(offenders).toEqual([])
  })
})

describe('judge-guard.yml never fails the job on bookkeeping', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const steps = stepsOf(yaml)

  it("tolerates a failure saving the picker's raw output", () => {
    const save = steps.find(
      (step) => step.name === "Save the picker's raw output",
    )
    expect(save?.body).toMatch(/^ {8}continue-on-error: true$/m)
  })

  it('still posts the guard check unconditionally, after all the bookkeeping', () => {
    const check = steps.find((step) => step.name === 'Post the guard check')
    expect(check?.body).toMatch(/^ {8}if: always\(\)$/m)
  })
})

describe('judge-guard.yml prices, caps and dispatches the sweep (ENG-11592)', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8')
  const steps = stepsOf(yaml)

  it('tolerates a crash in pricing, dispatching, or verdict resolution', () => {
    const names = [
      'Price the final agent set and apply the spend cap',
      'Dispatch the sweep and wait for its report',
      'Determine the sweep verdict',
    ]
    for (const name of names) {
      const step = steps.find((s) => s.name === name)
      expect(step, `missing step: ${name}`).toBeDefined()
      expect(step?.body).toMatch(/^ {8}continue-on-error: true$/m)
    }
  })

  it('gates the dispatch and the verdict read on the cap actually letting something run', () => {
    for (const name of [
      'Dispatch the sweep and wait for its report',
      'Determine the sweep verdict',
    ]) {
      const step = steps.find((s) => s.name === name)
      expect(step?.body).toContain("if: steps.cap.outputs.agents_to_run != ''")
    }
  })

  // PR #3737: the previous push's sweep was cancelled only by this run's own
  // dispatch, after the relay was read, so its spend reached the cap a push
  // late and the PR went past $50.
  it("settles the previous push's sweep before reading the spend relay", () => {
    const body =
      steps.find((s) => s.name === "Fetch this PR's guard spend so far")
        ?.body ?? ''
    const cancel = body.indexOf('gh run cancel "$id"')
    const watch = body.indexOf('gh run watch "$id"')
    const read = body.indexOf('judge-guard-spend-pr-$PR_NUMBER')
    expect(cancel).toBeGreaterThan(-1)
    expect(watch).toBeGreaterThan(cancel)
    expect(read).toBeGreaterThan(watch)
    expect(body).toContain(
      '.display_title == \\"Universal Judge request: PR #$PR_NUMBER\\"',
    )
    expect(body).toContain(
      '.triggering_actor.login == \\"github-actions[bot]\\"',
    )
  })

  it('names the "Universal judge (shadow)" check exactly, with no other name', () => {
    expect(yaml).toContain('name: "Universal judge (shadow)"')
  })

  // gh's default 3-second refresh spends the repository's shared
  // GITHUB_TOKEN allowance (1,000 requests an hour on the Team plan) about
  // 17 minutes into a sweep, failing every other workflow in omni with it.
  it('watches the dispatched sweep at no faster than once a minute', () => {
    const watches = [...yaml.matchAll(/^\s+gh run watch .*$/gm)].map(
      (m) => m[0],
    )
    expect(watches.length).toBeGreaterThan(0)
    for (const watch of watches) {
      const interval = /--interval (\d+)/.exec(watch)?.[1]
      expect(Number(interval), watch).toBeGreaterThanOrEqual(60)
    }
  })
})
