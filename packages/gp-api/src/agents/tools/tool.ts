import type { ModuleRef } from '@nestjs/core'
import type { z } from 'zod'

export type ToolContext = {
  runId: string
  stepKey: string
  organizationSlug: string
  signal: AbortSignal
  moduleRef: ModuleRef
}

export type AgentTool<I extends z.ZodType = z.ZodType> = {
  name: string
  description: string
  input: I
  execute: (input: z.infer<I>, ctx: ToolContext) => Promise<unknown>
}
