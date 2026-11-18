import type { z } from 'zod'
import type { WorkerContext } from '@/jobs/jobs.registry'
import type { AgentRunReplay } from './judgeReplay'

export type ToolContext = {
  runId: string
  // Stable across a resume of the same step, so a tool that writes can key
  // its side effect on runId + stepKey.
  stepKey: string
  organizationSlug: string
  signal: AbortSignal
  get: WorkerContext['get']
  // Set only on a Universal Judge run: web tools serve the base arm's
  // recorded pages first.
  judgeReplay?: AgentRunReplay
}

// One tool of an agent, keyed by its name in the agent's `tools` map. The name
// is the key, so a tool cannot be renamed in one place and not the other.
export type AgentTool<I extends z.ZodType = z.ZodType> = {
  description: string
  input: I
  execute: (input: z.infer<I>, ctx: ToolContext) => Promise<unknown>
}

// Identity at runtime. It is here so a tool gets the contextual typing an agent
// gets from defineAgent: execute's input is inferred from `input`, and ctx is a
// ToolContext.
export const defineTool = <I extends z.ZodType>(
  tool: AgentTool<I>,
): AgentTool<I> => tool
