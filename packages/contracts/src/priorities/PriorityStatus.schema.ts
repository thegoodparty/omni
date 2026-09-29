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

export const PriorityStepSchema = z.object({
  id: PriorityStepIdSchema,
  state: PriorityStepStateSchema,
  /** What this step settled, in the official's own words. Empty until worked. */
  summary: z.string().default(''),
  /** Why it is thin or back in doubt. Shown, never silently dropped. */
  caveat: z.string().optional(),
  updatedAt: z.string().optional(),
})
export type PriorityStep = z.infer<typeof PriorityStepSchema>

export const PRIORITY_STATUS_VERSION = 1

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
