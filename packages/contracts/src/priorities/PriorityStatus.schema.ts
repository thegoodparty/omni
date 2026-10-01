import { z } from 'zod'

/**
 * The working status of a priority: Bryan's seven steps, with what each one
 * settled. Stored as a JSON column on `Priority` and owned by the agent.
 *
 * BACKWARDS COMPATIBILITY. Rows written by an older build must keep parsing,
 * so this schema is APPEND-ONLY:
 *   - never remove a field, never rename one, never make an optional field
 *     required, and never remove a member from an enum
 *   - add new fields as optional, or with a default
 *   - bump `version` when you add something, and leave older values readable
 * The parser is deliberately lenient about unknown keys so a row written by a
 * NEWER build still loads on an older one during a rollout.
 */

export const PRIORITY_STEP_IDS = [
  'define',
  'evidence',
  'listen_problem',
  'options',
  'listen_options',
  'method',
  'plan',
] as const

export const PriorityStepIdSchema = z.enum(PRIORITY_STEP_IDS)
export type PriorityStepId = z.infer<typeof PriorityStepIdSchema>

export const PRIORITY_STEP_LABELS: Record<PriorityStepId, string> = {
  define: 'The problem',
  evidence: 'What we know',
  listen_problem: 'Who to hear from',
  options: 'Your options',
  listen_options: 'What people back',
  method: 'The path',
  plan: 'The plan',
}

/**
 * Why each step is on the list, in one line, for an official who is looking at
 * a step and wondering what it is for. Not what the agent wrote in it.
 */
export const PRIORITY_STEP_PURPOSE: Record<PriorityStepId, string> = {
  define:
    'Until you can state it in one sentence, no one can agree or disagree ' +
    'with you.',
  evidence: 'Separates what you can prove from what you have been told.',
  listen_problem: "The people living with it know things the records don't.",
  options: 'Puts the real choices side by side, including doing nothing.',
  listen_options: 'Tells you where the support is before you commit to one.',
  method:
    'Nothing happens without an ordinance, a budget line, or a program to ' +
    'carry it.',
  plan: 'Dates and owners are what turn a decision into something that happens.',
}

/**
 * `stale` is the one that matters: it is how the agent says "we settled this,
 * then learned something that puts it back in doubt" without losing what was
 * written.
 */
export const PriorityStepStateSchema = z.enum([
  'open',
  'active',
  'settled',
  'stale',
])
export type PriorityStepState = z.infer<typeof PriorityStepStateSchema>

/**
 * Whether what a step concluded has been checked with the constituents it
 * lands on. Listening is offered at each stage gate and is never a hard gate,
 * so every answer is a state worth keeping:
 *   - asked: the check was put to the official and they have not answered
 *   - out: they took it, and outreach is in the field
 *   - confirmed / revised: people answered, and the step held or changed
 *   - deferred: "not yet", raised again at most MAX_CHECK_RAISES times
 *   - declined: settled unchecked, on purpose
 */
export const PRIORITY_CHECK_STATES = [
  'asked',
  'out',
  'confirmed',
  'revised',
  'deferred',
  'declined',
] as const

export const PriorityCheckStateSchema = z.enum(PRIORITY_CHECK_STATES)
export type PriorityCheckState = z.infer<typeof PriorityCheckStateSchema>

/** The steps that end with a check: a stage gate each. */
export const PRIORITY_GATE_STEPS: readonly PriorityStepId[] = [
  'define',
  'options',
  'method',
  'plan',
]

/** How many times a deferred check is brought back before it is let go. */
export const MAX_CHECK_RAISES = 3

/**
 * The other side of a check: the constituents a step touches least, asked
 * the same question. It shows whether the conclusion holds beyond the people
 * it hits hardest, and it finds who would pay for or object to a fix. Nested
 * in the check rather than a second check because it is offered, answered
 * and raised together with it; it keeps its own state because the official
 * can take one group and not the other.
 */
export const PriorityStepContrastSchema = z.object({
  state: PriorityCheckStateSchema,
  who: z.string().default(''),
  question: z.string().default(''),
  when: z.string().optional(),
  /** Stamped by the server when this side was really put to the official. */
  offeredAt: z.string().optional(),
  /** What constituents on this side said, and who said it. */
  heard: z.string().optional(),
})
export type PriorityStepContrast = z.infer<typeof PriorityStepContrastSchema>

export const PriorityStepCheckSchema = z.object({
  state: PriorityCheckStateSchema,
  /** The group whose answer would confirm or break the step, in plain words. */
  who: z.string().default(''),
  /** The one question put to them. */
  question: z.string().default(''),
  /** On a deferral, what the official said about timing, in their words. */
  when: z.string().optional(),
  /** Times a deferred check has been raised again. Counted by the server. */
  raised: z.number().int().nonnegative().default(0),
  updatedAt: z.string().optional(),
  /**
   * Stamped by the server, never written by the agent, when the check was
   * recorded as asked in a turn where a card or a question really went out.
   * An `asked` without it was never shown and counts as no check at all.
   */
  offeredAt: z.string().optional(),
  /** What constituents said, and who said it. Required to confirm or revise. */
  heard: z.string().optional(),
  /** The least-affected group. Dropped on its own if it fails to parse. */
  contrast: PriorityStepContrastSchema.optional().catch(undefined),
})
export type PriorityStepCheck = z.infer<typeof PriorityStepCheckSchema>

export const PriorityStepContrastInputSchema = z.object({
  state: PriorityCheckStateSchema,
  who: z.string().optional(),
  question: z.string().optional(),
  when: z.string().optional(),
  heard: z.string().optional(),
})
export type PriorityStepContrastInput = z.infer<
  typeof PriorityStepContrastInputSchema
>

/**
 * What the agent writes for a check. Omitted fields keep what is stored, and
 * that includes `state`, so a patch can move only the least-affected side
 * without re-recording the main one (which would count as a raise).
 */
export const PriorityStepCheckInputSchema = z.object({
  state: PriorityCheckStateSchema.optional(),
  who: z.string().optional(),
  question: z.string().optional(),
  when: z.string().optional(),
  heard: z.string().optional(),
  contrast: PriorityStepContrastInputSchema.optional(),
})
export type PriorityStepCheckInput = z.infer<
  typeof PriorityStepCheckInputSchema
>

// Only the server knows a card or a question really went out this turn, so
// only the server passes `offered`; the client merge keeps what is stored.
const offeredAtFor = (
  stored: string | undefined,
  recordsAsked: boolean,
  offered: boolean,
  now: string,
): string | undefined => (recordsAsked && offered ? now : stored)

const mergeContrast = (
  stored: PriorityStepContrast | undefined,
  patch: PriorityStepContrastInput | undefined,
  now: string,
  offered: boolean,
): PriorityStepContrast | undefined => {
  if (patch === undefined) return stored
  const when = patch.when ?? stored?.when
  const heard = patch.heard ?? stored?.heard
  const offeredAt = offeredAtFor(
    stored?.offeredAt,
    patch.state === 'asked',
    offered,
    now,
  )
  return {
    state: patch.state,
    who: patch.who ?? stored?.who ?? '',
    question: patch.question ?? stored?.question ?? '',
    ...(when === undefined ? {} : { when }),
    ...(offeredAt === undefined ? {} : { offeredAt }),
    ...(heard === undefined ? {} : { heard }),
  }
}

/**
 * Merge a check patch onto the stored one. Recording "deferred" over a stored
 * deferral is how the agent says it raised the check again and heard "not
 * yet" again, so the count lives here rather than with the model, capped at
 * MAX_CHECK_RAISES. Shared so the server and the optimistic client merge
 * cannot count differently.
 */
export const mergeStepCheck = (
  stored: PriorityStepCheck | undefined,
  patch: PriorityStepCheckInput | undefined,
  now: string,
  offered = false,
): PriorityStepCheck | undefined => {
  if (patch === undefined) return stored
  const raisedAgain = stored?.state === 'deferred' && patch.state === 'deferred'
  const when = patch.when ?? stored?.when
  const heard = patch.heard ?? stored?.heard
  const offeredAt = offeredAtFor(
    stored?.offeredAt,
    patch.state === 'asked',
    offered,
    now,
  )
  const contrast = mergeContrast(stored?.contrast, patch.contrast, now, offered)
  return {
    state: patch.state ?? stored?.state ?? 'asked',
    who: patch.who ?? stored?.who ?? '',
    question: patch.question ?? stored?.question ?? '',
    ...(when === undefined ? {} : { when }),
    raised: Math.min(
      MAX_CHECK_RAISES,
      (stored?.raised ?? 0) + (raisedAgain ? 1 : 0),
    ),
    updatedAt: now,
    ...(offeredAt === undefined ? {} : { offeredAt }),
    ...(heard === undefined ? {} : { heard }),
    ...(contrast === undefined ? {} : { contrast }),
  }
}

/**
 * Each listening step collects what came back from one gate's check, so it
 * cannot be done before people have actually answered it.
 */
export const PRIORITY_LISTEN_GATES: Partial<
  Record<PriorityStepId, PriorityStepId>
> = {
  listen_problem: 'define',
  listen_options: 'options',
}

/**
 * Whether a check has an answer a listening step can close on: constituents
 * replied (confirmed or revised), or the official chose not to ask them.
 */
export const isCheckAnswered = (
  check: PriorityStepCheck | undefined,
): boolean =>
  check?.state === 'confirmed' ||
  check?.state === 'revised' ||
  check?.state === 'declined'

/**
 * The first listening step before `id` that is still open, if any. Work can
 * go ahead of an open listening step, but nothing past it is done until it
 * closes, because what comes after rests on what people have not said yet.
 */
export const openListenBefore = (
  steps: readonly { id: PriorityStepId; state: PriorityStepState }[],
  id: PriorityStepId,
): PriorityStepId | undefined => {
  const at = PRIORITY_STEP_IDS.indexOf(id)
  return steps.find(
    (step) =>
      PRIORITY_LISTEN_GATES[step.id] !== undefined &&
      PRIORITY_STEP_IDS.indexOf(step.id) < at &&
      step.state !== 'settled',
  )?.id
}

// Reads heal what earlier builds let through: a check is only meaningful on
// a gate, and an `asked` that was never stamped as shown was never shown, so
// it reads as no check at all and the gate asks for it again.
const healCheck = (step: PriorityStep): PriorityStep => {
  const check = step.check
  if (check === undefined) return step
  if (!PRIORITY_GATE_STEPS.includes(step.id)) {
    return { ...step, check: undefined }
  }
  if (check.state === 'asked' && check.offeredAt === undefined) {
    return { ...step, check: undefined }
  }
  const contrast = check.contrast
  return contrast?.state === 'asked' && contrast.offeredAt === undefined
    ? { ...step, check: { ...check, contrast: undefined } }
    : step
}

export const PriorityStepSchema = z.object({
  id: PriorityStepIdSchema,
  state: PriorityStepStateSchema,
  /** What this step settled, in the official's own words. Empty until worked. */
  summary: z.string().default(''),
  /** Why it is thin or back in doubt. Shown, never silently dropped. */
  caveat: z.string().optional(),
  updatedAt: z.string().optional(),
  // A check that fails to parse (a newer build's check state, say) drops on
  // its own instead of failing the step, which would empty the whole status.
  check: PriorityStepCheckSchema.optional().catch(undefined),
})
export type PriorityStep = z.infer<typeof PriorityStepSchema>

// 2: steps carry an optional `check`.
export const PRIORITY_STATUS_VERSION = 2

export const PriorityStatusSchema = z.object({
  version: z.number().int().default(PRIORITY_STATUS_VERSION),
  steps: z.array(PriorityStepSchema).default([]),
})
export type PriorityStatus = z.infer<typeof PriorityStatusSchema>

/** Every step open. What a priority starts life with. */
export const emptyPriorityStatus = (): PriorityStatus => ({
  version: PRIORITY_STATUS_VERSION,
  steps: PRIORITY_STEP_IDS.map((id) => ({ id, state: 'open', summary: '' })),
})

/**
 * Read a status column that may be null, may predate this schema, or may have
 * been written by a newer build. Never throws: an unreadable value degrades to
 * an empty status rather than breaking the page.
 */
export const parsePriorityStatus = (value: unknown): PriorityStatus => {
  const parsed = PriorityStatusSchema.safeParse(value)
  if (!parsed.success) return emptyPriorityStatus()
  // Fill in any step the stored value predates, so callers can always index
  // all seven.
  const byId = new Map(parsed.data.steps.map((s) => [s.id, s]))
  const steps = PRIORITY_STEP_IDS.map((id) => {
    const step = byId.get(id)
    return step === undefined
      ? { id, state: 'open' as const, summary: '' }
      : healCheck(step)
  })
  // Earlier builds let a listening step close before anyone answered; it
  // reads as still open, with what it settled kept.
  const checks = new Map(steps.map((step) => [step.id, step.check]))
  return {
    version: parsed.data.version,
    steps: steps.map((step) => {
      const gate = PRIORITY_LISTEN_GATES[step.id]
      return gate !== undefined &&
        step.state === 'settled' &&
        !isCheckAnswered(checks.get(gate))
        ? { ...step, state: 'open' as const }
        : step
    }),
  }
}
