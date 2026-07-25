import { type Tone } from './smsData'

// Email campaign data. Audiences / tones / filter pools / time options are shared
// with the SMS flow (re-exported from smsData). Email-specific: subject+body
// templates, signature, free cost, recommendation.

export {
  type Audience,
  type Tone,
  AUDIENCES,
  DEFAULT_AUDIENCE,
  FILTER_POOLS,
  TIME_OPTIONS,
  TONES,
  TONE_ICONS,
  estimateAudienceSize,
  formatMoney,
} from './smsData'

export const EMAIL_COST_PER_RECIPIENT = 0 // email is free in the source

export const CANDIDATE_FIRST_NAME = 'Renee'
export const CANDIDATE_FULL_NAME = 'Renee Wells'
export const CANDIDATE_ROLE_SHORT = 'City Council'

export const DEFAULT_SIGNATURE = `<div><b>${CANDIDATE_FULL_NAME}</b></div><div>Candidate for ${CANDIDATE_ROLE_SHORT}</div>`

export type EmailPurposeId =
  | 'introduce'
  | 'persuade'
  | 'event'
  | 'vote-early'
  | 'election-day'
  | 'custom'

export const EMAIL_PURPOSES: {
  id: EmailPurposeId
  label: string
  subject: string
  body: string
}[] = [
  {
    id: 'introduce',
    label: 'Introduce myself to voters',
    subject: `Meet ${CANDIDATE_FIRST_NAME}, your candidate for ${CANDIDATE_ROLE_SHORT}`,
    body: `Hi {first_name},\n\nI'm ${CANDIDATE_FULL_NAME}, and I'm running for ${CANDIDATE_ROLE_SHORT}. I'm reaching out to introduce myself and share why I'm running.\n\nOur district deserves leadership that listens first and acts on what matters to the people who live here. Over the coming weeks, I'd love to hear directly from you about the issues that shape your day-to-day.\n\nIf you'd like to learn more, just reply to this email — I read every note.`,
  },
  {
    id: 'persuade',
    label: 'Persuade likely voters',
    subject: `Where I stand — and why your vote matters`,
    body: `Hi {first_name},\n\nThis race is close, and it will be decided by neighbors like you. I'm ${CANDIDATE_FULL_NAME}, running for ${CANDIDATE_ROLE_SHORT}, and I want to be direct about why I'm asking for your vote.\n\nI'm focused on the things that shape our lives here — housing, safety, and making local government work for the people it serves.\n\nIf you're still deciding, I'd be glad to answer any questions. Just hit reply.`,
  },
  {
    id: 'event',
    label: 'Invite voters to a local event',
    subject: `You're invited: meet ${CANDIDATE_FIRST_NAME} in the neighborhood`,
    body: `Hi {first_name},\n\nI'm hosting a small neighborhood gathering next week and I'd love for you to come. It's a chance to meet, ask questions, and share what you'd like to see from your next ${CANDIDATE_ROLE_SHORT}.\n\nBring a friend, bring a question, or just come say hi. Details will follow shortly.`,
  },
  {
    id: 'vote-early',
    label: 'Encourage voters to vote early',
    subject: `Skip the line — vote early`,
    body: `Hi {first_name},\n\nEarly voting is open. It's the easiest way to make sure your vote counts without waiting in line on Election Day.\n\nCheck your early-vote location, bring an ID, and get it done in minutes. If I can answer any questions about the ballot, just reply.`,
  },
  {
    id: 'election-day',
    label: 'Encourage voters to vote on election day',
    subject: `It's Election Day — polls close tonight`,
    body: `Hi {first_name},\n\nToday is the day. Polls are open until 7:30 PM. Your vote is what makes this whole thing work.\n\nIf you need your polling place, or a ride, or want to double-check anything on the ballot, reply to this email and my team will help.`,
  },
  { id: 'custom', label: 'Write my own email', subject: '', body: '' },
]

export const EMAIL_RECOMMENDATION = {
  audienceId: 'housing-renters',
  title: 'Email renters about the rent-cap plan',
  reach: 4812,
}

// Alternate real drafts per purpose so "Regenerate" yields new copy. Variant 0
// is the EMAIL_PURPOSES template; index 1+ live here.
const EMAIL_ALT_BODIES: Partial<
  Record<EmailPurposeId, { subject: string; body: string }[]>
> = {
  introduce: [
    {
      subject: `A quick hello from ${CANDIDATE_FIRST_NAME}`,
      body: `Hi {first_name},\n\nI'm ${CANDIDATE_FULL_NAME}, running for ${CANDIDATE_ROLE_SHORT}, and I wanted to reach out as a neighbor before you hear from anyone else.\n\nI'm running because our community deserves leaders who show up, listen, and get the basics right — affordable housing, safe streets, and a city hall that works.\n\nI'd genuinely like to know what matters to you. Just reply and tell me.`,
    },
  ],
  persuade: [
    {
      subject: `Your vote will decide this one`,
      body: `Hi {first_name},\n\nRaces like ours are won and lost by a handful of votes. I'm ${CANDIDATE_FULL_NAME}, running for ${CANDIDATE_ROLE_SHORT}, and I'd be grateful for yours.\n\nI'm focused on lowering costs, keeping our neighborhoods safe, and making local government actually responsive.\n\nStill deciding? Reply with your questions — I answer every one.`,
    },
  ],
  event: [
    {
      subject: `Come meet ${CANDIDATE_FIRST_NAME} this week`,
      body: `Hi {first_name},\n\nI'd love to see you at a neighborhood gathering I'm hosting this week. No speeches — just a chance to meet, ask questions, and tell me what you'd like to see from your next ${CANDIDATE_ROLE_SHORT}.\n\nBring a neighbor. I'll send the details shortly.`,
    },
  ],
  'vote-early': [
    {
      subject: `Make a plan to vote early`,
      body: `Hi {first_name},\n\nEarly voting is open, and it's the simplest way to make your voice count without the Election Day rush.\n\nPick a time, grab your ID, and it's done in minutes. Reply if you'd like help finding your early-vote location.`,
    },
  ],
  'election-day': [
    {
      subject: `Polls close at 7:30 tonight`,
      body: `Hi {first_name},\n\nThis is it — polls are open until 7:30 PM today, and turnout will decide this race.\n\nNeed your polling place, a ride, or a hand with the ballot? Reply and my team will jump in.`,
    },
  ],
}

export const generateEmailDraft = (
  purpose: EmailPurposeId,
  seed = 0,
): { subject: string; body: string } => {
  const base = EMAIL_PURPOSES.find((x) => x.id === purpose)
  if (!base) return { subject: '', body: '' }
  const variants = [
    { subject: base.subject, body: base.body },
    ...(EMAIL_ALT_BODIES[purpose] ?? []),
  ]
  return variants[seed % variants.length] ?? variants[0]!
}

export const senderEmail = `${CANDIDATE_FIRST_NAME.toLowerCase()}@${CANDIDATE_ROLE_SHORT.toLowerCase().replace(/[^a-z0-9]+/g, '')}.com`

// Mock "improve with AI": tighten whitespace and ensure clean paragraph breaks.
export const polishEmail = (t: string): string =>
  t
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export type { Tone as EmailTone }
