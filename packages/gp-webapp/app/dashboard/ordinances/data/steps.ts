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
