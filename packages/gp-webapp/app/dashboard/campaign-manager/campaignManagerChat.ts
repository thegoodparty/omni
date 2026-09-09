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

// The kickoff the "Let's get you on the ballot" home card fires. Unlike the
// story and product-overview sentinels this is real English sent straight to the
// model: the answer has to be specific to the candidate's office and state, so
// it runs a normal LLM turn against the ballot-access guidance in the system
// prompt rather than a canned reply. Deliberately NOT added to the chat's
// hiddenMessageContents: hiding a message makes the reload path drop the
// assistant turn after it, which would erase the filing answer. It is sent with
// the kickoff's hidden flag so no user bubble appears live, and reads as a
// normal question the candidate asked when the thread is replayed.
export const CAMPAIGN_MANAGER_BALLOT_KICKOFF =
  'How do I get on the ballot for my race?'

// The two kickoffs the "you are clear for the week" cards fire. Same shape and
// same reasoning as the ballot kickoff above: real English, a normal LLM turn,
// and deliberately NOT in hiddenMessageContents.
//
// They are kickoffs rather than links because neither has a surface to link to.
// There is no events page (an event is a tracker task with flowType `events`),
// and no endpoint aggregates what a campaign learned from its own outreach, so
// the review has to run through the manager's own tools (count_contacts,
// describe_filter_dimensions, query_constituent_data) instead of reading a
// summary that does not exist.
export const CAMPAIGN_MANAGER_EVENT_KICKOFF =
  'Help me plan a campaign event in the next two weeks. Suggest a format and ' +
  'a place that fits my district.'

export const CAMPAIGN_MANAGER_OUTREACH_REVIEW_KICKOFF =
  'Looking at the voter outreach I have done so far, who have I reached, who ' +
  'is still undecided, and where should I go deeper next?'

// Fired when the candidate answers that they never made the ballot. The
// supportive close ("try again next cycle, we will be here") is the manager's
// reply, not card copy, so it can meet the candidate where they are — which
// also means the tone lives in campaignManagerPrompt.ts, not here.
export const CAMPAIGN_MANAGER_MISSED_BALLOT_KICKOFF =
  'The filing deadline passed and I did not make it onto the ballot for this ' +
  'election. What should I do now?'

export const campaignManagerChatApi = createAgentChatClient(
  'campaign_assistant',
  'campaign-manager-chat',
)
