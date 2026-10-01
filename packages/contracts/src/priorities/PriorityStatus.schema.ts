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
  /** The least-affected group. Dropped on its own if it fails to parse. */
  contrast: PriorityStepContrastSchema.optional().catch(undefined),
})
export type PriorityStepCheck = z.infer<typeof PriorityStepCheckSchema>

export const PriorityStepContrastInputSchema = z.object({
  state: PriorityCheckStateSchema,
  who: z.string().optional(),
  question: z.string().optional(),
  when: z.string().optional(),
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
  contrast: PriorityStepContrastInputSchema.optional(),
})
export type PriorityStepCheckInput = z.infer<
  typeof PriorityStepCheckInputSchema
>

const mergeContrast = (
  stored: PriorityStepContrast | undefined,
  patch: PriorityStepContrastInput | undefined,
): PriorityStepContrast | undefined => {
  if (patch === undefined) return stored
  const when = patch.when ?? stored?.when
  return {
    state: patch.state,
    who: patch.who ?? stored?.who ?? '',
    question: patch.question ?? stored?.question ?? '',
    ...(when === undefined ? {} : { when }),
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
): PriorityStepCheck | undefined => {
  if (patch === undefined) return stored
  const raisedAgain = stored?.state === 'deferred' && patch.state === 'deferred'
  const when = patch.when ?? stored?.when
  const contrast = mergeContrast(stored?.contrast, patch.contrast)
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
    ...(contrast === undefined ? {} : { contrast }),
  }
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
  return {
    version: parsed.data.version,
    steps: PRIORITY_STEP_IDS.map(
      (id) => byId.get(id) ?? { id, state: 'open' as const, summary: '' },
    ),
  }
}
