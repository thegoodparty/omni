import { Injectable } from '@nestjs/common'
import { formatISO } from 'date-fns'
import {
  PriorityStatusSchema,
  PriorityStepStateSchema,
  parsePriorityStatus,
  type PriorityStatus,
  type PriorityStep,
  type PriorityStepId,
  type PriorityStepState,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import type { LlmStreamTool, LlmTool } from '@/llm/services/llm.service'
import {
  UpdatePriorityStatusInputSchema,
  type UpdatePriorityStatusInput,
} from '../schemas/priorityStatus.schema'

const STEP_STATE = PriorityStepStateSchema.enum

export interface PriorityStatusResult {
  status: PriorityStatus
  currentStep: PriorityStepId | null
  nextAction: string | null
}

// The only writer of `status`, `currentStep` and `nextAction`. The two columns
// are derived from the JSON in the same update so they can never disagree with
// it; anything else writing them reintroduces that drift.
@Injectable()
export class PriorityStatusService extends createPrismaBase(MODELS.Priority) {
  async read(priorityId: string): Promise<PriorityStatus> {
    const row = await this.model.findUnique({
      where: { id: priorityId },
      select: { status: true },
    })
    return parsePriorityStatus(row?.status)
  }

  async applyUpdate(
    priorityId: string,
    update: UpdatePriorityStatusInput,
  ): Promise<PriorityStatusResult> {
    const current = await this.read(priorityId)
    const now = formatISO(new Date())
    const patches = new Map(update.steps.map((step) => [step.id, step]))

    const merged = current.steps.map((step): PriorityStep => {
      const patch = patches.get(step.id)
      if (!patch) return step
      // An omitted caveat keeps what is stored; an explicit empty string is
      // how the agent says the doubt is resolved.
      const caveat =
        patch.caveat === undefined
          ? step.caveat
          : patch.caveat === ''
            ? undefined
            : patch.caveat
      const next: PriorityStep = {
        id: step.id,
        state: patch.state,
        summary: patch.summary ?? step.summary,
        ...(caveat === undefined ? {} : { caveat }),
        ...(step.updatedAt === undefined ? {} : { updatedAt: step.updatedAt }),
      }
      const changed =
        next.state !== step.state ||
        next.summary !== step.summary ||
        next.caveat !== step.caveat
      return changed ? { ...next, updatedAt: now } : next
    })

    // currentStep is derived by finding the first active step, so a second
    // active one silently mislabels which step the official is on. A call
    // that opens a step demotes any other active step to open, which keeps
    // its summary and caveat.
    const incomingActive = update.steps.filter(
      (step) => step.state === STEP_STATE.active,
    )
    const activeStepId = incomingActive[incomingActive.length - 1]?.id
    const steps = merged.map(
      (step): PriorityStep =>
        activeStepId !== undefined &&
        step.id !== activeStepId &&
        step.state === STEP_STATE.active
          ? { ...step, state: STEP_STATE.open, updatedAt: now }
          : step,
    )

    const status = PriorityStatusSchema.parse({ ...current, steps })
    const firstInState = (state: PriorityStepState) =>
      status.steps.find((step) => step.state === state)?.id ?? null
    const currentStep =
      firstInState(STEP_STATE.active) ??
      firstInState(STEP_STATE.stale) ??
      firstInState(STEP_STATE.open)
    const nextAction = update.nextAction.trim() || null

    await this.model.update({
      where: { id: priorityId },
      data: { status, currentStep, nextAction },
    })

    return { status, currentStep, nextAction }
  }

  buildStatusTool(priorityId: string): Record<string, LlmTool> {
    const updateStatus: LlmStreamTool<typeof UpdatePriorityStatusInputSchema> =
      {
        description:
          'Record where this priority stands after what just happened in ' +
          'the conversation. Exactly one step is active at any moment: ' +
          'before you set a step active, move the step that was active to ' +
          'settled or stale in the same call. If you do not, that step is ' +
          'dropped back to open and its work reads as abandoned. Call this ' +
          'when a step genuinely changes state, or when what it settled ' +
          'materially changes, not to restate what is already stored. Pass ' +
          'only the steps that changed; anything you leave out keeps ' +
          'exactly what it had. Send a settled step back to active or ' +
          'stale only when new information meaningfully invalidates what ' +
          'that step concluded and resolving it needs more conversation, ' +
          'and say what changed in caveat. A detail added, a number ' +
          'confirmed, or the topic coming up again is not enough. Always ' +
          'pass nextAction: one short sentence the official could act on ' +
          'today.',
        inputSchema: UpdatePriorityStatusInputSchema,
        execute: (input) => this.applyUpdate(priorityId, input),
      }
    return { update_priority_status: updateStatus }
  }
}
