import {
  type LucideIcon,
  MessageSquare,
  Smile,
  Sun,
  Target,
} from 'lucide-react'

// Poll / Survey campaign data. Audiences / pools / time shared with SMS.
// Poll-specific: topics, its own tone set (Neutral…), a bias heuristic, $ per reply.

export {
  type Audience,
  AUDIENCES,
  DEFAULT_AUDIENCE,
  FILTER_POOLS,
  TIME_OPTIONS,
  estimateAudienceSize,
  formatMoney,
} from './smsData'

export const POLL_COST_PER_RECIPIENT = 0.035

const CANDIDATE_FIRST_NAME = 'Renee'
const CANDIDATE_ROLE_SHORT = 'City Council'

export const pollIntroFor = (): string =>
  `Hi, this is ${CANDIDATE_FIRST_NAME} from ${CANDIDATE_ROLE_SHORT}.`

export const POLL_TONES = ['Neutral', 'Warm', 'Direct', 'Friendly'] as const
export type PollTone = (typeof POLL_TONES)[number]
export const POLL_TONE_ICONS: Record<PollTone, LucideIcon> = {
  Neutral: MessageSquare,
  Warm: Sun,
  Direct: Target,
  Friendly: Smile,
}

export type PollTopicId =
  | 'public-safety-cameras'
  | 'affordable-housing'
  | 'northside-road-repair'
  | 'after-school-funding'
  | 'transit-reliability'
  | 'park-maintenance'
  | 'drone-noise-ordinance'
  | 'ev-charging-public-lots'
  | 'community-composting'
  | 'custom'

// `question` is the backend-free canned poll body (source drafts this via AI).
export const POLL_TOPICS: {
  id: PollTopicId
  label: string
  question: string
}[] = [
  {
    id: 'public-safety-cameras',
    label: 'Public safety camera expansion',
    question:
      'how you feel about expanding public safety cameras in our neighborhood, and where they would matter most. Reply with your thoughts.',
  },
  {
    id: 'affordable-housing',
    label: 'Affordable housing supply',
    question:
      'how housing costs are affecting you and your family right now, and what would help most. Reply and let me know.',
  },
  {
    id: 'northside-road-repair',
    label: 'Northside road repair',
    question:
      'which roads on the northside are in the worst shape for your daily routine, so we can prioritize repairs. Reply with your list.',
  },
  {
    id: 'after-school-funding',
    label: 'After-school program funding',
    question:
      'what after-school programs would make the biggest difference for families in our district. Reply with your priorities.',
  },
  {
    id: 'transit-reliability',
    label: 'Public transit reliability',
    question:
      'how reliable public transit has been for your commute lately, and what would improve it. Reply and tell me.',
  },
  {
    id: 'park-maintenance',
    label: 'Park maintenance backlog',
    question:
      'which parks or facilities near you most need repair or upgrades, so we can prioritize. Reply with your thoughts.',
  },
  {
    id: 'drone-noise-ordinance',
    label: 'Noise ordinance for delivery drones',
    question:
      'how much delivery-drone noise affects your neighborhood, and whether the city should set limits. Reply and let me know.',
  },
  {
    id: 'ev-charging-public-lots',
    label: 'EV charging in public lots',
    question:
      'whether public EV charging in city lots would be useful to you, and where it would help most. Reply with your thoughts.',
  },
  {
    id: 'community-composting',
    label: 'Community composting program',
    question:
      'whether you would use a citywide food-waste drop-off for composting. Reply and let me know.',
  },
  { id: 'custom', label: 'Write my own', question: '' },
]

export const POLL_RECOMMENDATION = {
  audienceId: 'all',
  title: 'Poll constituents on public transit reliability',
  reach: 3420,
}

// Full poll message: intro + the topic's question (source drafts this via AI).
export const generatePollDraft = (topic: PollTopicId): string => {
  const t = POLL_TOPICS.find((x) => x.id === topic)
  if (!t || !t.question) return ''
  return `${pollIntroFor()} We want to hear from you: ${t.question}`
}

// Basic whitespace tidy stands in for the source's "Improve with AI" backend call.
export const polishPoll = (text: string): string =>
  text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

// Heuristic list to flag potentially biased or loaded framing in a poll question.
const BIAS_PHRASES = [
  'obviously',
  'clearly',
  'everyone knows',
  'any reasonable',
  'common sense',
  'wasteful',
  'reckless',
  'radical',
  'extreme',
  'failed',
  'disaster',
  'shocking',
  'outrageous',
  'corrupt',
  'greedy',
  "shouldn't we",
  "don't you agree",
  "isn't it time",
  'unfair',
]

export const detectBias = (text: string): string[] => {
  if (!text.trim()) return []
  const lower = text.toLowerCase()
  return BIAS_PHRASES.filter((phrase) => lower.includes(phrase))
}
