'use client'

import { createAgentChatClient } from '../shared/agent-chat/chatClient'

// Campaign Manager's own conversation-history query key, kept distinct from
// Chief of Staff so the two scopes never share a cache entry.
export const CAMPAIGN_MANAGER_HISTORY_KEY = [
  'campaign-manager',
  'chat-history',
] as const

// Fallback intro for the shared chat surface's `defaultIntro`. The manager
// normally opens straight into its persisted conversation (whose first message
// is the server-seeded, resume-aware greeting), so this only shows if resolving
// that conversation fails and the body drops to a fresh deferred-create chat.
export const CAMPAIGN_MANAGER_INTRO: string[] = [
  "Hi, I'm your campaign manager.",
  'I keep an eye on your plan and tell you the two or three things that matter ' +
    'most this week, and what to do about them.',
  'Ask me what to do next, or tell me what just happened and I will help you ' +
    'handle it.',
]

export const campaignManagerChatApi = createAgentChatClient(
  'campaign_assistant',
  'campaign-manager-chat',
)
