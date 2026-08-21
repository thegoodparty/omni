import {
  PHONE_BANKING_PURPOSE_VALUES,
  type PhoneBankingPurpose,
} from '@goodparty_org/contracts'

// Contract slugs → the design canvas's card copy. Phone banking has its own
// wording ("Introduce myself to voters", "Encourage voters to vote early");
// it is deliberately NOT social's shorter copy.
export const PHONE_BANKING_PURPOSE_LABELS: Record<PhoneBankingPurpose, string> =
  {
    introduce: 'Introduce myself to voters',
    persuade: 'Persuade likely voters',
    event: 'Invite voters to a local event',
    'vote-early': 'Encourage voters to vote early',
    'election-day': 'Encourage voters to vote on election day',
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
