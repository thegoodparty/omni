import type {
  ConstituentFeedbackChannel,
  ConstituentFeedbackStance,
  FeedbackReportResponse,
} from '@goodparty_org/contracts'

type Denominators = FeedbackReportResponse['denominators']

const count = (value: number, one: string, many: string): string =>
  `${value.toLocaleString()} ${value === 1 ? one : many}`

// Both products reach every screen here, so the copy is mode-keyed
// (docs/product-vocabulary.md) and the Serve branch is where the vocabulary
// gate reads it. Most of it reads the same in both because it names nobody:
// Win must never say constituent, and Serve must never say voter.
//
// Nothing here says poll, survey, representative or statistically
// significant. These are notes a canvasser wrote after a conversation, not a
// sample of the district, and the page must not dress them up as one.
export const WHAT_WE_HEARD_COPY = {
  win: {
    title: 'What we heard',
    // Confirmed only, and the rest are stated rather than hidden, so the
    // numbers on the cards cannot be read as more than they are. The
    // waiting clause follows as a link to the review list, and the
    // sentence ends after whichever comes last.
    captionCounts: (d: Denominators): string =>
      [
        `${count(d.conversations, 'person', 'people')} answered.`,
        `${d.memos.toLocaleString()} left a note.`,
        `${d.confirmed.toLocaleString()} confirmed`,
      ].join(' '),
    waitingForReview: (pending: number): string =>
      `${pending.toLocaleString()} waiting for review`,
    summarizing:
      'Summarizing what you heard. This usually takes a few minutes.',
    soFarHeading: 'What people said so far',
    floorLine: (floor: number): string =>
      `Themes appear after ${floor.toLocaleString()} confirmed notes.`,
    themesHeading: 'Top themes',
    everyNoteHeading: 'Every note',
    failed: "We couldn't summarize this time.",
    summarize: 'Summarize what we heard',
    coolingDown: 'This was summarized a few minutes ago. Try again later.',
    summarizeFailed: "We couldn't start a summary. Try again in a moment.",
    noNotes: 'No notes yet. Notes from conversations with voters show up here.',
    drawerCaption: 'Notes from conversations with voters.',
    loadFailed: 'This page could not load. Refresh to try again.',
    loading: 'Loading what you heard',
    conversations: (value: number): string =>
      count(value, 'conversation', 'conversations'),
    seeDetails: 'See details',
    // The link's name, which has to say which theme: a page of cards each
    // named "See details" reads as one link said six times.
    seeDetailsFor: (title: string): string => `See details for ${title}`,
    stanceSplit: 'Where people stand',
    rank: (value: number): string => `Rank ${value}`,
    notYetReviewed: 'Not yet reviewed',
    // Every note is the canvasser's own summary of the conversation, never
    // the other person's words, and it says so.
    summaryBy: (actorName: string | null): string =>
      `Summary by ${actorName ?? 'your team'}`,
    // A note still transcribing is always a recording (typed notes skip
    // transcription), and there is no summary yet to credit anyone with.
    recordedBy: (actorName: string | null): string =>
      `Recorded by ${actorName ?? 'your team'}`,
    wants: 'Wants',
    issues: 'Issues',
    newTags: 'New tags to review',
    newTagsCaption: 'Accepted tags show on each person’s record.',
    accept: 'Accept',
    dismiss: 'Dismiss',
    tagFailed: "We couldn't update that tag. Try again.",
    back: 'Back to what we heard',
    backToWalk: 'Back to the walk',
    backToOutreach: 'Back to Voter Outreach',
    details: 'Details',
    whatPeopleWant: 'What people want',
    theNotes: 'The notes',
    entryCounts: (d: Pick<Denominators, 'conversations' | 'memos'>): string =>
      `${count(d.conversations, 'conversation', 'conversations')} · ${count(d.memos, 'note', 'notes')}`,
    // "Notes to review": memos nobody who was there has confirmed yet,
    // including the ones recorded with no signal and transcribed since.
    notesToReview: (pending: number): string =>
      `Notes to review: ${pending.toLocaleString()}`,
    reviewTitle: 'Notes to review',
    reviewCaption: 'Check what each note says, then confirm it.',
    reviewEmpty: 'Nothing to review. New notes show up here.',
    stillTranscribing: 'Still transcribing',
    readyToReview: 'Ready to review',
    // Each row's buttons say which note they act on, for a screen reader
    // moving through a page of them: its first words, or who took it and when.
    noteFrom: (actorName: string | null, occurredAt: Date): string =>
      `Note from ${actorName ?? 'your team'}, ${new Date(
        occurredAt,
      ).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}`,
    confirmFor: (note: string): string => `Looks right: ${note}`,
    tryAgainFor: (note: string): string => `Try again: ${note}`,
    typeItInsteadFor: (note: string): string => `Type it instead: ${note}`,
    couldNotHear: "We couldn't make out this note. Try again or type it.",
    couldNotRead:
      "We couldn't pull anything from this note. Try again or type it.",
    tryAgain: 'Try again',
    typeItInstead: 'Type it instead',
    typeLabel: 'Their note',
    typePlaceholder: 'What did they tell you?',
    saveNote: 'Save note',
    cancel: 'Cancel',
    retryFailed: "That didn't work. Try again in a moment.",
    confirmFailed: "We couldn't save that. Try again.",
  },
  serve: {
    title: 'What we heard',
    captionCounts: (d: Denominators): string =>
      [
        `${count(d.conversations, 'person', 'people')} answered.`,
        `${d.memos.toLocaleString()} left a note.`,
        `${d.confirmed.toLocaleString()} confirmed`,
      ].join(' '),
    waitingForReview: (pending: number): string =>
      `${pending.toLocaleString()} waiting for review`,
    summarizing:
      'Summarizing what you heard. This usually takes a few minutes.',
    soFarHeading: 'What people said so far',
    floorLine: (floor: number): string =>
      `Themes appear after ${floor.toLocaleString()} confirmed notes.`,
    themesHeading: 'Top themes',
    everyNoteHeading: 'Every note',
    failed: "We couldn't summarize this time.",
    summarize: 'Summarize what we heard',
    coolingDown: 'This was summarized a few minutes ago. Try again later.',
    summarizeFailed: "We couldn't start a summary. Try again in a moment.",
    noNotes:
      'No notes yet. Notes from conversations with constituents show up here.',
    drawerCaption: 'Notes from conversations with constituents.',
    loadFailed: 'This page could not load. Refresh to try again.',
    loading: 'Loading what you heard',
    conversations: (value: number): string =>
      count(value, 'conversation', 'conversations'),
    seeDetails: 'See details',
    seeDetailsFor: (title: string): string => `See details for ${title}`,
    stanceSplit: 'Where people stand',
    rank: (value: number): string => `Rank ${value}`,
    notYetReviewed: 'Not yet reviewed',
    summaryBy: (actorName: string | null): string =>
      `Summary by ${actorName ?? 'your team'}`,
    recordedBy: (actorName: string | null): string =>
      `Recorded by ${actorName ?? 'your team'}`,
    wants: 'Wants',
    issues: 'Issues',
    newTags: 'New tags to review',
    newTagsCaption: 'Accepted tags show on each person’s record.',
    accept: 'Accept',
    dismiss: 'Dismiss',
    tagFailed: "We couldn't update that tag. Try again.",
    back: 'Back to what we heard',
    backToWalk: 'Back to the walk',
    backToOutreach: 'Back to Constituent Outreach',
    details: 'Details',
    whatPeopleWant: 'What people want',
    theNotes: 'The notes',
    entryCounts: (d: Pick<Denominators, 'conversations' | 'memos'>): string =>
      `${count(d.conversations, 'conversation', 'conversations')} · ${count(d.memos, 'note', 'notes')}`,
    // "Notes to review": memos nobody who was there has confirmed yet,
    // including the ones recorded with no signal and transcribed since.
    notesToReview: (pending: number): string =>
      `Notes to review: ${pending.toLocaleString()}`,
    reviewTitle: 'Notes to review',
    reviewCaption: 'Check what each note says, then confirm it.',
    reviewEmpty: 'Nothing to review. New notes show up here.',
    stillTranscribing: 'Still transcribing',
    readyToReview: 'Ready to review',
    // Each row's buttons say which note they act on, for a screen reader
    // moving through a page of them: its first words, or who took it and when.
    noteFrom: (actorName: string | null, occurredAt: Date): string =>
      `Note from ${actorName ?? 'your team'}, ${new Date(
        occurredAt,
      ).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}`,
    confirmFor: (note: string): string => `Looks right: ${note}`,
    tryAgainFor: (note: string): string => `Try again: ${note}`,
    typeItInsteadFor: (note: string): string => `Type it instead: ${note}`,
    couldNotHear: "We couldn't make out this note. Try again or type it.",
    couldNotRead:
      "We couldn't pull anything from this note. Try again or type it.",
    tryAgain: 'Try again',
    typeItInstead: 'Type it instead',
    typeLabel: 'Their note',
    typePlaceholder: 'What did they tell you?',
    saveNote: 'Save note',
    cancel: 'Cancel',
    retryFailed: "That didn't work. Try again in a moment.",
    confirmFailed: "We couldn't save that. Try again.",
  },
}

export type WhatWeHeardCopy = (typeof WHAT_WE_HEARD_COPY)['win']

export const whatWeHeardCopy = (isServe: boolean): WhatWeHeardCopy =>
  isServe ? WHAT_WE_HEARD_COPY.serve : WHAT_WE_HEARD_COPY.win

// The capture card's own words for a position, so the report reads a stance
// back the way the canvasser confirmed it.
export const STANCE_LABELS: Record<
  'win' | 'serve',
  Record<ConstituentFeedbackStance, string>
> = {
  win: {
    supports: 'For it',
    opposes: 'Against it',
    mixed: 'Mixed',
    unclear: 'Unclear',
  },
  serve: {
    supports: 'For it',
    opposes: 'Against it',
    mixed: 'Mixed',
    unclear: 'Unclear',
  },
}

export const STANCE_ORDER: ConstituentFeedbackStance[] = [
  'supports',
  'opposes',
  'mixed',
  'unclear',
]

// The person record's words for where a conversation happened.
export const CHANNEL_LABELS: Record<ConstituentFeedbackChannel, string> = {
  door_knock: 'At the door',
  phone_bank: 'On the phone',
}
