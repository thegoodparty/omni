import { z } from 'zod'

// The Universal Judge's experiment override, carried on an agent dispatch
// message as the optional field `_judge_override`.
//
// Wire keys are snake_case, unlike the rest of this package, because the
// dispatch Lambda and the broker that read them are Python. Do not "fix"
// them to camelCase.
//
// What the override does: it points the broker at a candidate branch's
// manifest and instruction instead of the published ones, so a branch
// variant of a background agent can be run without publishing anything.
// The experiment id on the message stays real, and the scope ticket is
// still derived from the REAL published manifest — the override can change
// what the agent is told to do, never what it is allowed to touch.

export const JUDGE_KEY_PREFIX = '_judge/'

// Every run id a judge sweep dispatches must carry this prefix, whether or not
// that arm sends `_judge_override` — a sweep's base arm runs the published
// bytes and needs it too. It is the only marker for "this run has no gp-api
// `experiment_run` row", and five things downstream key on it: the mint sets
// the ticket's `is_eval` (which makes the broker suppress the results callback
// AND leave the org's `latest.json` pointer alone), the scheduler drops its
// started/failed callbacks, the task reaper skips reconciling a dead task, and
// both the shape-level and content-level override rejections go to the DLQ
// instead of calling back. Get it wrong and every judge run posts a callback
// gp-api cannot match, one `Experiment run not found` error per run. The
// dispatch Lambda refuses a `_judge_override` on a run id without it, and
// requires the whole id to match `^_judge-[A-Za-z0-9_-]{1,29}$`.
//
// gp-api mints product run ids as UUIDv7, so no product run can collide.
export const JUDGE_RUN_ID_PREFIX = '_judge-'

// A reserved prefix is load-bearing, not cosmetic: the dispatch handler
// mints a ticket allowlisting exactly the two keys it is handed, so
// confining them to a prefix nothing else publishes under is what stops an
// override from naming a real experiment's manifest.
//
// Validated as the whole shape rather than as a prefix, because a prefix
// check passes things that escape it — `_judge/../compliance_setup/x.json`
// starts with `_judge/` and addresses something else entirely. Pinning every
// segment to KEY_SEGMENT makes traversal, absolute paths and empty segments
// unrepresentable instead of individually forbidden, and keeps validation
// exactly as strict as the builder below.

// One id segment of a judge key: no separator, no dot-dot, never empty, and
// at most 64 characters. The upper bound is not decoration — it is what the
// dispatch Lambda and the broker enforce (`JUDGE_OVERRIDE_KEY_RE` in
// `pmf_engine/control_plane/manifest_loader.py` and
// `broker/dynamodb_client.py`), so an unbounded source here would let the
// builder below produce a key those two refuse. 64 fits a sha256 hex digest.
const KEY_SEGMENT_SOURCE = '[A-Za-z0-9_-]{1,64}'
const KEY_SEGMENT = new RegExp(`^${KEY_SEGMENT_SOURCE}$`)

// ECS caps `startedBy` at 36 characters, dispatch sets it to the run id
// verbatim, and the task reaper reads it back to identify the run. A longer id
// mints a ticket and claims the job to LAUNCHING before RunTask rejects it on
// validation, so every job in the sweep sticks. The dispatch Lambda refuses
// one past the cap; build them with `judgeRunId` and it cannot happen.
export const JUDGE_RUN_ID_MAX_LENGTH = 36

export const judgeRunId = (suffix: string): string => {
  const runId = `${JUDGE_RUN_ID_PREFIX}${suffix}`
  if (!KEY_SEGMENT.test(suffix)) {
    throw new Error(`unsafe suffix for a judge run id: ${suffix}`)
  }
  if (runId.length > JUDGE_RUN_ID_MAX_LENGTH) {
    throw new Error(
      `judge run id ${runId} is ${runId.length} characters; ECS caps startedBy at ${JUDGE_RUN_ID_MAX_LENGTH}`,
    )
  }
  return runId
}

const judgeObjectKey = (filename: string) =>
  z
    .string()
    .regex(
      new RegExp(
        `^${JUDGE_KEY_PREFIX}${KEY_SEGMENT_SOURCE}/${KEY_SEGMENT_SOURCE}/` +
          `${filename.replace('.', '\\.')}$`,
      ),
      { message: `must be ${JUDGE_KEY_PREFIX}<agentId>/<digest>/${filename}` },
    )

const judgeKeyFolder = (key: string) => key.split('/').slice(0, 3).join('/')

// Both Python consumers refuse a pair from two different folders (pairing one
// candidate's manifest with another's instruction would run a config nobody
// staged), so the contract has to as well — otherwise a producer validating
// against this schema can still build a pair the broker 400s.
export const JudgeOverrideSchema = z
  .object({
    manifest_key: judgeObjectKey('manifest.json'),
    instruction_key: judgeObjectKey('instruction.md'),
  })
  .refine(
    ({ manifest_key, instruction_key }) =>
      judgeKeyFolder(manifest_key) === judgeKeyFolder(instruction_key),
    {
      message:
        'manifest_key and instruction_key must name the same _judge/<agentId>/<digest>/ folder',
    },
  )

export type JudgeOverride = z.infer<typeof JudgeOverrideSchema>

// Both producer and consumer build the same layout from this, rather than
// string-concatenating it in two languages and drifting. The digest is the
// hash of the manifest plus instruction bytes, so the same content always
// lands on the same key: a re-run is idempotent and two branches never
// collide.
export const judgeOverrideKeys = (
  agentId: string,
  configDigest: string,
): JudgeOverride => {
  if (!KEY_SEGMENT.test(agentId)) {
    throw new Error(`unsafe agentId for a judge key: ${agentId}`)
  }
  if (!KEY_SEGMENT.test(configDigest)) {
    throw new Error(`unsafe configDigest for a judge key: ${configDigest}`)
  }
  const folder = `${JUDGE_KEY_PREFIX}${agentId}/${configDigest}`
  return {
    manifest_key: `${folder}/manifest.json`,
    instruction_key: `${folder}/instruction.md`,
  }
}
