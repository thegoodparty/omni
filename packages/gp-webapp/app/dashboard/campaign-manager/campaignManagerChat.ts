'use client'

import { createManagerChatClient } from '../shared/manager-chat/chatClient'

// Campaign Manager's own conversation-history query key, kept distinct from
// Chief of Staff so the two scopes never share a cache entry.
export const CAMPAIGN_MANAGER_HISTORY_KEY = [
  'campaign-manager',
  'chat-history',
] as const

// Static, non-persisted greeting played when "meet your campaign manager" opens
// the chat. The real conversation begins on the candidate's first message.
export const CAMPAIGN_MANAGER_INTRO: string[] = [
  "Hi, I'm your campaign manager.",
  'I keep an eye on your plan and tell you the two or three things that matter ' +
    'most this week, and what to do about them.',
  'Ask me what to do next, or tell me what just happened and I will help you ' +
    'handle it.',
]

export const campaignManagerChatApi = createManagerChatClient(
  'campaign_assistant',
  'campaign-manager-chat',
)
