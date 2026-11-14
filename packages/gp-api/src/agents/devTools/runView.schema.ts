import { z } from 'zod'
import type { RunView } from '@/agents/types'

export const RunViewSchema: z.ZodType<RunView> = z.object({
  runId: z.string(),
  agent: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'superseded']),
  shapeHash: z.string(),
  steps: z.number(),
  supersededBy: z.string().optional(),
  artifact: z.unknown().optional(),
  costUsd: z.number().optional(),
  error: z.string().optional(),
})
