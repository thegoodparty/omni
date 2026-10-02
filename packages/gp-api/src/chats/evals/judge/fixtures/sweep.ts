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

// Shaped like the real values — an `eo-<uuid>` organization, a BallotReady
// brHashId, a `qa-<uuid>@goodparty.org` fixture address — so a substituted
// params object is the one that would really be dispatched. Fictional.
export const SWEEP_VALUES: Required<PlaceholderValues> = {
  orgSlug: 'eo-0192e4a0-1f00-7000-8000-0000000c0de1',
  raceId: 'gAAAAABkRaCeIdFromBallotReady',
  userEmail: 'qa-6f1c9d84-3b52-4a27-9e0f-7c3d51ab2049@goodparty.org',
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
