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

// The hidden kickoff the "Let's get you on the ballot" home card fires. Unlike
// the story and product-overview sentinels this is real English sent straight
// to the model: the answer has to be specific to the candidate's office and
// state, so it runs a normal LLM turn against the ballot-access guidance in the
// system prompt rather than a canned reply. Hidden from the transcript so the
// manager reads as opening the topic itself.
export const CAMPAIGN_MANAGER_BALLOT_KICKOFF =
  'How do I get on the ballot for my race?'

export const campaignManagerChatApi = createAgentChatClient(
  'campaign_assistant',
  'campaign-manager-chat',
)
