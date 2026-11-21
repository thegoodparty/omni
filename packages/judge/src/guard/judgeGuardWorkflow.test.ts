import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/judge-guard.yml')
const SCRIPTS = path.join(REPO_ROOT, '.github/scripts')
const yaml = readFileSync(WORKFLOW, 'utf8')

interface Step {
  name: string
  body: string
}

const steps: Step[] = yaml
  .split(/^ {6}- /m)
  .slice(1)
  .map((part) => ({
    name: /^name: (.*)/.exec(part)?.[1]?.trim() ?? '',
    body: part,
  }))

const step = (name: string): Step => {
  const found = steps.find((s) => s.name === name)
  expect(found, `missing step: ${name}`).toBeDefined()
  return found as Step
}

describe('judge-guard.yml trigger and gates', () => {
  it('runs on pull_request_target', () => {
    expect(yaml).toMatch(
      /^on:\n {2}pull_request_target:\n {4}types: \[opened, reopened, ready_for_review, synchronize\]$/m,
    )
  })

  it('gates the only job on the JUDGE_GUARD_ENABLED switch, refusing forks and drafts', () => {
    const guardJob = yaml.slice(yaml.indexOf('\n  guard:\n'))
    const jobIf = /^ {4}if: >-\n((?: {6}.*\n)*)/m.exec(guardJob)?.[1] ?? ''
    expect(jobIf).toContain("vars.JUDGE_GUARD_ENABLED == 'true'")
    expect(jobIf).toContain('github.event.pull_request.head.repo.fork == false')
    expect(jobIf).toContain('github.event.pull_request.draft == false')
  })

  it('gates the concurrency group on the same switch, with a per-run fallback', () => {
    const group = /^concurrency:\n {2}group: >-\n((?: {4}.*\n)*)/m.exec(
      yaml,
    )?.[1]
    expect(group).toContain("vars.JUDGE_GUARD_ENABLED == 'true'")
    expect(group).toContain(
      "format('judge-guard-pr-{0}', github.event.pull_request.number)",
    )
    expect(group).toContain("format('judge-guard-noop-{0}', github.run_id)")
  })

  it('checks out main only, never the PR head', () => {
    expect(yaml).not.toMatch(/^\s+ref:/m)
  })
})

describe('judge-guard.yml holds no AWS', () => {
  it('requests no id-token and configures no AWS credentials', () => {
    expect(yaml).not.toContain('id-token: write')
    expect(yaml).not.toContain('aws-actions/configure-aws-credentials')
  })

  it('grants only what the checks, the comment and the dispatch need', () => {
    const permissions = /^permissions:\n((?: {2}.*\n)*)/m.exec(yaml)?.[1] ?? ''
    const granted = [...permissions.matchAll(/^ {2}([\w-]+): (\w+)/gm)]
      .map((m) => `${m[1]}:${m[2]}`)
      .sort()
    expect(granted).toEqual([
      'actions:write',
      'checks:write',
      'contents:read',
      'pull-requests:write',
    ])
  })

  it('pins every action to a commit SHA', () => {
    const uses = [...yaml.matchAll(/^\s+- uses: (\S+)|^\s+uses: (\S+)/gm)]
      .map((m) => m[1] ?? m[2] ?? '')
      .filter((u) => !u.startsWith('./'))
    expect(uses.length).toBeGreaterThan(0)
    for (const u of uses) {
      expect(u, u).toMatch(/@[0-9a-f]{40}$/)
    }
  })

  it('dispatches judge-eval.yml and never calls a workflow with uses:', () => {
    expect(yaml).toContain('gh workflow run judge-eval.yml')
    expect(yaml).not.toMatch(/uses: \.\/\.github\/workflows\//)
  })
})

describe('judge-guard.yml cancellation and failure handling', () => {
  it('uses !cancelled() after the dispatch, never always()', () => {
    expect(yaml).not.toContain('always()')
    for (const name of [
      'Dispatch judge-eval and wait for its verdicts',
      'Determine the verdict',
      'Post the guard check',
      'Upsert the guard comment',
    ]) {
      expect(step(name).body, name).toContain('!cancelled()')
    }
  })

  it('tolerates a crash in the picker, the dispatch and the verdict read', () => {
    for (const name of [
      'Run the picker',
      'Dispatch judge-eval and wait for its verdicts',
      'Determine the verdict',
    ]) {
      expect(step(name).body, name).toMatch(/^ {8}continue-on-error: true$/m)
    }
  })

  it('never posts a failure conclusion', () => {
    expect(yaml).not.toMatch(/CONCLUSION="failure"|conclusion: "?failure/)
    const post = step('Post the guard check').body
    const conclusions = [...post.matchAll(/CONCLUSION="([^"]*)"/g)].map(
      (m) => m[1],
    )
    expect(conclusions.length).toBeGreaterThan(0)
    for (const conclusion of conclusions) {
      expect(conclusion).toMatch(
        /^(success|\$\{VERDICT_CONCLUSION:-neutral\})$/,
      )
    }
  })

  it('names the "Universal judge (shadow)" check exactly', () => {
    expect(yaml).toContain('name: "Universal judge (shadow)"')
    expect(yaml).toMatch(/^name: Universal judge guard \(shadow\)$/m)
  })

  it('watches the dispatched run no faster than once a minute', () => {
    const watches = [...yaml.matchAll(/^\s+gh run watch .*$/gm)].map(
      (m) => m[0],
    )
    expect(watches.length).toBeGreaterThan(0)
    for (const watch of watches) {
      expect(
        Number(/--interval (\d+)/.exec(watch)?.[1]),
        watch,
      ).toBeGreaterThanOrEqual(60)
    }
  })
})

describe('judge-guard.yml skips the case scout', () => {
  it('self-tests both classifiers before trusting them', () => {
    const floor = step('Derive the path-matched floor').body
    expect(floor).toContain('judge-path-floor.self-test.sh')
    expect(floor).toContain('judge-cases-only.self-test.sh')
    expect(floor).toContain('echo "cases_only=$cases_only" >> "$GITHUB_OUTPUT"')
  })

  it('skips the picker on it and posts "No suite reached" first', () => {
    expect(step('Run the picker').body).toMatch(
      /^ {8}if: steps\.floor\.outputs\.cases_only != 'true'$/m,
    )
    const post = step('Post the guard check').body
    const casesBranch = post.indexOf('if [ "$CASES_ONLY" = "true" ]; then')
    expect(casesBranch).toBeGreaterThan(-1)
    expect(casesBranch).toBeLessThan(post.indexOf('elif'))
    expect(post.slice(casesBranch, post.indexOf('elif'))).toContain(
      'TITLE="No suite reached"',
    )
  })

  it.each(['judge-path-floor.self-test.sh', 'judge-cases-only.self-test.sh'])(
    'passes %s',
    (script) => {
      expect(() =>
        execFileSync('bash', [path.join(SCRIPTS, script)], { stdio: 'pipe' }),
      ).not.toThrow()
    },
  )
})
