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

const FALLBACK_NAME = 'Phone banking calls'

// Deliberately a second record rather than a derivation of the labels above:
// a label is copy on a card, phrased as an instruction to the caller
// ("Encourage voters to vote on election day"), while a name suggestion is a
// default title for a campaign in the outreach history list ("Election day
// calls"). Collapsing them means the next copy correction to a card silently
// renames campaigns — which is exactly how the labels came to read as tasks.
export const PHONE_BANKING_PURPOSE_NAME_SUGGESTIONS: Record<
  PhoneBankingPurpose,
  string
> = {
  introduce: 'Introduction calls',
  persuade: 'Persuasion calls',
  event: 'Event invite calls',
  'vote-early': 'Early voting calls',
  'election-day': 'Election day calls',
  // The flow suggests nothing for custom; the entry keeps the record total so
  // a new purpose is a compile error here.
  custom: FALLBACK_NAME,
}

export const PHONE_BANKING_PURPOSES: {
  id: PhoneBankingPurpose
  label: string
}[] = PHONE_BANKING_PURPOSE_VALUES.map((id) => ({
  id,
  label: PHONE_BANKING_PURPOSE_LABELS[id],
}))

export const phoneBankingPurposeLabel = (purpose: string): string =>
  PHONE_BANKING_PURPOSE_LABELS[purpose as PhoneBankingPurpose] ?? FALLBACK_NAME

export const phoneBankingPurposeNameSuggestion = (purpose: string): string =>
  PHONE_BANKING_PURPOSE_NAME_SUGGESTIONS[purpose as PhoneBankingPurpose] ??
  FALLBACK_NAME
