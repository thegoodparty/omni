// The conversation, as a script the engine plays back with fake latency.
//
// Each beat is one exchange: what the user can say, what tools the agent runs,
// what it then says, and what card it leaves behind. Beats unlock in order but
// the suggestion set is always a small menu, so a demo can wander a little
// without falling off the rails.

export type ToolRun = {
  /** The tool's real name, shown the way the product shows it. */
  name: string
  /** Human label while it runs. */
  label: string
  /** What it returned, one short line. */
  result: string
  /** How long to hold the running state, ms. */
  ms: number
}

export type CardSpec =
  | { kind: 'file'; note: string }
  | { kind: 'past-outreach' }
  | { kind: 'outreach' }
  | { kind: 'none' }

export type Beat = {
  id: string
  /** The suggested prompt that triggers it. */
  prompt: string
  tools: ToolRun[]
  text: string
  card: CardSpec
  /** Beats this unlocks. Empty means it stays available. */
  unlocks: string[]
}

export const OPENING =
  'Morning. Three priorities on your plate, and Maple Ave is the one with something new: Public Works came back with the speed count on Friday. Want to pick it up?'

export const BEATS: Beat[] = [
  {
    id: 'where',
    prompt: 'Where are we on Maple Ave?',
    tools: [
      {
        name: 'read_priority',
        label: 'Reading the Maple Ave file',
        result: '8 sections, 2 settled',
        ms: 1100,
      },
    ],
    text: 'Two of the eight sections are settled: the problem, and who it lands on. The speed count came in on Friday and I have put it in the file, but I left it marked thin, because there is no crash history at the crossing to go with it and that is the first thing a colleague will ask you for.\n\nWhat is actually holding this up is authority. Maple is a city street, but the calming standard may sit with the county, and until that is answered half your options are not yours to take.',
    card: {
      kind: 'file',
      note: 'Open it to see what is settled and what is thin.',
    },
    unlocks: ['asked-before', 'whats-left'],
  },
  {
    id: 'asked-before',
    prompt: 'Have I asked the walk zone about this before?',
    tools: [
      {
        name: 'search_past_outreach',
        label: 'Searching your past outreach',
        result: '2 matching sends',
        ms: 1500,
      },
      {
        name: 'read_outreach_results',
        label: 'Reading the replies',
        result: '208 replies across both',
        ms: 900,
      },
    ],
    text: 'Twice, and neither one was about Maple.\n\nWorth knowing though: when you asked the east side about the splash pad in June, eleven people brought up Maple traffic without being asked. That is a stronger signal than it looks, because nobody prompted them.',
    card: { kind: 'past-outreach' },
    unlocks: ['draft'],
  },
  {
    id: 'draft',
    prompt: 'Draft something to the walk zone then.',
    tools: [
      {
        name: 'describe_filter_dimensions',
        label: 'Checking what you can filter on',
        result: '18 dimensions available',
        ms: 800,
      },
      {
        name: 'count_contacts',
        label: 'Sizing the walk zone',
        result: '312 reachable of 340',
        ms: 1200,
      },
      {
        name: 'crud_saved_filters',
        label: 'Building the list',
        result: 'Saved as "Maple Ave walk zone"',
        ms: 1000,
      },
    ],
    text: 'List is built and the message is written. I put the count in it, because a number people can check is what makes this read as a real question rather than a survey.\n\nSocial rather than phone: the renters on the north side are thin in your contact file, and social is the only channel that reaches them at all.',
    card: { kind: 'outreach' },
    unlocks: ['whats-left'],
  },
  {
    id: 'whats-left',
    prompt: "What's left on this?",
    tools: [
      {
        name: 'read_priority',
        label: 'Reading the Maple Ave file',
        result: 'Authority still open',
        ms: 1000,
      },
    ],
    text: 'One thing, and it is cheap: ask your attorney who owns the calming standard on Maple. Twenty minutes of their time.\n\nEverything downstream turns on the answer. If it is the city, the grant route and an ordinance are both open. If it is the county, you are down to advocacy and a staff study.',
    card: { kind: 'file', note: 'The file has the rest.' },
    unlocks: [],
  },
]

/** Fired when the user marks a section settled from inside the file. */
export const settledAck = (label: string): string =>
  `Noted, I have marked "${label}" settled. That leaves authority as the only thing blocking you.`

/** Fired when the outreach is sent. */
export const SENT_ACK =
  'Sent. 312 people, and I will read the replies as they come in and tell you what changes. I have written it into the file under what they say.'
