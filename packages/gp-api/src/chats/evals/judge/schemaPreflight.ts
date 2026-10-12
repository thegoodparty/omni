import { MAX_CASE_DIMENSIONS, type CaseDimension } from './cases'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import {
  caseVerdictSchemaFor,
  dimensionsFor,
  judgeCase,
  type PlannedJudgment,
} from './judge'
import type { JudgePayload } from './normalize'
import { anthropicJudge } from './sweep'
import { priceUsd, UnpriceableRunError } from './pricing'
import type { JsonJudgeModel } from '../../general/ordinance-flow/evals/coldJudge'

// ONE REAL PANEL CALL WITH THE LARGEST SCHEMA THE JUDGE CAN SEND, before a
// sweep spends anything and after every change to the judge reaches main.
//
// Every other judge test drives a fake model, which never sees the JSON
// Schema the request carries. That is how #2497 and #2498 shipped a verdict
// schema every real call refused (too many optional parameters, then a
// compiled grammar too large at four case dimensions): the suite was green
// and every judgment of the next sweep came back ungraded. Counting the
// schema offline catches the documented limits; only the API knows the rest.
//
// The call goes through `judgeCase`, the panel's own path, so the messages,
// the schema conversion, the seats and the retry budget are exactly what a
// sweep sends. The payload is canned and tiny, so nothing it prints can carry
// a record or an agent's answer.

const PREFLIGHT_CASE_ID = 'schema-preflight'

// The case's own dimensions at the most a case list may carry, each at the
// longest name and question CaseDimensionSchema accepts. A name is a key in
// the schema, so its length is grammar size, and each dimension repeats the
// dimension object, which is what pushed the grammar over the API's limit.
export const preflightCaseDimensions = (): CaseDimension[] =>
  Array.from({ length: MAX_CASE_DIMENSIONS }, (_, index) => ({
    name: `preflight_dimension_${index + 1}_`.padEnd(40, 'x'),
    question: 'Does the run state the date it was generated?'.padEnd(
      400,
      ' And does it say where that date came from?',
    ),
  }))

// Every optional part of the request switched on: case dimensions at the
// maximum and a handling sentence, which makes the per-run `handled` fields
// required. Flags and the absolute floor are in every verdict schema.
export const preflightPayload = (): JudgePayload => {
  const handledWhen =
    'a run handles this when it says the two sources disagree.'
  return {
    agentId: 'schema_preflight',
    agentShape: 'background',
    caseId: PREFLIGHT_CASE_ID,
    sharedInput: [
      'Write one sentence about the opponent.',
      '',
      'Condition: two sources disagree about the opponent’s office.',
      `For this case, a run handles the condition when: ${handledWhen}`,
    ].join('\n'),
    runs: [
      {
        id: 'X',
        finalOutput: '{"summary": "The sources disagree."}',
        truncatedChars: 0,
      },
      {
        id: 'Y',
        finalOutput: '{"summary": "He is a commissioner."}',
        truncatedChars: 0,
      },
    ],
    caseDimensions: preflightCaseDimensions(),
    handledWhen,
  }
}

// The schema the call carries, exposed so a test can hold it to the maximum
// without making the call.
export const preflightDimensions = (
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
): string[] => dimensionsFor(preflightPayload(), config)

export const preflightSchema = (config: JudgeConfig = DEFAULT_JUDGE_CONFIG) =>
  caseVerdictSchemaFor(preflightDimensions(config), true)

// The limits the API names when it refuses a schema, matched on the API's
// own wording. The message printed is OURS, never the refusal text: omni is
// public, and a fixed sentence is the only thing that can safely reach a
// log here.
const KNOWN_LIMITS: readonly [RegExp, string][] = [
  [/optional parameters/i, 'too many optional parameters'],
  [/union/i, 'too many union parameters'],
  [/grammar/i, 'compiled grammar too large'],
  [/no verdict matching the rubric/i, 'a verdict that does not match it'],
]

export const refusalClass = (reason: string): string =>
  KNOWN_LIMITS.find(([pattern]) => pattern.test(reason))?.[1] ??
  'an error this check does not recognise'

export interface PreflightResult {
  ok: boolean
  message: string
  // What the call cost, priced from the tokens the model reported. Absent
  // when the call never returned usage.
  usd?: number
}

export const runPreflight = async (
  llm: JsonJudgeModel,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
): Promise<PreflightResult> => {
  let usd: number | undefined
  const metered: JsonJudgeModel = {
    jsonCompletion: async (options) => {
      const result = await llm.jsonCompletion(options)
      // Priced best-effort: an unpriced seat model must not fail a check
      // whose job is the schema, so it leaves the cost unreported instead.
      if (
        result.inputTokens !== undefined &&
        result.outputTokens !== undefined
      ) {
        try {
          usd =
            (usd ?? 0) +
            priceUsd(
              {
                input: result.inputTokens,
                output: result.outputTokens,
                cacheRead: 0,
                cacheWrite: 0,
              },
              result.model,
            )
        } catch (err) {
          if (!(err instanceof UnpriceableRunError)) throw err
          usd = undefined
        }
      }
      return result
    },
  }
  const planned: PlannedJudgment = {
    key: { caseId: PREFLIGHT_CASE_ID, attempt: 1, order: 'primary' },
    payload: preflightPayload(),
    slotMap: { X: 'base', Y: 'candidate' },
  }
  const judgment = await judgeCase(metered, planned, config)
  if (judgment.kind === 'ungraded') {
    return {
      ok: false,
      usd,
      message:
        'The judge panel schema was refused by the model API ' +
        `(${refusalClass(judgment.reason)}), so every judgment of a sweep ` +
        'would come back ungraded. Nothing has been dispatched.',
    }
  }
  // Every seat has to accept it. A sweep with one refusing seat loses that
  // seat on every judgment, which shrinks the panel without saying so.
  const [refused] = judgment.seatFailures
  if (refused !== undefined) {
    return {
      ok: false,
      usd,
      message:
        'One judge panel seat refused the schema ' +
        `(${refusalClass(refused.message)}), so it would drop out of every ` +
        'judgment of a sweep. Nothing has been dispatched.',
    }
  }
  // Read off each seat's own verdict, not the combined one: combining walks
  // the dimension list it is given, so it would name every dimension whether
  // or not a seat answered it.
  const incomplete = judgment.seats.some(
    ({ verdict }) =>
      verdict.handled === undefined ||
      preflightDimensions(config).some(
        (name) => !Object.hasOwn(verdict.dimensions, name),
      ),
  )
  if (incomplete) {
    return {
      ok: false,
      usd,
      message:
        'The judge panel answered, but its verdict is missing a field the ' +
        'schema requires, so scoring would misread every judgment. Nothing ' +
        'has been dispatched.',
    }
  }
  return {
    ok: true,
    usd,
    message:
      'The model API accepted the largest judge panel schema ' +
      `(${preflightDimensions(config).length} dimensions plus the per-run ` +
      'handled fields) and returned a verdict that parses.',
  }
}

const formatUsd = (usd: number | undefined): string =>
  usd === undefined ? 'cost not reported' : `cost $${usd.toFixed(4)}`

// Spends only when asked, the same switch the arms and the judging step
// read, so a dry sweep or a local run without the switch makes no call.
export const main = async (): Promise<number> => {
  if (process.env.JUDGE_SPEND !== 'true') {
    console.log('schema preflight skipped: JUDGE_SPEND is not true')
    return 0
  }
  const config = DEFAULT_JUDGE_CONFIG
  const result = await runPreflight(anthropicJudge(config), config)
  if (result.ok) {
    console.log(`${result.message} (${formatUsd(result.usd)})`)
    return 0
  }
  console.error(`::error::${result.message}`)
  return 1
}

// Never the error itself, and deliberately: it can carry the API's response,
// and this runs where anyone can read the log. The exit code still fails the
// step.
export const UNEXPECTED_FAILURE =
  '::error::The judge schema preflight could not complete its call. ' +
  'Nothing has been dispatched.'

export const exitCodeOf = async (
  run: () => Promise<number> = main,
): Promise<number> => {
  try {
    return await run()
  } catch {
    console.error(UNEXPECTED_FAILURE)
    return 1
  }
}

if (require.main === module) {
  void exitCodeOf().then((code) => {
    process.exitCode = code
  })
}
