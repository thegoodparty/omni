import path from 'node:path'
import { z } from 'zod'
import { CaseListError, ChatAccountStateSchema } from './accountState'

// THE SHAPE OF A CASE IN cases/<agentId>.json, and the loader that reads one.
//
// These files are the case scout's inbox now: no judge runs them, and the
// harness that used to is gone. They stay because the publisher still appends
// to them, and because the scout's own bench reads them from this checkout
// (caseScoutBench/runner.ts) to check that a draft parses once appended.
//
// `/v1/chats` is the only route a case drives, so a case is a chat case and
// nothing here describes a background one.
export {
  CaseListError,
  ChatAccountStateSchema,
  type ChatAccountState,
} from './accountState'

// A caseId becomes a path segment in the file the publisher appends to, so it
// is held to the segment alphabet HERE, at the boundary where the file that
// carries it can be named.
const CASE_ID = /^[A-Za-z0-9_-]+$/

const CaseIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(
    CASE_ID,
    'a caseId becomes a path segment in the record store, so it may ' +
      'contain only letters, digits, underscore and hyphen',
  )

// A case list is authored text, and every case in one is a paid model call
// under a spending sweep.
export const MAX_CASE_TURNS = 10

// Long enough for a mutation excerpt and the axis it tests, short enough that
// it cannot become a second input competing with the case's own input for the
// judge's attention.
export const MAX_CONDITION_CHARS = 2_000

// One sentence, so a bound well short of a condition's.
export const MAX_HANDLED_WHEN_CHARS = 600

export const ChatCaseSchema = z
  .object({
    caseId: CaseIdSchema,
    // The single turn the agent is asked to take.
    question: z.string().min(1).optional(),
    // Several USER turns, posted in order to one conversation.
    turns: z.array(z.string().min(1)).min(1).max(MAX_CASE_TURNS).optional(),
    accountState: ChatAccountStateSchema.optional(),
    condition: z.string().trim().min(1).max(MAX_CONDITION_CHARS).optional(),
    handledWhen: z
      .string()
      .trim()
      .min(1)
      .max(MAX_HANDLED_WHEN_CHARS)
      .optional(),
    scored: z.boolean().optional(),
    // Provenance the case scout stamps on what it writes: whether a human
    // authored the case or the scout drafted it from a real production
    // failure, and which split it belongs to.
    source: z.enum(['authored', 'production']).optional(),
    split: z.enum(['tune', 'holdout']).optional(),
  })
  // STRICT, WHICH IS NOT THE SAME AS REQUIRING ANYTHING. Every field above is
  // optional, and what strict adds is that a MISSPELLED field name is refused
  // rather than stripped: a `priorTranscipt` would otherwise be dropped and the
  // case would carry no condition applied, silently.
  .strict()
  .refine((one) => (one.question === undefined) !== (one.turns === undefined), {
    message:
      'a chat case needs exactly one of `question` (one turn) or `turns` ' +
      '(several user turns in order); carrying both leaves which one the ' +
      'agent was asked undecided',
    path: ['question'],
  })
  .refine(
    (one) => one.handledWhen === undefined || one.condition !== undefined,
    {
      message: 'handledWhen describes handling a condition; add the condition',
      path: ['handledWhen'],
    },
  )
  .refine((one) => one.handledWhen === undefined || one.scored !== false, {
    message: 'a control (scored: false) carries no handledWhen',
    path: ['handledWhen'],
  })
export type ChatCase = z.infer<typeof ChatCaseSchema>

// `placeholder` is carried through to the report on purpose. A verdict drawn
// from a list somebody wrote to exercise the pipeline is not the same claim as
// one drawn from a list somebody wrote to test the agent, and the difference
// is invisible once it is a number in a table.
const CaseListEnvelopeSchema = z.object({
  agentId: z.string().min(1),
  shape: z.literal('chat'),
  placeholder: z.boolean().optional(),
  note: z.string().min(1).optional(),
  cases: z.array(z.record(z.string(), z.json())).min(1),
})

export interface CaseList {
  agentId: string
  placeholder: boolean
  note?: string
  cases: ChatCase[]
  // Where it came from, so an error downstream of here can still name the
  // file rather than only the case.
  source: string
}

// One place, because this sentence is what goes in front of a person after a
// paid-for sweep failed, and four copies of it drift.
const describeIssues = (issues: readonly z.core.$ZodIssue[]): string =>
  issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')

// Takes the text rather than the path so the whole parser is testable without
// a fixture file, and so the one place that reads the filesystem is below.
export const parseCaseList = (
  source: string,
  text: string,
  expected: { agentId: string },
): CaseList => {
  let json: z.infer<ReturnType<typeof z.json>>
  try {
    json = z.json().parse(JSON.parse(text))
  } catch (err) {
    throw new CaseListError(
      `${source}: not valid JSON — ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }

  const envelope = CaseListEnvelopeSchema.safeParse(json)
  if (!envelope.success) {
    throw new CaseListError(
      `${source}: not a case list — ${describeIssues(envelope.error.issues)}`,
    )
  }

  // Checked rather than trusted, because the caller is what decides which
  // agent's file this is. A list filed against another agent would otherwise
  // reach a runner that cannot read it, and fail there with no mention of
  // this file.
  if (envelope.data.agentId !== expected.agentId) {
    throw new CaseListError(
      `${source}: declares agentId "${envelope.data.agentId}" but the ` +
        `registry points ${expected.agentId} at it`,
    )
  }

  const cases: ChatCase[] = []
  const seen = new Set<string>()

  envelope.data.cases.forEach((raw, index) => {
    const parsed = ChatCaseSchema.safeParse(raw)
    if (!parsed.success) {
      // The index is always available; the id only when it is a string, which
      // is exactly the case where naming it helps.
      const id =
        typeof raw.caseId === 'string' ? ` (caseId "${raw.caseId}")` : ''
      throw new CaseListError(
        `${source}: case ${index}${id} is not a valid chat case — ` +
          describeIssues(parsed.error.issues),
      )
    }
    // Two cases under one id would collide on the key the publisher appends
    // under, and the second would silently overwrite the first.
    if (seen.has(parsed.data.caseId)) {
      throw new CaseListError(
        `${source}: case ${index} repeats caseId ` +
          `"${parsed.data.caseId}"; ids must be unique within a list ` +
          'because each one names a stored record',
      )
    }
    seen.add(parsed.data.caseId)
    cases.push(parsed.data)
  })

  return {
    agentId: envelope.data.agentId,
    placeholder: envelope.data.placeholder ?? false,
    ...(envelope.data.note !== undefined && { note: envelope.data.note }),
    cases,
    source,
  }
}

export const CASES_DIR = path.join(__dirname, 'cases')
