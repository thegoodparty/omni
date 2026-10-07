import { COMMUNITY_INPUT_PURPOSE } from '@goodparty_org/contracts'

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
// purpose → who → points → name → draw, then a terminal `success` screen
// outside the stepper, with ONE optional stage between purpose and who for
// the two purposes that need something asked before a draft can be written.
// Drawing is the LAST thing the candidate does: the route is bought at first
// knock now, so there is nothing left to ask once the map is cut. The
// pre-draw stages all live inside the page's single `filters` step, which is
// what lets that phase grow a stage without the orchestrator learning about
// it. `filters` is therefore read as "the phase that decides the audience",
// not as "the filter pills" — the pills are one half of one stage.
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
// The orphan-filter retry zone is `name | draw` — every step after
// the campaign name is a valid retry destination for a failed create. Points
// is not in it because it sits pre-name and a walkback that far usually
// means changing the audience upstream; who/purpose release the filter.
export type CreateFlowStep = 'filters' | 'draw' | 'name' | 'points' | 'success'

// Two purposes each need one thing asked before the talking points can be
// drafted, and they ask for different things, so they are two stages rather
// than one parametrized one: `details` is when and where an event is, so the
// points can name it instead of leaving it blank, and `question` is the issue
// question a community-input effort is putting to constituents.
//
// AT MOST ONE OF THEM EVER FIRES. A purpose selects one or neither, so they
// occupy a single optional slot between `purpose` and `who` and the stepper
// adds one step, never two — which is why `stepperPosition` and
// `previousStage` take one flag for "an extra stage is in play" rather than
// one per stage.
//
// Both are PRE-DRAW stages rather than steps of their own precisely because
// this phase can grow without the orchestrator learning about it —
// `stageStep` still reports `filters`, so the canvas's draw-session
// transition is untouched.
export const PRE_DRAW_STAGES = [
  'purpose',
  'details',
  'question',
  'who',
] as const

export type PreDrawStage = (typeof PRE_DRAW_STAGES)[number]

export type CreateFlowStage =
  | PreDrawStage
  | 'draw'
  | 'name'
  | 'points'
  | 'success'

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
  stage === 'success'
    ? stage
    : 'filters'

export interface StepperPosition {
  currentStep: number
  totalSteps: number
}

// Whether a purpose inserts the `question` stage. One slug on both products:
// Win's "Hear from voters" and Serve's community input.
export const purposeAsksQuestion = (purpose: string | null): boolean =>
  purpose === COMMUNITY_INPUT_PURPOSE

// One path of five steps, six when the purpose asks for one of the two
// optional pre-draw stages. Choosing "Create a new list" picks the audience,
// it does not finish the job — every route through the flow draws a boundary.
//
// `success` is deliberately outside the count. It is not a step the
// candidate takes; it is the confirmation that the rest are done, and
// numbering it as one more would invite a Back into a campaign that already
// exists.
//
// The prototype still carries the old branch (`needsName ? 3 : 5`, keyed off a
// filtered draft with no saved list behind it). It is deliberately not
// implemented — a filtered draft continues to the draw step like any other
// audience, and the filter it mints is named by the campaign name on confirm.
// Which optional pre-draw stage this purpose asks for, or null for the
// purposes that ask nothing.
//
// Passing the STAGE rather than a boolean per stage is what makes the mutual
// exclusion structural: there is one slot in the path, so there is one
// argument, and no caller can claim both stages are in play. It is also what
// lets `previousStage` send `who` back to whichever one actually fired.
// Passed in rather than read here so this module stays pure and the flow
// keeps owning what a purpose means.
export type ExtraPreDrawStage = Extract<PreDrawStage, 'details' | 'question'>

export const stepperPosition = (
  stage: CreateFlowStage,
  extraStage: ExtraPreDrawStage | null = null,
): StepperPosition => {
  const extra = extraStage ? 1 : 0
  const totalSteps = 5 + extra
  switch (stage) {
    case 'purpose':
      return { currentStep: 1, totalSteps }
    case 'details':
    case 'question':
      return { currentStep: 2, totalSteps }
    case 'who':
      return { currentStep: 2 + extra, totalSteps }
    case 'points':
      return { currentStep: 3 + extra, totalSteps }
    case 'name':
      return { currentStep: 4 + extra, totalSteps }
    case 'draw':
      return { currentStep: 5 + extra, totalSteps }
    // Headerless: `totalSteps: 0` is what the shell reads as "draw no
    // stepper", the same thing SMS and social do on their own last screens.
    case 'success':
      return { currentStep: 0, totalSteps: 0 }
  }
}

// One step back, or null on the first — the header reserves the slot either
// way.
export const previousStage = (
  stage: CreateFlowStage,
  extraStage: ExtraPreDrawStage | null = null,
): CreateFlowStage | null => {
  switch (stage) {
    case 'purpose':
      return null
    case 'details':
    case 'question':
      return 'purpose'
    case 'who':
      return extraStage ?? 'purpose'
    case 'points':
      return 'who'
    case 'name':
      return 'points'
    case 'draw':
      return 'name'
    // The campaign exists by the time this renders. There is nothing to go
    // back to that would not mean creating it twice.
    case 'success':
      return null
  }
}
