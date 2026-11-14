import type { RunView } from '@/agents/types'

export const formatRunView = (view: RunView): string =>
  [
    `run      ${view.runId}`,
    `agent    ${view.agent}`,
    `status   ${view.status}`,
    `shape    ${view.shapeHash}`,
    `steps    ${view.steps}`,
    `cost     ${view.costUsd === undefined ? 'not recorded' : `$${view.costUsd.toFixed(4)}`}`,
    ...(view.supersededBy ? [`superseded by ${view.supersededBy}`] : []),
    ...(view.error ? [`error    ${view.error}`] : []),
    `artifact ${view.artifact === undefined ? 'none yet' : 'saved'}`,
  ].join('\n')
