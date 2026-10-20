import {
  READ_REPRESENTATIVENESS_LABELS,
  underrepresentedGroupName,
  type PriorityReadStatus,
  type UnderrepresentedGroup,
} from '@goodparty_org/contracts'

const groupList = (read: PriorityReadStatus): string =>
  read.underrepresented
    .map((group) => underrepresentedGroupName(group, read.status))
    .join(' and ')

// Shared by the priority page and its results page, so a read reads the
// same everywhere it shows.
export const READ_STATUS_COPY = {
  // Enough people have answered is a good read the census could not be
  // checked against, so it says nothing about which groups answered.
  goodLine: (read: PriorityReadStatus): string =>
    read.status === 'enoughAnswers'
      ? READ_REPRESENTATIVENESS_LABELS.enoughAnswers
      : "You've heard from every group",
  getAnswers: 'Get answers',
  seeWhatWeHeard: 'See what we heard',
  whatWeHeard: 'What we heard',
  progress: (read: PriorityReadStatus): string =>
    `${read.groupsHeard} of ${read.groupsTotal} groups heard`,
  label: (read: PriorityReadStatus): string =>
    READ_REPRESENTATIVENESS_LABELS[read.status],
  // The status, then the groups it is about, for the phone's one row and
  // the desktop rail alike.
  statusLine: (read: PriorityReadStatus): string => {
    if (read.good) return READ_STATUS_COPY.goodLine(read)
    if (read.underrepresented.length === 0) {
      return READ_REPRESENTATIVENESS_LABELS[read.status]
    }
    const groups = groupList(read)
    if (read.status === 'tooEarly') return `Waiting to hear from ${groups}`
    if (read.status === 'gettingClose')
      return `Still unsure what ${groups} think`
    return `Hear from more ${groups}`
  },
  missingGroups:
    "Some groups haven't answered yet. We'll show what we heard once every group has.",
  unsureGroups:
    "We'll show what we heard once we're sure what every group thinks.",
  // A follow-up text paid for with the first: when it goes and to whom.
  followUp: (texts: number, date: string): string =>
    `Follow-up text to ${texts.toLocaleString()} people on ${date}, to the groups you've heard from least`,
  hearFromMoreHeading: 'Hear from more',
  groupName: (group: UnderrepresentedGroup, read: PriorityReadStatus): string =>
    underrepresentedGroupName(group, read.status),
} as const

export const resultsHref = (priorityId: string): string =>
  `/dashboard/priorities/${encodeURIComponent(priorityId)}/results`

// The results page's Get answers goes back to the priority, which sends the
// agent the same hidden turn its own button does.
export const GET_ANSWERS_PARAM = 'getAnswers'

export const getAnswersHref = (priorityId: string): string =>
  `/dashboard/priorities/${encodeURIComponent(priorityId)}?${GET_ANSWERS_PARAM}=1`

export const readPercent = (read: PriorityReadStatus): number =>
  read.groupsTotal === 0
    ? 0
    : Math.min(100, Math.round((read.groupsHeard / read.groupsTotal) * 100))

// The groups bar takes its status's tone, so a full bar before a good read
// (every group heard, the model not sure yet) is never the success colour.
export const READ_PROGRESS_TONE: Record<PriorityReadStatus['status'], string> =
  {
    tooEarly:
      'bg-muted-foreground/20 [&>[data-slot=progress-indicator]]:bg-muted-foreground',
    notYetRepresentative:
      'bg-destructive/20 [&>[data-slot=progress-indicator]]:bg-destructive',
    gettingClose: 'bg-warning/20 [&>[data-slot=progress-indicator]]:bg-warning',
    representative: '',
    enoughAnswers: '',
  }

// The dot beside a status, so the label is never read by colour alone.
export const READ_STATUS_DOT: Record<PriorityReadStatus['status'], string> = {
  tooEarly: 'bg-muted-foreground',
  notYetRepresentative: 'bg-destructive',
  gettingClose: 'bg-warning',
  representative: 'bg-primary',
  enoughAnswers: 'bg-primary',
}
