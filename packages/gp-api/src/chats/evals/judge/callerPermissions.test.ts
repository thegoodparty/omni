import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// A CALLED WORKFLOW IS CAPPED BY WHAT ITS CALLER HOLDS, and nothing in the
// called file can say so.
//
// judge.yml's sweep job asks for `id-token: write` — what it exchanges for
// the AWS credentials that stage a background config and send a dispatch.
// Adding it there and nowhere else made every sweep fail at STARTUP: before
// any job exists, so there is no log, no annotation and no failed step, just
// `startup_failure` and "This run likely failed because of a workflow file
// issue." The chat half went down with it, because neither job ever started.
//
// judgeWorkflow.test.ts asserts the permission is present in judge.yml. That
// is exactly the half that was already true. This file checks the other side.

const WORKFLOWS = join(__dirname, '../../../../../../.github/workflows')
const CALLERS = ['judge-request.yml', 'judge-comment.yml']

const read = (name: string): string =>
  readFileSync(join(WORKFLOWS, name), 'utf8')

// Every `name: write` under any `permissions:` block in the file. Deliberately
// not a YAML parse: this suite has no yaml dependency, and the question is a
// flat one — which write scopes does this file grant anywhere.
const writeScopes = (yaml: string): Set<string> =>
  new Set(
    [...yaml.matchAll(/^\s+([a-z-]+): write$/gm)]
      .map((match) => match[1])
      .filter((scope): scope is string => scope !== undefined),
  )

describe('what judge.yml asks for, its callers have to grant', () => {
  const required = writeScopes(read('judge.yml'))

  it('finds the write scopes judge.yml asks for', () => {
    expect([...required].sort()).toEqual(['id-token', 'pull-requests'])
  })

  it.each(CALLERS)('%s grants every one of them', (caller) => {
    const granted = writeScopes(read(caller))
    const missing = [...required].filter((scope) => !granted.has(scope))
    expect(
      missing,
      `${caller} calls judge.yml but never grants ${missing.join(', ')}, so ` +
        'the run fails at startup with no log and no failed step',
    ).toEqual([])
  })

  // On the calling job, not at the workflow level. judge-comment.yml's parse
  // job reads an untrusted comment body and has no business holding a token
  // that can assume an AWS role.
  it.each(CALLERS)('%s keeps id-token on the calling job', (caller) => {
    const yaml = read(caller)
    const header = yaml.slice(0, yaml.indexOf('jobs:'))
    expect(writeScopes(header).has('id-token')).toBe(false)
  })
})
