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

    const steps = current.steps.map((step): PriorityStep => {
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
      const merged: PriorityStep = {
        id: step.id,
        state: patch.state,
        summary: patch.summary ?? step.summary,
        ...(caveat === undefined ? {} : { caveat }),
        ...(step.updatedAt === undefined ? {} : { updatedAt: step.updatedAt }),
      }
      const changed =
        merged.state !== step.state ||
        merged.summary !== step.summary ||
        merged.caveat !== step.caveat
      return changed ? { ...merged, updatedAt: now } : merged
    })

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
          'the conversation. Call it whenever a step moves: the official ' +
          'answers the question a step asks, you find evidence that ' +
          'settles one, or you start working a new one. Pass only the ' +
          'steps that changed — anything you leave out keeps exactly what ' +
          'it had. Sending a settled step back to active, or to stale ' +
          'when new information puts it back in doubt, is normal and ' +
          'expected, not a failure. Always pass nextAction: the single ' +
          'thing the official should do next.',
        inputSchema: UpdatePriorityStatusInputSchema,
        execute: (input) => this.applyUpdate(priorityId, input),
      }
    return { update_priority_status: updateStatus }
  }
}
