import type {
  ConstituentFeedbackStance,
  FeedbackReportChannel,
  FeedbackReportResponse,
} from '@goodparty_org/contracts'

type Denominators = FeedbackReportResponse['denominators']

const count = (value: number, one: string, many: string): string =>
  `${value.toLocaleString()} ${value === 1 ? one : many}`

// A text send's entries are the constituents' own replies, not a
// canvasser's notes, so the lines that say "note" say "reply" there. The
// door and the phone read exactly as they did.
const isText = (channel: FeedbackReportChannel): boolean => channel === 'text'

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
    countsLabel: 'Notes so far',
    countAnswered: 'People answered',
    countNoted: 'Left a note',
    // A text send keeps its own caption: every reply counts and nothing waits
    // for review, so it is the replies and the people they came from.
    replyCounts: (d: Denominators): string =>
      `${count(d.memos, 'reply', 'replies')} from ${count(d.conversations, 'person', 'people')}.`,
    summarizing:
      'Summarizing what you heard. This usually takes a few minutes.',
    soFarHeading: 'What people said so far',
    floorLine: (floor: number, channel: FeedbackReportChannel): string =>
      isText(channel)
        ? `Themes appear after ${floor.toLocaleString()} replies.`
        : `Themes appear after ${floor.toLocaleString()} confirmed notes.`,
    themesHeading: 'Top themes',
    showMoreThemes: (hidden: number): string =>
      `Show ${count(hidden, 'more theme', 'more themes')}`,
    everyNoteHeading: (channel: FeedbackReportChannel): string =>
      isText(channel) ? 'Every reply' : 'All notes',
    showMoreNotes: (hidden: number): string =>
      `Show ${count(hidden, 'more note', 'more notes')}`,
    failed: "We couldn't summarize this time.",
    summarize: 'Summarize notes',
    coolingDown: 'This was summarized a few minutes ago. Try again later.',
    summarizeFailed: "We couldn't start a summary. Try again in a moment.",
    downloadNotes: 'Download',
    noNotes: (channel: FeedbackReportChannel): string =>
      isText(channel)
        ? 'No replies yet. Replies from voters show up here.'
        : 'No notes yet. Notes from conversations with voters show up here.',
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
    // Every note is the canvasser's own summary of the conversation, never
    // the other person's words, and it says so.
    summaryBy: (actorName: string | null): string =>
      `Summary by ${actorName ?? 'your team'}`,
    // A text reply is the person's own words, so it is not a summary and
    // is not credited to anyone on the team.
    theirReply: 'Their reply',
    issueHeading: 'Issue',
    issueNumber: (n: number): string => `Issue ${n}`,
    wantsHeading: 'Wants',
    issues: 'Issues',
    back: 'Back to what we heard',
    backToOutreach: 'Back to Voter Outreach',
    backLabel: 'Back',
    details: 'Details',
    whatPeopleWant: 'What people want',
    personInfo: 'Voter data',
    personInfoFailed: "We couldn't load this voter. Try again in a moment.",
    showMoreWants: (hidden: number): string =>
      `Show ${hidden.toLocaleString()} more`,
    theNotes: (channel: FeedbackReportChannel): string =>
      isText(channel) ? 'The replies' : 'The notes',
    entryCounts: (
      d: Pick<Denominators, 'conversations' | 'memos'>,
      channel: FeedbackReportChannel,
    ): string =>
      isText(channel)
        ? count(d.memos, 'reply', 'replies')
        : `${count(d.conversations, 'conversation', 'conversations')} · ${count(d.memos, 'note', 'notes')}`,
    typeLabel: 'Their note',
    saveNote: 'Save note',
    cancel: 'Cancel',
  },
  serve: {
    title: 'What we heard',
    countsLabel: 'Notes so far',
    countAnswered: 'People answered',
    countNoted: 'Left a note',
    // A text send keeps its own caption: every reply counts and nothing waits
    // for review, so it is the replies and the people they came from.
    replyCounts: (d: Denominators): string =>
      `${count(d.memos, 'reply', 'replies')} from ${count(d.conversations, 'person', 'people')}.`,
    summarizing:
      'Summarizing what you heard. This usually takes a few minutes.',
    soFarHeading: 'What people said so far',
    floorLine: (floor: number, channel: FeedbackReportChannel): string =>
      isText(channel)
        ? `Themes appear after ${floor.toLocaleString()} replies.`
        : `Themes appear after ${floor.toLocaleString()} confirmed notes.`,
    themesHeading: 'Top themes',
    showMoreThemes: (hidden: number): string =>
      `Show ${count(hidden, 'more theme', 'more themes')}`,
    everyNoteHeading: (channel: FeedbackReportChannel): string =>
      isText(channel) ? 'Every reply' : 'All notes',
    showMoreNotes: (hidden: number): string =>
      `Show ${count(hidden, 'more note', 'more notes')}`,
    failed: "We couldn't summarize this time.",
    summarize: 'Summarize notes',
    coolingDown: 'This was summarized a few minutes ago. Try again later.',
    summarizeFailed: "We couldn't start a summary. Try again in a moment.",
    downloadNotes: 'Download',
    noNotes: (channel: FeedbackReportChannel): string =>
      isText(channel)
        ? 'No replies yet. Replies from constituents show up here.'
        : 'No notes yet. Notes from conversations with constituents show up here.',
    loadFailed: 'This page could not load. Refresh to try again.',
    loading: 'Loading what you heard',
    conversations: (value: number): string =>
      count(value, 'conversation', 'conversations'),
    seeDetails: 'See details',
    seeDetailsFor: (title: string): string => `See details for ${title}`,
    stanceSplit: 'Where people stand',
    rank: (value: number): string => `Rank ${value}`,
    summaryBy: (actorName: string | null): string =>
      `Summary by ${actorName ?? 'your team'}`,
    // A text reply is the person's own words, so it is not a summary and
    // is not credited to anyone on the team.
    theirReply: 'Their reply',
    issueHeading: 'Issue',
    issueNumber: (n: number): string => `Issue ${n}`,
    wantsHeading: 'Wants',
    issues: 'Issues',
    back: 'Back to what we heard',
    backToOutreach: 'Back to Constituent Outreach',
    backLabel: 'Back',
    details: 'Details',
    whatPeopleWant: 'What people want',
    personInfo: 'Constituent data',
    personInfoFailed:
      "We couldn't load this constituent. Try again in a moment.",
    showMoreWants: (hidden: number): string =>
      `Show ${hidden.toLocaleString()} more`,
    theNotes: (channel: FeedbackReportChannel): string =>
      isText(channel) ? 'The replies' : 'The notes',
    entryCounts: (
      d: Pick<Denominators, 'conversations' | 'memos'>,
      channel: FeedbackReportChannel,
    ): string =>
      isText(channel)
        ? count(d.memos, 'reply', 'replies')
        : `${count(d.conversations, 'conversation', 'conversations')} · ${count(d.memos, 'note', 'notes')}`,
    typeLabel: 'Their note',
    saveNote: 'Save note',
    cancel: 'Cancel',
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
export const CHANNEL_LABELS: Record<FeedbackReportChannel, string> = {
  door_knock: 'At the door',
  phone_bank: 'On the phone',
  text: 'By text',
}
