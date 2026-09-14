// The guided priority flow's step spine. Client-owned for now: the flow's
// backend does not exist yet, so this file is the only source of step order,
// labels, and stage grouping. When the gp-api module lands, the step union
// moves to @goodparty_org/contracts (as OrdinanceFlowStep did) and this file
// keeps only the display copy.
//
// Design doc: docs/serve-priority-flow-prompt.md
export const PRIORITY_FLOW_STEP_VALUES = [
  'intro',
  'define',
  'evidence',
  'listen_problem',
  'options',
  'listen_options',
  'method',
  'plan',
  'track',
] as const

export type PriorityFlowStep = (typeof PRIORITY_FLOW_STEP_VALUES)[number]

export type PriorityFlowStage = 'understand' | 'explore' | 'codify' | 'execute'

export const PRIORITY_STAGE_LABELS: Record<PriorityFlowStage, string> = {
  understand: 'Understand it',
  explore: 'Weigh the options',
  codify: 'Decide how',
  execute: 'Get it done',
}

// How the agent opens a step. These are invitations into a conversation, not
// headings over a form: the step is about to ask real questions, so the opener
// should sound like someone sitting down with you rather than a section label.
export const PRIORITY_STEP_LABELS: Record<PriorityFlowStep, string> = {
  intro: "Let's start with what you want to change",
  define: "Let's get the shape of this",
  evidence: "Let's see what we already know",
  listen_problem: "Let's work out who to hear from",
  options: "Let's look at how you could do this",
  listen_options: "Let's find out which way people lean",
  method: "Let's pick how you'll make it happen",
  plan: "Let's turn this into a plan",
  track: "Let's see where this stands",
}

// Short names for the rail, where the question would wrap three lines.
export const PRIORITY_STEP_SHORT_LABELS: Record<PriorityFlowStep, string> = {
  intro: 'Getting started',
  define: 'The problem',
  evidence: 'What we know',
  listen_problem: 'Who to hear from',
  options: 'Your options',
  listen_options: 'What people back',
  method: 'The path',
  plan: 'The plan',
  track: 'Where it stands',
}

export const PRIORITY_STEP_CAPTIONS: Record<PriorityFlowStep, string> = {
  intro: 'Tell me the change you want and I will take it from here.',
  define: 'A few questions, so we both know what solving this would look like.',
  evidence: 'What your data and the public record say, and where it is thin.',
  listen_problem: 'Who this lands on hardest, and how you would reach them.',
  options: 'A few real ways to act, and what each one would cost you.',
  listen_options: 'The people whose answer would actually change your mind.',
  method: 'What you are allowed to do here, then the path that fits.',
  plan: 'The next few things that have to happen, with names and dates.',
  track: 'What moved, what is stuck, and what to tell people.',
}

export const PRIORITY_STEP_STAGE: Record<PriorityFlowStep, PriorityFlowStage> =
  {
    intro: 'understand',
    define: 'understand',
    evidence: 'understand',
    listen_problem: 'understand',
    options: 'explore',
    listen_options: 'explore',
    method: 'codify',
    plan: 'execute',
    track: 'execute',
  }

// Intro is an entry point and track is a standing step, the way the ordinance
// flow treats intro and review. Neither is counted in the wizard progress.
export const PRIORITY_NUMBERED_STEPS: readonly PriorityFlowStep[] = [
  'define',
  'evidence',
  'listen_problem',
  'options',
  'listen_options',
  'method',
  'plan',
]

export const isPriorityStep = (value: string): value is PriorityFlowStep =>
  (PRIORITY_FLOW_STEP_VALUES as readonly string[]).includes(value)

export const priorityStepNumber = (step: PriorityFlowStep): number | null => {
  const index = PRIORITY_NUMBERED_STEPS.indexOf(step)
  return index === -1 ? null : index + 1
}

export const nextPriorityStep = (
  current: PriorityFlowStep,
): PriorityFlowStep | null => {
  if (current === 'intro') return PRIORITY_NUMBERED_STEPS[0] ?? null
  if (current === 'track') return null
  const index = PRIORITY_NUMBERED_STEPS.indexOf(current)
  if (index === -1) return null
  return PRIORITY_NUMBERED_STEPS[index + 1] ?? 'track'
}

// The step before this one, for going back when the ground moves under a
// decision. Intro and the first numbered step have nowhere to go; track sits
// outside the numbered flow and steps back into the last of them.
export const previousPriorityStep = (
  current: PriorityFlowStep,
): PriorityFlowStep | null => {
  if (current === 'track') {
    return PRIORITY_NUMBERED_STEPS[PRIORITY_NUMBERED_STEPS.length - 1] ?? null
  }
  const index = PRIORITY_NUMBERED_STEPS.indexOf(current)
  return index <= 0 ? null : (PRIORITY_NUMBERED_STEPS[index - 1] ?? null)
}

// Label on the button that advances, keyed by DESTINATION step — same reason
// the ordinance flow keeps this client-side: the destination comes from flow
// order, so the label has to as well or the two contradict each other.
export const PRIORITY_NEXT_STEP_CTA: Record<PriorityFlowStep, string> = {
  intro: 'Get started',
  define: 'Define the problem',
  evidence: 'See what we know',
  listen_problem: 'Find who to hear from',
  options: 'Lay out my options',
  listen_options: 'Ask about the options',
  method: 'Check what I can do',
  plan: 'Build the plan',
  track: 'Track it from here',
}
