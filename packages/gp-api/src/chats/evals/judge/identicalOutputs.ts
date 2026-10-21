import type { NormalizedCase } from './normalize'
import type { JsonValue, Payload } from './record'

// THE WORST FAILURE THIS HARNESS CAN HAVE is comparing two identical things
// and reporting "no difference", because that is indistinguishable from a real
// verdict of SAME. It costs a wrong decision and leaves no trace.
//
// The `configDigest` refusal in normalize.ts catches one route to it: two arms
// that hashed to the same config, so the agent could not have seen a
// difference. This catches the later and stronger signal, identical OUTPUT,
// which fires even when the digests differ but nothing downstream used the
// difference. Ways to land there:
//
//   - a candidate override that rides along unread, so both arms load the
//     published config (that specific hole is closed, the class is not);
//   - a staging step that silently drops a field, leaving the candidate's
//     bytes effectively the base's;
//   - a case whose answer does not depend on what the branch changed.
//
// Only the third is legitimate, and only per case. ONE identical pair is
// ordinary: a deterministic agent answering a question the branch did not
// touch will match. EVERY pair identical means the candidate was never
// applied, and that is what gets refused.

// Canonical rather than raw JSON.stringify. Two arms' payloads are built by
// one runner so their key order almost always agrees, but "almost always" here
// would mean missing an identical pair because a key moved — a false
// NEGATIVE, the direction that hides the bug this exists to catch.
const canonical = (value: JsonValue): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`
  }
  const keys = Object.keys(value).sort()
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key] ?? null)}`)
    .join(',')}}`
}

export const sameOutput = (a: Payload | null, b: Payload | null): boolean => {
  // Neither arm has an output only when both were infraErrors, and an
  // infraError case is never judgeable — so this cannot be reached from a
  // pairing. Two absent outputs are not evidence that the arms match.
  if (a === null || b === null) return false
  return a.kind === b.kind && canonical(a.value) === canonical(b.value)
}

export interface IdenticalOutputs {
  agentId: string
  // Judgeable pairs whose two arms produced the same output.
  identical: number
  // Judgeable pairs in total. Reported beside the count because "4
  // identical" means nothing without it.
  of: number
  // Every judgeable pair matched, and there was at least one. This is the
  // condition that means the machinery did not apply the candidate.
  allIdentical: boolean
  // The cases that matched, so the evidence line can name them rather than
  // only count them.
  caseIds: readonly string[]
}

export const identicalOutputs = (
  agentId: string,
  judgeable: readonly NormalizedCase[],
): IdenticalOutputs => {
  const matched = judgeable.filter((c) =>
    sameOutput(c.records.base.output, c.records.candidate.output),
  )
  return {
    agentId,
    identical: matched.length,
    of: judgeable.length,
    // Guarded on a non-empty pairing: nothing to compare is a different
    // failure, already reported as a refusal of its own, and calling it
    // "every pair identical" would be a second wrong explanation for it.
    allIdentical: judgeable.length > 0 && matched.length === judgeable.length,
    caseIds: [...new Set(matched.map((c) => c.caseId))].sort(),
  }
}

export const allIdenticalReason = (result: IdenticalOutputs): string =>
  `All ${result.of} judgeable case(s) came back byte-identical on both ` +
  'arms, so the candidate was never applied to any of them. That reads as ' +
  'a verdict of SAME and is not one: something between the branch and the ' +
  'agent dropped the difference. Check that the candidate arm is the ' +
  'commit under test and that its config reached the agent. A genuinely ' +
  'inert change can trip this legitimately — turn off ' +
  'gates.failOnAllIdenticalOutputs to say so deliberately.'
