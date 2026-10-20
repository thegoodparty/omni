import {
  READ_REPRESENTATIVENESS_LABELS,
  UNDERREPRESENTED_GROUP_NAMES,
  type PriorityReadStatus,
  type UnderrepresentedGroup,
} from '@goodparty_org/contracts'

const groupList = (groups: UnderrepresentedGroup[]): string =>
  groups.map((group) => UNDERREPRESENTED_GROUP_NAMES[group]).join(' and ')

// Shared by the priority page and its results page, so "a good read" reads
// the same everywhere it shows.
export const READ_STATUS_COPY = {
  moreAnswers: (more: number) =>
    more === 1
      ? '1 more answer for a good read'
      : `${more.toLocaleString()} more answers for a good read`,
  // Enough answers is a good read the census could not be checked against,
  // so it says nothing about who answered.
  goodLine: (read: PriorityReadStatus): string =>
    read.status === 'enoughAnswers'
      ? READ_REPRESENTATIVENESS_LABELS.enoughAnswers
      : 'Representative of your district',
  getAnswers: 'Get answers',
  seeWhatWeHeard: 'See what we heard',
  whatWeHeard: 'What we heard',
  progress: (answers: number, needed: number) =>
    `${answers.toLocaleString()} of ${needed.toLocaleString()} answers for a good read`,
  label: (read: PriorityReadStatus): string =>
    READ_REPRESENTATIVENESS_LABELS[read.status],
  hearFromMore: (groups: UnderrepresentedGroup[]) =>
    `Hear from more ${groupList(groups)}`,
  // The phone's one row: the status, then the one thing to do about it.
  stripLine: (read: PriorityReadStatus): string => {
    const label = READ_REPRESENTATIVENESS_LABELS[read.status]
    if (read.underrepresented.length > 0) {
      return `${label}. Hear from more ${groupList(read.underrepresented.slice(0, 1))}`
    }
    return read.status === 'gettingClose'
      ? `${label}. A few more answers will do it`
      : label
  },
  tooEarly: "It's too early to tell what your community thinks.",
  // A follow-up text paid for with the first: when it goes and to whom.
  followUp: (texts: number, date: string): string =>
    `Follow-up text to ${texts.toLocaleString()} people on ${date}, to the groups you've heard from least`,
  notLikeDistrict:
    "We're hearing less from some groups than live in your district. We'll show what we heard once answers look like your district.",
  hearFromMoreHeading: 'Hear from more',
  groupName: (group: UnderrepresentedGroup): string =>
    UNDERREPRESENTED_GROUP_NAMES[group],
} as const

export const resultsHref = (priorityId: string): string =>
  `/dashboard/priorities/${encodeURIComponent(priorityId)}/results`

// The results page's Get answers goes back to the priority, which sends the
// agent the same hidden turn its own button does.
export const GET_ANSWERS_PARAM = 'getAnswers'

export const getAnswersHref = (priorityId: string): string =>
  `/dashboard/priorities/${encodeURIComponent(priorityId)}?${GET_ANSWERS_PARAM}=1`

export const readPercent = (answers: number, needed: number): number =>
  Math.min(100, Math.round((answers / needed) * 100))

// The dot beside a status, so the label is never read by colour alone.
export const READ_STATUS_DOT: Record<PriorityReadStatus['status'], string> = {
  tooEarly: 'bg-muted-foreground',
  notYetRepresentative: 'bg-destructive',
  gettingClose: 'bg-warning',
  representative: 'bg-primary',
  enoughAnswers: 'bg-primary',
}
