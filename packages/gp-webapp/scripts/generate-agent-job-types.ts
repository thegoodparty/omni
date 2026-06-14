/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { compile, JSONSchema } from 'json-schema-to-typescript'
import RefParser from '@apidevtools/json-schema-ref-parser'
import prettier from 'prettier'

// Experiment manifests live in the runbooks package, a sibling workspace.
// Read them straight off disk — no S3 publish needed to regenerate contracts,
// and the schemas reflect whatever is on the current branch. Enumeration
// mirrors publish_experiments.py: every dir except `_schema` and dotfiles,
// sorted by name so generated output is deterministic.
const experimentsDir = `${__dirname}/../../runbooks/experiments`

// Deep-sort object keys so generated output is stable and order-independent of
// how a manifest happens to be authored. Mirrors the publisher's
// `json.dumps(sort_keys=True)`, which is what every consumer saw historically.
const sortKeys = (value: any): any =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sortKeys(value[key])]),
        )
      : value

const main = async () => {
  const experimentIds = readdirSync(experimentsDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== '_schema' &&
        !entry.name.startsWith('.'),
    )
    .map((entry) => entry.name)
    .sort()

  const jobSchemas: Record<string, JSONSchema> = {}

  for (const id of experimentIds) {
    const manifestPath = `${experimentsDir}/${id}/manifest.json`
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

    // Pass manifestPath as the base so external refs like
    // `../_schema/manifest.schema.json#/$defs/X` resolve against the real
    // meta-schema, while internal `#/definitions` refs resolve against the
    // passed schema. (The publisher used to inline these before upload.)
    const inputSchema = await RefParser.dereference(
      manifestPath,
      manifest.input_schema,
      {},
    )
    const outputSchema = await RefParser.dereference(
      manifestPath,
      manifest.output_schema,
      {},
    )

    jobSchemas[id] = {
      type: 'object',
      additionalProperties: false,
      required: ['Input', 'Output'],
      properties: {
        Input: sortKeys(inputSchema) as JSONSchema,
        Output: sortKeys(outputSchema) as JSONSchema,
      },
    }
  }

  const outputPath = 'gpApi/generated/agent-job-contracts.ts'

  const types = await compile(
    {
      type: 'object',
      additionalProperties: false,
      properties: jobSchemas,
      required: Object.keys(jobSchemas),
    },
    'AgentJobContracts',
    {
      bannerComment: '',
    },
  )

  const prettierConfig = await prettier.resolveConfig(outputPath)
  const formatted = await prettier.format(types, {
    ...prettierConfig,
    parser: 'typescript',
  })

  writeFileSync(outputPath, formatted)

  console.log('✅ Agent job contracts generated')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
