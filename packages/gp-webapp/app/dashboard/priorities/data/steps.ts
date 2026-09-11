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

// Step titles are questions the user can answer, per docs/product-copy.md.
export const PRIORITY_STEP_LABELS: Record<PriorityFlowStep, string> = {
  intro: 'What do you want to change?',
  define: "What's the problem, exactly?",
  evidence: 'What do you already know?',
  listen_problem: 'Who should you hear from?',
  options: 'What are your options?',
  listen_options: 'Which option do people back?',
  method: 'How will you make it happen?',
  plan: 'What has to happen next?',
  track: 'Where does this stand?',
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
  intro: 'Tell me what you want to change and I will take it from here.',
  define: 'Pin down who this hits and what solved would look like.',
  evidence: 'I will pull what your district data and the public record say.',
  listen_problem: 'Who this lands on hardest, and how to reach those people.',
  options: 'A few real ways to act, with what each one costs you.',
  listen_options: 'Ask the people it affects which way to go.',
  method: 'I will check what you are allowed to do, then we pick the path.',
  plan: 'Turn the decision into dated steps with names on them.',
  track: 'What moved, what is stuck, and what to tell constituents.',
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
