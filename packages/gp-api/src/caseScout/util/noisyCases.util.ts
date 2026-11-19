import { compareDesc, max, parseISO } from 'date-fns'
import type { Removal } from '../schemas/caseScoutBucket.schema'

// Noisy-case removal proposals (Implementation Notes 2.8). A case is proposed
// for removal when main's arm split its three attempts (1 or 2 handled) in at
// least half of its last six complete sweeps. A case failing 0 of 3 every
// time is never proposed: a production case is meant to fail until the agent
// is fixed. Advisory only; a reviewer decides on the PR.

export const SWEEP_WINDOW = 6
export const MIN_SPLIT_SWEEPS = 3
export const ATTEMPTS_PER_CASE = 3
export const HANDLED_STATUS = 'produced'

export type SweepAttempt = {
  sweepId: string
  startedAt: string
  status: string
}

export const proposeRemovalForCase = (
  agentId: string,
  caseId: string,
  attempts: SweepAttempt[],
): Removal | undefined => {
  const bySweep = new Map<string, SweepAttempt[]>()
  for (const attempt of attempts) {
    bySweep.set(attempt.sweepId, [
      ...(bySweep.get(attempt.sweepId) ?? []),
      attempt,
    ])
  }
  // A sweep that did not record exactly three attempts is a partial capture,
  // neither a clean pass nor a split.
  const complete = [...bySweep.values()].filter(
    (sweep) => sweep.length === ATTEMPTS_PER_CASE,
  )
  if (complete.length < SWEEP_WINDOW) return undefined

  const lastWindow = complete
    .map((sweep) => ({
      sweep,
      latest: max(sweep.map((attempt) => parseISO(attempt.startedAt))),
    }))
    .sort((a, b) => compareDesc(a.latest, b.latest))
    .slice(0, SWEEP_WINDOW)

  const splitCount = lastWindow.filter(({ sweep }) => {
    const handled = sweep.filter(
      (attempt) => attempt.status === HANDLED_STATUS,
    ).length
    return handled > 0 && handled < sweep.length
  }).length
  if (splitCount < MIN_SPLIT_SWEEPS) return undefined

  return {
    caseId,
    agentId,
    reason:
      `base arm split ${splitCount}/${SWEEP_WINDOW} of its last sweeps ` +
      `(neither 0/${ATTEMPTS_PER_CASE} nor ` +
      `${ATTEMPTS_PER_CASE}/${ATTEMPTS_PER_CASE} handled)`,
  }
}
