import { z } from 'zod'
import {
  PRIORITY_GATE_STEPS,
  PRIORITY_STEP_LABELS,
  PriorityStepCheckInputSchema,
  PriorityStatusSchema,
  PriorityStepIdSchema,
  PriorityStepStateSchema,
  mergeStepCheck,
  type PriorityStatus,
  type PriorityStep,
  type PriorityStepId,
  type PriorityStepState,
} from '@goodparty_org/contracts'

export const STATUS_TOOL = 'update_priority_status'

// The tool the agent calls to move the rail. Mirrors the server's input schema
// (`gp-api/src/priorities/schemas/priorityStatus.schema.ts`) but stays lenient
// about `nextAction`, so a call that omits it still moves the steps rather
// than dropping the whole update.
const StepPatchSchema = z.object({
  id: PriorityStepIdSchema,
  state: PriorityStepStateSchema,
  summary: z.string().optional(),
  caveat: z.string().optional(),
  // Dropped rather than failing the patch, so a check the model got wrong
  // never stops the step itself from moving.
  check: PriorityStepCheckInputSchema.optional().catch(undefined),
})

export const PriorityStatusUpdateSchema = z.object({
  steps: z.array(StepPatchSchema),
  nextAction: z.string().optional(),
})
export type PriorityStatusUpdate = z.infer<typeof PriorityStatusUpdateSchema>

// What the tool returns once it has written: the merged status, straight from
// the server. The live rail and its markers move only on this, never on the
// call, so a refused call (which returns `{ error }` and parses as null here)
// moves nothing.
const StatusToolResultSchema = z.object({
  status: PriorityStatusSchema,
  nextAction: z.string().nullable().optional(),
})

export interface StepChange {
  id: PriorityStepId
  from: PriorityStepState
  to: PriorityStepState
  // The agent settled this step and has now taken it back. Said out loud in
  // the marker copy: hiding it would make the rail look broken.
  backwards: boolean
}

export interface AppliedStatusUpdate {
  status: PriorityStatus
  nextAction: string | null
}

export const parseStatusUpdate = (
  value: unknown,
): PriorityStatusUpdate | null => {
  const parsed = PriorityStatusUpdateSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * The same merge the server does, run locally so a reloaded transcript can
 * rebuild the status each kept call left behind. A step left out of the patch
 * keeps everything it had; an omitted summary or caveat keeps the stored one,
 * and an empty caveat clears it.
 */
export const applyStatusUpdate = (
  current: PriorityStatus,
  update: PriorityStatusUpdate,
): AppliedStatusUpdate => {
  const patches = new Map(update.steps.map((step) => [step.id, step]))

  const steps = current.steps.map((step): PriorityStep => {
    const patch = patches.get(step.id)
    if (!patch) return step
    const caveat =
      patch.caveat === undefined
        ? step.caveat
        : patch.caveat === ''
          ? undefined
          : patch.caveat
    const now = new Date().toISOString()
    // The server refuses a check on a step that is not a gate, so the rail
    // never shows one either.
    const check = PRIORITY_GATE_STEPS.includes(step.id)
      ? mergeStepCheck(step.check, patch.check, now)
      : step.check
    return {
      id: step.id,
      state: patch.state,
      summary: patch.summary ?? step.summary,
      ...(caveat === undefined ? {} : { caveat }),
      ...(check === undefined ? {} : { check }),
      updatedAt: now,
    }
  })

  // Mirrors the server's applyUpdate: opening a step demotes any other active
  // step to open. Without it replayStatusMarkers accumulates a baseline that
  // carries two active steps, so every later marker is computed against the
  // wrong state.
  const incomingActive = update.steps.filter((step) => step.state === 'active')
  const activeStepId = incomingActive[incomingActive.length - 1]?.id
  const demoted = steps.map((step): PriorityStep => {
    if (
      activeStepId === undefined ||
      step.id === activeStepId ||
      step.state !== 'active'
    ) {
      return step
    }
    return { ...step, state: 'open', updatedAt: new Date().toISOString() }
  })

  const nextAction = update.nextAction?.trim() || null
  return { status: { ...current, steps: demoted }, nextAction }
}

/**
 * What moved between two statuses, step by step. A marker is drawn from this
 * and never from the tool call: the server can refuse a call outright, and
 * one that opens two steps keeps only the last, so only the status it stored
 * says what really moved. A step that went out and came back inside one call
 * has no net move and leaves no marker.
 */
export const statusChanges = (
  before: PriorityStatus,
  after: PriorityStatus,
): StepChange[] =>
  after.steps.flatMap((step): StepChange[] => {
    const from =
      before.steps.find((prior) => prior.id === step.id)?.state ?? 'open'
    if (from === step.state) return []
    return [
      {
        id: step.id,
        from,
        to: step.state,
        backwards: from === 'settled',
      },
    ]
  })

export const parseStatusToolResult = (
  value: unknown,
): { status: PriorityStatus; nextAction: string | null } | null => {
  const parsed = StatusToolResultSchema.safeParse(value)
  if (!parsed.success) return null
  return {
    status: parsed.data.status,
    nextAction: parsed.data.nextAction ?? null,
  }
}

const lower = (id: PriorityStepId): string =>
  PRIORITY_STEP_LABELS[id].toLowerCase()

/**
 * One quiet line naming what moved. A step going backwards says so, because
 * that is the agent using its judgement and the rail would otherwise look
 * like it had lost its place.
 */
export const describeStepChange = (change: StepChange): string => {
  if (change.to === 'settled') return `Done with ${lower(change.id)}`
  if (change.to === 'stale') {
    return `${PRIORITY_STEP_LABELS[change.id]} needs another look`
  }
  if (change.backwards) return `Back to ${lower(change.id)}`
  if (change.to === 'active') return `Working on ${lower(change.id)}`
  return `Set aside ${lower(change.id)}`
}
