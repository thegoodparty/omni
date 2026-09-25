// The create flow's two vocabularies, and the map between them.
//
// `CreateFlowStep` is the ORCHESTRATOR's word for where the flow is. The page
// (`NativeDoorKnockingPage`, #1380) opens the flow at `filters` and
// `changeFlowStep` puts the canvas into drawing mode on exactly the
// `filters` → `draw` transition, so renaming or reordering these would
// silently break the draw session — the canvas would never enter
// draw_polygon. That transition fires on the way back in as well as on the
// way in, which is why the page asks whether a ring already exists before
// deciding between a fresh session and resuming the one already drawn.
//
// `CreateFlowStage` is the FLOW's own word, and it is what the design draws:
// purpose → who → points → name → draw → route. The two pre-draw stages
// both live inside the page's single `filters` step, which is what lets that
// phase grow a stage without the orchestrator learning about it. `filters` is
// therefore read as "the phase that decides the audience", not as "the filter
// pills" — the pills are one half of one stage of two.
//
// `points` is the talking-points stage. It sits third: the purpose slug and
// the audience it writes from are both settled by then (steps 1 and 2), which
// is the whole of what the draft endpoint reads. It sits BEFORE the polygon,
// so the audience label falls back to a placeholder — the campaign name is
// not asked until `name`, which now comes AFTER points.
//
// `name` is the "Name your campaign" stage. It sits fourth, BEFORE `draw`,
// because the multi-turf design has one campaign hold many turfs cut on one
// map: the campaign is the container, so its name is settled before any turf
// is drawn into it. This is what the drawing step is drawing INTO, not just
// naming after the fact.
//
// The orphan-filter retry zone is `name | draw | route` — every step after
// the campaign name is a valid retry destination for a failed create. Points
// is not in it because it sits pre-name and a walkback that far usually
// means changing the audience upstream; who/purpose release the filter.
export type CreateFlowStep = 'filters' | 'draw' | 'name' | 'points' | 'route'

// `question` sits between them for the one purpose that asks one. It is a
// PRE-DRAW stage rather than a step of its own precisely because this phase
// can grow without the orchestrator learning about it — `stageStep` still
// reports `filters`, so the canvas's draw-session transition is untouched.
export const PRE_DRAW_STAGES = ['purpose', 'question', 'who'] as const

export type PreDrawStage = (typeof PRE_DRAW_STAGES)[number]

export type CreateFlowStage =
  | PreDrawStage
  | 'draw'
  | 'name'
  | 'points'
  | 'route'

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
  stage === 'draw' ||
  stage === 'points' ||
  stage === 'name' ||
  stage === 'route'
    ? stage
    : 'filters'

export interface StepperPosition {
  currentStep: number
  totalSteps: number
}

// One path of six steps, always. There is no short path that ends at a saved
// list, and building a new audience does not make one: this is door knocking,
// so every route through the flow draws a boundary and buys a route. Choosing
// "Create a new list" picks the audience, it does not finish the job.
//
// The prototype still carries the old branch (`needsName ? 3 : 5`, keyed off a
// filtered draft with no saved list behind it). It is deliberately not
// implemented — a filtered draft continues to the draw step like any other
// audience, and the filter it mints is named by the campaign name on confirm.
// `asksQuestion` is the community-input purpose being selected, which inserts
// one stage after `purpose` and makes the path seven long. Passed in rather
// than read here so this module stays pure and the flow keeps owning what the
// purpose means.
export const stepperPosition = (
  stage: CreateFlowStage,
  asksQuestion = false,
): StepperPosition => {
  const totalSteps = asksQuestion ? 7 : 6
  const after = (base: number): number => (asksQuestion ? base + 1 : base)
  switch (stage) {
    case 'purpose':
      return { currentStep: 1, totalSteps }
    case 'question':
      return { currentStep: 2, totalSteps }
    case 'who':
      return { currentStep: after(2), totalSteps }
    case 'points':
      return { currentStep: after(3), totalSteps }
    case 'name':
      return { currentStep: after(4), totalSteps }
    case 'draw':
      return { currentStep: after(5), totalSteps }
    case 'route':
      return { currentStep: after(6), totalSteps }
  }
}

// One step back, or null on the first — the header reserves the slot either
// way.
export const previousStage = (
  stage: CreateFlowStage,
  asksQuestion = false,
): CreateFlowStage | null => {
  switch (stage) {
    case 'purpose':
      return null
    case 'question':
      return 'purpose'
    case 'who':
      return asksQuestion ? 'question' : 'purpose'
    case 'points':
      return 'who'
    case 'name':
      return 'points'
    case 'draw':
      return 'name'
    case 'route':
      return 'draw'
  }
}
