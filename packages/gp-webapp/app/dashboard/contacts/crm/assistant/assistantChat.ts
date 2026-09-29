'use client'

import type {
  AgentChatClient,
  ChatScope,
} from '../../../shared/agent-chat/chatClient'
import { chiefOfStaffChatApi } from '../../../chief-of-staff/data/chat-api'
import { HISTORY_KEY } from '../../../chief-of-staff/data/use-chat-history'
import {
  CAMPAIGN_MANAGER_HISTORY_KEY,
  campaignManagerChatApi,
} from '../../../campaign-manager/campaignManagerChat'

export const ASSISTANT_PLACEHOLDER =
  "Describe the list you want and I'll make it for you"

export interface AssistantChatBinding {
  chatApi: AgentChatClient
  historyKey: readonly unknown[]
  scope: ChatScope
  // The agent's own display name for the surface header. The point of the
  // consolidation is that a candidate meets ONE assistant, so the contacts
  // entry point names the agent it actually opens rather than a list-shaped
  // alias for it; the list-building framing moves to the subtitle.
  agentName: string
  analyticsLabel: string
}

// No dedicated ChatScope for this surface (a new scope needs a migration and
// isn't justified — ENG-10737): Win rides the Campaign Manager's
// campaign_assistant scope, Serve rides Chief of Staff. Reusing each scope's
// canonical client + history key keeps the conversation caches consistent
// with those surfaces instead of double-fetching the same list.
export const getAssistantChat = (
  isWinContext: boolean,
): AssistantChatBinding =>
  isWinContext
    ? {
        chatApi: campaignManagerChatApi,
        historyKey: CAMPAIGN_MANAGER_HISTORY_KEY,
        scope: 'campaign_assistant',
        agentName: 'Campaign manager',
        analyticsLabel: 'campaign-manager-chat',
      }
    : {
        chatApi: chiefOfStaffChatApi,
        historyKey: HISTORY_KEY,
        scope: 'chief_of_staff',
        agentName: 'Chief of Staff',
        analyticsLabel: 'chief-of-staff-chat',
      }
