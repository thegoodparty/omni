import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { ENV_VAR_CONTRACT } from './env.schema'

const ENV_EXAMPLE_PATH = join(__dirname, '.env.example')

// A duplicate object-literal key collapses silently at parse time (the
// second value wins, the first vanishes with no error), so ENV_VAR_CONTRACT
// itself can never prove there was no collision — only the source text can.
const SCHEMA_SOURCE_PATH = join(__dirname, './env.schema.ts')

const parseEnvExampleKeys = (): string[] =>
  readFileSync(ENV_EXAMPLE_PATH, 'utf-8')
    .split('\n')
    .map((line) => /^([A-Z0-9_]+)=/.exec(line)?.[1])
    .filter((key): key is string => Boolean(key))

const parseSchemaSourceKeys = (): string[] => {
  const source = readFileSync(SCHEMA_SOURCE_PATH, 'utf-8')
  const start = source.indexOf(
    'ENV_VAR_CONTRACT: Record<string, EnvVarSpec> = {'
  )
  const end = source.indexOf('\n}\n\nexport const envSchema', start)
  const block = source.slice(start, end)
  return [...block.matchAll(/^\s{2}([A-Z0-9_]+):\s*\{/gm)]
    .map((m) => m[1])
    .filter((key): key is string => Boolean(key))
}

describe('ENV_VAR_CONTRACT', () => {
  it('names every required var in .env.example', () => {
    const exampleKeys = new Set(parseEnvExampleKeys())
    const requiredKeys = Object.entries(ENV_VAR_CONTRACT)
      .filter(([, spec]) => spec.tier === 'required')
      .map(([name]) => name)

    expect(requiredKeys.length).toBeGreaterThan(0)
    for (const key of requiredKeys) {
      expect(exampleKeys.has(key)).toBe(true)
    }
  })

  it('matches .env.example exactly in both directions', () => {
    const exampleKeys = new Set(parseEnvExampleKeys())
    const schemaKeys = new Set(Object.keys(ENV_VAR_CONTRACT))

    const missingFromExample = [...schemaKeys].filter(
      (key) => !exampleKeys.has(key)
    )
    const missingFromSchema = [...exampleKeys].filter(
      (key) => !schemaKeys.has(key)
    )

    expect(missingFromExample).toEqual([])
    expect(missingFromSchema).toEqual([])
  })

  it('declares no var name twice', () => {
    const keys = parseSchemaSourceKeys()
    const duplicates = keys.filter((key, i) => keys.indexOf(key) !== i)

    expect(duplicates).toEqual([])
  })

  it('names a feature on every degradable entry', () => {
    const degradableWithoutFeature = Object.entries(ENV_VAR_CONTRACT)
      .filter(([, spec]) => spec.tier === 'degradable' && !spec.feature)
      .map(([name]) => name)

    expect(degradableWithoutFeature).toEqual([])
  })

  // gp-admin has no degradable vars today — every non-required var is either
  // a Dev/Prod-mirrored setting, an E2E credential, or a platform-set value.
  it('has no degradable entries', () => {
    const degradableKeys = Object.entries(ENV_VAR_CONTRACT)
      .filter(([, spec]) => spec.tier === 'degradable')
      .map(([name]) => name)

    expect(degradableKeys).toEqual([])
  })
})
