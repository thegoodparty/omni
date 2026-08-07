import {
  type LucideIcon,
  Share2,
  MessageSquare,
  Mail,
  Phone,
  Headphones,
  DoorOpen,
  ClipboardList,
  CalendarClock,
  CircleDot,
  CheckCircle2,
} from 'lucide-react'

// Ported from the Lovable source (src/pages/Outreach.tsx).
export type ChannelKey =
  | 'sms'
  | 'email'
  | 'robocall'
  | 'phone-bank'
  | 'door'
  | 'social'
  | 'polls'

export type HistoryStatus = 'scheduled' | 'in-progress' | 'done'

export type HistoryRow = {
  id: string
  date: string
  scheduledAt?: Date
  startedAt?: Date
  completedAt?: Date
  name: string
  channel: ChannelKey
  status: HistoryStatus
  people: number
  responses: number
  unsubscribes: number | null
  audienceName: string
  audienceFilters: string[]
  cost: number
  costPerOutreach: number
  receiptId: string | null
  archived?: boolean
  households?: number
  supporters?: number
  answers?: number
}

export const CHANNEL_LABEL: Record<ChannelKey, string> = {
  social: 'Social media',
  sms: 'SMS',
  email: 'Email',
  robocall: 'Robocall',
  'phone-bank': 'Phone banking',
  door: 'Door knocking',
  polls: 'Poll / Survey',
}

export const CHANNEL_ICON: Record<ChannelKey, LucideIcon> = {
  social: Share2,
  sms: MessageSquare,
  email: Mail,
  robocall: Phone,
  'phone-bank': Headphones,
  door: DoorOpen,
  polls: ClipboardList,
}

// Channel pill tint — soft fill built ONLY from styleguide auxiliary color families
// (`bg-{family}-light`), one family per channel group. Text colour is a single
// consistent `text-foreground` across every pill. Not a Badge variant (Badge ships
// none for these); applied via className. See NEW_COMPONENTS.md for the DS gap.
export const CHANNEL_TINT: Record<ChannelKey, string> = {
  email: 'border-transparent bg-primary-light text-foreground',
  sms: 'border-transparent bg-info-light text-foreground',
  social: 'border-transparent bg-secondary-light text-foreground',
  polls: 'border-transparent bg-tertiary-light text-foreground',
  door: 'border-transparent bg-success-light text-foreground',
  'phone-bank': 'border-transparent bg-warning-light text-foreground',
  robocall: 'border-transparent bg-warning-light text-foreground',
}

// Channel-card icon-circle background — same colour family as the badge. Only the
// background varies per channel; the glyph colour is a single constant (set in
// ChannelCard) so every icon reads the same, per design.
export const CHANNEL_ICON_TINT: Record<ChannelKey, string> = {
  email: 'bg-primary-light',
  sms: 'bg-info-light',
  social: 'bg-secondary-light',
  polls: 'bg-tertiary-light',
  door: 'bg-success-light',
  'phone-bank': 'bg-warning-light',
  robocall: 'bg-warning-light',
}

export const CHANNELS: ChannelKey[] = [
  'social',
  'sms',
  'email',
  'robocall',
  'phone-bank',
  'door',
  'polls',
]

export const STATUS_META: Record<
  HistoryStatus,
  { label: string; icon: LucideIcon }
> = {
  scheduled: { label: 'Scheduled', icon: CalendarClock },
  'in-progress': { label: 'In progress', icon: CircleDot },
  done: { label: 'Done', icon: CheckCircle2 },
}

export const STATUSES: HistoryStatus[] = ['scheduled', 'in-progress', 'done']

export const HISTORY: HistoryRow[] = [
  {
    id: 'h1',
    date: 'Jul 2',
    startedAt: new Date('2026-07-02T09:00:00'),
    completedAt: new Date('2026-07-02T11:30:00'),
    name: 'July rent-cap push',
    channel: 'sms',
    status: 'done',
    people: 1204,
    responses: 186,
    unsubscribes: 9,
    audienceName: 'Renters — housing cost concerns',
    audienceFilters: ['Renters', 'Housing cost concerns'],
    cost: 60.2,
    costPerOutreach: 0.05,
    receiptId: 'rcpt_h1',
  },
  {
    id: 'h2',
    date: 'Jun 24',
    startedAt: new Date('2026-06-24T10:00:00'),
    name: 'Precinct 4 doors',
    channel: 'door',
    status: 'in-progress',
    people: 312,
    responses: 121,
    unsubscribes: 0,
    households: 180,
    supporters: 121,
    audienceName: 'Precinct 4 high-turnout undecideds',
    audienceFilters: ['Precinct 4', 'High turnout', 'Undecided'],
    cost: 0,
    costPerOutreach: 0,
    receiptId: null,
  },
  {
    id: 'h3',
    date: 'Jun 15',
    startedAt: new Date('2026-06-15T10:00:00'),
    completedAt: new Date('2026-06-15T12:00:00'),
    name: 'Transit boost',
    channel: 'social',
    status: 'done',
    people: 4900,
    responses: 214,
    unsubscribes: null,
    audienceName: 'Facebook + Nextdoor',
    audienceFilters: ['Facebook', 'Nextdoor'],
    cost: 0,
    costPerOutreach: 0,
    receiptId: null,
  },
  {
    id: 'h4',
    date: 'Jul 20',
    scheduledAt: new Date('2026-07-20T09:00:00'),
    name: 'Budget hearing reminder',
    channel: 'robocall',
    status: 'scheduled',
    people: 2050,
    responses: 0,
    unsubscribes: 0,
    answers: 0,
    audienceName: 'All registered voters',
    audienceFilters: ['All registered voters'],
    cost: 82.0,
    costPerOutreach: 0.04,
    receiptId: 'rcpt_h4',
  },
  {
    id: 'h5',
    date: 'May 30',
    startedAt: new Date('2026-05-30T17:00:00'),
    name: 'Volunteer phone bank',
    channel: 'phone-bank',
    status: 'in-progress',
    people: 480,
    responses: 92,
    unsubscribes: 2,
    supporters: 92,
    audienceName: 'Likely voters',
    audienceFilters: ['Likely voters'],
    cost: 0,
    costPerOutreach: 0,
    receiptId: null,
  },
  {
    id: 'h6',
    date: 'May 18',
    startedAt: new Date('2026-05-18T09:00:00'),
    completedAt: new Date('2026-05-18T09:45:00'),
    name: 'Kickoff SMS',
    channel: 'sms',
    status: 'done',
    people: 1800,
    responses: 240,
    unsubscribes: 14,
    audienceName: 'All registered voters',
    audienceFilters: ['All registered voters'],
    cost: 90.0,
    costPerOutreach: 0.05,
    receiptId: 'rcpt_h6',
  },
  {
    id: 'h7',
    date: 'Jul 14',
    startedAt: new Date('2026-07-14T08:00:00'),
    completedAt: new Date('2026-07-14T10:00:00'),
    name: 'Small business roundtable invite',
    channel: 'email',
    status: 'done',
    people: 820,
    responses: 312,
    unsubscribes: 4,
    audienceName: 'Small business owners',
    audienceFilters: ['Small business', 'Downtown'],
    cost: 0,
    costPerOutreach: 0,
    receiptId: null,
  },
  {
    id: 'h7b',
    date: 'Jul 13',
    startedAt: new Date('2026-07-13T09:00:00'),
    completedAt: new Date('2026-07-13T12:00:00'),
    name: 'Quarterly community update — infrastructure, schools, and upcoming town hall invitation',
    channel: 'email',
    status: 'done',
    people: 2340,
    responses: 812,
    unsubscribes: 11,
    audienceName: 'Full newsletter list',
    audienceFilters: ['Subscribers', 'District-wide'],
    cost: 0,
    costPerOutreach: 0,
    receiptId: null,
  },
  {
    id: 'h8',
    date: 'Jul 10',
    startedAt: new Date('2026-07-10T10:00:00'),
    completedAt: new Date('2026-07-10T14:00:00'),
    name: 'Weekend canvass — Ward 3',
    channel: 'door',
    status: 'done',
    people: 540,
    responses: 198,
    unsubscribes: 0,
    households: 310,
    supporters: 198,
    audienceName: 'Ward 3 undecideds',
    audienceFilters: ['Ward 3', 'Undecided'],
    cost: 0,
    costPerOutreach: 0,
    receiptId: null,
  },
  {
    id: 'h9',
    date: 'Jul 8',
    startedAt: new Date('2026-07-08T09:00:00'),
    completedAt: new Date('2026-07-08T09:30:00'),
    name: 'Election Day reminder',
    channel: 'robocall',
    status: 'done',
    people: 3600,
    responses: 0,
    unsubscribes: 0,
    answers: 1420,
    audienceName: 'All registered voters',
    audienceFilters: ['All registered voters'],
    cost: 144.0,
    costPerOutreach: 0.04,
    receiptId: 'rcpt_h9',
  },
  {
    id: 'h10',
    date: 'Jul 5',
    startedAt: new Date('2026-07-05T11:00:00'),
    completedAt: new Date('2026-07-05T11:15:00'),
    name: 'Instagram launch reel',
    channel: 'social',
    status: 'done',
    people: 0,
    responses: 872,
    unsubscribes: null,
    audienceName: 'Instagram + TikTok',
    audienceFilters: ['Instagram', 'TikTok'],
    cost: 0,
    costPerOutreach: 0,
    receiptId: null,
  },
  {
    id: 'h11',
    date: 'Jul 3',
    startedAt: new Date('2026-07-03T14:00:00'),
    completedAt: new Date('2026-07-03T14:30:00'),
    name: 'Volunteer recruitment SMS',
    channel: 'sms',
    status: 'done',
    people: 950,
    responses: 88,
    unsubscribes: 6,
    audienceName: 'Past volunteers',
    audienceFilters: ['Volunteers'],
    cost: 47.5,
    costPerOutreach: 0.05,
    receiptId: 'rcpt_h11',
  },
  {
    id: 'h12',
    date: 'Jul 1',
    startedAt: new Date('2026-07-01T09:00:00'),
    completedAt: new Date('2026-07-01T11:00:00'),
    name: 'Coffee with the candidate',
    channel: 'email',
    status: 'done',
    people: 1400,
    responses: 421,
    unsubscribes: 8,
    audienceName: 'Newsletter subscribers',
    audienceFilters: ['Subscribers'],
    cost: 0,
    costPerOutreach: 0,
    receiptId: null,
  },
  {
    id: 'h13',
    date: 'Jun 28',
    startedAt: new Date('2026-06-28T16:00:00'),
    completedAt: new Date('2026-06-28T19:00:00'),
    name: 'Downtown phone bank',
    channel: 'phone-bank',
    status: 'done',
    people: 620,
    responses: 205,
    unsubscribes: null,
    supporters: 205,
    audienceName: 'Downtown likely voters',
    audienceFilters: ['Downtown', 'Likely voters'],
    cost: 0,
    costPerOutreach: 0,
    receiptId: null,
  },
  {
    id: 'h14',
    date: 'Jun 22',
    startedAt: new Date('2026-06-22T13:00:00'),
    completedAt: new Date('2026-06-22T13:20:00'),
    name: 'Facebook policy explainer',
    channel: 'social',
    status: 'done',
    people: 0,
    responses: 356,
    unsubscribes: null,
    audienceName: 'Facebook + Nextdoor',
    audienceFilters: ['Facebook', 'Nextdoor'],
    cost: 0,
    costPerOutreach: 0,
    receiptId: null,
  },
  {
    id: 'h15',
    date: 'Jul 22',
    scheduledAt: new Date('2026-07-22T14:30:00'),
    name: 'Town hall RSVP push',
    channel: 'sms',
    status: 'scheduled',
    people: 2200,
    responses: 0,
    unsubscribes: 0,
    audienceName: 'District-wide',
    audienceFilters: ['All registered voters'],
    cost: 110.0,
    costPerOutreach: 0.05,
    receiptId: 'rcpt_h15',
  },
  {
    id: 'h16',
    date: 'Jul 25',
    scheduledAt: new Date('2026-07-25T10:00:00'),
    name: 'Weekend doors — Precinct 7',
    channel: 'door',
    status: 'scheduled',
    people: 400,
    responses: 0,
    unsubscribes: 0,
    households: 240,
    supporters: 0,
    audienceName: 'Precinct 7 undecideds',
    audienceFilters: ['Precinct 7', 'Undecided'],
    cost: 0,
    costPerOutreach: 0,
    receiptId: null,
  },
  {
    id: 'h17',
    date: 'Jul 12',
    startedAt: new Date('2026-07-12T10:00:00'),
    completedAt: new Date('2026-07-12T18:00:00'),
    name: 'Housing supply poll',
    channel: 'polls',
    status: 'done',
    people: 1500,
    responses: 462,
    unsubscribes: 7,
    audienceName: 'Renters — housing cost concerns',
    audienceFilters: ['Renters', 'Housing cost concerns'],
    cost: 52.5,
    costPerOutreach: 0.035,
    receiptId: 'rcpt_h17',
  },
  {
    id: 'h18',
    date: 'Jul 28',
    scheduledAt: new Date('2026-07-28T09:00:00'),
    name: 'Public safety cameras poll',
    channel: 'polls',
    status: 'scheduled',
    people: 2100,
    responses: 0,
    unsubscribes: 0,
    audienceName: 'District-wide',
    audienceFilters: ['All registered voters'],
    cost: 73.5,
    costPerOutreach: 0.035,
    receiptId: 'rcpt_h18',
  },
  {
    id: 'a1',
    date: 'Jun 12',
    startedAt: new Date('2026-06-12T09:00:00'),
    completedAt: new Date('2026-06-12T13:00:00'),
    name: 'Spring canvass wrap-up',
    channel: 'door',
    status: 'done',
    people: 640,
    responses: 210,
    unsubscribes: 0,
    households: 350,
    supporters: 210,
    audienceName: 'Precinct 2 & 3 supporters',
    audienceFilters: ['Precinct 2', 'Precinct 3', 'Supporters'],
    cost: 0,
    costPerOutreach: 0,
    receiptId: null,
    archived: true,
  },
  {
    id: 'a2',
    date: 'Jun 28',
    startedAt: new Date('2026-06-28T08:00:00'),
    completedAt: new Date('2026-06-28T08:30:00'),
    name: 'Primary GOTV blast',
    channel: 'sms',
    status: 'done',
    people: 3200,
    responses: 402,
    unsubscribes: 21,
    audienceName: 'All registered Dems',
    audienceFilters: ['Democrats', 'All registered voters'],
    cost: 160,
    costPerOutreach: 0.05,
    receiptId: 'rcpt_a2',
    archived: true,
  },
  {
    id: 'a3',
    date: 'Jun 10',
    startedAt: new Date('2026-06-10T09:00:00'),
    completedAt: new Date('2026-06-10T09:05:00'),
    name: 'Cancelled town hall reminder',
    channel: 'robocall',
    status: 'done',
    people: 1800,
    responses: 0,
    unsubscribes: 0,
    answers: 0,
    audienceName: 'District-wide',
    audienceFilters: ['All registered voters'],
    cost: 0,
    costPerOutreach: 0,
    receiptId: null,
    archived: true,
  },
]

// ---------- formatting ----------
export const fmtDateTime = (d: Date) =>
  d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export const fmtDateLong = (d: Date) =>
  d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

export const fmtTime = (d: Date) =>
  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

export const peopleLabel = (channel: ChannelKey) =>
  channel === 'phone-bank' || channel === 'robocall'
    ? 'people called'
    : 'people'

export function resultsText(row: HistoryRow): string {
  switch (row.channel) {
    case 'sms':
      return `${row.responses.toLocaleString()} responses · ${row.unsubscribes ?? 0} unsub`
    case 'door':
    case 'phone-bank':
      return `${(row.supporters ?? row.responses).toLocaleString()} supporters`
    case 'robocall':
      return `${(row.answers ?? row.responses).toLocaleString()} answers`
    case 'email':
      return `${row.responses.toLocaleString()} opens`
    case 'social':
      return row.responses > 0
        ? `${row.responses.toLocaleString()} engagements`
        : '—'
    case 'polls':
      return `${row.responses.toLocaleString()} responses`
    default:
      return `${row.responses.toLocaleString()} responses`
  }
}

// Outcome breakdown shown in the drawer for done campaigns.
const OUTCOMES_BY_CHANNEL: Partial<
  Record<ChannelKey, { label: string; weight: number }[]>
> = {
  sms: [
    { label: 'Responded', weight: 15 },
    { label: 'No response', weight: 80 },
    { label: 'Opted out', weight: 5 },
  ],
  door: [
    { label: 'Answered', weight: 30 },
    { label: 'Not home', weight: 40 },
    { label: 'Refused to engage', weight: 8 },
    { label: 'Support: yes', weight: 10 },
    { label: 'Support: unsure', weight: 8 },
    { label: 'Support: no', weight: 4 },
  ],
  robocall: [
    { label: 'Answered', weight: 25 },
    { label: 'Voicemail left', weight: 45 },
    { label: 'No answer', weight: 30 },
  ],
  'phone-bank': [
    { label: 'Answered', weight: 22 },
    { label: 'No answer', weight: 30 },
    { label: 'Voicemail left', weight: 18 },
    { label: 'Wrong number', weight: 5 },
    { label: 'Refused to engage', weight: 5 },
    { label: 'Support: yes', weight: 10 },
    { label: 'Support: unsure', weight: 6 },
    { label: 'Support: no', weight: 4 },
  ],
  polls: [
    { label: 'Responded', weight: 30 },
    { label: 'No response', weight: 65 },
    { label: 'Opted out', weight: 5 },
  ],
}

export function computeOutcomes(
  channel: ChannelKey,
  people: number,
): { label: string; count: number; pct: number }[] | null {
  const spec = OUTCOMES_BY_CHANNEL[channel]
  if (!spec || people <= 0) return null
  const total = spec.reduce((s, o) => s + o.weight, 0)
  const raw = spec.map((o) => ({
    label: o.label,
    exact: (o.weight / total) * people,
  }))
  const rounded = raw.map((r) => ({
    label: r.label,
    count: Math.floor(r.exact),
  }))
  let remainder = people - rounded.reduce((s, r) => s + r.count, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r.exact - Math.floor(r.exact) }))
    .sort((a, b) => b.frac - a.frac)
  for (const { i } of order) {
    if (remainder <= 0) break
    const target = rounded[i]
    if (!target) continue
    target.count += 1
    remainder -= 1
  }
  return rounded.map((r) => ({
    ...r,
    pct: people > 0 ? Math.round((r.count / people) * 100) : 0,
  }))
}
