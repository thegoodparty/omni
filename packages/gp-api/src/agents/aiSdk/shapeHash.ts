import { createHash } from 'node:crypto'
import { z } from 'zod'

// The shape a saved run depends on: for now the agent's output schema.
// Prompts, models and tools are left out, so tweaking them never restarts a
// run in flight. Subagent names and output schemas join it when subagents do.
export const agentShapeHash = (output: z.ZodType): string =>
  createHash('sha256')
    .update(JSON.stringify(z.toJSONSchema(output, { unrepresentable: 'any' })))
    .digest('hex')
    .slice(0, 12)

// A chat agent has no saved run to protect; this only versions its spans.
export const chatShapeHash = (agent: {
  model: string
  tools: { name: string }[]
}): string =>
  createHash('sha256')
    .update(JSON.stringify([agent.model, agent.tools.map((t) => t.name)]))
    .digest('hex')
    .slice(0, 12)
