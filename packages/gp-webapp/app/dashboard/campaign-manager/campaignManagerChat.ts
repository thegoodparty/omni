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
// Mirrors gp-api's buildCampaignManagerGreeting (kept in sync by hand; it is
// display copy, not a cross-service contract). First-name aware to match: the
// server bakes the candidate's first name into its own seeded greeting.
export const buildCampaignManagerIntro = (
  firstName?: string | null,
): string[] => [
  firstName
    ? `Hi ${firstName}, I'm your Campaign Manager.`
    : "Hi, I'm your Campaign Manager.",
  "I can help you do things like understand your community's biggest " +
    'priorities, draft voter outreach, or prepare for upcoming events.',
  'How can I help today?',
]

export const campaignManagerChatApi = createAgentChatClient(
  'campaign_assistant',
  'campaign-manager-chat',
)
