import { type LucideIcon, Clock, Smile, Sun, Target } from 'lucide-react'

// Ported from the Lovable source (SmsCampaignFlow.tsx + data/voterLists.ts),
// adapted for the backend-free prototype: AI drafting is mocked with canned copy
// and the "build a new list" step is a simplified filter-chip picker.

export const COST_PER_RECIPIENT = 0.035
export const OPT_OUT_FOOTER = 'Reply STOP to opt out.'
export const SMS_CHAR_LIMIT = 480

// Candidate identity (matches the prototype's Renee Wells / City Council).
const CANDIDATE_FIRST_NAME = 'Renee'
const CANDIDATE_ROLE_SHORT = 'City Council'

export type PurposeId =
  | 'introduce'
  | 'persuade'
  | 'event'
  | 'vote-early'
  | 'election-day'
  | 'custom'

export const PURPOSES: { id: PurposeId; label: string }[] = [
  { id: 'introduce', label: 'Introduce myself to voters' },
  { id: 'persuade', label: 'Persuade likely voters' },
  { id: 'event', label: 'Invite voters to a local event' },
  { id: 'vote-early', label: 'Encourage voters to vote early' },
  { id: 'election-day', label: 'Encourage voters to vote on election day' },
  { id: 'custom', label: 'Write my own message' },
]

export const TONES = ['Warm', 'Direct', 'Urgent', 'Friendly'] as const
export type Tone = (typeof TONES)[number]
export const TONE_ICONS: Record<Tone, LucideIcon> = {
  Warm: Sun,
  Direct: Target,
  Urgent: Clock,
  Friendly: Smile,
}

export const TIME_OPTIONS: {
  id: string
  label: string
  time: string | null
}[] = [
  ...Array.from({ length: 13 }, (_, i) => {
    const hour24 = 9 + i
    const period = hour24 >= 12 ? 'PM' : 'AM'
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
    return {
      id: String(hour24),
      label: `${hour12}:00 ${period}`,
      time: `${String(hour24).padStart(2, '0')}:00`,
    }
  }),
  { id: 'custom', label: 'Custom time…', time: null },
]

export type Audience = {
  id: string
  name: string
  count: number
  filters: string[]
}

export const DEFAULT_AUDIENCE: Audience = {
  id: 'all',
  name: 'All voters',
  count: 118099,
  filters: ['All registered voters'],
}

export const AUDIENCES: Audience[] = [
  DEFAULT_AUDIENCE,
  {
    id: 'housing-renters',
    name: 'Renters in 98103',
    count: 4812,
    filters: ['Precinct 3', '18–34', 'Under $50k', 'Affordable housing'],
  },
  {
    id: 'jobs-working',
    name: 'Service workers, persuadable',
    count: 6207,
    filters: ['18–34', '35–50', 'Likely voters', 'Local jobs & wages'],
  },
  {
    id: 'safety-swing',
    name: 'Ballard safety swing',
    count: 2980,
    filters: ['Precinct 2', '51–64', '65+', 'Homeowner: Yes', 'Public safety'],
  },
  {
    id: 'education-families',
    name: 'Education & families',
    count: 39120,
    filters: ['Families with children', 'Homeowners', 'Schools & education'],
  },
]

// Recommended list surfaced in the "Who do you want to reach?" step (ported from
// data/outreachRecommendations.ts — the SMS recommendation). The banner shows only
// the title + reach, exactly like the source RecommendationBanner.
export const SMS_RECOMMENDATION = {
  audienceId: 'housing-renters',
  title: 'Text renters about the rent-cap plan',
  reach: 4812,
}

export const FILTER_POOLS: { key: string; label: string; options: string[] }[] =
  [
    {
      key: 'precinct',
      label: 'Precinct',
      options: ['Precinct 1', 'Precinct 2', 'Precinct 3', 'Precinct 4'],
    },
    { key: 'age', label: 'Age', options: ['18–34', '35–50', '51–64', '65+'] },
    {
      key: 'turnout',
      label: 'Turnout',
      options: ['Super voters', 'Likely voters', 'Occasional', 'New voters'],
    },
    {
      key: 'issue',
      label: 'Top issue',
      options: [
        'Affordable housing',
        'Local jobs & wages',
        'Public safety',
        'Schools & education',
        'Transit',
      ],
    },
  ]

const UNIVERSE = 118099
export const estimateAudienceSize = (selected: string[]): number => {
  if (selected.length === 0) return UNIVERSE
  const factor = Math.pow(0.55, selected.length)
  return Math.max(120, Math.round(UNIVERSE * factor))
}

export const formatMoney = (n: number): string =>
  n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

// Compliance: every SMS must open with a candidate identification.
export const introFor = (tone: string): string => {
  const t = tone.toLowerCase()
  if (t === 'direct')
    return `${CANDIDATE_FIRST_NAME} here, candidate for ${CANDIDATE_ROLE_SHORT}.`
  if (t === 'urgent')
    return `${CANDIDATE_FIRST_NAME} here — running for ${CANDIDATE_ROLE_SHORT}.`
  if (t === 'friendly')
    return `Hey! It's ${CANDIDATE_FIRST_NAME}, running for ${CANDIDATE_ROLE_SHORT}.`
  return `Hi, this is ${CANDIDATE_FIRST_NAME}, candidate for ${CANDIDATE_ROLE_SHORT}.`
}

export const hasIntro = (text: string): boolean => {
  const head = text.slice(0, 140).toLowerCase()
  return (
    head.includes(CANDIDATE_FIRST_NAME.toLowerCase()) &&
    (head.includes('candidate') || head.includes('running for'))
  )
}

export const messageEndsWithOptOut = (text: string): boolean =>
  text.trimEnd().toLowerCase().endsWith(OPT_OUT_FOOTER.toLowerCase())

// Mock of the AI drafting endpoint: purpose-specific SMS bodies. Multiple real
// variants per purpose so "Regenerate" (and switching tone) yields new copy.
const PURPOSE_BODY: Record<PurposeId, string[]> = {
  introduce: [
    "I'm running to lower everyday costs and make City Hall work for you, not the insiders. Can I count on your vote?",
    "I'm running because our neighborhood deserves a City Council that shows up and listens. I'd be honored to earn your vote.",
    "I'm running to cut waste at City Hall and put working families first. Can I count on your support?",
  ],
  persuade: [
    "Together we can bring down housing costs and invest in safer streets. I'd be honored to earn your support this November.",
    "This race is close and it comes down to neighbors like you. I'm focused on housing, safety, and a city that listens.",
    "Real change starts local. Help me deliver lower costs and safer streets — I'd be grateful for your vote.",
  ],
  event: [
    'Join me this Saturday at the community center to talk through the issues that matter most to you. Hope to see you there!',
    "I'm hosting a neighborhood meetup this week — come ask questions and share what you'd like to see. Bring a friend!",
    "Let's talk in person. Stop by my community gathering this weekend — I'd love to hear what's on your mind.",
  ],
  'vote-early': [
    'Early voting is open now — beat the lines and make your voice heard. Every early vote helps us win.',
    "Don't wait for Election Day. Early voting is open and it only takes a few minutes to make your voice count.",
    'Early voting is the easiest way to vote. Make your plan today and text a friend to do the same.',
  ],
  'election-day': [
    'Today is Election Day and polls are open until 8 PM. Your vote decides our future — please turn out.',
    "It's Election Day! Polls close at 8 PM. This race comes down to turnout — please make your voice heard.",
    "Polls are open until 8 PM today. If you haven't voted yet, now's the time. Every vote matters.",
  ],
  custom: [],
}

export const generateDraft = (
  purpose: PurposeId,
  tone: Tone,
  seed = 0,
): string => {
  const bodies = PURPOSE_BODY[purpose]
  if (!bodies || bodies.length === 0) return `${introFor(tone)} `
  const body = bodies[seed % bodies.length] ?? bodies[0]
  return `${introFor(tone)} ${body}`
}
