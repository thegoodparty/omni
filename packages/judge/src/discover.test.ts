import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverSuites, SUITE_GLOB } from './discover'

const checkoutWith = async (files: Record<string, string>): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'judge-checkout-'))
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, contents)
  }
  return root
}

// The suite module is loaded from the checkout under test, so the fixture has to
// reach the framework by absolute path: the checkout has no node_modules.
const FRAMEWORK = join(process.cwd(), 'packages/judge/src/suite.ts')

const fixtureSuite = (name: string, caseId = 'case-1'): string => `
const { definePairwiseAgentEvalSuite } = require(${JSON.stringify(FRAMEWORK)})
exports.default = definePairwiseAgentEvalSuite(${JSON.stringify(name)}, {
  mode: 'win',
  profile: {},
  run: async () => 'out',
  cases: [{ id: ${JSON.stringify(caseId)}, input: { topic: 't' } }],
})
`

describe('discoverSuites', () => {
  it('globs suites under packages/gp-api/src only', async () => {
    const root = await checkoutWith({
      'packages/gp-api/src/a/a.eval.ts': fixtureSuite('a'),
      'packages/gp-api/src/b/b.eval.ts': fixtureSuite('b'),
      'packages/gp-api/src/c/c.eval.tsx': 'export default {}',
      'packages/judge/src/d.eval.ts': fixtureSuite('d'),
    })
    const found = await discoverSuites({ checkoutRoot: root, selected: 'all' })
    expect(found.map(({ suite }) => suite.name).sort()).toEqual(['a', 'b'])
    expect(SUITE_GLOB).toBe('packages/gp-api/src/**/*.eval.ts')
  })

  it('fails loudly when nothing matches', async () => {
    const root = await checkoutWith({ 'packages/gp-api/src/a/a.ts': '' })
    await expect(
      discoverSuites({ checkoutRoot: root, selected: 'all' }),
    ).rejects.toThrow(/No suite files matched/)
  })

  it('selects named suites and ignores the rest', async () => {
    const root = await checkoutWith({
      'packages/gp-api/src/a/a.eval.ts': fixtureSuite('a'),
      'packages/gp-api/src/b/b.eval.ts': fixtureSuite('b'),
    })
    const found = await discoverSuites({
      checkoutRoot: root,
      selected: ['b'],
    })
    expect(found.map(({ suite }) => suite.name)).toEqual(['b'])
  })

  it('names the unknown suites it was asked for, and the known ones', async () => {
    const root = await checkoutWith({
      'packages/gp-api/src/a/a.eval.ts': fixtureSuite('a'),
    })
    await expect(
      discoverSuites({ checkoutRoot: root, selected: ['nope'] }),
    ).rejects.toThrow(/No suite named 'nope'.*Known suites: a/s)
  })

  it('refuses two suites with the same name', async () => {
    const root = await checkoutWith({
      'packages/gp-api/src/a/a.eval.ts': fixtureSuite('same'),
      'packages/gp-api/src/b/b.eval.ts': fixtureSuite('same'),
    })
    await expect(
      discoverSuites({ checkoutRoot: root, selected: 'all' }),
    ).rejects.toThrow(/Two suites are named 'same'/)
  })

  it('reads several suites from one file via `suites`', async () => {
    const root = await checkoutWith({
      'packages/gp-api/src/a/a.eval.ts': `
        const { definePairwiseAgentEvalSuite } = require(${JSON.stringify(FRAMEWORK)})
        const make = (name) => definePairwiseAgentEvalSuite(name, {
          mode: 'win', profile: {}, run: async () => 'out',
          cases: [{ id: 'case-1', input: {} }],
        })
        exports.suites = [make('one'), make('two')]
      `,
    })
    const found = await discoverSuites({ checkoutRoot: root, selected: 'all' })
    expect(found.map(({ suite }) => suite.name)).toEqual(['one', 'two'])
  })

  it('refuses a file that exports no suite', async () => {
    const root = await checkoutWith({
      'packages/gp-api/src/a/a.eval.ts': 'export default { notASuite: true }',
    })
    await expect(
      discoverSuites({ checkoutRoot: root, selected: 'all' }),
    ).rejects.toThrow(/does not export a pairwise agent eval suite/)
  })
})
