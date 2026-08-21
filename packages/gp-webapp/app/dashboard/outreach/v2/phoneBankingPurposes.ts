import {
  PHONE_BANKING_PURPOSE_VALUES,
  type PhoneBankingPurpose,
} from '@goodparty_org/contracts'

// Contract slugs → the design's card copy, mirroring socialPurposes.ts.
export const PHONE_BANKING_PURPOSE_LABELS: Record<PhoneBankingPurpose, string> =
  {
    introduce: 'Introduce myself',
    persuade: 'Persuade likely voters',
    event: 'Invite people to a local event',
    'vote-early': 'Encourage early voting',
    'election-day': 'Election day turnout',
    custom: 'Write my own script',
  }

export const PHONE_BANKING_PURPOSES: {
  id: PhoneBankingPurpose
  label: string
}[] = PHONE_BANKING_PURPOSE_VALUES.map((id) => ({
  id,
  label: PHONE_BANKING_PURPOSE_LABELS[id],
}))

export const phoneBankingPurposeLabel = (purpose: string): string =>
  PHONE_BANKING_PURPOSE_LABELS[purpose as PhoneBankingPurpose] ??
  'Phone banking calls'
