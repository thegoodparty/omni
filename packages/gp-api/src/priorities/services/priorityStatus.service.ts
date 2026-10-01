import { Injectable } from '@nestjs/common'
import { formatISO, isBefore, parseISO } from 'date-fns'
import {
  MAX_CHECK_RAISES,
  PRIORITY_GATE_STEPS,
  PRIORITY_LISTEN_GATES,
  isCheckAnswered,
  openListenBefore,
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
    a.offeredAt === b.offeredAt &&
    a.heard === b.heard &&
    a.contrast?.offeredAt === b.contrast?.offeredAt &&
    a.contrast?.heard === b.contrast?.heard &&
    a.contrast?.state === b.contrast?.state &&
    a.contrast?.who === b.contrast?.who &&
    a.contrast?.question === b.contrast?.question &&
    a.contrast?.when === b.contrast?.when)

const isGate = (id: PriorityStepId): boolean => PRIORITY_GATE_STEPS.includes(id)

const CHECK_HOW =
  'Build the most-affected and least-affected lists, present a card for ' +
  'each, ask with ask_clarify_question, and only then record the check as ' +
  'asked.'

export interface StatusTurn {
  // Whether a card or a question reached the official in the calling turn,
  // which only the chat handler can see.
  offered: () => boolean
  // When the calling turn began. An offer stamped before it was shown in an
  // earlier turn, so the official has had the chance to answer it.
  startedAt: string
}

const NO_TURN: StatusTurn = { offered: () => false, startedAt: '' }

type CheckSide = {
  state: PriorityStepCheck['state']
  offeredAt?: string
  heard?: string
}

// Answers need evidence. The official agreeing is not constituents agreeing,
// so confirmed and revised need what constituents said, and a side that was
// really put to people: out in the field, or shown in an earlier turn.
const lacksEvidence = (
  stored: CheckSide | undefined,
  patch: { state?: CheckSide['state']; heard?: string } | undefined,
  turn: StatusTurn,
): boolean => {
  const next = patch?.state
  if (next !== 'confirmed' && next !== 'revised') return false
  if (next === stored?.state) return false
  const heard = (patch?.heard ?? stored?.heard ?? '').trim()
  const shownBefore =
    stored?.offeredAt !== undefined &&
    turn.startedAt !== '' &&
    isBefore(parseISO(stored.offeredAt), parseISO(turn.startedAt))
  return heard === '' || !(stored?.state === 'out' || shownBefore)
}

// Why the agent may not make a move yet, or null. The check is the step's
// one ask for its stage, and a model left to itself records it and moves on
// without ever showing it, or calls the official's own agreement a
// constituent answer. So the moves that wait on it are: a check on a step
// that is not a gate; recording `asked` before anything was put in front of
// the official this turn; recording an answer nobody gave; opening a step
// past a settled gate that has no check (an `asked` never shown reads as
// none); and going more than one step past a gate still waiting on the
// official's yes.
const refusalFor = (
  current: PriorityStatus,
  update: UpdatePriorityStatusInput,
  turn: StatusTurn,
): string | null => {
  const offGate = update.steps.find(
    (step) => step.check !== undefined && !isGate(step.id),
  )
  if (offGate !== undefined) {
    return (
      `${PRIORITY_STEP_LABELS[offGate.id]} does not carry a check. Checks ` +
      'live on The problem, Your options, The path and The plan; record ' +
      'what came back on the check it answers.'
    )
  }
  const recordsAsked = update.steps.some(
    (step) =>
      step.check?.state === 'asked' || step.check?.contrast?.state === 'asked',
  )
  if (recordsAsked && !turn.offered()) {
    return `Nothing has been put in front of the official yet. ${CHECK_HOW}`
  }
  const unanswered = update.steps.find((patch) => {
    const stored = current.steps.find((step) => step.id === patch.id)?.check
    return (
      lacksEvidence(stored, patch.check, turn) ||
      lacksEvidence(stored?.contrast, patch.check?.contrast, turn)
    )
  })
  if (unanswered !== undefined) {
    return (
      'Only constituents can confirm or revise a check, and the official ' +
      'agreeing is not that. Record confirmed or revised only for a check ' +
      'that was out with people or shown in an earlier turn, and put what ' +
      'they said, and who said it, in heard.'
    )
  }
  const closesUnheard = update.steps.find((patch) => {
    const gate = PRIORITY_LISTEN_GATES[patch.id]
    if (gate === undefined || patch.state !== STEP_STATE.settled) return false
    const stored = current.steps.find((step) => step.id === gate)?.check
    const gatePatch = update.steps.find((step) => step.id === gate)?.check
    return !isCheckAnswered(
      mergeStepCheck(stored, gatePatch, turn.startedAt, turn.offered()),
    )
  })
  if (closesUnheard !== undefined) {
    const gate = PRIORITY_LISTEN_GATES[closesUnheard.id]!
    return (
      `${PRIORITY_STEP_LABELS[closesUnheard.id]} stays open until ` +
      `constituents have answered the check on ${PRIORITY_STEP_LABELS[gate]}` +
      ', or the official decides not to ask. Leave it open with a caveat ' +
      'naming who you are waiting on, and keep working.'
    )
  }
  const afterUpdate = current.steps.map((step) => ({
    id: step.id,
    state:
      update.steps.find((patch) => patch.id === step.id)?.state ?? step.state,
  }))
  const settlesPastListening = update.steps.find(
    (patch) =>
      patch.state === STEP_STATE.settled &&
      openListenBefore(afterUpdate, patch.id) !== undefined,
  )
  if (settlesPastListening !== undefined) {
    const listen = openListenBefore(afterUpdate, settlesPastListening.id)!
    return (
      `You can work on ${PRIORITY_STEP_LABELS[settlesPastListening.id]} ` +
      `now, but it cannot be done until ${PRIORITY_STEP_LABELS[listen]} ` +
      'closes, because it rests on what people have not said yet. Keep it ' +
      'active, and say plainly what it is waiting on.'
    )
  }
  const opening = update.steps.filter(
    (step) => step.state === STEP_STATE.active,
  )
  const openingId = opening[opening.length - 1]?.id
  if (openingId === undefined) return null
  const openingAt = PRIORITY_STEP_IDS.indexOf(openingId)
  const patches = new Map(update.steps.map((step) => [step.id, step]))
  const after = (step: PriorityStep) => {
    const patch = patches.get(step.id)
    return {
      state: patch?.state ?? step.state,
      check: mergeStepCheck(
        step.check,
        patch?.check,
        turn.startedAt,
        turn.offered(),
      ),
    }
  }
  const gatesBefore = current.steps.filter(
    (step) => isGate(step.id) && PRIORITY_STEP_IDS.indexOf(step.id) < openingAt,
  )
  const bare = gatesBefore.find((step) => {
    const { state, check } = after(step)
    return (
      state === STEP_STATE.settled &&
      (check === undefined ||
        (check.state === 'asked' && check.offeredAt === undefined))
    )
  })
  if (bare !== undefined) {
    return (
      `${PRIORITY_STEP_LABELS[bare.id]} is settled but its check was never ` +
      `shown. Offer it now, before ${PRIORITY_STEP_LABELS[openingId]}: ` +
      CHECK_HOW
    )
  }
  const waiting = gatesBefore.find(
    (step) =>
      after(step).check?.state === 'asked' &&
      openingAt >= PRIORITY_STEP_IDS.indexOf(step.id) + 2,
  )
  return waiting === undefined
    ? null
    : `The check on ${PRIORITY_STEP_LABELS[waiting.id]} is still waiting on ` +
        "the official's answer, and nothing is out with constituents yet. " +
        'Ask it again, with the cards, or record their answer (out, ' +
        `deferred or declined) before ${PRIORITY_STEP_LABELS[openingId]}.`
}

// A gate settled in this call with no check yet: the tool result says what
// has to happen next, in this turn, before any next-step work.
const checkDueFor = (
  status: PriorityStatus,
  update: UpdatePriorityStatusInput,
): string | null => {
  const due = update.steps.filter(
    (patch) =>
      isGate(patch.id) &&
      patch.state === STEP_STATE.settled &&
      status.steps.find((step) => step.id === patch.id)?.check === undefined,
  )
  if (due.length === 0) return null
  const labels = due.map((patch) => PRIORITY_STEP_LABELS[patch.id])
  return due.length === 1
    ? `${labels[0]} is settled. Offer its check now, in this turn, before ` +
        `any work on the next step. ${CHECK_HOW}`
    : `${labels.join(' and ')} are settled. Offer each one's check now, in ` +
        `this turn, one at a time, before any work on the next step. ` +
        CHECK_HOW
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
    offered = false,
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
      const merged = mergeStepCheck(step.check, patch.check, now, offered)
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
    side?: 'main' | 'contrast'
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
    const contrastSide = args.side === 'contrast'
    const sideState = contrastSide ? stored?.contrast?.state : stored?.state
    if (stored === undefined || sideState !== 'deferred') {
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
      contrastSide
        ? {
            // Taking it up is not another deferral, so it leaves the state
            // alone rather than spend one of the raises the cap allows.
            ...((args.answer === 'declined' || args.answer === 'not_yet') && {
              contrast: {
                state:
                  args.answer === 'declined'
                    ? ('declined' as const)
                    : ('deferred' as const),
                ...(args.when === undefined ? {} : { when: args.when }),
              },
            }),
          }
        : {
            ...(args.answer === 'declined' && { state: 'declined' as const }),
            ...(args.answer === 'not_yet' && { state: 'deferred' as const }),
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

  buildStatusTool(
    priorityId: string,
    turn: StatusTurn = NO_TURN,
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
          const refusal = refusalFor(await this.read(priorityId), input, turn)
          if (refusal !== null) return { error: refusal }
          const result = await this.applyUpdate(
            priorityId,
            input,
            turn.offered(),
          )
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
