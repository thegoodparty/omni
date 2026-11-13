import type { ModuleRef } from '@nestjs/core'
import type { z } from 'zod'
import type { JudgeReplay } from './tools/judgeReplay'
import type { AgentTool } from './tools/tool'

export const END = '__end__'
export type StageDefinition = {
  prompt: string // path under src/agents/prompts/
  model: string
  tools: AgentTool[]
  reads: string[] // 'input' or earlier stage names
  output: z.ZodType
  next?: string | ((state: Record<string, unknown>) => string)
}
export type BackgroundAgentDefinition<
  I extends z.ZodType,
  O extends z.ZodType,
> = {
  input: I
  output: O
  stages: Record<string, StageDefinition> // single-stage agents: one entry
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
  stages: { name: string; status: string; steps: number; output?: unknown }[]
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
