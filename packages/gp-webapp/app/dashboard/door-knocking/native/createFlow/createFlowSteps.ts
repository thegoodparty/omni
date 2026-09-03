// The create flow's two vocabularies, and the map between them.
//
// `CreateFlowStep` is the ORCHESTRATOR's word for where the flow is. The page
// (`NativeDoorKnockingPage`, #1380) opens the flow at `filters` and
// `changeFlowStep` starts a drawing session on exactly the `filters` → `draw`
// transition, so renaming or reordering these would silently break the draw
// session — the canvas would never enter draw_polygon.
//
// `CreateFlowStage` is the FLOW's own word, and it is what the design draws:
// purpose → who → draw → confirm → route. The two pre-draw stages both live
// inside the page's single `filters` step, which is what lets that phase grow
// a stage without the orchestrator learning about it. `filters` is therefore
// read as "the phase that decides the audience", not as "the filter pills" —
// the pills are one half of one stage of two.
export type CreateFlowStep = 'filters' | 'draw' | 'confirm' | 'route'

export const PRE_DRAW_STAGES = ['purpose', 'who'] as const

export type PreDrawStage = (typeof PRE_DRAW_STAGES)[number]

export type CreateFlowStage = PreDrawStage | 'draw' | 'confirm' | 'route'

// The design's own limit on the name this flow asks for. Deliberately tighter
// than `MAX_TURF_NAME_LENGTH`, which is what `EditTurfDialog` has to go on
// accepting for names already saved.
export const MAX_CAMPAIGN_NAME_LENGTH = 60

export const flowStage = (
  step: CreateFlowStep,
  preDrawStage: PreDrawStage,
): CreateFlowStage => (step === 'filters' ? preDrawStage : step)

// The page step a stage reports back, so a stage change and a step change are
// one decision rather than two that can disagree.
export const stageStep = (stage: CreateFlowStage): CreateFlowStep =>
  stage === 'draw' || stage === 'confirm' || stage === 'route'
    ? stage
    : 'filters'

export interface StepperPosition {
  currentStep: number
  totalSteps: number
}

// One path of five steps, always. There is no short path that ends at a saved
// list, and building a new audience does not make one: this is door knocking,
// so every route through the flow draws a boundary and buys a route. Choosing
// "Create a new list" picks the audience, it does not finish the job.
//
// The prototype still carries the old branch (`needsName ? 3 : 5`, keyed off a
// filtered draft with no saved list behind it). It is deliberately not
// implemented — a filtered draft continues to the draw step like any other
// audience, and the filter it mints is named by the campaign name on confirm.
export const stepperPosition = (stage: CreateFlowStage): StepperPosition => {
  switch (stage) {
    case 'purpose':
      return { currentStep: 1, totalSteps: 5 }
    case 'who':
      return { currentStep: 2, totalSteps: 5 }
    case 'draw':
      return { currentStep: 3, totalSteps: 5 }
    case 'confirm':
      return { currentStep: 4, totalSteps: 5 }
    case 'route':
      return { currentStep: 5, totalSteps: 5 }
  }
}

// One step back, or null on the first — the header reserves the slot either
// way.
export const previousStage = (
  stage: CreateFlowStage,
): CreateFlowStage | null => {
  switch (stage) {
    case 'purpose':
      return null
    case 'who':
      return 'purpose'
    case 'draw':
      return 'who'
    case 'confirm':
      return 'draw'
    case 'route':
      return 'confirm'
  }
}
