type Props = {
  values: number[]
  weeks: string[]
  width?: number
  height?: number
}

/**
 * Nine weekly bars, one series, no axes and no legend. Its only job is to make a
 * shape visible that the status enum hides: `active` only means "fired in the last
 * 30 days", so an instrument that fell off a cliff five weeks ago and flatlined
 * still reads as healthy. The eye catches that instantly.
 *
 * A zero week draws a baseline tick rather than nothing, because a missing bar and
 * a silent week look identical otherwise, and the silence is the finding.
 */
export const Sparkline = ({
  values,
  weeks,
  width = 96,
  height = 24,
}: Props) => {
  if (!values.length) {
    return (
      <span
        className="text-xs text-muted-foreground"
        title="No weekly data in the last 63 days"
      >
        no data
      </span>
    )
  }

  const gap = 2
  const barW = Math.max(2, (width - gap * (values.length - 1)) / values.length)
  const max = Math.max(...values, 1)
  const r = Math.min(2, barW / 2)

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Weekly volume, ${values.length} weeks, ${values[0]} to ${values[values.length - 1]}`}
      className="overflow-visible"
    >
      {values.map((v, i) => {
        const x = i * (barW + gap)
        const h = v === 0 ? 1 : Math.max(1.5, (v / max) * height)
        const week = weeks[i] ?? ''
        return (
          <rect
            key={i}
            x={x}
            y={height - h}
            width={barW}
            height={h}
            rx={v === 0 ? 0.5 : r}
            className={
              v === 0 ? 'fill-muted-foreground/30' : 'fill-foreground/70'
            }
          >
            <title>{`week of ${week}: ${v.toLocaleString('en-US')}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}
