import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { OrdinanceFlowStepSchema } from '@goodparty_org/contracts'
import {
  AgentShapeSchema,
  JsonValueSchema,
  type AgentShape,
  type JsonValue,
} from './record'
import type { AgentEntry } from './agents'
import { DEFAULT_JUDGE_CONFIG, MAX_LIST_ATTEMPTS_PER_CASE } from './config'

// Loads an agent's inputs. One file per agent, authored per agent rather than
// coded, which is the property that makes wiring the twenty-first agent a case
// list plus a registry line.
//
// JSON rather than YAML. The TDD says YAML and also says a parser dependency
// is whichever track needs one to add; gp-api has no YAML parser and a case
// list is a flat list of strings, so JSON buys the same thing for free. The
// shape below is what a YAML file would have to deserialize to anyway, so
// swapping the reader later is a change to `parseCaseList`'s one caller.

// A caseId becomes a path segment in the record store and half of a record's
// `runId`, so it is held to the segment alphabet HERE, at the boundary where
// the file that carries it can be named. The store validates again — it has
// to, since it takes records from a runner too — but by then the error can
// only name a record.
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

// EVERY FIELD BELOW IS OPTIONAL, AND THAT IS A CROSS-CHECKOUT REQUIREMENT
// RATHER THAN A CONVENIENCE. A sweep's two arms are two checkouts at two
// commits, so the base ref parses its own copy of a case list with its own
// copy of this file. A required field arriving here reads, on an older base
// ref, as a case list that no longer validates — which is the break this
// stack has taken three times. See the note above `ChatCaseSchema`.

export const ToolFailureModeSchema = z.enum(['error', 'timeout'])
export type ToolFailureMode = z.infer<typeof ToolFailureModeSchema>

// Bounded because a case list is authored text: a directive that waited
// minutes would be indistinguishable from a wedged sweep.
export const MAX_TOOL_TIMEOUT_MS = 30_000
const DEFAULT_TOOL_TIMEOUT_MS = 50

// "Force the tool this request needs to fail" as something a runner can act
// on. The chat runner already wraps every tool's `execute` to record whether
// the step failed, so honouring this is a branch at that ONE seam rather than
// a second code path through the tools.
//
// NEITHER MODE RUNS THE REAL TOOL. An ordinance `present_*` tool commits its
// own record, and a case that says the tool failed must not leave that write
// behind.
//
// `timeout` reproduces the OUTCOME of a timeout — a tool step that rejected,
// which the AI SDK turns into a tool-error result while the loop carries on
// and answers with less information. It is not a real wall-clock hang: a hang
// would cost the route's whole stream timeout per case and arrive as an
// infraError with no answer to compare, which measures the harness rather
// than the agent.
export const ToolFailureSchema = z
  .object({
    // Checked against the tools the turn actually registered, not against a
    // list here: the tool set is assembled by the scope handler from its
    // context, so no static list could be right for every seed.
    tool: z.string().min(1),
    mode: ToolFailureModeSchema,
    // `timeout` only, and short by default. See above.
    afterMs: z.number().int().positive().max(MAX_TOOL_TIMEOUT_MS).optional(),
  })
  .strict()
  .refine((one) => one.mode === 'timeout' || one.afterMs === undefined, {
    message:
      'afterMs only means something for mode "timeout"; an "error" step ' +
      'throws before the real execute is reached and waits for nothing',
    path: ['afterMs'],
  })
export type ToolFailure = z.infer<typeof ToolFailureSchema>

// How long a forced timeout waits before rejecting.
export const toolFailureDelayMs = (failure: ToolFailure): number =>
  failure.mode === 'timeout' ? (failure.afterMs ?? DEFAULT_TOOL_TIMEOUT_MS) : 0

// "The capability exists but the user lacks access" as something a seeder can
// act on. A CLOSED SET, and `.strict()` is what keeps it closed: an open bag
// of column overrides would let a case list seed a state no deployment can
// produce, and the verdict would then be about an agent we do not ship.
//
// The states worth naming are the ones that decide which tools REGISTER,
// because tool registration is the only thing about an account the model can
// see. Each is read off a handler rather than invented:
//
//   pro             campaignManager.handler gates the whole CRM and
//                   voter-file family on `ctx.isPro !== false`.
//   district        `organization.positionId` is the half of the district
//                   gate that lives in our own database; without it
//                   resolveByOrgSlug returns null before it asks
//                   election-api anything, so `districtFilters` is null and
//                   the constituent-data pair registers on no scope.
//   campaignDetails the campaign's `details` blob carries `raceId`, which is
//                   what `get_ballot_requirements` registers on.
//   ordinanceStep   each ordinance step past clarify carries its own
//                   `present_*` tools and nothing else does.
//   briefingHighlight
//                   the one state here that registers no tool: it opens the
//                   briefing chat on a highlighted passage instead of the
//                   whole briefing, which is the other thing the briefing
//                   prompt renders differently. Like ordinanceStep it picks
//                   what the conversation is anchored on, and like it the
//                   runner reads the anchor back.
//
// Absent means "whatever the seeder seeds by default", which is every one of
// these present. Only an explicit `false` takes something away, so a case
// list that names none of them seeds exactly what it seeded before. The
// exception is briefingHighlight, whose default is the whole briefing: a
// highlight is something a user picks, not something an account has.
export const ChatAccountStateSchema = z
  .object({
    pro: z.boolean().optional(),
    district: z.boolean().optional(),
    campaignDetails: z.boolean().optional(),
    ordinanceStep: OrdinanceFlowStepSchema.optional(),
    briefingHighlight: z.boolean().optional(),
  })
  .strict()
  .refine((state) => Object.keys(state).length > 0, {
    message:
      'an empty accountState asks for nothing; omit the field rather than ' +
      'declaring a state the seeder cannot tell from the default',
  })
export type ChatAccountState = z.infer<typeof ChatAccountStateSchema>

// One row of a transcript the harness writes onto the record before the agent
// is asked anything, so a case can be answered MID-conversation.
//
// `toolCalls` carries the CALL and its input, which is what production stores:
// `onToolCallStart` pushes a tool segment and the result is streamed to the
// client without ever being persisted. A seeded turn therefore cannot carry a
// tool result, because a real one does not either.
export const SeededTurnSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    // Not `.min(1)` here: production persists a widget-only assistant turn
    // with empty content and replays it to nobody, and a seeded transcript
    // that could not express that would be the wrong shape. The refine below
    // is what keeps an empty row from being an authoring slip.
    content: z.string(),
    toolCalls: z
      .array(
        z
          .object({
            tool: z.string().min(1),
            input: JsonValueSchema,
          })
          .strict(),
      )
      .min(1)
      .optional(),
  })
  .strict()
  .refine((turn) => turn.role === 'assistant' || turn.toolCalls === undefined, {
    message: 'only an assistant turn can carry toolCalls',
    path: ['toolCalls'],
  })
  .refine(
    (turn) => turn.content.trim().length > 0 || turn.toolCalls !== undefined,
    {
      message:
        'a turn with no content and no toolCalls puts an empty row on the ' +
        'record, which reads as a turn that happened rather than one that ' +
        'was never written',
      path: ['content'],
    },
  )
export type SeededTurn = z.infer<typeof SeededTurnSchema>

// A TRANSCRIPT PRODUCTION COULD HAVE PRODUCED, which is narrower than a list
// of individually valid rows.
//
// `toLlmMessages` folds a LEADING assistant row into the system prompt,
// because Anthropic requires the replayed list to open on a user turn — and
// it folds only the first one. So a transcript opening on an assistant reply,
// or that puts two assistant rows together, leaves an assistant row as the
// first real message and the provider rejects the turn. That arrives as a
// stream error after the conversation is open and a turn has been attempted,
// which is exactly the spend this stack refuses before.
//
// The fold is also a reason not to WANT a leading assistant row: it is
// injected as "You already greeted the candidate with: …", so a case author
// writing "the agent already said X" would get a greeting claim instead — and
// on a Serve scope, one that calls an elected official a candidate.
//
// campaign_assistant is the case that makes this load-bearing rather than
// theoretical: its `seedConversation` writes a scripted assistant opener at
// POST /v1/chats, before anything here runs. With the rule below that opener
// is the row that gets folded and the seeded transcript follows it legally;
// without it, an author's leading assistant row is the SECOND one and the
// turn dies.
export const transcriptShapeIssue = (
  turns: readonly SeededTurn[],
): string | undefined => {
  if (turns[0]?.role !== 'user') {
    return (
      'a prior transcript has to open on a user turn: the replayed ' +
      'message list must, and a leading assistant row is folded into the ' +
      'system prompt as a greeting rather than replayed as a reply'
    )
  }
  const doubled = turns.findIndex(
    (turn, index) =>
      index > 0 &&
      turn.role === 'assistant' &&
      turns[index - 1]?.role === 'assistant',
  )
  return doubled === -1
    ? undefined
    : `rows ${doubled - 1} and ${doubled} are both assistant turns, which ` +
        'no conversation produces: the model answers a user turn, so two ' +
        'replies in a row leave an assistant message where the provider ' +
        'requires a user one'
}

// Ten turns is more conversation than any authored case needs and every one
// of them is a paid model call under a spending sweep.
export const MAX_CASE_TURNS = 10
// Against the route's own 40-message replay window, with room for the
// scripted opener campaign_assistant's handler seeds before anything here
// runs. The runner refuses the combination that would push a seeded row out
// of that window; this is only the authoring bound, and it is deliberately
// short of it rather than exactly on it.
export const MAX_SEEDED_TURNS = 18

// The case a chat agent is driven with.
//
// `question` STAYS VALID ON ITS OWN and is still what every authored list
// uses: nineteen case lists carry nothing else, and none of them needed
// editing for any of this. It is now optional only because `turns` is the
// general spelling of the same thing — the refine below requires exactly one
// of the two, so a case with neither is refused rather than driving an agent
// that was asked nothing.
export const ChatCaseSchema = z
  .object({
    caseId: CaseIdSchema,
    // The single turn the agent is asked to take.
    question: z.string().min(1).optional(),
    // Several USER turns, posted in order to one conversation. The route
    // persists history, so turn 2 already sees turn 1 and its reply; nothing
    // here hand-builds a context.
    turns: z.array(z.string().min(1)).min(1).max(MAX_CASE_TURNS).optional(),
    // A transcript written onto the record before the first driven turn, so
    // the agent answers mid-conversation.
    priorTranscript: z
      .array(SeededTurnSchema)
      .min(1)
      .max(MAX_SEEDED_TURNS)
      // superRefine rather than refine so the reason reaches the message: a
      // case list is authored text and "not a valid transcript" sends the
      // author back to read the code.
      .superRefine((turns, ctx) => {
        const issue = transcriptShapeIssue(turns)
        if (issue !== undefined) {
          ctx.addIssue({ code: 'custom', message: issue })
        }
      })
      .optional(),
    toolFailure: ToolFailureSchema.optional(),
    accountState: ChatAccountStateSchema.optional(),
  })
  // STRICT, WHICH IS NOT THE SAME AS REQUIRING ANYTHING. Every field above is
  // optional, which is what an older base ref needs. What strict adds is that
  // a MISSPELLED field name is refused rather than stripped: a
  // `priorTranscipt` would otherwise be dropped on both arms, the case would
  // run with no condition applied, and the pair would compare happily and be
  // reported as a verdict. The inner schemas are strict for the same reason,
  // and catch a typo inside a directive; this is what catches the directive's
  // own name.
  //
  // The cost is stated in the README: a field this ref does not know refuses
  // the whole list, which on an older base arm is a named skip for that agent
  // rather than a silently unconditioned comparison. That is the better of
  // the two failures.
  .strict()
  .refine((one) => (one.question === undefined) !== (one.turns === undefined), {
    message:
      'a chat case needs exactly one of `question` (one turn) or `turns` ' +
      '(several user turns in order); carrying both leaves which one the ' +
      'agent was asked undecided',
    path: ['question'],
  })
export type ChatCase = z.infer<typeof ChatCaseSchema>

// THE `input` PAYLOAD a chat case records when it uses any of the fields
// above, and the ONE schema both sides of it read: `runners/chat.ts` builds
// the value and `normalize.ts` renders it. A writer and a reader that
// described this shape separately would drift, and the record travels between
// two checkouts, so the drift would show up as a comparison refused for the
// wrong reason.
//
// `turns` is always present, even for a one-turn case: a case that uses any
// new field records the general shape, which is what makes an older base
// ref's plainer `{ kind: 'question' }` payload mismatch rather than compare.
//
// `.strict()`, and it is the guard rather than tidiness. The renderer's output
// is what `blindCase` compares across arms, so a field this schema stripped
// and the renderer therefore never printed would let two arms driven under
// DIFFERENT conditions compare as equal — the exact failure the payload
// exists to prevent, in the direction where the base ref is the newer one.
// Refused instead, which falls the renderer back to whole-value JSON and
// mismatches loudly.
export const TranscriptInputSchema = z
  .object({
    turns: z.array(z.string().min(1)).min(1),
    seededTranscript: z.array(SeededTurnSchema).min(1).optional(),
    toolFailure: ToolFailureSchema.optional(),
    accountState: ChatAccountStateSchema.optional(),
  })
  .strict()
export type TranscriptInput = z.infer<typeof TranscriptInputSchema>

// The case's user turns, in order. One list whichever spelling was used, so
// nothing downstream of here branches on which field the author picked.
//
// Throws rather than returning an empty list: `ChatCaseSchema` guarantees one
// of the two fields, but the TYPE has both optional, so a hand-built case in
// a test or a future caller can reach here with neither — and an empty list
// would drive a conversation of no turns and record it as a run.
export const caseTurns = (one: ChatCase): string[] => {
  if (one.turns !== undefined) return one.turns
  if (one.question !== undefined) return [one.question]
  throw new CaseListError(
    `${one.caseId} carries neither question nor turns, so there is no turn ` +
      'to drive',
  )
}

// Whether this case asked the harness to build any part of the agent's
// context by hand. Carried to the record, the manifest and the report: a
// verdict where the harness wrote half the transcript is not the same claim
// as one where production built all of it.
export const usesSeededTranscript = (one: ChatCase): boolean =>
  one.priorTranscript !== undefined

// A question the judge is asked about ONE case, beside the config's default
// dimensions. A probe tests a relationship between the artifact and an input
// the case mutated, and "is this a good artifact" is the wrong question for
// it: a polished artifact that glossed over a sparse input can read better
// than one that handled it.
//
// JUDGE-ONLY. The runner never reads it, so it never reaches the agent's
// params or a record. The judging step reads it from its own checkout's case
// list, keyed by caseId, and puts it on the one payload both slots share — so
// both runs are always judged on the same questions, and a base ref that
// predates the field strips it from a case the base arm never judges anyway.
//
// The reserved names are the keys a verdict already has. `overall` is
// judge.ts's OVERALL, spelled out because judge.ts imports this module.
const RESERVED_DIMENSIONS = new Set([
  ...DEFAULT_JUDGE_CONFIG.dimensions,
  'overall',
])

export const MAX_CASE_DIMENSIONS = 4

export const CaseDimensionSchema = z
  .object({
    // Becomes a key in the judge's output schema and a row in a public
    // report, so it is held to an identifier: a leading letter also rules
    // out `__proto__`, the one key `z.object` cannot require.
    name: z
      .string()
      .max(40)
      .regex(
        /^[a-z][a-z0-9_]*$/,
        'a case dimension name is a snake_case identifier',
      )
      .refine((name) => !RESERVED_DIMENSIONS.has(name), {
        message:
          'that name is already a dimension every case is judged on; a ' +
          'case dimension has to be a question of its own',
      }),
    question: z.string().min(1).max(400),
  })
  .strict()
export type CaseDimension = z.infer<typeof CaseDimensionSchema>

// Long enough for a mutation excerpt and the axis it tests, short enough that
// it cannot become a second input competing with the params for the judge's
// attention.
export const MAX_CONDITION_CHARS = 2_000

// One sentence, so a bound well short of a condition's.
export const MAX_HANDLED_WHEN_CHARS = 600

export const BackgroundCaseSchema = z
  .object({
    caseId: CaseIdSchema,
    // The parameters fixture the experiment is dispatched with. Opaque here
    // for the same reason a record's input is opaque: only the runner knows
    // what an experiment's params mean.
    params: z.record(z.string(), JsonValueSchema),
    // What this case planted in or took out of `params`, for the JUDGE. A
    // probe tests a relationship between the artifact and the input, and a
    // judge not told what was planted has to find it unaided inside tens of
    // thousands of characters of source text — or grade polish instead.
    //
    // NEVER DISPATCHED. The runner sends `params` and nothing else, so the
    // agent cannot read the answer key. The judging step reads this off the
    // case list in its own checkout and adds it to the shared input after
    // blinding, which is what makes it identical across arms: it is never
    // part of either arm's record, so a base ref that predates the field
    // cannot strip it from one side and turn every pair into a mismatch.
    condition: z.string().trim().min(1).max(MAX_CONDITION_CHARS).optional(),
    // What handling the condition looks like, as one sentence: "a run
    // handles this when …". Judge-only, like `condition`. Asked bare, the
    // judge grades whether a run MENTIONED the problem, so a run that quietly
    // resisted an injection read as not handling it; with the outcome stated,
    // it reads as handled. When present, the judge answers yes, partly or no
    // per run, and the report sorts the case into handled by both, a shared
    // failure, a regression or an improvement.
    handledWhen: z
      .string()
      .trim()
      .min(1)
      .max(MAX_HANDLED_WHEN_CHARS)
      .optional(),
    // `false` keeps the pair out of every aggregate. It still runs and is
    // still judged, and the report states that judgment on its own line: a
    // control's job is to be the zero reading, and averaged into the verdict
    // it is just one more case.
    scored: z.boolean().optional(),
    // Judge-only questions for this one case; see `CaseDimensionSchema`.
    dimensions: z
      .array(CaseDimensionSchema)
      .min(1)
      .max(MAX_CASE_DIMENSIONS)
      .refine(
        (dimensions) =>
          new Set(dimensions.map((d) => d.name)).size === dimensions.length,
        { message: 'a case names each of its dimensions once' },
      )
      .optional(),
  })
  // Strict for the reason `ChatCaseSchema` is: a misspelled `scored` would
  // otherwise be stripped and the control silently scored, and a misspelled
  // `condition` would send the judge in blind on the one case that needed it.
  .strict()
  // A handling sentence describes how a run deals with a planted condition,
  // so a case without one has nothing for it to describe. And a control is
  // the zero reading: asking it "did the run handle this" would hand the
  // judge a question whose only honest answer is "nothing to handle".
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
export type BackgroundCase = z.infer<typeof BackgroundCaseSchema>

// What the judging step needs from a case list beyond the records, keyed by
// caseId. Chat cases carry neither field, so a chat list yields an empty map.
export interface CaseJudging {
  condition?: string
  handledWhen?: string
  scored: boolean
}

export const caseJudgingOf = (list: CaseList): Map<string, CaseJudging> =>
  new Map(
    list.cases.flatMap((one) =>
      'params' in one
        ? [
            [
              one.caseId,
              {
                ...(one.condition !== undefined && {
                  condition: one.condition,
                }),
                ...(one.handledWhen !== undefined && {
                  handledWhen: one.handledWhen,
                }),
                scored: one.scored ?? true,
              },
            ],
          ]
        : [],
    ),
  )

export type JudgeCase = ChatCase | BackgroundCase

export const caseDimensionsOf = (one: JudgeCase): readonly CaseDimension[] =>
  'dimensions' in one ? (one.dimensions ?? []) : []

const CASE_SCHEMAS = {
  chat: ChatCaseSchema,
  background: BackgroundCaseSchema,
} as const

// `placeholder` is carried through to the report on purpose. A verdict drawn
// from a list somebody wrote to exercise the pipeline is not the same claim as
// one drawn from a list somebody wrote to test the agent, and the difference
// is invisible once it is a number in a table.
const CaseListEnvelopeSchema = z.object({
  agentId: z.string().min(1),
  shape: AgentShapeSchema,
  placeholder: z.boolean().optional(),
  note: z.string().min(1).optional(),
  // Background only: how many attempts every case in this list is walked
  // with, in place of the config's default. See MAX_LIST_ATTEMPTS_PER_CASE.
  attemptsPerCase: z.number().int().positive().optional(),
  cases: z.array(z.record(z.string(), JsonValueSchema)).min(1),
})

export interface CaseList {
  agentId: string
  shape: AgentShape
  placeholder: boolean
  note?: string
  attemptsPerCase?: number
  cases: JudgeCase[]
  // Where it came from, so an error downstream of here can still name the
  // file rather than only the case.
  source: string
}

export class CaseListError extends Error {}

// One place, because this sentence is what goes in front of a person after a
// paid-for sweep failed, and four copies of it drift.
export const describeIssues = (issues: readonly z.core.$ZodIssue[]): string =>
  issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')

// Takes the text rather than the path so the whole parser is testable without
// a fixture file, and so the one place that reads the filesystem is below.
export const parseCaseList = (
  source: string,
  text: string,
  expected: { agentId: string; shape: AgentShape },
): CaseList => {
  // Every JSON.parse result is a JsonValue by construction, so this schema
  // cannot reject one; it is here to give the value a type that is not `any`.
  let json: JsonValue
  try {
    json = JsonValueSchema.parse(JSON.parse(text))
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

  // Checked rather than trusted, because the registry is what decides which
  // runner drives the file. A chat list filed against a background agent would
  // otherwise reach a runner that cannot read it, and fail there with no
  // mention of this file.
  if (envelope.data.agentId !== expected.agentId) {
    throw new CaseListError(
      `${source}: declares agentId "${envelope.data.agentId}" but the ` +
        `registry points ${expected.agentId} at it`,
    )
  }
  if (envelope.data.shape !== expected.shape) {
    throw new CaseListError(
      `${source}: declares shape "${envelope.data.shape}" but ` +
        `${expected.agentId} is a ${expected.shape} agent`,
    )
  }

  // Refused by name rather than clamped: a list asking for five attempts and
  // walked with three would bill for less than it asked and report as though
  // it got what it asked for.
  const listAttempts = envelope.data.attemptsPerCase
  if (listAttempts !== undefined) {
    if (envelope.data.shape !== 'background') {
      throw new CaseListError(
        `${source}: sets attemptsPerCase, which only a background list may ` +
          "set; a chat list's attempts are the config's",
      )
    }
    if (listAttempts > MAX_LIST_ATTEMPTS_PER_CASE) {
      throw new CaseListError(
        `${source}: asks for ${listAttempts} attempts per case, over the ` +
          `ceiling of ${MAX_LIST_ATTEMPTS_PER_CASE} in config.ts`,
      )
    }
  }

  const schema = CASE_SCHEMAS[envelope.data.shape]
  const cases: JudgeCase[] = []
  const seen = new Set<string>()
  const questions = new Map<string, string>()

  envelope.data.cases.forEach((raw, index) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      // The index is always available; the id only when it is a string, which
      // is exactly the case where naming it helps.
      const id =
        typeof raw.caseId === 'string' ? ` (caseId "${raw.caseId}")` : ''
      throw new CaseListError(
        `${source}: case ${index}${id} is not a valid ` +
          `${envelope.data.shape} case — ` +
          describeIssues(parsed.error.issues),
      )
    }
    // Two cases under one id would collide on the record store key and the
    // second would silently overwrite the first, which reads downstream as a
    // sweep that ran fewer cases than it was billed for.
    if (seen.has(parsed.data.caseId)) {
      throw new CaseListError(
        `${source}: case ${index} repeats caseId ` +
          `"${parsed.data.caseId}"; ids must be unique within a list ` +
          'because each one names a stored record',
      )
    }
    seen.add(parsed.data.caseId)
    // One name is one row in the report, aggregated across every case that
    // carries it, so two cases asking different questions under it would be
    // averaged into a number that answers neither.
    for (const dimension of caseDimensionsOf(parsed.data)) {
      const asked = questions.get(dimension.name)
      if (asked !== undefined && asked !== dimension.question) {
        throw new CaseListError(
          `${source}: case ${index} asks dimension "${dimension.name}" a ` +
            'different question than an earlier case; one name is one ' +
            'row in the report, so give a different question its own name',
        )
      }
      questions.set(dimension.name, dimension.question)
    }
    cases.push(parsed.data)
  })

  return {
    agentId: envelope.data.agentId,
    shape: envelope.data.shape,
    placeholder: envelope.data.placeholder ?? false,
    ...(envelope.data.note !== undefined && { note: envelope.data.note }),
    ...(listAttempts !== undefined && { attemptsPerCase: listAttempts }),
    cases,
    source,
  }
}

export const CASES_DIR = path.join(__dirname, 'cases')

// Resolved under CASES_DIR and required to stay there: `cases` is a registry
// string, and a registry string that could address `../../../etc` would make
// the case list a file-read primitive.
export const caseListPath = (
  cases: string,
  dir: string = CASES_DIR,
): string => {
  const resolved = path.resolve(dir, cases)
  const root = path.resolve(dir)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new CaseListError(
      `case list "${cases}" resolves outside ${root}; a registry entry ` +
        'names a file in the case-list directory, not a path',
    )
  }
  return resolved
}

export const loadCaseList = (
  agent: AgentEntry,
  dir: string = CASES_DIR,
): CaseList => {
  if (agent.cases === null) {
    throw new CaseListError(
      `${agent.agentId} has no case list yet, so it has no inputs and ` +
        'there is nothing to compare',
    )
  }
  const file = caseListPath(agent.cases, dir)
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    throw new CaseListError(
      `${file}: cannot be read — ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  return parseCaseList(file, text, {
    agentId: agent.agentId,
    shape: agent.shape,
  })
}

// Which shape a loaded case is. Discriminated on the BACKGROUND field, not on
// a chat one: every field of a chat case except its id is optional now, so the
// absence of any one of them proves nothing. `params` is required of a
// background case and impossible on a chat one, which makes it the only
// structural discriminator left.
export const isChatCase = (one: JudgeCase): one is ChatCase =>
  !('params' in one)

// A background agent's cases, narrowed. `parseCaseList` already discriminated
// on `shape` when it built these, so re-deriving the narrowing structurally in
// each reader was both duplicated and weaker than what the loader knows.
export const loadBackgroundCases = (
  agent: AgentEntry,
  dir: string = CASES_DIR,
): BackgroundCase[] => {
  const list = loadCaseList(agent, dir)
  if (list.shape !== 'background') {
    throw new CaseListError(
      `${list.source}: ${agent.agentId} is a ${list.shape} agent, so its ` +
        'cases have no params to read',
    )
  }
  return list.cases.map((one) => {
    if (!('params' in one)) {
      throw new CaseListError(
        `${list.source}: ${agent.agentId}/${one.caseId} carries no params`,
      )
    }
    return one
  })
}
