import type { AgentDefinition } from './defineAgent'

// Every gp-api agent, by name. The name is the run's AgentRun.agentName. Start
// one with AgentsService.run(name, input).
export const AGENTS: Record<string, AgentDefinition> = {}
