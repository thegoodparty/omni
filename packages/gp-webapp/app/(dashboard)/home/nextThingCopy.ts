import type { CampaignTrackerTask } from 'gpApi/api-endpoints'

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
