import { createHash } from 'node:crypto'
import { z } from 'zod'

// The shape a saved run depends on: for now the agent's output schema.
// Prompts, models and tools are left out, so changing them never restarts a
// run in flight.
export const agentShapeHash = (output: z.ZodType): string =>
  createHash('sha256')
    .update(JSON.stringify(z.toJSONSchema(output, { unrepresentable: 'any' })))
    .digest('hex')
    .slice(0, 12)
