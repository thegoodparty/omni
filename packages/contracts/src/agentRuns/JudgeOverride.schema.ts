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

// One id segment of a judge key: no separator, no dot-dot, never empty.
const KEY_SEGMENT_SOURCE = '[A-Za-z0-9_-]+'
const KEY_SEGMENT = new RegExp(`^${KEY_SEGMENT_SOURCE}$`)

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

export const JudgeOverrideSchema = z.object({
  manifest_key: judgeObjectKey('manifest.json'),
  instruction_key: judgeObjectKey('instruction.md'),
})

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
