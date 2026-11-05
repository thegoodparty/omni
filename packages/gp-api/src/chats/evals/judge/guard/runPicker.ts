import {
  buildPickerUserPrompt,
  finalAgentSet,
  PICKER_SYSTEM_PROMPT,
  PickerOutputSchema,
  truncateDiff,
  validatePickerOutput,
  type Addition,
  type PickerOutput,
} from './picker'
import type { CodeMapRow } from './codeMap'
import {
  recordPickerFailure,
  type FailureLogPort,
  type PickerFailure,
} from './pickerFailures'
import { postPickerFailureAlert, type SlackAlertEnv } from './slackAlert'

// The failure-handling table this module implements end to end (TDD "When
// the picker fails"; Implementation Notes 2.5's table; this story's own
// Implementation Details). Every row the story covers maps to one branch of
// `runPicker` below:
//
//   The call errors or times out            -> retries once, falls back to
//                                               floor, "Picker unavailable,
//                                               ran path-matched agents only"
//   Output isn't JSON / fails the shape     -> same, plus the raw output is
//                                               saved to the judge records
//                                               bucket by the caller
//   An added id isn't in the registry       -> dropped, the rest kept, the
//                                               dropped id named
//   No path match, and the picker failed    -> passes with no sweep,
//                                               "Couldn't check shared code.
//                                               Comment /judge for a plan."
//   The diff was cut at the size limit      -> runs normally, "Diff
//                                               truncated" noted
//
// The $50-spend-cap row in the Implementation Notes' table is not here: this
// story never calls judge.yml (that wiring, and the cost estimate it needs,
// is ENG-11592's job), so there is no plan to price yet. This story's own
// Acceptance Criteria list the five rows above, not that one.

export type PickerFailureReason = PickerFailure['reason']

export interface PickerCallResult {
  readonly raw: string
}

// Injected so the orchestrator never imports LlmService (or any Nest
// construct) itself — the CLI entry point below wires the real model call;
// tests wire a fake one. Thrown errors are the "errors or times out" row;
// a resolved value that is not valid JSON in the picker's shape is the
// "isn't JSON or fails the shape" row — both are handled the same way here.
export type CallPicker = (prompt: {
  system: string
  user: string
}) => Promise<PickerCallResult>

export interface RunPickerInput {
  readonly pr: number
  readonly runId: string
  readonly changedPaths: readonly string[]
  readonly diff: string
  readonly floor: readonly string[]
  readonly codeMap: readonly CodeMapRow[]
  readonly registryIds: readonly string[]
  readonly now: Date
}

export interface RunPickerDeps {
  readonly callPicker: CallPicker
  readonly failureLog: FailureLogPort
  readonly slackEnv: SlackAlertEnv
  readonly postAlert?: typeof postPickerFailureAlert
}

export interface RunPickerResult {
  readonly finalAgents: readonly string[]
  readonly added: readonly Addition[]
  readonly droppedIds: readonly string[]
  readonly pickerStatus: 'ok' | 'failed'
  readonly diffTruncated: boolean
  readonly checkConclusion: 'success' | 'neutral'
  readonly checkTitle: string
  readonly checkSummary: string
}

const PICKER_UNAVAILABLE_NOTE =
  'Picker unavailable, ran path-matched agents only'

const NO_SWEEP_NOTE = "Couldn't check shared code. Comment `/judge` for a plan."

const parsePickerOutput = (
  raw: string,
): { ok: true; output: PickerOutput } | { ok: false; detail: string } => {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (err) {
    return {
      ok: false,
      detail: `not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  const parsed = PickerOutputSchema.safeParse(json)
  if (!parsed.success) {
    return { ok: false, detail: parsed.error.message }
  }
  return { ok: true, output: parsed.data }
}

// Retries once (TDD: "the guard retries once, then runs the path-matched
// agents and says so"). This is job-internal error handling, not a person
// re-running a red check, so it does not run against this repo's
// never-re-run-a-red-check policy — same reasoning the TDD itself gives.
const callPickerWithRetry = async (
  callPicker: CallPicker,
  prompt: { system: string; user: string },
): Promise<
  | { ok: true; output: PickerOutput }
  | { ok: false; reason: PickerFailureReason; detail: string }
> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string
    try {
      raw = (await callPicker(prompt)).raw
    } catch (err) {
      if (attempt === 1) {
        return {
          ok: false,
          reason: 'timeout_or_error',
          detail: err instanceof Error ? err.message : String(err),
        }
      }
      continue
    }
    const parsed = parsePickerOutput(raw)
    if (parsed.ok) return parsed
    if (attempt === 1) {
      return { ok: false, reason: 'invalid_shape', detail: raw }
    }
  }
  // Unreachable — the loop above always returns on its second iteration —
  // but TypeScript cannot see that, and throwing here beats an
  // unsound `as` cast.
  throw new Error('callPickerWithRetry: exhausted attempts without a result')
}

export const runPicker = async (
  input: RunPickerInput,
  deps: RunPickerDeps,
): Promise<RunPickerResult> => {
  const { diff, truncated } = truncateDiff(input.diff)
  const prompt = {
    system: PICKER_SYSTEM_PROMPT,
    user: buildPickerUserPrompt({
      changedPaths: input.changedPaths,
      diff,
      diffTruncated: truncated,
      floor: input.floor,
      codeMap: input.codeMap,
      registryIds: input.registryIds,
    }),
  }

  const result = await callPickerWithRetry(deps.callPicker, prompt)
  const diffNote = truncated ? ' Diff truncated.' : ''

  if (!result.ok) {
    // Bookkeeping, not the result: a bucket the credentials step could not
    // reach (judge.yml's own "Choose where records are kept" accepts the
    // same risk for the sweep) must never turn a model failure into a job
    // failure — that would be the one way this story could still block a
    // PR despite every other branch resolving.
    try {
      const postAlert = deps.postAlert ?? postPickerFailureAlert
      const { shouldAlert } = await recordPickerFailure(deps.failureLog, {
        pr: input.pr,
        runId: input.runId,
        timestamp: input.now.toISOString(),
        reason: result.reason,
        detail: result.detail,
      })
      if (shouldAlert) {
        await postAlert(
          deps.slackEnv,
          `Universal judge guard: the picker has failed twice in the last 7 ` +
            `days. Latest: PR #${input.pr}, run ${input.runId} (${result.reason}). ` +
            'This likely means a broken prompt or a model change.',
        )
      }
    } catch (err) {
      console.error(
        '::warning::guard picker: could not record/alert on a picker ' +
          `failure, continuing with the floor-only result: ${
            err instanceof Error ? err.message : String(err)
          }`,
      )
    }

    if (input.floor.length === 0) {
      return {
        finalAgents: [],
        added: [],
        droppedIds: [],
        pickerStatus: 'failed',
        diffTruncated: truncated,
        checkConclusion: 'success',
        checkTitle: 'No sweep',
        checkSummary: `${NO_SWEEP_NOTE}${diffNote}`,
      }
    }
    return {
      finalAgents: input.floor,
      added: [],
      droppedIds: [],
      pickerStatus: 'failed',
      diffTruncated: truncated,
      checkConclusion: 'neutral',
      checkTitle: `Floor matched: ${input.floor.join(', ')}`,
      checkSummary: `${PICKER_UNAVAILABLE_NOTE}${diffNote}`,
    }
  }

  const { add, droppedIds } = validatePickerOutput(
    result.output,
    new Set(input.registryIds),
  )
  const finalAgents = finalAgentSet(input.floor, add)
  const droppedNote =
    droppedIds.length > 0
      ? ` Dropped unregistered id(s): ${droppedIds.join(', ')}.`
      : ''

  if (finalAgents.length === 0) {
    return {
      finalAgents,
      added: add,
      droppedIds,
      pickerStatus: 'ok',
      diffTruncated: truncated,
      checkConclusion: 'success',
      checkTitle: 'No agent reached',
      checkSummary:
        'The path-matched floor and the picker both reached no agent for ' +
        `this diff.${droppedNote}${diffNote}`,
    }
  }

  return {
    finalAgents,
    added: add,
    droppedIds,
    pickerStatus: 'ok',
    diffTruncated: truncated,
    checkConclusion: 'neutral',
    checkTitle: `Floor matched: ${finalAgents.join(', ')}`,
    checkSummary:
      `The path-matched floor reached: ${
        input.floor.length > 0 ? input.floor.join(', ') : '(none)'
      }. The picker added: ${
        add.length > 0
          ? add.map((a) => `${a.agentId} (${a.reason})`).join('; ')
          : '(none)'
      }.${droppedNote}${diffNote} This is a placeholder — the spend cap and ` +
      'the live sweep are not wired up yet.',
  }
}
