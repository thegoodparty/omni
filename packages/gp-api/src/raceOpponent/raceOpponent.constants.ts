export const RACE_OPPONENT_COLLECTION = 'race_opponent_collection'
export const KNOW_YOUR_OPPONENT_FEATURE = 'win-know-your-opponent'
export const SELF_RESEARCH = 'self_research'

// Mirrors campaignStrategy's MAX_SECTION_ATTEMPTS: a failing-and-retried (or
// hammered) self-research pass can claim at most this many paid Fargate runs
// over its lifetime before the orchestrator surfaces retry instead of looping.
export const MAX_SELF_RESEARCH_ATTEMPTS = 10
