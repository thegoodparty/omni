import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = join(__dirname, '../../..')

// deploy/ is a Pulumi program on its own dependency tree and is excluded
// from this package's tsconfig, so the deployed literal is only readable as
// source text.
const PULUMI_PATH = 'deploy/index.ts'
const ENV_TEST_PATH = '.env.test'
const ENV_EXAMPLE_PATH = '.env.example'

const PULUMI_PATTERN = /\bAI_MODELS:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g

const DOTENV_PATTERN =
  /^[ \t]*AI_MODELS[ \t]*=[ \t]*(?:"([^"]*)"|'([^']*)'|([^#\r\n]*))/gm

const readAiModels = (relativePath: string, pattern: RegExp): string => {
  const source = readFileSync(join(PACKAGE_ROOT, relativePath), 'utf-8')
  const values = [...source.matchAll(pattern)].map((match) =>
    (match[1] ?? match[2] ?? match[3] ?? '').trim(),
  )
  const [value] = values

  if (values.length !== 1 || !value) {
    throw new Error(
      [
        `Expected one readable AI_MODELS value in ${relativePath}, found`,
        `${values.length}: ${JSON.stringify(values)}.`,
        'This test can no longer see the value it guards, so it would',
        'pass vacuously. Fix the pattern in',
        'src/shared/env/aiModels.test.ts before changing the model.',
      ].join(' '),
    )
  }

  return value
}

const driftMessage = (path: string, value: string, deployed: string) =>
  [
    `AI_MODELS drift: ${PULUMI_PATH} and ${path} name different models.`,
    `  ${PULUMI_PATH} -> '${deployed}'  (what actually deploys)`,
    `  ${path} -> '${value}'`,
    'Change both in one commit. A model changed only in the Pulumi config',
    'ships to production while every test run, both arms of a Universal',
    'Judge sweep, and every local dev server keep using the old one, so',
    'the suite stays green through a real behaviour change.',
  ].join('\n')

describe('AI_MODELS', () => {
  it('matches between deploy/index.ts and .env.test', () => {
    const deployed = readAiModels(PULUMI_PATH, PULUMI_PATTERN)
    const forTests = readAiModels(ENV_TEST_PATH, DOTENV_PATTERN)

    expect(forTests, driftMessage(ENV_TEST_PATH, forTests, deployed)).toBe(
      deployed,
    )
  })

  it('matches between deploy/index.ts and .env.example', () => {
    const deployed = readAiModels(PULUMI_PATH, PULUMI_PATTERN)
    const forLocal = readAiModels(ENV_EXAMPLE_PATH, DOTENV_PATTERN)

    expect(forLocal, driftMessage(ENV_EXAMPLE_PATH, forLocal, deployed)).toBe(
      deployed,
    )
  })
})
