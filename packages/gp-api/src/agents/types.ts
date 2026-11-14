import type { ModuleRef } from '@nestjs/core'
import type { z } from 'zod'
import type { JudgeReplay } from './tools/judgeReplay'
import type { AgentTool } from './tools/tool'

export type BackgroundAgentDefinition<
  I extends z.ZodType,
  O extends z.ZodType,
> = {
  input: I
  output: O
  model: string
  prompt: string // path under src/agents/prompts/
  tools: AgentTool[]
  onArtifact: (
    artifact: z.infer<O>,
    run: { runId: string; input: z.infer<I> },
    moduleRef: ModuleRef,
  ) => Promise<void>
}
export type ChatAgentDefinition = {
  model: string
  system: (ctx: {
    conversationId: string
    organizationSlug: string
    moduleRef: ModuleRef
  }) => Promise<string>
  tools: AgentTool[]
}
export type RunView = {
  runId: string
  agent: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'superseded'
  shapeHash: string
  steps: number
  supersededBy?: string
  artifact?: unknown
  costUsd?: number
  error?: string
}
export interface AgentRuntime {
  run(
    agent: string,
    input: unknown,
    options?: { judgeReplay?: JudgeReplay },
  ): Promise<{ runId: string }>
  getRun(runId: string): Promise<RunView>
}
