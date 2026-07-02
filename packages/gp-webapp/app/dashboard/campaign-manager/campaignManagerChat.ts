'use client'

import { createAgentChatClient } from '../shared/agent-chat/chatClient'

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

export type StoryField = 'why' | 'background' | 'positions'

// The next-question prompt per story field. Mirrors the gp-api
// STORY_QUESTION_PROMPTS wording (kept in sync by hand; display copy, not a
// contract) so the client opener and the server-seeded greeting read the same.
const STORY_QUESTION_PROMPTS: Record<StoryField, string> = {
  why:
    'your why: the moment, the people, the breaking point, your stump-speech ' +
    'opener. What made you decide to run?',
  background:
    'your background: childhood, career, and community ties, the human story ' +
    'behind you. Tell me a little about yourself.',
  positions:
    'your positions: the two to four concrete fights you would take on in ' +
    'your first term. What are they?',
}

// Resume-aware opener played when the Campaign Story is unfinished: introduces
// the manager (or welcomes them back), then asks the first still-missing
// question, so opening the chat picks up where they left off. Mirrors the
// server-seeded buildStoryGreeting.
export const buildStoryOpener = (missing: StoryField[]): string[] => {
  const next = missing[0] ?? 'why'
  const answered = 3 - missing.length
  const intro =
    answered === 0
      ? [
          "Hi, I'm your campaign manager. Before I build your plan and " +
            "tracker, let's get your Campaign Story down, since it's what " +
            'personalizes your Campaign Plan, Campaign Tracker, and your ' +
            'GoodParty.org experience.',
          "It's just three short questions, in your own words, and I can " +
            'help sharpen anything you write.',
        ]
      : [
          "Welcome back. Let's finish your Campaign Story so I can build " +
            'your plan and tracker.',
        ]
  const lead = answered === 0 ? 'First' : 'Next'
  return [...intro, `${lead}, ${STORY_QUESTION_PROMPTS[next]}`]
}

export const campaignManagerChatApi = createAgentChatClient(
  'campaign_assistant',
  'campaign-manager-chat',
)
