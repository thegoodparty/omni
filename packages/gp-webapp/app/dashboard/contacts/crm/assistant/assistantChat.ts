'use client'

import type { AgentChatClient } from '../../../shared/agent-chat/chatClient'
import { chiefOfStaffChatApi } from '../../../chief-of-staff/data/chat-api'
import { HISTORY_KEY } from '../../../chief-of-staff/data/use-chat-history'
import {
  CAMPAIGN_MANAGER_HISTORY_KEY,
  campaignManagerChatApi,
} from '../../../campaign-manager/campaignManagerChat'
import { toolDisplayName } from '../../../chief-of-staff/components/chat/chatConstants'

// gp-api's saved-filter write tool (crud_saved_filters, ENG-10736). A
// tool_result for it means the assistant may have created/updated/deleted a
// saved list, so the lists index needs a refetch.
export const SAVED_FILTERS_TOOL = 'crud_saved_filters'

export const ASSISTANT_PLACEHOLDER =
  "Describe the list you want and I'll make it for you"

export interface AssistantChatBinding {
  chatApi: AgentChatClient
  historyKey: readonly unknown[]
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
      }
    : { chatApi: chiefOfStaffChatApi, historyKey: HISTORY_KEY }

const CRM_TOOL_LABELS: Record<string, string> = {
  describe_filter_dimensions: 'Checking available filters',
  count_contacts: 'Counting matches',
  [SAVED_FILTERS_TOOL]: 'Working on your lists',
}

// The CRM tools get list-building labels; anything else the scope's handler
// runs (web search, priorities, ...) falls back to the shared display names.
export const assistantToolLabel = (toolName: string): string =>
  CRM_TOOL_LABELS[toolName] ?? toolDisplayName(toolName)
