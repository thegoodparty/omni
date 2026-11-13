import type { RunView } from '@/agents/types'

export const KILL_STAGE = 'readPacket'
const FIRST_STAGE = 'findAgenda'

export type KillTestOutcome = 'resumed' | 'started_over' | 'unclear'

export type KillTestVerdict = {
  pass: boolean
  outcome: KillTestOutcome
  lines: string[]
}

const stage = (view: RunView, name: string) =>
  view.stages.find((s) => s.name === name)

// The moment to kill: the first stage is done and the one after it has saved
// at least `minSteps` steps of its own.
export const readyToKill = (view: RunView, minSteps: number): boolean => {
  const first = stage(view, FIRST_STAGE)
  const killed = stage(view, KILL_STAGE)
  return (
    view.status === 'running' &&
    first?.status === 'completed' &&
    killed?.status === 'running' &&
    killed.steps >= minSteps
  )
}

// `firstAfter` is the first view the observer read after the second worker
// started; `final` is the last. A resume keeps the first stage as it was and
// the killed stage's steps; a start-over runs the first stage again under a
// new shape hash.
export const killTestVerdict = (args: {
  before: RunView
  firstAfter: RunView
  final: RunView
  changedShape: boolean
}): KillTestVerdict => {
  const { before, firstAfter, final, changedShape } = args
  const firstBefore = stage(before, FIRST_STAGE)
  const firstAgain = stage(firstAfter, FIRST_STAGE)
  const killedBefore = stage(before, KILL_STAGE)
  const killedAgain = stage(firstAfter, KILL_STAGE)

  const keptFirstStage =
    firstAgain?.status === 'completed' &&
    firstAgain.steps === firstBefore?.steps
  const keptKilledSteps =
    (killedAgain?.steps ?? 0) >= (killedBefore?.steps ?? 0)
  const sameShape = final.shapeHash === before.shapeHash

  const outcome: KillTestOutcome =
    sameShape && keptFirstStage && keptKilledSteps
      ? 'resumed'
      : !sameShape && !keptFirstStage
        ? 'started_over'
        : 'unclear'
  const expected: KillTestOutcome = changedShape ? 'started_over' : 'resumed'
  const pass = final.status === 'completed' && outcome === expected

  return {
    pass,
    outcome,
    lines: [
      `killed during ${KILL_STAGE} at step ${killedBefore?.steps ?? 0}; ${FIRST_STAGE} had ${firstBefore?.steps ?? 0} steps`,
      `after restart: ${FIRST_STAGE} ${firstAgain?.status ?? 'missing'} with ${firstAgain?.steps ?? 0} steps, ${KILL_STAGE} ${killedAgain?.status ?? 'missing'} with ${killedAgain?.steps ?? 0} steps`,
      `shape hash ${sameShape ? 'unchanged' : 'changed'}: ${before.shapeHash} -> ${final.shapeHash}`,
      `final status ${final.status}`,
      `outcome ${outcome}, expected ${expected}: ${pass ? 'PASS' : 'FAIL'}`,
    ],
  }
}
