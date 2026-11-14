import { Inject, Injectable, Optional } from '@nestjs/common'
import { AGENTS, type AgentName } from './agents.registry'
import type { JudgeReplay } from './tools/judgeReplay'
import type { AgentRuntime, RunView } from './types'

export const AGENT_RUNTIME = Symbol('AGENT_RUNTIME')

@Injectable()
export class AgentsService {
  constructor(
    @Optional()
    @Inject(AGENT_RUNTIME)
    private readonly runtime: AgentRuntime | null = null,
  ) {}

  async run(
    name: AgentName,
    input: unknown,
    options?: { judgeReplay?: JudgeReplay },
  ): Promise<{ runId: string }> {
    const parsed: unknown = AGENTS[name].input.parse(input)
    return this.requireRuntime().run(name, parsed, options)
  }

  async getRun(runId: string): Promise<RunView> {
    return this.requireRuntime().getRun(runId)
  }

  private requireRuntime(): AgentRuntime {
    if (!this.runtime) {
      throw new Error(
        'No agent engine is bound to AGENT_RUNTIME; the engine branches provide one',
      )
    }
    return this.runtime
  }
}
