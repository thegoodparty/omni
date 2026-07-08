export const RACE_OPPONENT_COLLECTION = 'race_opponent_collection'
export const RACE_OPPONENT_SUMMARY = 'race_opponent_summary'
export const RACE_OPPONENT_ACTIONS = 'race_opponent_actions'
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

// Contrast category allowlist: only an opponent's PUBLIC CONDUCT may become a
// contrast. Family, health, private life, and unsourced rumor are off-limits
// regardless of what an agent surfaces — enforced server-side, not as a prompt
// suggestion. A finding whose normalized category is not in this set yields no
// contrast. Categories are normalized (lowercased, spaces/dashes -> '_') before
// the membership check so 'Public Record' and 'public-record' both match.
export const CONTRAST_ALLOWED_CATEGORIES = [
  'voting_record',
  'public_statements',
  'campaign_finance',
  'policy_position',
  'public_record',
  'attendance',
  'public_conduct',
] as const

// Words that inflate a factual contrast into an attack: imputed motive and
// character-attack adjectives. The tone pass strips them deterministically. A
// draft that still reads as near-the-line after stripping (i.e. a strip
// actually fired) is routed to the human fair-line review gate rather than
// returned directly. Deliberately narrow: only terms that are essentially
// always pejorative in a contrast. Words that are routine FACTUAL political
// vocabulary ('failed to vote on HB-412', 'the budget agenda', 'bought a
// building', 'secretly recorded') are NOT here — stripping them would mangle
// legitimate sourced contrasts.
export const CONTRAST_INFLATION_TERMS = [
  'corrupt',
  'crooked',
  'liar',
  'lying',
  'radical',
  'extremist',
  'dangerous',
  'disgraceful',
  'shameful',
  'reckless',
  'greedy',
  'selfish',
  'incompetent',
  'puppet',
] as const
