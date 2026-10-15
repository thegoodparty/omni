import { z } from 'zod'
import { JUDGE_KEY_PREFIX } from './JudgeOverride.schema'

// The Universal Judge's page replay setting, carried on an agent dispatch
// message as the optional field `_judge_replay`, beside `_judge_override`.
//
// The broker records the pages a run fetches (`record`) or serves recorded
// copies and fetches live on a miss (`replay`), under the store `key` names.
// The key is arm-free on purpose: the two arms' run ids differ, but a base
// arm and the candidate compared against it share one store. A key names a
// folder with no trailing slash, and the broker stores objects at
// `${key}/<name>`; joining without the slash would let `t1-1` prefix `t1-10`.
//
// Validated as a whole shape, never as a prefix, for the reason the override
// gives: a prefix check passes `_judge/replay/../x`. Every segment is pinned to
// a charset with no separator and no dot, so traversal, absolute paths and
// empty segments are unrepresentable. This guards against mistakes and path
// escapes. It is not access control: the judge's role can already read and
// write `_judge/*` directly.

export const JUDGE_REPLAY_KEY_PREFIX = `${JUDGE_KEY_PREFIX}replay/`

// The dispatch Lambda and the broker will mirror these bounds
// (`JUDGE_REPLAY_KEY_RE`), so a key the builders produce is never one those
// two refuse. Port them with `re.fullmatch`: Python's `$` also matches before
// a trailing newline. The agent id is the dispatch handler's experiment id
// shape; the case id bound matches the case list loader's; an attempt is at
// most 99 by this contract.
const SEGMENT = '[A-Za-z0-9_-]{1,64}'
const AGENT_ID = '[a-z][a-z0-9_]{0,63}'
const CASE_ID = '[A-Za-z0-9_-]{1,80}'
const ATTEMPT = '[1-9][0-9]?'

const SWEEP_KEY = `sweep/${SEGMENT}/${AGENT_ID}/${CASE_ID}-${ATTEMPT}`
const BASE_KEY = `base/${AGENT_ID}/${SEGMENT}/${CASE_ID}-${ATTEMPT}`
const SEED_KEY = `seed/${AGENT_ID}/${CASE_ID}`

const prefixed = (shape: string) =>
  new RegExp(`^${JUDGE_REPLAY_KEY_PREFIX}${shape}$`)

const SWEEP_KEY_RE = prefixed(SWEEP_KEY)
const BASE_KEY_RE = prefixed(BASE_KEY)
const SEED_KEY_RE = prefixed(SEED_KEY)
const ANY_KEY_RE = prefixed(`(?:${SWEEP_KEY}|${BASE_KEY}|${SEED_KEY})`)

// A seed store is written by the bench before dispatch and replayed by both
// arms. Letting a run record into it would mix live pages into planted ones,
// so the broker only ever reads it.
export const JudgeReplaySchema = z
  .object({
    mode: z.enum(['record', 'replay']),
    key: z.string().regex(ANY_KEY_RE, {
      message: `must be a ${JUDGE_REPLAY_KEY_PREFIX}sweep/, base/ or seed/ key`,
    }),
  })
  .strict()
  .refine(({ mode, key }) => !(mode === 'record' && SEED_KEY_RE.test(key)), {
    message: 'a seed store is replay-only',
  })

export type JudgeReplay = z.infer<typeof JudgeReplaySchema>

const requireKey = (key: string, shape: RegExp, label: string): string => {
  if (!shape.test(key)) {
    throw new Error(`unsafe input for a judge replay ${label} key: ${key}`)
  }
  return key
}

// Checked as a number, not left to the key shape: a case id may end in a
// hyphen, so attempt -1 on case `a-` builds `a--1`, which reads as case `a-`
// attempt 1 and shares its store.
const requireAttempt = (attempt: number): number => {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 99) {
    throw new Error(`attempt must be an integer from 1 to 99, got ${attempt}`)
  }
  return attempt
}

// The base arm records here and the candidate replays from it.
export const judgeReplaySweepKey = (
  sweepId: string,
  agentId: string,
  caseId: string,
  attempt: number,
): string =>
  requireKey(
    `${JUDGE_REPLAY_KEY_PREFIX}sweep/${sweepId}/${agentId}/${caseId}-${requireAttempt(attempt)}`,
    SWEEP_KEY_RE,
    'sweep',
  )

// The recording that belongs to a cached base arm, keyed like the cache entry
// by config digest, so a candidate compared against a reused base still sees
// the pages that base saw.
export const judgeReplayBaseKey = (
  agentId: string,
  configDigest: string,
  caseId: string,
  attempt: number,
): string =>
  requireKey(
    `${JUDGE_REPLAY_KEY_PREFIX}base/${agentId}/${configDigest}/${caseId}-${requireAttempt(attempt)}`,
    BASE_KEY_RE,
    'base',
  )

// Planted pages a bench commits beside its case list. Not per attempt: every
// attempt of both arms reads the same seed.
export const judgeReplaySeedKey = (agentId: string, caseId: string): string =>
  requireKey(
    `${JUDGE_REPLAY_KEY_PREFIX}seed/${agentId}/${caseId}`,
    SEED_KEY_RE,
    'seed',
  )
