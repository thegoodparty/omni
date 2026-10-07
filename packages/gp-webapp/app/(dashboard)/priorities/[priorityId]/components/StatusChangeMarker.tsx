'use client'

import { describeStepChange, type StepChange } from '../data/statusUpdates'
import { StepStateIcon } from './PriorityStatusRail'

/**
 * A step moving is a thing the official should be able to see happen, so it
 * leaves a line in the conversation rather than only changing the rail. Quiet
 * by design: no bubble, no avatar, no border.
 */
export const StatusChangeMarker = ({
  changes,
}: {
  changes: StepChange[]
}): React.JSX.Element | null => {
  if (changes.length === 0) return null
  return (
    <div className="flex flex-col gap-1 py-0.5">
      {changes.map((change) => (
        <p
          key={`${change.id}-${change.to}`}
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <StepStateIcon state={change.to} className="size-3.5" />
          {describeStepChange(change)}
        </p>
      ))}
    </div>
  )
}
