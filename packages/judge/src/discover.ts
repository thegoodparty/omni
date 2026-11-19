import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import fg from 'fast-glob'
import { isExpectedResultEvalSuite } from './expectedResult'
import { isPairwiseAgentEvalSuite, type PairwiseAgentEvalSuite } from './suite'

// Suites are TypeScript beside the agent, discovered by glob:
//
//   packages/gp-api/src/**/*.eval.ts
//
// A suite file may import gp-api runtime code, since every file the glob finds
// is loaded here, but only through relative paths: tsx runs from the repo
// root, where gp-api's `@/` alias does not resolve. The runner holds no AWS
// access, and its only input is the two URLs. The glob is relative to
// `checkoutRoot`, which defaults to the current working directory — the
// checkout the runner was started in.
//
// The glob is also what Vitest's eval config (`vitest.evals.config.ts`) uses,
// so a file here may be an expected-result suite instead. Those register their
// own Vitest tests and are skipped by this runner.

export const SUITE_GLOB = 'packages/gp-api/src/**/*.eval.ts'

export type DiscoveredSuite = {
  suite: PairwiseAgentEvalSuite<unknown>
  file: string
}

export type DiscoverSuitesOptions = {
  checkoutRoot: string
  // Suite names the run asked for, or 'all'.
  selected: 'all' | string[]
}

const loadSuitesFromFile = async (
  file: string,
): Promise<PairwiseAgentEvalSuite<unknown>[]> => {
  const module = (await import(pathToFileURL(file).href)) as {
    default?: unknown
    suites?: unknown
  }
  const candidates: unknown[] = []
  if (module.suites !== undefined) {
    if (!Array.isArray(module.suites)) {
      throw new Error(
        `${file} exports 'suites' but it is not an array; export one suite as the default, or several as 'suites'`,
      )
    }
    candidates.push(...module.suites)
  } else {
    candidates.push(module.default)
  }
  // A whole file that only defines expected-result suites belongs to Vitest.
  if (candidates.length > 0 && candidates.every(isExpectedResultEvalSuite)) {
    return []
  }
  const suites = candidates.filter(isPairwiseAgentEvalSuite)
  if (suites.length !== candidates.length) {
    throw new Error(
      `${file} does not export a pairwise agent eval suite; export one as the default, or several as 'suites'`,
    )
  }
  if (suites.length === 0) {
    throw new Error(`${file} exports no suites`)
  }
  return suites
}

export const discoverSuites = async ({
  checkoutRoot,
  selected,
}: DiscoverSuitesOptions): Promise<DiscoveredSuite[]> => {
  const root = isAbsolute(checkoutRoot) ? checkoutRoot : resolve(checkoutRoot)
  const files = (await fg(SUITE_GLOB, { cwd: root, absolute: true })).sort()
  if (files.length === 0) {
    throw new Error(
      `No suite files matched ${SUITE_GLOB} under ${root}. Suites live beside the agent they grade.`,
    )
  }

  const discovered: DiscoveredSuite[] = []
  for (const file of files) {
    for (const suite of await loadSuitesFromFile(file)) {
      discovered.push({ suite, file })
    }
  }

  const names = new Map<string, string>()
  for (const { suite, file } of discovered) {
    const clash = names.get(suite.name)
    if (clash) {
      throw new Error(
        `Two suites are named '${suite.name}': ${clash} and ${file}`,
      )
    }
    names.set(suite.name, file)
  }

  if (selected === 'all') return discovered

  const wanted = new Set(selected)
  const unknown = selected.filter((name) => !names.has(name))
  if (unknown.length > 0) {
    throw new Error(
      `No suite named ${unknown.map((name) => `'${name}'`).join(', ')}. ` +
        `Known suites: ${[...names.keys()].sort().join(', ')}`,
    )
  }
  return discovered.filter(({ suite }) => wanted.has(suite.name))
}
