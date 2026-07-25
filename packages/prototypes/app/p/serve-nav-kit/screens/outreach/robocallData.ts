// Robocall campaign data. Audiences / tones / pools / time / dictation are shared
// with SMS (re-exported from smsData). Robocall-specific: script templates, per-call
// cost, and an audio recording step.

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

export const ROBOCALL_COST_PER_RECIPIENT = 0.045

const CANDIDATE_FIRST_NAME = 'Renee'
const CANDIDATE_FULL_NAME = 'Renee Wells'
const CANDIDATE_ROLE_SHORT = 'City Council'
const COMMITTEE_NAME = `${CANDIDATE_FULL_NAME} for ${CANDIDATE_ROLE_SHORT}`
const DIALER_PHONE = '555-555-5555'

// Federally required identification read at the end of every robocall.
export const PAID_FOR_DISCLAIMER = `Paid for by ${COMMITTEE_NAME}, ${DIALER_PHONE}.`
export const ROBOCALL_LEGAL_NOTE =
  "The last line keeps you legally compliant and protects you personally. Federal law requires callers to identify who's behind the call and the number it came from."

export type RobocallPurposeId =
  | 'introduce'
  | 'persuade'
  | 'event'
  | 'vote-early'
  | 'election-day'
  | 'custom'

export const ROBOCALL_PURPOSES: { id: RobocallPurposeId; label: string }[] = [
  { id: 'introduce', label: 'Introduce myself to voters' },
  { id: 'persuade', label: 'Persuade likely voters' },
  { id: 'event', label: 'Invite voters to a local event' },
  { id: 'vote-early', label: 'Encourage voters to vote early' },
  { id: 'election-day', label: 'Encourage voters to vote on election day' },
  { id: 'custom', label: 'Write my own script' },
]

export const ROBOCALL_RECOMMENDATION = {
  audienceId: 'all',
  title: 'Remind likely voters about the budget hearing',
  reach: 2050,
}

// Multiple real script variants per purpose so "Regenerate" (and switching tone)
// produces new copy each time.
const SCRIPT_BODY: Record<RobocallPurposeId, string[]> = {
  introduce: [
    `Hi, this is ${CANDIDATE_FIRST_NAME}, and I'm running for ${CANDIDATE_ROLE_SHORT}. I'm calling to introduce myself and let you know I'm running to lower everyday costs and make City Hall work for you. I'd be honored to earn your vote. Thank you.`,
    `Hi, this is ${CANDIDATE_FIRST_NAME}, your neighbor and candidate for ${CANDIDATE_ROLE_SHORT}. I'm running because our community deserves leaders who show up and listen. I'd love to earn your vote this fall. Thanks for your time.`,
  ],
  persuade: [
    `Hi, this is ${CANDIDATE_FIRST_NAME}, candidate for ${CANDIDATE_ROLE_SHORT}. This race is close, and it will be decided by neighbors like you. I'm focused on housing, safety, and a government that listens. I'd be grateful for your support this November. Thank you.`,
    `Hi, this is ${CANDIDATE_FIRST_NAME}, running for ${CANDIDATE_ROLE_SHORT}. Elections like ours come down to a handful of votes. I'll fight to lower costs and keep our streets safe. I'd be honored to have your support. Thank you.`,
  ],
  event: [
    `Hi, this is ${CANDIDATE_FIRST_NAME}, running for ${CANDIDATE_ROLE_SHORT}. I'm hosting a neighborhood gathering this Saturday and I'd love for you to come. It's a chance to meet, ask questions, and share what matters to you. Hope to see you there.`,
    `Hi, this is ${CANDIDATE_FIRST_NAME}, candidate for ${CANDIDATE_ROLE_SHORT}. I'm holding a community meetup this week and your voice would mean a lot. Come by, bring a neighbor, and tell me what you'd like to see. Hope to see you soon.`,
  ],
  'vote-early': [
    `Hi, this is ${CANDIDATE_FIRST_NAME}, candidate for ${CANDIDATE_ROLE_SHORT}. Early voting is open now — it's the easiest way to make your vote count without waiting in line. Please make a plan to vote early. Thank you.`,
    `Hi, this is ${CANDIDATE_FIRST_NAME}, running for ${CANDIDATE_ROLE_SHORT}. Don't wait for Election Day — early voting is open and takes just a few minutes. Make your plan today, and thanks for making your voice heard.`,
  ],
  'election-day': [
    `Hi, this is ${CANDIDATE_FIRST_NAME}, running for ${CANDIDATE_ROLE_SHORT}. Today is Election Day and polls are open until 7:30 PM. Your vote decides our future — please turn out. Thank you.`,
    `Hi, this is ${CANDIDATE_FIRST_NAME}, candidate for ${CANDIDATE_ROLE_SHORT}. It's Election Day and polls close at 7:30 PM. This race comes down to turnout — please make your voice heard today. Thank you.`,
  ],
  custom: [],
}

export const generateScript = (
  purpose: RobocallPurposeId,
  seed = 0,
): string => {
  const scripts = SCRIPT_BODY[purpose]
  if (!scripts || scripts.length === 0) return ''
  return scripts[seed % scripts.length] ?? scripts[0]!
}

export const fmtDuration = (secs: number): string => {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
