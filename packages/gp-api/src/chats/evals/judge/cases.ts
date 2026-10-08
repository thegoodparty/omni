import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import {
  AgentShapeSchema,
  JsonValueSchema,
  type AgentShape,
  type JsonValue,
} from './record'
import type { AgentEntry } from './agents'
import { DEFAULT_JUDGE_CONFIG } from './config'

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

// Ten turns is more conversation than any authored case needs and every one
// of them is a paid model call under a spending sweep.
export const MAX_CASE_TURNS = 10

// The case a chat agent is driven with.
//
// `question` STAYS VALID ON ITS OWN and is still what every authored list
// uses: nineteen case lists carry nothing else, and none of them needed
// editing for it. It is now optional only because `turns` is the
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
  })
  // STRICT, WHICH IS NOT THE SAME AS REQUIRING ANYTHING. Every field above is
  // optional, which is what an older base ref needs. What strict adds is that
  // a MISSPELLED field name is refused rather than stripped, so a typo
  // cannot silently change what a case asks on both arms.
  //
  // The cost is stated in the README: a field this ref does not know refuses
  // the whole list, which on an older base arm is a named skip for that agent
  // rather than a silently different comparison. That is the better of the
  // two failures.
  .strict()
  .refine((one) => (one.question === undefined) !== (one.turns === undefined), {
    message:
      'a chat case needs exactly one of `question` (one turn) or `turns` ' +
      '(several user turns in order); carrying both leaves which one the ' +
      'agent was asked undecided',
    path: ['question'],
  })
export type ChatCase = z.infer<typeof ChatCaseSchema>

// THE `input` PAYLOAD a chat case records when it uses `turns`, and the ONE
// schema both sides of it read: the chat runner builds the value and
// `normalize.ts` renders it. A writer and a reader that described this shape
// separately would drift, and the record travels between two checkouts, so
// the drift would show up as a comparison refused for the wrong reason.
//
// `.strict()`, and it is the guard rather than tidiness. The renderer's output
// is what `blindCase` compares across arms, so a field this schema stripped
// and the renderer therefore never printed would let two arms driven under
// DIFFERENT conditions compare as equal. Refused instead, which falls the
// renderer back to whole-value JSON and mismatches loudly.
export const TranscriptInputSchema = z
  .object({
    turns: z.array(z.string().min(1)).min(1),
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
export type BackgroundCase = z.infer<typeof BackgroundCaseSchema>

// What the judging step needs from a case list beyond the records, keyed by
// caseId. Chat cases carry neither field, so a chat list yields an empty map.
export interface CaseJudging {
  condition?: string
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
  cases: z.array(z.record(z.string(), JsonValueSchema)).min(1),
})

export interface CaseList {
  agentId: string
  shape: AgentShape
  placeholder: boolean
  note?: string
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
