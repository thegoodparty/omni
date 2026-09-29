// One priority, worked properly. The point of this prototype is that the chat
// and the file are two views of ONE thread, so everything here is shared state
// that both views read and either can change.

export type SectionState = 'settled' | 'working' | 'thin' | 'empty'

export type Section = {
  id: string
  label: string
  state: SectionState
  body: string
  /** What is still wrong with it, when something is. */
  caveat?: string
  /** Shown under the body: where this came from. */
  source?: string
}

export const SECTION_STATE_LABEL: Record<SectionState, string> = {
  settled: 'Settled',
  working: 'In progress',
  thin: 'Thin',
  empty: 'Not started',
}

export const SECTION_STATE_CLASS: Record<SectionState, string> = {
  settled: 'bg-success/10 text-success border-success/30',
  working: 'bg-primary/10 text-primary border-primary/30',
  thin: 'bg-warning/5 text-warning border-warning/40',
  empty: 'bg-muted text-muted-foreground border-border',
}

export const PRIORITY = {
  title: 'Speeding on Maple Ave near the elementary school',
  short: 'Maple Ave speeding',
  office: 'Maplewood City Council',
  source: 'Yours',
  visibility: 'Private',
  opened: '15 September',
}

export const INITIAL_SECTIONS: Section[] = [
  {
    id: 'problem',
    label: 'The problem',
    state: 'settled',
    body: 'Cars run above the posted limit through the elementary school walk zone at pickup. Solved means measured speeds at the crossing come down to the limit, against a baseline taken first.',
    source: 'Settled with you on 15 September',
  },
  {
    id: 'affected',
    label: 'Who it lands on',
    state: 'settled',
    body: '340 households inside the walk zone, four blocks north of the school. 312 of them reachable.',
    source: 'Your district data, 22 September',
  },
  {
    id: 'evidence',
    label: 'What we know',
    state: 'thin',
    body: '38 mph average at pickup against a 25 limit. Complaints cluster between 2:40 and 3:20pm. Maple is a city street.',
    caveat:
      'No crash history at the crossing, so the safety case rests on speed alone. A colleague will press on that.',
    source: 'Public Works count, 26 September',
  },
  {
    id: 'heard',
    label: 'What they say',
    state: 'empty',
    body: '',
  },
  {
    id: 'options',
    label: 'Your options',
    state: 'empty',
    body: '',
  },
  {
    id: 'authority',
    label: 'What you are allowed to do',
    state: 'empty',
    body: '',
  },
  {
    id: 'method',
    label: 'How you will do it',
    state: 'empty',
    body: '',
  },
  {
    id: 'plan',
    label: 'The plan',
    state: 'empty',
    body: '',
  },
]

export type PastOutreach = {
  id: string
  date: string
  channel: string
  audience: string
  sent: number
  replies: number
  topic: string
  finding: string
}

/** What `search_past_outreach` returns. Two hits, neither about Maple. */
export const PAST_OUTREACH: PastOutreach[] = [
  {
    id: 'o1',
    date: '12 June',
    channel: 'Social media',
    audience: 'East side households',
    sent: 1240,
    replies: 86,
    topic: 'Lincoln Park splash pad',
    finding:
      'Strong support, and eleven people raised traffic on Maple unprompted.',
  },
  {
    id: 'o2',
    date: '3 March',
    channel: 'Phone banking',
    audience: 'Households with a child under 12',
    sent: 410,
    replies: 122,
    topic: 'Park hours and summer programming',
    finding:
      'Mostly about pool hours. Two callers mentioned the school crossing.',
  },
]

export type OutreachPlan = {
  audience: string
  count: number
  channel: string
  listName: string
  goal: string
  message: string
}

export const OUTREACH_PLAN: OutreachPlan = {
  audience: 'Maple Ave walk zone households',
  count: 312,
  channel: 'Social media',
  listName: 'Maple Ave walk zone',
  goal: 'Community input',
  message:
    "I'm looking at speeding on Maple Ave by the elementary school. Public Works clocked an average of 38 in a 25 at pickup. If you walk that stretch, tell me where it actually feels unsafe: at the crossing itself, or further down the block.",
}

/** Written into the file once the outreach is sent. */
export const HEARD_AFTER_SEND =
  'Asked the 312 reachable walk-zone households where it feels unsafe, sent 28 September. Nothing back yet.'
