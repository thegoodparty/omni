import { differenceInCalendarDays, format } from 'date-fns'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import { getNextElection } from 'helpers/campaignHelper'
import type { Campaign } from 'helpers/types'

// Home's words: the headline above the card, and the two questions "Chat
// about this" offers, keyed on the kind of task.

// The headline is general on purpose, so it reads right above any task. Home
// shows one per browser session (useSessionHeadline): a candidate opens Home
// often, and a line that changes each visit gets noticed, then tuned out.
export const HOME_HEADLINES = [
  'On the trail',
  'Make it count',
  'Earn every vote',
  'Every vote counts',
  "You've got this",
  'Ready when you are',
  "Let's get to work",
] as const

type TaskKind = 'ballot' | 'send' | 'event' | 'canvass' | 'other'

const kindOf = (
  task: CampaignTrackerTask | null,
  needsFiling: boolean,
): TaskKind => {
  if (!task) return 'other'
  if (needsFiling) return 'ballot'
  switch (task.flowType) {
    case 'text':
    case 'robocall':
      return 'send'
    case 'events':
      return 'event'
    case 'doorKnocking':
    case 'phoneBanking':
      return 'canvass'
    default:
      return 'other'
  }
}

// Two, so they sit on one row on a phone. Each is a complete question, so a
// tap sends it.
const QUESTIONS: Record<TaskKind, [string, string]> = {
  ballot: [
    'How many signatures do I need?',
    'Where do I file, and what does it cost?',
  ],
  send: ['Draft this message for me', 'When should it go out?'],
  event: ['Help me prepare for this event', 'What should I say when I speak?'],
  canvass: ['Write me a script', 'Which voters should I start with?'],
  other: ['Help me get this done', 'Why does this matter for my race?'],
}

export const questionsFor = (
  task: CampaignTrackerTask,
  needsFiling: boolean,
): [string, string] => QUESTIONS[kindOf(task, needsFiling)]

const countdownFor = (
  campaign: Campaign | null,
  today: Date,
): string | null => {
  const election = getNextElection(campaign)
  if (!election) return null
  const days = differenceInCalendarDays(
    new Date(election.nextElectionDate.replace(/-/g, '/')),
    today,
  )
  const name = election.isPrimary ? 'your primary' : 'Election Day'
  if (days < 0) return null
  if (days === 0)
    return election.isPrimary
      ? 'Your primary is today'
      : 'Election Day is today'
  if (days === 1)
    return election.isPrimary
      ? 'Your primary is tomorrow'
      : 'Election Day is tomorrow'
  return `${days} days to ${name}`
}

// The quiet line above the headline: today, and how far off the next election
// is when we know it.
export const eyebrowFor = (campaign: Campaign | null, today: Date): string => {
  const date = format(today, 'EEEE, MMMM d')
  const countdown = countdownFor(campaign, today)
  return countdown ? `${date} · ${countdown}` : date
}
