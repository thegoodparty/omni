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
  | 'ev-charging-public-lots'
  | 'community-composting'
  | 'custom'

export const POLL_TOPICS: {
  id: PollTopicId
  label: string
  question: string
}[] = [
  {
    id: 'public-safety-cameras',
    label: 'Public safety camera expansion',
    question:
      'How do you feel about expanding public safety cameras in our neighborhood, and where do you think they matter most? Reply with your thoughts.',
  },
  {
    id: 'affordable-housing',
    label: 'Affordable housing supply',
    question:
      'How are housing costs affecting you and your family right now? Reply and let me know what would help most.',
  },
  {
    id: 'northside-road-repair',
    label: 'Northside road repair',
    question:
      'Which roads on the northside are in the worst shape for your daily routine? Reply so we can prioritize repairs.',
  },
  {
    id: 'after-school-funding',
    label: 'After-school program funding',
    question:
      'What after-school programs would make the biggest difference for families in our district? Reply with your priorities.',
  },
  {
    id: 'transit-reliability',
    label: 'Public transit reliability',
    question:
      'How reliable has public transit been for your commute lately? Reply and tell me what would improve it.',
  },
  {
    id: 'park-maintenance',
    label: 'Park maintenance backlog',
    question:
      'Which parks or facilities near you most need repair or upgrades? Reply so we can prioritize.',
  },
  {
    id: 'ev-charging-public-lots',
    label: 'EV charging in public lots',
    question:
      'Would public EV charging in city lots be useful to you, and where would it help most? Reply with your thoughts.',
  },
  {
    id: 'community-composting',
    label: 'Community composting program',
    question:
      'Would you use a citywide food-waste drop-off for composting? Reply and let me know.',
  },
  { id: 'custom', label: 'Write my own', question: '' },
]

export const POLL_RECOMMENDATION = {
  audienceId: 'education-families',
  title: 'Poll families about after-school programs',
  reach: 39120,
}

export const generatePollQuestion = (topic: PollTopicId): string =>
  POLL_TOPICS.find((t) => t.id === topic)?.question ?? ''

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
