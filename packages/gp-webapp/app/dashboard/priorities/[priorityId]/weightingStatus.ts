import type { ReadRepresentativeness } from '@goodparty_org/contracts'

// A read's status against the census, as the analytics property spells it.
export const WEIGHTING_STATUS: Record<ReadRepresentativeness, string> = {
  tooEarly: 'too_early',
  notYetRepresentative: 'not_yet_representative',
  gettingClose: 'getting_close',
  representative: 'representative',
  enoughAnswers: 'enough_answers',
}
