export const RACE_OPPONENT_COLLECTION = 'race_opponent_collection'
export const KNOW_YOUR_OPPONENT_FEATURE = 'win-know-your-opponent'
export const SELF_RESEARCH = 'self_research'
export const OPPONENT_RESEARCH = 'opponent_research'

// Mirrors campaignStrategy's MAX_SECTION_ATTEMPTS: a failing-and-retried (or
// hammered) self-research pass can claim at most this many paid Fargate runs
// over its lifetime before the orchestrator surfaces retry instead of looping.
export const MAX_SELF_RESEARCH_ATTEMPTS = 10

// Same lifetime cap as self-research, applied per opponent row: a
// failing-and-retried opponent pass can claim at most this many paid Fargate
// runs before start() surfaces retry instead of re-dispatching.
export const MAX_OPPONENT_RESEARCH_ATTEMPTS = 10

// Dataset-reference findings (e.g. an L2 residency match) carry a stable
// dataset URI in source_url rather than a fetchable URL. They skip the network
// reachability check — grounding is the broker's anti-fabrication gate. Detect
// them by scheme: anything that is not http(s) is treated as a dataset ref.
export const DATASET_SOURCE_SCHEMES = ['l2:']
