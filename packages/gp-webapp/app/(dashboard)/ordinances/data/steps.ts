import {
  ORDINANCE_FLOW_STEP_VALUES,
  type OrdinanceFlowStep,
} from '@goodparty_org/contracts'

export const ORDINANCE_STEP_ORDER: readonly OrdinanceFlowStep[] =
  ORDINANCE_FLOW_STEP_VALUES

export const ORDINANCE_STEP_LABELS: Record<OrdinanceFlowStep, string> = {
  intro: 'Get started',
  clarify: 'Clarify',
  authority: 'Authority',
  current_law: 'Current law',
  comparables: 'How others solved it',
  draft: 'Draft',
  review: 'Review',
}

// Call-to-action shown on the "advance" button, keyed by the DESTINATION step.
// Client-owned on purpose: the button's destination is derived from flow order
// (nextOrdinanceStep), so its label must be too — letting the agent name the
// destination produced buttons that contradicted where they went (e.g.
// "Research current law" on the comparables step, whose next step is draft).
export const ORDINANCE_NEXT_STEP_CTA: Record<OrdinanceFlowStep, string> = {
  intro: 'Get started',
  clarify: 'Start clarifying the goal',
  authority: 'Check our legal authority',
  current_law: 'Show me the current law',
  comparables: 'See how others solved it',
  draft: 'Write the first draft',
  review: 'Review the draft',
}

export const isOrdinanceStep = (value: string): value is OrdinanceFlowStep =>
  (ORDINANCE_FLOW_STEP_VALUES as readonly string[]).includes(value)

// Intro is an entry point (used when not seeded from a community issue), not a
// numbered step. The wizard progress counts only the five substantive steps.
export const ORDINANCE_NUMBERED_STEPS: readonly OrdinanceFlowStep[] = [
  'clarify',
  'authority',
  'current_law',
  'comparables',
  'draft',
]

// 1-based position in the numbered flow, or null for intro (uncounted).
export const ordinanceStepNumber = (step: OrdinanceFlowStep): number | null => {
  const index = ORDINANCE_NUMBERED_STEPS.indexOf(step)
  return index === -1 ? null : index + 1
}

// The step to advance to from the current one, or null if there is none. Intro
// enters the numbered flow at the first step.
export const nextOrdinanceStep = (
  current: OrdinanceFlowStep,
): OrdinanceFlowStep | null => {
  if (current === 'intro') return ORDINANCE_NUMBERED_STEPS[0] ?? null
  const index = ORDINANCE_NUMBERED_STEPS.indexOf(current)
  if (index === -1) return null
  return ORDINANCE_NUMBERED_STEPS[index + 1] ?? null
}
