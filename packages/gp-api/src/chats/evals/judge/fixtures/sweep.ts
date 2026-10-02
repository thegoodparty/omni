import type { PlaceholderValues } from '../caseParams'

// Shared test material for the sweep's two environments: the identifiers a
// fixture supplies, and the variables an arm requires.
//
// Both were copied into three and two files respectively before they lived
// here. The identifiers matter because one of the tests that uses them exists
// precisely to prove two arms receive the SAME triple — three separate
// declarations of "the same" values is the wrong shape for that claim. The
// arm environment matters because the literal IS the required-variable set,
// and it should be edited once when `ArmEnvSchema` gains a key.

// The values a sweep really produces (judgeIdentifiers.ts): a `judge-` slug
// from the sweep id, a BallotReady brHashId, the reserved judge address. Real
// in shape, so a substituted params object is the one that would be
// dispatched. A slug of any other shape would be refused by the dispatch, so a
// fixture shaped differently would hide exactly that refusal.
export const SWEEP_VALUES: Required<PlaceholderValues> = {
  orgSlug: 'judge-36999748321-1',
  raceId: 'gAAAAABkRaCeIdFromBallotReady',
  userEmail: 'judge-sweep@example.com',
}

export const SWEEP_ARM_SHA = 'a'.repeat(40)

// Everything `parseArmEnv` requires and nothing it does not, so a test that
// overrides one entry is varying exactly that one.
export const armEnvFor = (over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  JUDGE_ARM: 'candidate',
  JUDGE_SWEEP_ID: 'swp_1',
  JUDGE_AGENTS: 'chief_of_staff',
  JUDGE_BASE_REF: 'universal-judge',
  JUDGE_CANDIDATE_SHA: SWEEP_ARM_SHA,
  JUDGE_ARM_COMMIT: SWEEP_ARM_SHA,
  JUDGE_RECORDS_DIR: '/tmp/judge',
  ...over,
})
