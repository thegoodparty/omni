import {
  meetingBriefingAgent,
  meetingBriefingSingleStageAgent,
} from './meetingBriefing/meetingBriefing.agent'

export { defineAgent } from './defineAgent'

export const AGENTS = {
  meetingBriefing: meetingBriefingAgent,
  meetingBriefingSingleStage: meetingBriefingSingleStageAgent,
}

export type AgentName = keyof typeof AGENTS

export const isAgentName = (name: string): name is AgentName => name in AGENTS
