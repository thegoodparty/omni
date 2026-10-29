import {
  joinGroupNames,
  READ_REPRESENTATIVENESS_LABELS,
  underrepresentedGroupName,
  type ManagedCivicPanelStatus,
  type PriorityReadStatus,
  type UnderrepresentedGroup,
} from '@goodparty_org/contracts'
import { SERVE_CITIZENS_PANEL_COPY } from '../../contacts/citizens-panel/citizensPanelCopy'

const NO_ONE_ASKED = 'No one asked yet'
const FEW_MORE_OVERALL = 'Need a few more answers overall'

// Every group has its answers, but not yet the district's total: one
// answer counts in every group, so the groups fill before the total does.
// A group still too unsure may be named too, but the total is what holds
// the read back.
const onlyTotalShort = (read: PriorityReadStatus): boolean =>
  read.status === 'notYetRepresentative' &&
  read.groupsTotal > 0 &&
  read.groupsHeard === read.groupsTotal

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

// The people toward a balanced read and the people it needs, for the seats
// and the bar. A read served before the API counted them falls back to
// everyone who answered, up to the total needed.
export const representativeCount = (
  read: PriorityReadStatus,
): { have: number; need: number } => {
  const need = read.representativeNeeded ?? read.needed
  return {
    have: Math.min(read.representativeAnswers ?? read.answers, need),
    need,
  }
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
  progress: (read: PriorityReadStatus): string => {
    const { have, need } = representativeCount(read)
    return `${have.toLocaleString()} of the ${need.toLocaleString()} answers we need`
  },
  legendHeard: 'Heard',
  legendNeeded: 'Still needed',
  // The groups holding the read back, for the results page's held card.
  stillNeed: (read: PriorityReadStatus): string =>
    `Still need: ${groupList(read, read.underrepresented)}.`,
  label: (read: PriorityReadStatus): string => {
    if (!read.good && !read.checkOut) return NO_ONE_ASKED
    return onlyTotalShort(read)
      ? FEW_MORE_OVERALL
      : READ_REPRESENTATIVENESS_LABELS[read.status]
  },
  // Whether the status line names groups, so a heading that already says
  // the total is short is not repeated under it.
  namesGroups: (read: PriorityReadStatus): boolean =>
    read.underrepresented.length > 0 && !onlyTotalShort(read),
  // The status, then the groups it is about, for the phone's one row and
  // the desktop rail alike.
  statusLine: (read: PriorityReadStatus): string => {
    if (read.good) return READ_STATUS_COPY.goodLine(read)
    if (!read.checkOut) return READ_STATUS_COPY.noOneAsked
    if (onlyTotalShort(read)) return FEW_MORE_OVERALL
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
    if (read.groupsTotal === 0 || onlyTotalShort(read)) {
      return "We'll show what we heard once enough people have answered."
    }
    return read.status === 'gettingClose'
      ? "We'll show what we heard once we're sure what every group thinks."
      : "We'll show what people said once every group has enough answers, so a few loud voices can't tip the read."
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

export const readPercent = (read: PriorityReadStatus): number => {
  const { have, need } = representativeCount(read)
  return Math.min(100, Math.round((have / need) * 100))
}

// The bar takes its status's tone, so a full bar before a good read (every
// answer in, the model not sure yet) is never the success colour.
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

// The civic panel GoodParty builds, under the read: the titles the civic
// panel page leads with, and how many residents have joined.
export const civicPanelStanding = (
  status: Exclude<ManagedCivicPanelStatus, 'stopped'>,
  members: number,
  goal: number,
): { title: string; line: string } => {
  const hero = SERVE_CITIZENS_PANEL_COPY.hero
  const joined = SERVE_CITIZENS_PANEL_COPY.joinedOfGoal(members, goal)
  switch (status) {
    case 'building':
      return { title: hero.building.title, line: joined }
    case 'paused':
      return { title: hero.paused.title, line: joined }
    case 'exhausted':
      return { title: hero.exhausted.title, line: joined }
    case 'ready':
      return { title: hero.ready.title, line: hero.ready.line(members, goal) }
  }
}
