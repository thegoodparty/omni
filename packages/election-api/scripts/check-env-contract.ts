/**
 * CI drift check: env.schema.ts vs .env.example.
 *
 * Asserts the two are in lockstep — every var the schema declares has a
 * line in .env.example and vice versa — and that every `required` var's
 * example line isn't left empty.
 *
 * Usage: npx tsx scripts/check-env-contract.ts
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { ENV_VAR_CONTRACT, EnvVarSpec } from '../src/shared/env/env.schema'

const ENV_EXAMPLE_PATH = join(__dirname, '../.env.example')

export type ParsedEnvExample = Record<string, string>

// KEY=value, KEY=, and KEY="quoted value" — comments and blank lines ignored.
// A trailing `# comment` on a value line is left in `value` on purpose: the
// only current callers check presence/emptiness, not the literal string.
export const parseEnvExample = (contents: string): ParsedEnvExample => {
  const result: ParsedEnvExample = {}
  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const match = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed)
    const key = match?.[1]
    const rawValue = match?.[2]
    if (!key || rawValue === undefined) continue

    const quoted = /^"(.*)"$/.exec(rawValue)
    result[key] = quoted?.[1] ?? rawValue
  }
  return result
}

export const checkEnvContract = (
  parsedExample: ParsedEnvExample,
  contract: Record<string, EnvVarSpec> = ENV_VAR_CONTRACT,
): string[] => {
  const errors: string[] = []
  const exampleKeys = new Set(Object.keys(parsedExample))
  const schemaKeys = new Set(Object.keys(contract))

  const missingFromExample = [...schemaKeys]
    .filter((key) => !exampleKeys.has(key))
    .sort()
  const missingFromSchema = [...exampleKeys]
    .filter((key) => !schemaKeys.has(key))
    .sort()

  if (missingFromExample.length > 0) {
    errors.push(
      `In env.schema.ts but missing from .env.example: ${missingFromExample.join(', ')}`,
    )
  }
  if (missingFromSchema.length > 0) {
    errors.push(
      `In .env.example but missing from env.schema.ts: ${missingFromSchema.join(', ')}`,
    )
  }

  const emptyRequired = Object.entries(contract)
    .filter(([, spec]) => spec.tier === 'required')
    .filter(([name]) => !parsedExample[name])
    .map(([name]) => name)
    .sort()

  if (emptyRequired.length > 0) {
    errors.push(
      `Required vars with no value in .env.example: ${emptyRequired.join(', ')}`,
    )
  }

  return errors
}

const main = () => {
  const parsedExample = parseEnvExample(readFileSync(ENV_EXAMPLE_PATH, 'utf-8'))
  const errors = checkEnvContract(parsedExample)

  if (errors.length > 0) {
    console.error('env.schema.ts and .env.example have drifted:\n')
    for (const error of errors) {
      console.error(`  - ${error}`)
    }
    process.exit(1)
  }

  console.log('env.schema.ts and .env.example match.')
}

if (require.main === module) {
  main()
}
