import type { RunView } from '@/agents/types'

const pad = (value: string, width: number): string => value.padEnd(width)

export const formatRunView = (view: RunView): string => {
  const nameWidth = Math.max(5, ...view.stages.map((s) => s.name.length))
  const statusWidth = Math.max(6, ...view.stages.map((s) => s.status.length))
  const lines = [
    `run      ${view.runId}`,
    `agent    ${view.agent}`,
    `status   ${view.status}`,
    `shape    ${view.shapeHash}`,
    `cost     ${view.costUsd === undefined ? 'not recorded' : `$${view.costUsd.toFixed(4)}`}`,
    ...(view.error ? [`error    ${view.error}`] : []),
    '',
    `${pad('stage', nameWidth)}  ${pad('status', statusWidth)}  steps  output`,
    ...view.stages.map(
      (stage) =>
        `${pad(stage.name, nameWidth)}  ${pad(stage.status, statusWidth)}  ` +
        `${String(stage.steps).padStart(5)}  ${stage.output === undefined ? '-' : 'saved'}`,
    ),
    '',
    `artifact ${view.artifact === undefined ? 'none yet' : 'saved'}`,
  ]
  return lines.join('\n')
}
