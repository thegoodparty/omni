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

// A state of the account a chat case starts from, beyond what its scope sets
// up by default, and only what a chat arm can make through the product's own
// routes. A CLOSED SET, and `.strict()` is what keeps it closed: a key no arm
// sets up would let a case claim a state the agent was never in.
//
//   briefingHighlight
//                   opens the briefing chat on a highlighted passage instead
//                   of the whole briefing, which the briefing prompt renders
//                   differently. Set up by the anchor POST /v1/briefing-chats
//                   takes, so it means something on briefing_annotation only.
//
// Absent means the whole briefing.
export const ChatAccountStateSchema = z
  .object({
    briefingHighlight: z.boolean().optional(),
  })
  .strict()
  .refine((state) => Object.keys(state).length > 0, {
    message:
      'an empty accountState asks for nothing; omit the field rather than ' +
      'declaring a state the runner cannot tell from the default',
  })
export type ChatAccountState = z.infer<typeof ChatAccountStateSchema>

// Ten turns is more conversation than any authored case needs and every one
// of them is a paid model call under a spending sweep.
export const MAX_CASE_TURNS = 10

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
// it cannot become a second input competing with the case's own input for the
// judge's attention.
export const MAX_CONDITION_CHARS = 2_000

// One sentence, so a bound well short of a condition's.
export const MAX_HANDLED_WHEN_CHARS = 600

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
    accountState: ChatAccountStateSchema.optional(),
    // The same four judge-only fields a background case carries, with the
    // same bounds; see BackgroundCaseSchema. The runner never reads them, so
    // a turn is driven the same way with or without them.
    condition: z.string().trim().min(1).max(MAX_CONDITION_CHARS).optional(),
    handledWhen: z
      .string()
      .trim()
      .min(1)
      .max(MAX_HANDLED_WHEN_CHARS)
      .optional(),
    scored: z.boolean().optional(),
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

// THE `input` PAYLOAD a chat case records when it uses `turns` or
// `accountState`, and the ONE schema both sides of it read: the chat runner builds the value and
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

// A page the broker serves both arms in place of the live one. The URL has to
// be in the broker's normalized form already (gp-ai
// `broker/page_replay.normalize_url`), because the store is keyed by its hash
// and the broker hashes the normalized form of what the agent asks for. So:
// https, a lowercase host, no fragment, and a query of plain pairs in sorted
// order with no tracking parameters. A broker test reads every committed
// seeded URL and checks it normalizes to itself.
// No port and a path that starts with `/`: the broker keeps both as written,
// so `https://a.gov` and `https://a.gov/` would be two different pages.
const SEED_QUERY_PAIR = '[A-Za-z0-9._-]+=[A-Za-z0-9._-]*'
const SEED_URL = new RegExp(
  "^https://[a-z0-9.-]+/[A-Za-z0-9._~!$'()*+,;=:@%/-]*" +
    `(?:\\?${SEED_QUERY_PAIR}(?:&${SEED_QUERY_PAIR})*)?$`,
)
const TRACKING_PARAM = /^(?:utm_.*|fbclid|gclid)$/i

export const MAX_SEED_PAGES = 20
export const MAX_SEED_PAGE_BYTES = 1024 * 1024

const queryInBrokerOrder = (url: string): boolean => {
  const query = url.split('?')[1]
  if (query === undefined) return true
  const pairs = query.split('&').map((pair) => {
    const [name = '', value = ''] = pair.split('=')
    return [name, value] as const
  })
  const sorted = [...pairs].sort(([a, x], [b, y]) => {
    if (a !== b) return a < b ? -1 : 1
    if (x === y) return 0
    return x < y ? -1 : 1
  })
  return (
    pairs.every(([name]) => !TRACKING_PARAM.test(name)) &&
    pairs.every(([name, value], i) => {
      const [sortedName, sortedValue] = sorted[i] ?? ['', '']
      return name === sortedName && value === sortedValue
    })
  )
}

export const SeedPageSchema = z
  .object({
    url: z
      .string()
      .max(2_000)
      .regex(SEED_URL, {
        message:
          'must be an https URL in the broker normalized form: lowercase ' +
          'host, no fragment, a plain query',
      })
      .refine(queryInBrokerOrder, {
        message:
          'query parameters must be sorted by name, then value, with no ' +
          'utm_*, fbclid or gclid',
      }),
    // A file under `cases/seeds/<agentId>/`, committed beside the list. omni
    // is public, so it holds only content fine to publish.
    file: z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/, {
      message: 'is a file name in cases/seeds/<agentId>/, not a path',
    }),
    // Text only: the page is read and planted as UTF-8, and `http.get`
    // refuses a binary response anyway.
    contentType: z
      .enum(['text/html', 'text/plain', 'application/json', 'application/xml'])
      .optional(),
  })
  .strict()
export type SeedPage = z.infer<typeof SeedPageSchema>

export const BackgroundCaseSchema = z
  .object({
    caseId: CaseIdSchema,
    // The parameters fixture the experiment is dispatched with. Opaque here
    // for the same reason a record's input is opaque: only the runner knows
    // what an experiment's params mean.
    params: z.record(z.string(), JsonValueSchema),
    // Files the runner stages into the agent's workspace before it boots,
    // the hold-still route for an agent that reads a user-supplied document:
    // both arms read the same object. The runner already carries and checks
    // the field at dispatch (dest a plain filename, the key's length, the
    // count, no placeholder token); until now no authored list carried it,
    // and a strict schema without it refused the first one. The three names
    // are the dispatch handler's own. Strict, like the case: a misspelled
    // `dest` would otherwise stage the file under a name the agent never
    // reads and the case would run as if nothing had been supplied.
    inputFiles: z
      .array(
        z
          .object({
            bucket: z.string().min(1),
            key: z.string().min(1),
            dest: z.string().min(1),
          })
          .strict(),
      )
      .min(1)
      .optional(),
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
    // Pages both arms are served instead of the live web, so a bench can
    // plant content: a hidden instruction, a namesake, a stale page, two
    // sources that disagree. Dispatched as a page replay store, never as
    // params, so the agent fetches them like any other page.
    seedPages: z
      .array(SeedPageSchema)
      .min(1)
      .max(MAX_SEED_PAGES)
      .refine(
        (pages) => new Set(pages.map((p) => p.url)).size === pages.length,
        { message: 'a case seeds each URL once' },
      )
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
// caseId.
export interface CaseJudging {
  condition?: string
  handledWhen?: string
  scored: boolean
}

export const caseJudgingOf = (list: CaseList): Map<string, CaseJudging> =>
  new Map(
    list.cases.map((one) => [
      one.caseId,
      {
        ...(one.condition !== undefined && { condition: one.condition }),
        ...(one.handledWhen !== undefined && {
          handledWhen: one.handledWhen,
        }),
        scored: one.scored ?? true,
      },
    ]),
  )

export type JudgeCase = ChatCase | BackgroundCase

export const caseDimensionsOf = (one: JudgeCase): readonly CaseDimension[] =>
  one.dimensions ?? []

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

export const SEEDS_DIR = 'seeds'

export interface SeededPage {
  url: string
  contentType: string
  body: string
}

export const loadSeedPages = (
  agentId: string,
  one: BackgroundCase,
  dir: string = CASES_DIR,
): SeededPage[] =>
  (one.seedPages ?? []).map((page) => {
    const file = caseListPath(path.join(SEEDS_DIR, agentId, page.file), dir)
    let body: string
    try {
      body = readFileSync(file, 'utf8')
    } catch (err) {
      throw new CaseListError(
        `${agentId}/${one.caseId} seeds ${page.url} from ${file}, which ` +
          `cannot be read — ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    if (Buffer.byteLength(body, 'utf8') > MAX_SEED_PAGE_BYTES) {
      throw new CaseListError(
        `${file} is over ${MAX_SEED_PAGE_BYTES} bytes; a seeded page is ` +
          'one page, not a download',
      )
    }
    return {
      url: page.url,
      contentType: page.contentType ?? 'text/html',
      body,
    }
  })

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
