'use client'

import { cn } from '@styleguide'
import type { CampaignStrategyPhase } from './campaignStrategy.types'
import { phaseCounts, phaseHasNext } from './phaseProgress'

/**
 * Where the candidate is in the whole plan, before the long list: one segment
 * per phase, filled by how much of it is done, with "You are here" on the
 * phase that holds the next task (or the one happening now).
 */
export default function PlanProgress({
  phases,
}: {
  phases: CampaignStrategyPhase[]
}): React.JSX.Element | null {
  if (phases.length === 0) return null

  const here =
    phases.find(phaseHasNext) ??
    phases.find((phase) => phase.status === 'active') ??
    null
  const totals = phases.map(phaseCounts)
  const done = totals.reduce((sum, t) => sum + t.done, 0)
  const total = totals.reduce((sum, t) => sum + t.total, 0)

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <p className="text-sm font-semibold text-foreground">
          {here ? `You’re in ${here.title}` : 'Your plan'}
        </p>
        {total > 0 && (
          <p className="text-sm tabular-nums text-muted-foreground">
            {done} of {total} done
          </p>
        )}
      </div>
      <ol className="grid grid-flow-col auto-cols-fr gap-2">
        {phases.map((phase, index) => {
          const { done: phaseDone, total: phaseTotal } = totals[index] ?? {
            done: 0,
            total: 0,
          }
          const isHere = phase.key === here?.key
          const fill =
            phase.status === 'done'
              ? 100
              : phaseTotal > 0
                ? Math.round((phaseDone / phaseTotal) * 100)
                : 0
          return (
            <li
              key={phase.key}
              aria-current={isHere ? 'step' : undefined}
              className="flex flex-col gap-1.5"
            >
              <div className="h-1.5 overflow-hidden rounded-full bg-grayscale-200">
                <div
                  className={cn(
                    'h-full rounded-full',
                    phase.status === 'done' ? 'bg-success' : 'bg-primary',
                  )}
                  style={{ width: `${fill}%` }}
                />
              </div>
              <span
                className={cn(
                  'truncate text-xs',
                  isHere
                    ? 'font-semibold text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {phase.title}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
