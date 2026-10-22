import {
  joinGroupNames,
  READ_REPRESENTATIVENESS_LABELS,
  underrepresentedGroupName,
  type PriorityReadStatus,
  type UnderrepresentedGroup,
} from '@goodparty_org/contracts'

const NO_ONE_ASKED = 'No one asked yet'

const groupList = (
  read: PriorityReadStatus,
  groups: readonly UnderrepresentedGroup[],
): string =>
  joinGroupNames(
    groups.map((group) => underrepresentedGroupName(group, read.status)),
  )

// A group nobody in has answered is still to hear from; one with a few
// answers, or still too unsure, needs more of them.
const shortLine = (read: PriorityReadStatus): string => {
  const unheard = read.underrepresented.filter((group) =>
    read.unheard?.includes(group),
  )
  const few = read.underrepresented.filter(
    (group) => !read.unheard?.includes(group),
  )
  if (unheard.length === 0) {
    return `Need a few more answers from ${groupList(read, few)}`
  }
  const still = `Still need to hear from ${groupList(read, unheard)}`
  return few.length === 0
    ? still
    : `${still}, and a few more answers from ${groupList(read, few)}`
}

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
  noOneAsked: NO_ONE_ASKED,
  // Get answers is for a check that is out, a read that is still short, and
  // no follow-up text already on its way.
  canGetAnswers: (read: PriorityReadStatus): boolean =>
    read.checkOut === true &&
    !read.good &&
    !read.followUp &&
    !read.followUpSent,
  seeWhatWeHeard: 'See what we heard',
  whatWeHeard: 'What we heard',
  progress: (read: PriorityReadStatus): string =>
    `${read.groupsHeard} of ${read.groupsTotal} groups heard`,
  label: (read: PriorityReadStatus): string =>
    read.good || read.checkOut
      ? READ_REPRESENTATIVENESS_LABELS[read.status]
      : NO_ONE_ASKED,
  // The status, then the groups it is about, for the phone's one row and
  // the desktop rail alike.
  statusLine: (read: PriorityReadStatus): string => {
    if (read.good) return READ_STATUS_COPY.goodLine(read)
    if (!read.checkOut) return READ_STATUS_COPY.noOneAsked
    if (read.underrepresented.length === 0) {
      return READ_REPRESENTATIVENESS_LABELS[read.status]
    }
    if (read.status === 'gettingClose') {
      return `Still unsure what ${groupList(read, read.underrepresented)} think`
    }
    return shortLine(read)
  },
  // The results page's held card, under the status line: why what was
  // heard is not shown yet, without claiming nobody answered.
  heldBack: (read: PriorityReadStatus): string => {
    if (read.groupsTotal === 0) {
      return "We'll show what we heard once enough people have answered."
    }
    return read.status === 'gettingClose'
      ? "We'll show what we heard once we're sure what every group thinks."
      : "We'll show what we heard once every group has enough answers."
  },
  // A follow-up text paid for with the first: when it goes and to whom.
  followUp: (texts: number, date: string): string =>
    `Follow-up text to ${texts.toLocaleString()} people on ${date}`,
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
