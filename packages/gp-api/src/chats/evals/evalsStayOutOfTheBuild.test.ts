import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// tsconfig.build.json and .swcrc.build.json both drop `src/chats/evals/**`
// from the production build, and its own comment states the invariant that
// makes that safe: "Nothing outside src/chats/evals imports them."
//
// Nothing enforced it. A module that ships importing one that does not
// type-checks, lints and passes vitest — all three read tsconfig.json, which
// excludes neither — and then throws MODULE_NOT_FOUND on the first `require`
// inside the container. ECS reports that as a task that keeps stopping and
// the deployment circuit breaker fails the rollout, which is a long way from
// the import that caused it. That happened once, on the judge telemetry
// guard, which imported judgeFixtureIdentity for a single string.
//
// The fix in that case is the one judgeTelemetry.util.ts already used for
// JUDGE_ORG_SLUG_PREFIX: copy the constant to the shipping side and assert
// here, from the test side, that the two agree. Test files may import the
// harness as freely as they like, because they never ship.
const SRC = resolve(__dirname, '../..')
const EVALS = resolve(SRC, 'chats/evals')

const IGNORED_DIRS = new Set(['node_modules', 'generated'])

const isTestFile = (path: string): boolean =>
  /\.(test|spec)\.ts$/.test(path) || path.endsWith('.d.ts')

const tsFilesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      return IGNORED_DIRS.has(entry) || path === EVALS ? [] : tsFilesUnder(path)
    }
    return path.endsWith('.ts') && !isTestFile(path) ? [path] : []
  })

// Only an actual module specifier counts. Prose that names a path under
// src/chats/evals is normal and good in a comment explaining why a constant
// was copied rather than imported, and must not fail this.
const EVAL_IMPORT =
  /(?:from\s*|require\(\s*|import\(\s*)['"]([^'"]*chats\/evals\/[^'"]*)['"]/g

describe('src/chats/evals is not reachable from the production build', () => {
  it('is imported by no shipping module', () => {
    const offenders = tsFilesUnder(SRC).flatMap((file) => {
      const specifiers = [
        ...readFileSync(file, 'utf8').matchAll(EVAL_IMPORT),
      ].map((match) => match[1])
      return specifiers.map(
        (specifier) => `${relative(SRC, file)} imports ${specifier}`,
      )
    })

    expect(offenders).toEqual([])
  })
})
