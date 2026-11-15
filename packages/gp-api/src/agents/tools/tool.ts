import type { z } from 'zod'
import type { WorkerContext } from '@/jobs/jobs.registry'

export type ToolContext = {
  runId: string
  // Stable across a resume of the same step, so a tool that writes can key
  // its side effect on runId + stepKey.
  stepKey: string
  organizationSlug: string
  signal: AbortSignal
  get: WorkerContext['get']
}

export type AgentTool<I extends z.ZodType = z.ZodType> = {
  name: string
  description: string
  input: I
  execute: (input: z.infer<I>, ctx: ToolContext) => Promise<unknown>
}
