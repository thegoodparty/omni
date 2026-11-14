import { briefingChatAgent } from './briefingChat/briefingChat.agent'
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

// Foreground agents: a user's turn streams through the engine's chat path.
export const CHAT_AGENTS = {
  briefingChat: briefingChatAgent,
}

export type ChatAgentName = keyof typeof CHAT_AGENTS
