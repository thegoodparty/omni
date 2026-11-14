import type { RunView } from '@/agents/types'

export type KillTestOutcome = 'resumed' | 'started_over' | 'unclear'

export type KillTestVerdict = {
  pass: boolean
  outcome: KillTestOutcome
  lines: string[]
}

// The moment to kill: the run has saved at least `minSteps` steps.
export const readyToKill = (view: RunView, minSteps: number): boolean =>
  view.status === 'running' && view.steps >= minSteps

// `firstAfter` is the first view the observer read after the second worker
// started; `final` is the last, which follows a superseded run to the run
// that replaced it. A resume carries on the same run from its saved steps; a
// start-over supersedes the run, keeps its steps on it, and finishes a fresh
// run under a new shape hash.
export const killTestVerdict = (args: {
  before: RunView
  firstAfter: RunView
  final: RunView
  changedShape: boolean
}): KillTestVerdict => {
  const { before, firstAfter, final, changedShape } = args
  const sameRun = final.runId === before.runId
  const sameShape = final.shapeHash === before.shapeHash
  const keptSteps =
    firstAfter.runId === before.runId && firstAfter.steps >= before.steps
  const replaced =
    firstAfter.status === 'superseded' &&
    firstAfter.supersededBy === final.runId

  const outcome: KillTestOutcome =
    sameRun && sameShape && keptSteps && firstAfter.status !== 'superseded'
      ? 'resumed'
      : !sameRun && !sameShape && keptSteps && replaced
        ? 'started_over'
        : 'unclear'
  const expected: KillTestOutcome = changedShape ? 'started_over' : 'resumed'
  const pass = final.status === 'completed' && outcome === expected

  return {
    pass,
    outcome,
    lines: [
      `killed run ${before.runId} after ${before.steps} saved steps`,
      `after restart: run ${firstAfter.runId} ${firstAfter.status} with ${firstAfter.steps} steps` +
        (firstAfter.supersededBy
          ? `, superseded by ${firstAfter.supersededBy}`
          : ''),
      `shape hash ${sameShape ? 'unchanged' : 'changed'}: ${before.shapeHash} -> ${final.shapeHash}`,
      `final run ${final.runId} ${final.status} with ${final.steps} steps`,
      `outcome ${outcome}, expected ${expected}: ${pass ? 'PASS' : 'FAIL'}`,
    ],
  }
}
