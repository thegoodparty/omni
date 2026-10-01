import { Injectable } from '@nestjs/common'
import { formatISO } from 'date-fns'
import {
  MAX_CHECK_RAISES,
  PRIORITY_GATE_STEPS,
  PRIORITY_STATUS_VERSION,
  PRIORITY_STEP_IDS,
  PRIORITY_STEP_LABELS,
  PriorityStatusSchema,
  PriorityStepStateSchema,
  mergeStepCheck,
  parsePriorityStatus,
  type PriorityStatus,
  type PriorityStep,
  type PriorityStepCheck,
  type PriorityStepId,
  type PriorityStepState,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import type { LlmStreamTool, LlmTool } from '@/llm/services/llm.service'
import {
  RecordCheckReminderInputSchema,
  UpdatePriorityStatusInputSchema,
  type CheckReminderAnswer,
  type UpdatePriorityStatusInput,
} from '../schemas/priorityStatus.schema'

const STEP_STATE = PriorityStepStateSchema.enum

// A merged check is always a fresh object with a fresh updatedAt, so only its
// content says whether anything changed.
const sameCheck = (
  a: PriorityStepCheck | undefined,
  b: PriorityStepCheck | undefined,
): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.state === b.state &&
    a.who === b.who &&
    a.question === b.question &&
    a.when === b.when &&
    a.raised === b.raised &&
    a.contrast?.state === b.contrast?.state &&
    a.contrast?.who === b.contrast?.who &&
    a.contrast?.question === b.contrast?.question &&
    a.contrast?.when === b.contrast?.when)

const isGate = (id: PriorityStepId): boolean => PRIORITY_GATE_STEPS.includes(id)

const CHECK_HOW =
  'Build the most-affected and least-affected lists, present a card for ' +
  'each, ask with ask_clarify_question, and only then record the check as ' +
  'asked.'

// Why the agent may not make a move yet, or null. The check is the step's
// one ask for its stage, and a model left to itself records it and moves on
// without ever showing it, so two moves wait on it: recording `asked` before
// anything was put in front of the official this turn, and opening a step
// past a settled gate that carries no check at all.
const refusalFor = (
  current: PriorityStatus,
  update: UpdatePriorityStatusInput,
  offeredThisTurn: boolean,
): string | null => {
  const recordsAsked = update.steps.some(
    (step) =>
      step.check?.state === 'asked' || step.check?.contrast?.state === 'asked',
  )
  if (recordsAsked && !offeredThisTurn) {
    return `Nothing has been put in front of the official yet. ${CHECK_HOW}`
  }
  const opening = update.steps.filter(
    (step) => step.state === STEP_STATE.active,
  )
  const openingId = opening[opening.length - 1]?.id
  if (openingId === undefined) return null
  const openingAt = PRIORITY_STEP_IDS.indexOf(openingId)
  const patches = new Map(update.steps.map((step) => [step.id, step]))
  const bare = current.steps.find((step) => {
    if (!isGate(step.id) || PRIORITY_STEP_IDS.indexOf(step.id) >= openingAt) {
      return false
    }
    const patch = patches.get(step.id)
    const state = patch?.state ?? step.state
    const check = mergeStepCheck(step.check, patch?.check, '')
    return state === STEP_STATE.settled && check === undefined
  })
  return bare === undefined
    ? null
    : `${PRIORITY_STEP_LABELS[bare.id]} is settled but its check was never ` +
        `offered. Offer it now, before ${PRIORITY_STEP_LABELS[openingId]}: ` +
        CHECK_HOW
}

// A gate settled in this call with no check yet: the tool result says what
// has to happen next, in this turn, before any next-step work.
const checkDueFor = (
  status: PriorityStatus,
  update: UpdatePriorityStatusInput,
): string | null => {
  const due = update.steps.find(
    (patch) =>
      isGate(patch.id) &&
      patch.state === STEP_STATE.settled &&
      status.steps.find((step) => step.id === patch.id)?.check === undefined,
  )
  return due === undefined
    ? null
    : `${PRIORITY_STEP_LABELS[due.id]} is settled. Offer its check now, in ` +
        `this turn, before any work on the next step. ${CHECK_HOW}`
}

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
      const merged = mergeStepCheck(step.check, patch.check, now)
      const check = sameCheck(merged, step.check) ? step.check : merged
      const next: PriorityStep = {
        id: step.id,
        state: patch.state,
        summary: patch.summary ?? step.summary,
        ...(caveat === undefined ? {} : { caveat }),
        ...(step.updatedAt === undefined ? {} : { updatedAt: step.updatedAt }),
        ...(check === undefined ? {} : { check }),
      }
      const changed =
        next.state !== step.state ||
        next.summary !== step.summary ||
        next.caveat !== step.caveat ||
        next.check !== step.check
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

    const status = PriorityStatusSchema.parse({
      ...current,
      version: Math.max(current.version, PRIORITY_STATUS_VERSION),
      steps,
    })
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

  // The Chief of Staff's only write here: it reminds the official about a
  // check they put off, and that reminder has to spend the same raise the
  // priority flow counts, or the two surfaces would each nag up to the cap.
  // It touches one step's check and nothing else, so the step states and the
  // derived columns cannot move from outside the flow.
  async recordCheckReminder(args: {
    priorityId: string
    electedOfficeId: string
    stepId: PriorityStepId
    answer: CheckReminderAnswer
    when?: string
  }): Promise<{ check: PriorityStepCheck } | { error: string }> {
    const row = await this.model.findFirst({
      where: {
        id: args.priorityId,
        electedOfficeId: args.electedOfficeId,
        archivedAt: null,
      },
      select: { status: true },
    })
    if (!row) return { error: 'No priority on file with that id.' }
    const current = parsePriorityStatus(row.status)
    const stored = current.steps.find((step) => step.id === args.stepId)?.check
    if (stored?.state !== 'deferred') {
      return { error: 'That step has no check the official put off.' }
    }
    if (stored.raised >= MAX_CHECK_RAISES) {
      return {
        error:
          'This check has already been raised as many times as it should ' +
          'be. Let it go.',
      }
    }
    const check = mergeStepCheck(
      stored,
      {
        state: args.answer === 'declined' ? 'declined' : 'deferred',
        ...(args.when === undefined ? {} : { when: args.when }),
      },
      formatISO(new Date()),
    )
    const status = PriorityStatusSchema.parse({
      ...current,
      version: Math.max(current.version, PRIORITY_STATUS_VERSION),
      steps: current.steps.map((step) =>
        step.id === args.stepId ? { ...step, check } : step,
      ),
    })
    await this.model.update({
      where: { id: args.priorityId },
      data: { status },
    })
    return check === undefined ? { error: 'Nothing recorded.' } : { check }
  }

  // `offeredThisTurn` reads whether a card or a question went out in the turn
  // that is calling, which only the chat handler can see.
  buildStatusTool(
    priorityId: string,
    offeredThisTurn: () => boolean = () => false,
  ): Record<string, LlmTool> {
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
        execute: async (input) => {
          const refusal = refusalFor(
            await this.read(priorityId),
            input,
            offeredThisTurn(),
          )
          if (refusal !== null) return { error: refusal }
          const result = await this.applyUpdate(priorityId, input)
          const checkDue = checkDueFor(result.status, input)
          return checkDue === null ? result : { ...result, checkDue }
        },
      }
    return { update_priority_status: updateStatus }
  }

  buildCheckReminderTool(electedOfficeId: string): Record<string, LlmTool> {
    const recordReminder: LlmStreamTool<typeof RecordCheckReminderInputSchema> =
      {
        description:
          'Record that you just reminded the official about a check on one ' +
          'of their priorities that they put off, and what they said. Call ' +
          'it every time you raise one, whatever the answer: each reminder ' +
          'counts against the same small limit the priority itself uses, ' +
          'so skipping this lets them be reminded twice as often. Returns ' +
          'an error when that step has nothing put off or the limit is ' +
          'reached; then drop the subject.',
        inputSchema: RecordCheckReminderInputSchema,
        execute: (input) =>
          this.recordCheckReminder({ ...input, electedOfficeId }),
      }
    return { record_check_reminder: recordReminder }
  }
}
