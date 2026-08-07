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
import { introFor, type Tone } from './smsData'

export const ROBOCALL_COST_PER_RECIPIENT = 0.045

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

// Greeting-less body variants per purpose; the tone-specific opener is prepended
// by generateScript via introFor(tone), so switching tone actually re-voices the
// script (and "Regenerate" rotates the body).
const SCRIPT_BODY: Record<RobocallPurposeId, string[]> = {
  introduce: [
    `I'm calling to introduce myself and let you know I'm running to lower everyday costs and make City Hall work for you. I'd be honored to earn your vote. Thank you.`,
    `I'm running because our community deserves leaders who show up and listen. I'd love to earn your vote this fall. Thanks for your time.`,
  ],
  persuade: [
    `This race is close, and it will be decided by neighbors like you. I'm focused on housing, safety, and a government that listens. I'd be grateful for your support this November. Thank you.`,
    `Elections like ours come down to a handful of votes. I'll fight to lower costs and keep our streets safe. I'd be honored to have your support. Thank you.`,
  ],
  event: [
    `I'm hosting a neighborhood gathering this Saturday and I'd love for you to come. It's a chance to meet, ask questions, and share what matters to you. Hope to see you there.`,
    `I'm holding a community meetup this week and your voice would mean a lot. Come by, bring a neighbor, and tell me what you'd like to see. Hope to see you soon.`,
  ],
  'vote-early': [
    `Early voting is open now — it's the easiest way to make your vote count without waiting in line. Please make a plan to vote early. Thank you.`,
    `Don't wait for Election Day — early voting is open and takes just a few minutes. Make your plan today, and thanks for making your voice heard.`,
  ],
  'election-day': [
    `Today is Election Day and polls are open until 7:30 PM. Your vote decides our future — please turn out. Thank you.`,
    `It's Election Day and polls close at 7:30 PM. This race comes down to turnout — please make your voice heard today. Thank you.`,
  ],
  custom: [],
}

export const generateScript = (
  purpose: RobocallPurposeId,
  tone: Tone,
  seed = 0,
): string => {
  const bodies = SCRIPT_BODY[purpose]
  if (!bodies || bodies.length === 0) return ''
  const body = bodies[seed % bodies.length] ?? bodies[0]!
  return `${introFor(tone)} ${body}`
}

export const fmtDuration = (secs: number): string => {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
