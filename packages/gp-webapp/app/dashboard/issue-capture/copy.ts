import type {
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
    // numbers on the cards cannot be read as more than they are.
    caption: (d: Denominators): string =>
      [
        `${count(d.conversations, 'person', 'people')} answered.`,
        `${d.memos.toLocaleString()} left a note.`,
        d.pending > 0
          ? `${d.confirmed.toLocaleString()} confirmed, ${d.pending.toLocaleString()} waiting for review.`
          : `${d.confirmed.toLocaleString()} confirmed.`,
      ].join(' '),
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
    loadFailed: 'This page could not load. Refresh to try again.',
    loading: 'Loading what you heard',
    conversations: (value: number): string =>
      count(value, 'conversation', 'conversations'),
    seeDetails: 'See details',
    stanceSplit: 'Where people stand',
    rank: (value: number): string => `Rank ${value}`,
    notYetReviewed: 'Not yet reviewed',
    // Every note is the canvasser's own summary of the conversation, never
    // the other person's words, and it says so.
    summaryBy: (actorName: string | null): string =>
      `Summary by ${actorName ?? 'your team'}`,
    wants: 'Wants',
    newTags: 'New tags to review',
    newTagsCaption: 'Accepted tags show on each person’s record.',
    accept: 'Accept',
    dismiss: 'Dismiss',
    tagFailed: "We couldn't update that tag. Try again.",
    back: 'Back to what we heard',
    details: 'Details',
    whatPeopleWant: 'What people want',
    theNotes: 'The notes',
    entryCounts: (d: Pick<Denominators, 'conversations' | 'memos'>): string =>
      `${count(d.conversations, 'conversation', 'conversations')} · ${count(d.memos, 'note', 'notes')}`,
  },
  serve: {
    title: 'What we heard',
    caption: (d: Denominators): string =>
      [
        `${count(d.conversations, 'person', 'people')} answered.`,
        `${d.memos.toLocaleString()} left a note.`,
        d.pending > 0
          ? `${d.confirmed.toLocaleString()} confirmed, ${d.pending.toLocaleString()} waiting for review.`
          : `${d.confirmed.toLocaleString()} confirmed.`,
      ].join(' '),
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
    loadFailed: 'This page could not load. Refresh to try again.',
    loading: 'Loading what you heard',
    conversations: (value: number): string =>
      count(value, 'conversation', 'conversations'),
    seeDetails: 'See details',
    stanceSplit: 'Where people stand',
    rank: (value: number): string => `Rank ${value}`,
    notYetReviewed: 'Not yet reviewed',
    summaryBy: (actorName: string | null): string =>
      `Summary by ${actorName ?? 'your team'}`,
    wants: 'Wants',
    newTags: 'New tags to review',
    newTagsCaption: 'Accepted tags show on each person’s record.',
    accept: 'Accept',
    dismiss: 'Dismiss',
    tagFailed: "We couldn't update that tag. Try again.",
    back: 'Back to what we heard',
    details: 'Details',
    whatPeopleWant: 'What people want',
    theNotes: 'The notes',
    entryCounts: (d: Pick<Denominators, 'conversations' | 'memos'>): string =>
      `${count(d.conversations, 'conversation', 'conversations')} · ${count(d.memos, 'note', 'notes')}`,
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
export const CHANNEL_LABELS: Record<string, string> = {
  door_knock: 'At the door',
  phone_bank: 'On the phone',
}
