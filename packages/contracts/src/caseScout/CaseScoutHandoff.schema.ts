import { z } from 'zod'

// The case scout's nightly handoff from gp-api to the Delegate swarm, which
// writes the cases into the code-form chat suites and opens the PR. One batch
// per night, signed per the Standard Webhooks spec. Every free-text string
// here is a drafter-written string that passed the scout's PII gate
// (gp-api src/caseScout/util/gate.util.ts, `outboundStrings`); nothing in it
// points back at a conversation, a session or a user.

export const CASE_SCOUT_HANDOFF_VERSION = 1

// The code-form suites Delegate writes to, named as their files are:
// packages/gp-api/src/chats/general/*/<suite>.eval.ts.
export const CASE_SCOUT_SUITES = [
  'chief_of_staff',
  'campaign_assistant',
] as const
export const CaseScoutSuiteSchema = z.enum(CASE_SCOUT_SUITES)
export type CaseScoutSuite = z.infer<typeof CaseScoutSuiteSchema>

const SeveritySchema = z.int().min(0).max(3)

export const CaseScoutHandoffCaseSchema = z.strictObject({
  suite: CaseScoutSuiteSchema,
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/),
  turns: z.array(z.string().min(1)).min(1).max(10),
  grading: z.strictObject({
    condition: z.string().min(1).max(2_000),
    handledWhen: z.string().min(1).max(600),
  }),
  severity: SeveritySchema,
})
export type CaseScoutHandoffCase = z.infer<typeof CaseScoutHandoffCaseSchema>

// A failure the suite's fixture cannot reproduce yet: no case, only what the
// fixture would need.
export const CaseScoutHandoffNeedsSetupSchema = z.strictObject({
  suite: CaseScoutSuiteSchema,
  what: z.string().min(1),
  severity: SeveritySchema,
})
export type CaseScoutHandoffNeedsSetup = z.infer<
  typeof CaseScoutHandoffNeedsSetupSchema
>

export const CaseScoutHandoffSchema = z.strictObject({
  version: z.literal(CASE_SCOUT_HANDOFF_VERSION),
  // The UTC date of the night, yyyy-mm-dd.
  runId: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  environment: z.enum(['dev', 'prod']),
  cases: z.array(CaseScoutHandoffCaseSchema),
  needsSetup: z.array(CaseScoutHandoffNeedsSetupSchema),
})
export type CaseScoutHandoff = z.infer<typeof CaseScoutHandoffSchema>
