'use client'

type PathToVictoryMeterProps = {
  total: number
  current: number
  needed: number
}

const pct = (n: number, total: number) => `${Math.min(100, (n / total) * 100)}%`

// GAP: styleguide Progress is single-value. This is a two-segment meter — filled
// "so far", a lighter "to win" band up to the needed threshold, and a marker at
// the win line — over a neutral track for the full expected turnout.
export const PathToVictoryMeter = ({
  total,
  current,
  needed,
}: PathToVictoryMeterProps) => (
  <div className="space-y-2">
    <div className="flex justify-between text-xs font-semibold">
      <span className="text-primary">{current.toLocaleString()} so far</span>
      <span className="text-foreground">{needed.toLocaleString()} to win</span>
    </div>
    <div className="bg-muted relative h-2.5 w-full overflow-hidden rounded-full">
      {/* to-win band */}
      <div
        className="bg-primary-light absolute inset-y-0 left-0 rounded-full"
        style={{ width: pct(needed, total) }}
      />
      {/* progress so far */}
      <div
        className="bg-primary absolute inset-y-0 left-0 rounded-full"
        style={{ width: pct(current, total) }}
      />
      {/* win threshold marker */}
      <div
        className="bg-foreground absolute inset-y-0 w-0.5"
        style={{ left: pct(needed, total) }}
      />
    </div>
    <div className="text-muted-foreground flex justify-between text-xs">
      <span>0</span>
      <span>{total.toLocaleString()} expected to vote</span>
    </div>
  </div>
)
