import { useState, useSyncExternalStore } from 'react'
import { CAMPAIGN_TASK_CATALOG } from '@goodparty_org/contracts'

// Home's headline, the one line above the next-step card. It speaks to the
// card under it, so each kind of task has its own lines. Any line can be an
// instruction. None claims something we cannot know about their race.
export const HOME_HEADLINES = {
  ballot: [
    'Get your name on the ballot',
    'Every race starts here',
    'Make it official',
    'First stop, the ballot',
  ],
  story: [
    'Tell it your way',
    'Why are you running?',
    'Start with your why',
    'Your story matters',
  ],
  setup: [
    'Lay the groundwork',
    'Get the basics in place',
    'Set yourself up to win',
    'Build a strong foundation',
  ],
  fundraising: [
    'Fuel your campaign',
    'Raise what you need',
    'Rally your supporters',
    'Build your support',
  ],
  launch: [
    'Time to go public',
    'Step into the race',
    'Introduce yourself',
    'Let them know you’re running',
  ],
  events: [
    'Show up in person',
    'Meet your community',
    'Bring people together',
    'Be where voters are',
  ],
  doorKnocking: [
    'Hit the doors',
    'One door at a time',
    'Meet voters where they live',
    'Knock, talk, listen',
  ],
  phoneBanking: [
    'Pick up the phone',
    'Make the calls',
    'One call at a time',
    'A real voice goes far',
  ],
  text: [
    'Reach voters by text',
    'Start the conversation',
    'Get your message out',
    'Reach voters directly',
  ],
  robocall: [
    'Let voters hear you',
    'Put your voice out there',
    'Say it in your own voice',
    'Get your message heard',
  ],
  visibility: [
    'Get your name out there',
    'Stay top of mind',
    'Keep voters in the loop',
    'Speak up',
  ],
  directMail: [
    'Land in their mailbox',
    'Put it in their hands',
    'Something they can hold',
    'Make a lasting impression',
  ],
  dates: [
    'Mark your calendar',
    'Know your dates',
    'Stay ahead of the calendar',
    'Don’t miss a deadline',
  ],
  gotv: [
    'Get out the vote',
    'Bring it home',
    'Every vote counts',
    'Finish strong',
    'Turn support into votes',
  ],
  closeOut: [
    'Say thank you',
    'Finish what you started',
    'Wrap it up right',
    'Close it out with care',
  ],
  opponent: [
    'Know your race',
    'Know who you’re up against',
    'Keep an eye on the field',
    'Stay a step ahead',
  ],
  tracking: [
    'Count every contact',
    'Track your progress',
    'See how far you’ve come',
    'Log your work',
  ],
  // No next task: every task this week is done.
  weekDone: [
    'That’s a wrap on this week',
    'Nice work this week',
    'You’re ahead of the game',
    'Way to show up',
  ],
  // No next task, and nothing was due this week.
  caughtUp: [
    'You’re all caught up',
    'All clear for now',
    'Take a breath',
    'Enjoy the breather',
  ],
  // An AI-written task that names no channel the plan knows.
  other: [
    'Here’s your next move',
    'You’ve got this',
    'One step closer',
    'Let’s get this done',
    'Let’s keep going',
  ],
} as const satisfies Record<string, readonly string[]>

export type HeadlineKind = keyof typeof HOME_HEADLINES

// Shown once, on the first landing after onboarding, over whatever card leads.
export const FIRST_LANDING_HEADLINE = 'You’re in good company'
// Onboarding lands on Home with ?welcome=1, which Home strips once read.
export const FIRST_LANDING_PARAM = 'welcome'

// Tracker rows carry no category, so a row is matched to its catalog entry by
// title, the way gp-api does. The category names the kind; outreach is split
// by channel, since a text and a door knock deserve different lines.
const CATEGORY_KIND: Record<string, HeadlineKind> = {
  'Ballot access': 'ballot',
  'Campaign story': 'story',
  Setup: 'setup',
  Preparation: 'setup',
  'Compliance & Admin': 'setup',
  Fundraising: 'fundraising',
  Launch: 'launch',
  Events: 'events',
  'Events & Volunteer Organizing': 'events',
  'Communications & Visibility': 'visibility',
  'Direct mail': 'directMail',
  'Election admin': 'dates',
  'Get Out the Vote (GOTV)': 'gotv',
  'Election day ops': 'gotv',
  'Holidays/parades/external events': 'gotv',
  'Close-out': 'closeOut',
  Opponent: 'opponent',
  'Progress & tracking': 'tracking',
}

// Catalog channels and row flowTypes, which spell events differently.
const CHANNEL_KIND: Record<string, HeadlineKind> = {
  text: 'text',
  robocall: 'robocall',
  doorKnocking: 'doorKnocking',
  phoneBanking: 'phoneBanking',
  socialMedia: 'visibility',
  directMail: 'directMail',
  event: 'events',
  events: 'events',
}

export type HeadlineTask = {
  id: string
  title: string
  flowType: string | null
  // Set for a state rather than a task, such as a finished week.
  kind?: HeadlineKind
}

export const headlineKind = (task: HeadlineTask): HeadlineKind => {
  if (task.kind) return task.kind
  const entry = CAMPAIGN_TASK_CATALOG.find((def) => def.title === task.title)
  const byCategory = entry && CATEGORY_KIND[entry.category]
  if (byCategory) return byCategory
  const channel = entry?.channel ?? task.flowType
  return (channel && CHANNEL_KIND[channel]) || 'other'
}

const LAST_KEY = 'home-headline-last'
const SEEN_KEY = 'home-headlines-seen'

type LinesByKind = Partial<Record<HeadlineKind, string[]>>

const readLines = (storage: () => Storage, key: string): LinesByKind => {
  try {
    const parsed: unknown = JSON.parse(storage().getItem(key) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string[]] =>
          Array.isArray(entry[1]) &&
          entry[1].every((line) => typeof line === 'string'),
      ),
    )
  } catch {
    return {}
  }
}

const writeLines = (
  storage: () => Storage,
  key: string,
  value: LinesByKind,
): void => {
  try {
    storage().setItem(key, JSON.stringify(value))
  } catch {}
}

// A line of this kind not yet shown this session, so a candidate who keeps
// meeting the same kind of task sees each line before any repeats. Once all
// have been shown the session starts over, and even then never with the line
// just seen, which is also remembered across tabs and sign-ins.
export const pickHeadline = (kind: HeadlineKind): string => {
  const lines: readonly string[] = HOME_HEADLINES[kind]
  const lastByKind = readLines(() => window.localStorage, LAST_KEY)
  const seenByKind = readLines(() => window.sessionStorage, SEEN_KEY)
  const last = lastByKind[kind]?.[0]
  let seen = seenByKind[kind] ?? []
  let choices = lines.filter((line) => !seen.includes(line) && line !== last)
  if (choices.length === 0) {
    seen = []
    choices = lines.filter((line) => line !== last)
  }
  const next =
    choices[Math.floor(Math.random() * choices.length)] ?? lines[0] ?? ''
  writeLines(() => window.localStorage, LAST_KEY, {
    ...lastByKind,
    [kind]: [next],
  })
  writeLines(() => window.sessionStorage, SEEN_KEY, {
    ...seenByKind,
    [kind]: [...seen, next],
  })
  return next
}

// Nothing to subscribe to: the snapshot only tells server from client.
const subscribeNever = () => () => undefined

/**
 * The headline for the card in front. A card keeps its line for the whole
 * visit, so a skip and a skip back show the same one, and a new card brings
 * its own. Blank until mounted, because the server can't know what was shown;
 * a pick on both sides would mismatch on hydration.
 */
export const useTaskHeadline = (
  task: HeadlineTask | undefined,
  { firstLanding = false }: { firstLanding?: boolean } = {},
): string | null => {
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  )
  // Held for the visit, and filled during render so the line changes in the
  // same frame as the card. Each id picks once, which also keeps React's dev
  // double render from spending two lines.
  const [linesById] = useState(() => new Map<string, string>())
  if (!mounted || !task) return null
  let line = linesById.get(task.id)
  if (!line) {
    line =
      firstLanding && linesById.size === 0
        ? FIRST_LANDING_HEADLINE
        : pickHeadline(headlineKind(task))
    linesById.set(task.id, line)
  }
  return line
}
