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
  title: 'What do you want to say?',
  body: 'Edit the question, or change the tone and try another.',
  suggestedFor: (audience: string) => `Suggested for ${audience}`,
  questionLabel: 'Your question',
  questionPlaceholder: 'What matters most to you about our community?',
  regenerate: 'Regenerate',
  imageTitle: 'Add an image to your poll',
  imageHint: 'Optional. Recipients see it in the text.',
  imageUploading: 'Uploading your image…',
  imageTypeError: 'Use a PNG or JPG image.',
  imageUploadError: "We couldn't upload your image. Try again.",
  count: (chars: number, segments: number) =>
    `${chars} chars · ${segments} SMS`,
  tooShort: 'Write at least 10 characters to continue.',
  tooLong: 'Shorten your question to continue.',
  draftError: "We couldn't write a new question. Try again.",
  undo: 'Undo',
  improve: 'Improve with AI',
  improving: 'Improving…',
  improveError:
    "We couldn't improve your question just now. Try again, or edit it yourself.",
  improveUnchanged: 'Your question already reads clearly and neutrally.',
  tryAgain: 'Try again',
  checkBias: 'Check for bias',
  checkingBias: 'Checking for bias…',
  biasPassed: 'No bias detected',
  biasFlagged: 'Bias detected',
  biasCheckError: "Couldn't check. Try again",
  // The phone toolbar shows the status as an icon; these say what it means.
  biasTooltip: {
    idle: 'Check your question for wording that leads people toward an answer.',
    checking: 'Checking your question for bias…',
    passed:
      "No bias detected. Your question doesn't lead people toward an answer.",
    flagged: 'Bias detected. This question may lead people toward an answer.',
    error: "We couldn't check your question for bias. Tap to try again.",
  },
  biasFlaggedNote:
    'This question may lead people toward an answer. Improve it with AI or reword it to continue.',
  dictationError: (error: string) =>
    `Dictation didn't start: ${error}. Check your microphone permission and try again.`,
}

export const SERVE_POLL_REVIEW_COPY = {
  channelLabel: 'Poll',
  title: 'Ready to send your poll?',
  freeBody: 'Review your poll details and schedule your send.',
  paidBody: 'Review your poll details and complete your payment.',
  scheduleAction: 'Schedule poll',
  chargeNote:
    'One-time charge for this poll. Your Pro subscription is billed separately.',
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
