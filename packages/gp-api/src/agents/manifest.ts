import { createHash } from 'node:crypto'
import { z } from 'zod'

// The schemas a saved run depends on: its input and its output. Prompts,
// models and tools are left out, so changing them never restarts a run in
// flight.
export type AgentManifest = {
  input: unknown
  output: unknown
}

export const agentManifest = (definition: {
  input: z.ZodType
  output: z.ZodType
}): AgentManifest => ({
  input: z.toJSONSchema(definition.input, { unrepresentable: 'any' }),
  output: z.toJSONSchema(definition.output, { unrepresentable: 'any' }),
})

// Hash of the manifest, so a run started under one shape is never resumed
// under another.
export const manifestShapeHash = (manifest: AgentManifest): string =>
  createHash('sha256')
    .update(JSON.stringify(manifest))
    .digest('hex')
    .slice(0, 12)
