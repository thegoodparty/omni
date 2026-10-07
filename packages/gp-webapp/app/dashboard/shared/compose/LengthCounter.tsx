import { cn } from '@styleguide'

// A compose field stops taking keystrokes at its limit, so the candidate is
// told before they get there and when they arrive, rather than finding their
// typing ignored.
const WARN_FROM = 0.9

type LengthCounterProps = {
  length: number
  max: number
  className?: string
}

export const LengthCounter = ({
  length,
  max,
  className,
}: LengthCounterProps) => {
  if (length < max * WARN_FROM) return null
  const atLimit = length >= max
  return (
    <p
      role="status"
      className={cn(
        'text-xs tabular-nums',
        atLimit ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      {atLimit
        ? `You've reached the ${max.toLocaleString()}-character limit.`
        : `${(max - length).toLocaleString()} characters left`}
    </p>
  )
}
