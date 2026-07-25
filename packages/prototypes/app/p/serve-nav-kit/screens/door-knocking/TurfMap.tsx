'use client'

import { type DoorRecord, type Voter } from './doorKnockingData'

type Props = {
  voters: Voter[]
  records: Record<string, DoorRecord>
  // Optional subset to spotlight (e.g. the list being viewed).
  highlightIds?: string[]
  className?: string
}

// Backend-free synthetic turf map: plots voters by their normalised x/y with
// DS-token colours by canvass status. No external map / geocoding.
export const TurfMap = ({
  voters,
  records,
  highlightIds,
  className,
}: Props) => {
  const highlight = highlightIds ? new Set(highlightIds) : null

  const fillFor = (v: Voter) => {
    const rec = records[v.id]
    if (rec?.support === 'yes') return 'fill-success'
    if (rec?.support === 'no') return 'fill-destructive'
    if (rec) return 'fill-primary'
    return 'fill-muted-foreground/40'
  }

  return (
    <svg
      viewBox="0 0 100 60"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Turf map"
      className={className}
    >
      {/* subtle street grid */}
      {Array.from({ length: 9 }, (_, i) => (
        <line
          key={`v${i}`}
          x1={(i + 1) * 10}
          y1="0"
          x2={(i + 1) * 10}
          y2="60"
          className="stroke-border"
          strokeWidth="0.15"
        />
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <line
          key={`h${i}`}
          x1="0"
          y1={(i + 1) * 10}
          x2="100"
          y2={(i + 1) * 10}
          className="stroke-border"
          strokeWidth="0.15"
        />
      ))}

      {voters.map((v) => {
        const on = !highlight || highlight.has(v.id)
        return (
          <circle
            key={v.id}
            cx={v.x}
            cy={v.y * 0.6}
            r={on ? 0.9 : 0.6}
            className={fillFor(v)}
            opacity={on ? 1 : 0.25}
          />
        )
      })}
    </svg>
  )
}
