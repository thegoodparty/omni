import {
  meetingBriefingAgent,
  meetingBriefingSingleStageAgent,
} from './meetingBriefing/meetingBriefing.agent'

import { briefingChatAgent } from './briefingChat/briefingChat.agent'

export { defineAgent } from './defineAgent'

export const AGENTS = {
  meetingBriefing: meetingBriefingAgent,
  meetingBriefingSingleStage: meetingBriefingSingleStageAgent,
}

export type AgentName = keyof typeof AGENTS

export const isAgentName = (name: string): name is AgentName => name in AGENTS

// Chat agents. A turn runs on the same engine as a background run, on the
// conversation's own thread.
export const CHAT_AGENTS = {
  briefingChat: briefingChatAgent,
}
