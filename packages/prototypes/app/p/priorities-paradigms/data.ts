// One priority, modelled richly enough that every shell can render the same
// work. The differences between the screens are the paradigm, never the content.

export type SectionState = 'confirmed' | 'draft' | 'thin' | 'empty' | 'stale'

export type DossierSection = {
  id: string
  label: string
  state: SectionState
  body: string
  /** What is still wrong with it, when something is. */
  caveat?: string
  /** Sections whose answers were built on this one. */
  dependents?: string[]
}

export type GateState = 'met' | 'open' | 'stale'

export type Gate = {
  id: string
  label: string
  state: GateState
  detail: string
  /** Shown when the gate cannot be worked yet. */
  waitingOn?: string
}

export type NextAction = {
  label: string
  why: string
  kind: 'do' | 'review' | 'waiting'
}

export type SessionDecision = {
  ask: string
  options: { label: string; note: string }[]
}

export type Session = {
  id: string
  date: string
  /** Relative age, written the way a person would say it. */
  age: string
  changed?: string
  didForYou?: string
  decision?: SessionDecision
  /** What the official chose, on a session that is already closed. */
  resolved?: string
}

export type CapabilityCardKind =
  | 'affected'
  | 'evidence'
  | 'outreach'
  | 'constraint'

export type ChatTurn = {
  id: string
  role: 'user' | 'agent'
  text: string
  /** A capability the agent ran mid-turn, rendered as a card. */
  card?: { kind: CapabilityCardKind; title: string; lines: string[] }
}

export type Priority = {
  id: string
  title: string
  short: string
  description: string
  source: 'yours' | 'campaign' | 'community'
  sourceLabel: string
  isPublic: boolean
  method: string | null
  nextAction: NextAction
  sections: DossierSection[]
  gates: Gate[]
  sessions: Session[]
}

export const SOURCE_LABEL: Record<Priority['source'], string> = {
  yours: 'Yours',
  campaign: 'From your campaign',
  community: 'From your community',
}

export const MAPLE: Priority = {
  id: 'maple',
  title: 'Speeding on Maple Ave near the elementary school',
  short: 'Speeding on Maple Ave',
  description:
    'Cars come through the Maple Ave corridor well over the limit at pickup, and the crossing by the school is the worst of it. I want it slowed down before someone gets hurt.',
  source: 'yours',
  sourceLabel: SOURCE_LABEL.yours,
  isPublic: false,
  method: null,
  nextAction: {
    label: 'Ask your attorney who sets calming standards on Maple',
    why: 'Maple is a city street, but the calming standard may sit with the county engineer. Every option below changes depending on the answer, and it is a twenty minute question.',
    kind: 'do',
  },
  sections: [
    {
      id: 'problem',
      label: 'The problem',
      state: 'confirmed',
      body: 'Cars run above the posted limit through the elementary school walk zone at pickup. It lands hardest on the 340 households inside that zone. Solved means measured speeds at the crossing come down to the posted limit.',
      dependents: ['affected', 'heard', 'options'],
    },
    {
      id: 'evidence',
      label: 'What we know',
      state: 'thin',
      body: '38 mph average at pickup, from the Public Works count on 14 September. The corridor is a city street. Complaints cluster between 2:40 and 3:20pm.',
      caveat:
        'There is no crash history for the crossing itself, so the safety claim rests on speed alone. A colleague will press on that.',
    },
    {
      id: 'affected',
      label: 'Who it hits',
      state: 'confirmed',
      body: '340 households inside the walk zone, 312 of them reachable. Concentrated on the four blocks north of the school.',
      caveat:
        'Renters on the north side are thin in your contact file. The PTA reaches them and you do not.',
    },
    {
      id: 'heard',
      label: 'What they say',
      state: 'draft',
      body: 'The ask is written and the list of 312 is built. Nothing has come back yet.',
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
  ],
  gates: [
    {
      id: 'problem',
      label: 'You know what the problem is',
      state: 'met',
      detail:
        'Speeds above the limit through the school walk zone at pickup. Solved means measured speeds come down at the crossing.',
    },
    {
      id: 'affected',
      label: 'You know who it lands on',
      state: 'met',
      detail: '340 households in the walk zone, 312 reachable.',
    },
    {
      id: 'heard',
      label: 'You have heard from them',
      state: 'open',
      detail: 'List of 312 built, ask drafted, nothing back yet.',
      waitingOn: 'Responses. Usually about a week.',
    },
    {
      id: 'authority',
      label: 'You know what you are allowed to do',
      state: 'open',
      detail:
        'Not checked. Maple is a city street, but the calming standard may sit with the county.',
    },
    {
      id: 'method',
      label: 'You have chosen how',
      state: 'open',
      detail: 'Nothing to choose between until authority is settled.',
      waitingOn: 'You know what you are allowed to do',
    },
    {
      id: 'plan',
      label: 'There is a plan',
      state: 'open',
      detail: 'Comes out of the method.',
      waitingOn: 'You have chosen how',
    },
  ],
  sessions: [
    {
      id: 's3',
      date: '28 September',
      age: 'today',
      changed:
        'Public Works sent the speed count. 38 mph average at pickup, against a 25 limit.',
      didForYou:
        'Drafted the ask for the 312 households in the walk zone and built the list. It is waiting on your review, not sent.',
      decision: {
        ask: 'The count is high enough to justify spending. Which route should I price first?',
        options: [
          {
            label: 'Capital plan',
            note: 'Your money, your calendar, but it competes with everything else next cycle.',
          },
          {
            label: 'Safe-routes grant',
            note: 'Outside money and the walk zone is exactly what it funds, but it runs on the state calendar.',
          },
          {
            label: 'Neither yet, check authority first',
            note: 'Cheapest. If the county owns the standard, both routes change.',
          },
        ],
      },
    },
    {
      id: 's2',
      date: '22 September',
      age: '6 days ago',
      changed: 'Nothing came back from the county.',
      didForYou:
        'Pulled the walk zone boundary and sized it: 340 households, 312 with a phone.',
      resolved: 'You asked Public Works for a speed count.',
    },
    {
      id: 's1',
      date: '15 September',
      age: '2 weeks ago',
      didForYou:
        'Read the last three years of council minutes for Maple. It has come up twice, both times without a vote.',
      resolved:
        'You settled the problem statement: speeds at the crossing, at pickup.',
    },
  ],
}

export const SPLASH: Priority = {
  id: 'splash',
  title: 'Get the splash pad built at Lincoln Park',
  short: 'Lincoln Park splash pad',
  description:
    'I ran on this. The park has no water feature and the nearest one is a twenty minute drive for families on the east side.',
  source: 'campaign',
  sourceLabel: SOURCE_LABEL.campaign,
  isPublic: true,
  method: 'Budget, capital plan',
  nextAction: {
    label: 'Review the update to residents before it goes out',
    why: 'It cleared committee on Tuesday, which is the first thing worth telling people since June. The draft is written and in your voice.',
    kind: 'review',
  },
  sections: [],
  gates: [],
  sessions: [],
}

export const CANOPY: Priority = {
  id: 'canopy',
  title: 'Update the tree ordinance to add a canopy goal',
  short: 'Tree canopy ordinance',
  description:
    'Our ordinance protects individual trees but sets no target for coverage, so we lose ground every year without anyone noticing.',
  source: 'community',
  sourceLabel: SOURCE_LABEL.community,
  isPublic: true,
  method: 'Ordinance',
  nextAction: {
    label: 'Waiting on the city attorney',
    why: 'You asked on 19 September whether a canopy target can be binding or only aspirational. Nothing back. Worth a nudge on Thursday if it is still quiet.',
    kind: 'waiting',
  },
  sections: [],
  gates: [],
  sessions: [],
}

export const PRIORITIES: Priority[] = [MAPLE, SPLASH, CANOPY]

/** The conversation every chat-shaped shell renders. */
export const CONVERSATION: ChatTurn[] = [
  {
    id: 't1',
    role: 'agent',
    text: 'Maple Ave is the corridor that carries the school traffic, so who this lands on depends a lot on which part of the day you mean. I pulled what your district data says about that stretch before asking.',
    card: {
      kind: 'affected',
      title: 'Who is inside the walk zone',
      lines: [
        '340 households, four blocks north of the school',
        '312 reachable by phone',
        'Renters on the north side are thin in your file',
      ],
    },
  },
  {
    id: 't2',
    role: 'user',
    text: 'The families walking their kids to school. It is worst right at pickup.',
  },
  {
    id: 't3',
    role: 'agent',
    text: 'That narrows it usefully. The walk zone is a defined boundary, which matters later because it is the unit most safe-routes money is awarded against. Public Works came back with the count this morning.',
    card: {
      kind: 'evidence',
      title: 'What the count says',
      lines: [
        '38 mph average at pickup, against a 25 limit',
        'Complaints cluster 2:40 to 3:20pm',
        'No crash history at the crossing, so speed is the whole case',
      ],
    },
  },
  {
    id: 't4',
    role: 'user',
    text: 'That is worse than I thought. What do I do about it?',
  },
  {
    id: 't5',
    role: 'agent',
    text: 'Before options, one cheap question decides most of them: Maple is a city street, but the calming standard may sit with the county engineer. If it does, half the routes below are not yours to take. Ask your attorney, then I will price the two that survive.',
    card: {
      kind: 'constraint',
      title: 'Worth settling first',
      lines: [
        'Authority: unverified, ask the city attorney',
        'Funding: capital plan or safe-routes grant',
        'Who says yes: council majority, or the manager for a study',
      ],
    },
  },
]

export const SECTION_STATE_LABEL: Record<SectionState, string> = {
  confirmed: 'Confirmed',
  draft: 'In progress',
  thin: 'Thin',
  empty: 'Not started',
  stale: 'Needs another look',
}

export const GATE_STATE_LABEL: Record<GateState, string> = {
  met: 'Settled',
  open: 'Open',
  stale: 'Needs another look',
}
