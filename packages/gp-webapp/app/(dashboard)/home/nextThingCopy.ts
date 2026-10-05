import type { CampaignTrackerTask } from 'gpApi/api-endpoints'

// Home's words for the next thing, keyed on the kind of task: the friendly
// headline above the card and the two questions on it. One place, so the two
// always describe the same task.

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

const HEADLINES: Record<TaskKind, string> = {
  ballot: "Let's get you on the ballot",
  send: "Let's reach your voters",
  event: "Let's get ready for your event",
  canvass: "Let's meet your voters",
  other: "Let's keep your campaign moving",
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

export const headlineFor = (
  task: CampaignTrackerTask | null,
  needsFiling: boolean,
  firstName?: string | null,
): string => {
  const headline = HEADLINES[kindOf(task, needsFiling)]
  return firstName ? `${headline}, ${firstName}` : headline
}

export const questionsFor = (
  task: CampaignTrackerTask,
  needsFiling: boolean,
): [string, string] => QUESTIONS[kindOf(task, needsFiling)]

// What chat receives for a question about the next step, so the answer is
// about that task without the candidate having to say which one.
export const askAboutStep = (title: string, question: string): string =>
  `About my next step, "${title}": ${question}`
