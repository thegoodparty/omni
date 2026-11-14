import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { StageDefinition } from '../types'

// The shape a saved run depends on: stage names, their order and their
// output schemas. Prompts, models and tools are left out, so tweaking them
// never restarts a run in flight (notes, "Deploys and shape changes").
export const agentShapeHash = (
  stages: Record<string, StageDefinition>,
): string =>
  createHash('sha256')
    .update(
      JSON.stringify(
        Object.entries(stages).map(([name, stage]) => [
          name,
          z.toJSONSchema(stage.output, { unrepresentable: 'any' }),
        ]),
      ),
    )
    .digest('hex')
    .slice(0, 12)

// A chat agent has no saved stages to protect; this only versions its spans.
export const chatShapeHash = (agent: {
  model: string
  tools: { name: string }[]
}): string =>
  createHash('sha256')
    .update(JSON.stringify([agent.model, agent.tools.map((t) => t.name)]))
    .digest('hex')
    .slice(0, 12)
