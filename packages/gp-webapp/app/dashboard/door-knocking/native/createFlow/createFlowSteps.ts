// The create flow's two vocabularies, and the map between them.
//
// `CreateFlowStep` is the ORCHESTRATOR's word for where the flow is, and it is
// frozen at three values by `NativeDoorKnockingPage` (#1380): the page opens
// the flow at `filters`, and `changeFlowStep` starts a drawing session on
// exactly the `filters` → `draw` transition. Renaming or reordering these
// would silently break the draw session — the canvas would never enter
// draw_polygon — so the page's three names stay as they are.
//
// `CreateFlowStage` is the FLOW's own word, and it is what the canvas designs:
// purpose → who → draw → confirm, with a conditional `name`. The three
// pre-draw stages all live inside the page's single `filters` step, which is
// what lets this file grow a step without the orchestrator learning about it.
// `filters` is therefore read as "the phase that decides the audience", not as
// "the filter pills" — the pills are one stage of three.
export type CreateFlowStep = 'filters' | 'draw' | 'confirm'

export const PRE_DRAW_STAGES = ['purpose', 'who', 'name'] as const

export type PreDrawStage = (typeof PRE_DRAW_STAGES)[number]

export type CreateFlowStage = PreDrawStage | 'draw' | 'confirm'

// How much of the map the confirm step opens UNCOVERED, as a percentage of the
// container both it and the map fill. The canvas prototype puts a 192px map band
// above its confirm card, which is about what 30% of a phone's map area comes to
// — and the sheet still keeps 70% for a name, eight swatches, a stats line and
// two buttons.
//
// It lives in this module, which carries no imports, because it is the one
// number the two halves of this surface have to agree on: `CreateListFlow` makes
// it the sheet's top edge, and `useCreateListDraw` (across the seam, in
// `CreateListSurface`) turns what is left of it into the camera padding the
// drawn ring is fitted against. A copy on each side is a sheet and a camera that
// silently stop describing the same band.
export const CONFIRM_PEEK_TOP_PCT = 30

export const flowStage = (
  step: CreateFlowStep,
  preDrawStage: PreDrawStage,
): CreateFlowStage => (step === 'filters' ? preDrawStage : step)

// The page step a stage reports back, so a stage change and a step change are
// one decision rather than two that can disagree.
export const stageStep = (stage: CreateFlowStage): CreateFlowStep =>
  stage === 'draw' || stage === 'confirm' ? stage : 'filters'

export interface StepperPosition {
  currentStep: number
  totalSteps: number
}

// COMPUTED, never a constant: the flow is four steps or five depending on
// whether the audience needs saving as a reusable voter list first, and a
// hardcoded `of 4` under a five-step path is the kind of wrong that only shows
// up on the last screen. `needsName` is stable from the who step onward —
// nothing after it can edit the filters or the chosen list — so the count only
// ever moves while the candidate is still on the step that decides it.
export const stepperPosition = (
  stage: CreateFlowStage,
  needsName: boolean,
): StepperPosition => {
  const totalSteps = needsName ? 5 : 4
  switch (stage) {
    case 'purpose':
      return { currentStep: 1, totalSteps }
    case 'who':
      return { currentStep: 2, totalSteps }
    case 'name':
      return { currentStep: 3, totalSteps }
    case 'draw':
      return { currentStep: needsName ? 4 : 3, totalSteps }
    case 'confirm':
      return { currentStep: needsName ? 5 : 4, totalSteps }
  }
}

// One step back, or null on the first — the header reserves the slot either
// way. Draw returns to whichever pre-draw stage the candidate actually left,
// which is the name step only when they were offered it.
export const previousStage = (
  stage: CreateFlowStage,
  needsName: boolean,
): CreateFlowStage | null => {
  switch (stage) {
    case 'purpose':
      return null
    case 'who':
      return 'purpose'
    case 'name':
      return 'who'
    case 'draw':
      return needsName ? 'name' : 'who'
    case 'confirm':
      return 'draw'
  }
}
