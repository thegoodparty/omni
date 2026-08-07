// Phone bank campaign data. Audiences / tones / pools are shared with SMS
// (re-exported from smsData). Phone-bank-specific: volunteer call scripts, the
// call-list session's outcome model, and PDF-sheet sizing. Phone banking is
// FREE (volunteers do the calling), so there is no cost or scheduling.

export {
  type Audience,
  type Tone,
  AUDIENCES,
  DEFAULT_AUDIENCE,
  FILTER_POOLS,
  TONES,
  TONE_ICONS,
  estimateAudienceSize,
} from './smsData'

const CANDIDATE_FIRST_NAME = 'Renee'
const CANDIDATE_ROLE_SHORT = 'City Council'

// Call sheets cap at 60 rows each; multiple lists split the audience across PDFs.
export const MAX_PDF_ROWS = 60

export type PhoneBankPurposeId =
  | 'introduce'
  | 'persuade'
  | 'event'
  | 'vote-early'
  | 'election-day'
  | 'custom'

export const PHONEBANK_PURPOSES: {
  id: PhoneBankPurposeId
  label: string
}[] = [
  { id: 'introduce', label: 'Introduce myself to voters' },
  { id: 'persuade', label: 'Persuade likely voters' },
  { id: 'event', label: 'Invite voters to a local event' },
  { id: 'vote-early', label: 'Encourage voters to vote early' },
  { id: 'election-day', label: 'Encourage voters to vote on election day' },
  { id: 'custom', label: 'Write my own script' },
]

export const PHONEBANK_RECOMMENDATION = {
  audienceId: 'all',
  title: 'Call volunteer prospects to confirm shifts',
  reach: 1134,
}

// The script a volunteer reads aloud on the call — used when a session is opened
// without a campaign-authored script.
export const DEFAULT_CALL_SCRIPT = `Hi, this is [your name] calling on behalf of the campaign. I'm reaching out today because this election matters, and I'd love to hear what's most important to you. Would you be willing to share which issues you care about and whether we can count on your support?`

// Backend-free mock: the source generates scripts from a live AI endpoint, so no
// source copy exists. Two volunteer-read variants per purpose feed "Regenerate".
const SCRIPT_BODY: Record<PhoneBankPurposeId, string[]> = {
  introduce: [
    `Hi, my name is [your name] and I'm a volunteer for ${CANDIDATE_FIRST_NAME}, who's running for ${CANDIDATE_ROLE_SHORT}. I'm calling to introduce her and hear what matters most to you. Do you have a minute to chat about the issues you care about this election?`,
    `Hi, this is [your name] calling for ${CANDIDATE_FIRST_NAME}'s campaign for ${CANDIDATE_ROLE_SHORT}. She's running to lower everyday costs and make City Hall work for neighbors like you. Can I ask what you'd most like to see change in our community?`,
  ],
  persuade: [
    `Hi, I'm [your name], a volunteer for ${CANDIDATE_FIRST_NAME} for ${CANDIDATE_ROLE_SHORT}. This race is close and it'll come down to neighbors like you. ${CANDIDATE_FIRST_NAME} is focused on housing, safety, and a government that listens — can we count on your support this fall?`,
    `Hi, this is [your name] calling for ${CANDIDATE_FIRST_NAME}, candidate for ${CANDIDATE_ROLE_SHORT}. Elections like ours are decided by a handful of votes. Could I share why I'm supporting her, and ask whether she can earn your vote?`,
  ],
  event: [
    `Hi, I'm [your name], a volunteer with ${CANDIDATE_FIRST_NAME}'s campaign for ${CANDIDATE_ROLE_SHORT}. She's hosting a neighborhood gathering this Saturday and would love for you to come. It's a chance to meet her and ask questions — could I tell you the details?`,
    `Hi, this is [your name] calling for ${CANDIDATE_FIRST_NAME} for ${CANDIDATE_ROLE_SHORT}. We're holding a community meetup this week and your voice would mean a lot. Would you be interested in stopping by?`,
  ],
  'vote-early': [
    `Hi, I'm [your name], a volunteer for ${CANDIDATE_FIRST_NAME} for ${CANDIDATE_ROLE_SHORT}. Early voting is open now — it's the easiest way to make your vote count without waiting in line. Can I help you make a plan to vote early?`,
    `Hi, this is [your name] calling for ${CANDIDATE_FIRST_NAME}'s campaign. Don't wait for Election Day — early voting is open and takes just a few minutes. Have you had a chance to make your plan to vote?`,
  ],
  'election-day': [
    `Hi, I'm [your name], a volunteer for ${CANDIDATE_FIRST_NAME} for ${CANDIDATE_ROLE_SHORT}. Today is Election Day and polls are open until 7:30 PM. Your vote decides our future — have you been able to get to the polls yet?`,
    `Hi, this is [your name] calling for ${CANDIDATE_FIRST_NAME}. It's Election Day and polls close at 7:30 PM. This race comes down to turnout — can I help you find your polling place?`,
  ],
  custom: [],
}

export const generateScript = (
  purpose: PhoneBankPurposeId,
  seed = 0,
): string => {
  const scripts = SCRIPT_BODY[purpose]
  if (!scripts || scripts.length === 0) return ''
  return scripts[seed % scripts.length] ?? scripts[0]!
}

// -------- Call-list session (the live calling screen) --------

export type CallOutcome =
  | 'answered'
  | 'no_answer'
  | 'voicemail'
  | 'wrong_number'
  | 'refused'
export type Support = 'yes' | 'unsure' | 'no'
export type Engagement = 'engaged' | 'refused'
export type WillVote = 'yes' | 'unsure' | 'no'

export type Note = {
  id: string
  text: string
  createdAt: number
  updatedAt?: number
}

export type ContactState = {
  outcome?: CallOutcome
  engagement?: Engagement
  support?: Support
  willVote?: WillVote
  notes?: Note[]
}

export const OUTCOME_ORDER: CallOutcome[] = [
  'answered',
  'no_answer',
  'voicemail',
  'wrong_number',
  'refused',
]

// DS-token colours mirroring WalkMode's status palette (no raw --map-pin-* vars).
export const OUTCOME_META: Record<
  CallOutcome,
  { label: string; color: string }
> = {
  answered: { label: 'Answered', color: 'bg-success' },
  no_answer: { label: 'No answer', color: 'bg-yellow-400' },
  voicemail: { label: 'Voicemail left', color: 'bg-muted-foreground' },
  wrong_number: { label: 'Wrong number', color: 'bg-muted-foreground/50' },
  refused: { label: 'Refused', color: 'bg-foreground' },
}

export const SUPPORT_LABEL: Record<Support, string> = {
  yes: 'Yes',
  no: 'No',
  unsure: 'Unsure',
}
