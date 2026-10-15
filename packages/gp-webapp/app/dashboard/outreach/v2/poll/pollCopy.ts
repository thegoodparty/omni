import type { PollTone } from '@goodparty_org/contracts'
import type { OutreachAudienceCopy } from '../audience/OutreachAudienceStep'

// Every string the poll flow owns is Serve copy: self-serve polls exist only
// for elected officials. They live in SERVE_* objects because this directory
// sits under the shared v2 tree, where the vocabulary check reads a bare
// string as Win copy (docs/product-vocabulary.md).

export const SERVE_POLL_TOPIC_COPY = {
  title: 'What do you want to poll about?',
  body: "Pick a topic and we'll draft the question for you.",
}

export const SERVE_POLL_AUDIENCE_COPY: OutreachAudienceCopy = {
  pickerTitle: 'Who are you polling?',
  pickerBody: 'Start with a random sample, or pick one of your lists.',
  filtersTitle: 'Build a constituent list',
  filtersBody: 'Pick filters to define who this list reaches.',
  nameTitle: 'Name your list',
  nameBody: 'Give it a name so you can find it again.',
  reachVerb: 'Ask',
  reachNoun: 'constituents',
  unitCostLabel: 'Each text costs',
}

export const SERVE_POLL_RECOMMENDATION_COPY = {
  label: 'Recommended for you',
  title: 'A random sample of your constituents',
  reason: 'A broad random sample gives you the most reliable read.',
  reach: (count: string, price: string) =>
    `Ask ${count} constituents for $${price}`,
}

export const SERVE_POLL_QUESTION_COPY = {
  title: 'What do you want to ask?',
  body: 'Edit the question, or change the tone and try another.',
  questionLabel: 'Your question',
  questionPlaceholder: 'What matters most to you about our community?',
  regenerate: 'Regenerate',
  introLabel: 'Starts with',
  footerLabel: 'Ends with',
  imageLabel: 'Add an image (optional)',
  count: (chars: number, segments: number) =>
    `${chars} characters, ${segments} ${segments === 1 ? 'text' : 'texts'}`,
  tooShort: 'Write at least 10 characters to continue.',
  tooLong: 'Shorten your question to continue.',
  draftError: "We couldn't write a new question. Try again.",
  biasAlertTitle: 'This question may lead people toward an answer',
  biasAlertBody: 'Choose Optimize message to reword it, or continue as it is.',
}

export const SERVE_POLL_REVIEW_COPY = {
  channelLabel: 'Poll',
}

export const SERVE_POLL_SUCCESS_COPY = {
  title: 'Your poll is in review',
  review: "We'll review it within 2 business days.",
  reach: (count: string, when: string) =>
    `Once it's approved, it goes to ${count} constituents on ${when}.`,
  action: 'Done',
}

export const POLL_TONE_LABELS: Record<PollTone, string> = {
  Neutral: 'Neutral',
  Warm: 'Warm',
  Direct: 'Direct',
  Friendly: 'Friendly',
}

export const DEFAULT_POLL_TONE: PollTone = 'Neutral'
