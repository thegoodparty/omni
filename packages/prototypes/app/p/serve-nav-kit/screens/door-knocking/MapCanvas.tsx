'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, cn } from '@goodparty_org/styleguide'
import {
  type List,
  type StatusColor,
  type Voter,
  ALL_VOTERS,
  DEFAULT_LIST_COLOR,
  LIST_COLOR_TOKEN,
  STATUS_FILL,
  getDoorOutcomeMeta,
} from './doorKnockingData'

type Mode = 'view' | 'draw' | 'walk'

// The centered draw hint shows once per session: dismissed on the first tap and
// kept hidden for later route creations (module scope survives component
// remounts; resets only on a full page reload).
let drawHintDismissed = false

type Props = {
  voters: Voter[]
  // Houses that belong to the active list — drawn larger + in the list color.
  listVoterIds?: Set<string>
  // All saved list polygons (light outlines).
  lists?: List[]
  // Active polygon being drawn or previewed (filled).
  activePolygon?: { x: number; y: number }[]
  activeColor?: string
  route?: Voter[]
  liveIndex?: number
  mode?: Mode
  // Only show pins of this status color (legend filter).
  pinFilter?: StatusColor | null
  onPolygonChange?: (poly: { x: number; y: number }[]) => void
  onHouseTap?: (v: Voter) => void
  className?: string
}

// -------- meter-space → 1000×700 screen projection (invertible) --------
// The transform fits whatever is on screen (the route, or the displayed voters)
// centered in the viewBox — so a single list's route sits in the middle of the
// map rather than wherever it falls in the whole district.
const VIEW_W = 1000
const VIEW_H = 700

type Transform = {
  cx: number
  cy: number
  scale: number
}

const fitTransform = (pts: { x: number; y: number }[]): Transform => {
  const source = pts.length ? pts : ALL_VOTERS
  const xs = source.map((p) => p.x)
  const ys = source.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const w = Math.max(maxX - minX, 1)
  const h = Math.max(maxY - minY, 1)
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    scale: Math.min(VIEW_W / w, VIEW_H / h) * 0.8,
  }
}

const makeProject = (t: Transform) => (x: number, y: number) => ({
  sx: (x - t.cx) * t.scale + VIEW_W / 2,
  sy: (y - t.cy) * t.scale + VIEW_H / 2,
})
const makeUnproject = (t: Transform) => (sx: number, sy: number) => ({
  x: Math.round((sx - VIEW_W / 2) / t.scale + t.cx),
  y: Math.round((sy - VIEW_H / 2) / t.scale + t.cy),
})

const fillFor = (v: Voter): string => {
  const meta = getDoorOutcomeMeta(v)
  return meta ? STATUS_FILL[meta.color] : 'fill-muted-foreground/25'
}

export const MapCanvas = ({
  voters,
  listVoterIds,
  lists = [],
  activePolygon,
  activeColor,
  route,
  liveIndex,
  mode = 'view',
  pinFilter,
  onPolygonChange,
  onHouseTap,
  className,
}: Props) => {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [draft, setDraft] = useState<{ x: number; y: number }[]>(
    activePolygon ?? [],
  )
  const dragIdx = useRef<number | null>(null)
  const [showHint, setShowHint] = useState(!drawHintDismissed)

  // Fit the transform to the route (walk) or the displayed voters, so the
  // content sits centered in the map.
  const transform = useMemo(
    () => fitTransform(route && route.length ? route : voters),
    [route, voters],
  )
  const project = useMemo(() => makeProject(transform), [transform])
  const unproject = useMemo(() => makeUnproject(transform), [transform])

  useEffect(() => {
    if (mode !== 'draw') setDraft(activePolygon ?? [])
  }, [activePolygon, mode])

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const t = pt.matrixTransform(ctm.inverse())
    return unproject(t.x, t.y)
  }

  const commit = (next: { x: number; y: number }[]) => {
    setDraft(next)
    onPolygonChange?.(next)
  }

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (mode !== 'draw' || dragIdx.current !== null) return
    if (!drawHintDismissed) {
      drawHintDismissed = true
      setShowHint(false)
    }
    commit([...draft, toWorld(e)])
  }

  const startDrag = (i: number) => (e: React.MouseEvent) => {
    if (mode !== 'draw') return
    e.stopPropagation()
    dragIdx.current = i
  }
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (dragIdx.current === null) return
    const p = toWorld(e)
    const next = draft.map((pt, i) => (i === dragIdx.current ? p : pt))
    commit(next)
  }
  const endDrag = () => {
    dragIdx.current = null
  }

  const polyPoints = (poly: { x: number; y: number }[]) =>
    poly
      .map((p) => {
        const s = project(p.x, p.y)
        return `${s.sx},${s.sy}`
      })
      .join(' ')

  const routeLine = route ? route.map((v) => project(v.x, v.y)) : []

  return (
    <div
      className={cn('relative w-full overflow-hidden bg-emerald-50', className)}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label="Turf map"
        className={cn(
          'h-full w-full select-none',
          mode === 'draw' ? 'cursor-crosshair' : 'cursor-default',
        )}
        onClick={handleSvgClick}
        onMouseMove={onMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      >
        {/* Roads only — no grid. White streets on the green land, like a map. */}
        {[0.28, 0.52, 0.74].map((f) => (
          <line
            key={`h${f}`}
            x1={0}
            y1={VIEW_H * f}
            x2={VIEW_W}
            y2={VIEW_H * f}
            className="stroke-background"
            strokeWidth={9}
            strokeOpacity={0.8}
          />
        ))}
        {[0.32, 0.66].map((f) => (
          <line
            key={`v${f}`}
            x1={VIEW_W * f}
            y1={0}
            x2={VIEW_W * f}
            y2={VIEW_H}
            className="stroke-background"
            strokeWidth={9}
            strokeOpacity={0.8}
          />
        ))}

        {/* saved list outlines */}
        {lists.map((t) =>
          t.polygon.length > 2 ? (
            <polygon
              key={t.id}
              points={polyPoints(t.polygon)}
              fill={LIST_COLOR_TOKEN[t.color ?? DEFAULT_LIST_COLOR]}
              fillOpacity={0.06}
              stroke={LIST_COLOR_TOKEN[t.color ?? DEFAULT_LIST_COLOR]}
              strokeOpacity={0.4}
              strokeDasharray="7 5"
              strokeWidth={2}
            />
          ) : null,
        )}

        {/* active polygon preview */}
        {activePolygon && activePolygon.length > 1 && mode !== 'draw' && (
          <polygon
            points={polyPoints(activePolygon)}
            fill={activeColor ?? 'var(--color-primary)'}
            fillOpacity={0.12}
            stroke={activeColor ?? 'var(--color-primary)'}
            strokeWidth={2.5}
          />
        )}

        {/* draft polygon while drawing */}
        {mode === 'draw' && draft.length > 0 && (
          <>
            <polygon
              points={polyPoints(draft)}
              fill="var(--color-primary)"
              fillOpacity={0.1}
              className="stroke-primary"
              strokeWidth={2.5}
              strokeDasharray={draft.length > 2 ? undefined : '5 5'}
            />
            {draft.map((p, i) => {
              const s = project(p.x, p.y)
              return (
                <circle
                  key={i}
                  cx={s.sx}
                  cy={s.sy}
                  r={7}
                  className="fill-background stroke-primary cursor-grab"
                  strokeWidth={2.5}
                  onMouseDown={startDrag(i)}
                />
              )
            })}
          </>
        )}

        {/* houses */}
        {voters.map((v) => {
          const meta = getDoorOutcomeMeta(v)
          if (pinFilter) {
            if (!meta && pinFilter !== 'red') return null
            if (meta && meta.color !== pinFilter) return null
          }
          // Hide raw pins when a route is shown (stops render instead).
          if (route && listVoterIds?.has(v.id)) return null
          const inList = listVoterIds?.has(v.id)
          const s = project(v.x, v.y)
          const r = inList ? 6 : 4
          return (
            <circle
              key={v.id}
              cx={s.sx}
              cy={s.sy}
              r={r}
              className={cn(
                fillFor(v),
                'stroke-background',
                mode !== 'draw' && 'cursor-pointer',
              )}
              strokeWidth={1.25}
              onClick={(e) => {
                e.stopPropagation()
                if (mode === 'draw') return
                onHouseTap?.(v)
              }}
            />
          )
        })}

        {/* route polyline */}
        {routeLine.length > 1 && (
          <polyline
            points={routeLine.map((p) => `${p.sx},${p.sy}`).join(' ')}
            fill="none"
            className="stroke-primary"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeOpacity={0.6}
          />
        )}

        {/* numbered stops */}
        {route?.map((v, i) => {
          const s = project(v.x, v.y)
          const active = mode === 'walk' && i === liveIndex
          return (
            <g
              key={`stop-${v.id}`}
              className={mode !== 'draw' ? 'cursor-pointer' : undefined}
              onClick={(e) => {
                e.stopPropagation()
                if (mode !== 'draw') onHouseTap?.(v)
              }}
            >
              <circle
                cx={s.sx}
                cy={s.sy}
                r={11}
                className={
                  active ? 'fill-primary' : 'fill-background stroke-primary'
                }
                strokeWidth={2}
              />
              <text
                x={s.sx}
                y={s.sy + 3.5}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                className={active ? 'fill-primary-foreground' : 'fill-primary'}
              >
                {i + 1}
              </text>
            </g>
          )
        })}

        {/* live location pulse */}
        {mode === 'walk' &&
          route &&
          typeof liveIndex === 'number' &&
          route[liveIndex] &&
          (() => {
            const s = project(route[liveIndex]!.x, route[liveIndex]!.y)
            return (
              <g>
                <circle
                  cx={s.sx}
                  cy={s.sy}
                  r={20}
                  className="fill-info"
                  opacity={0.18}
                >
                  <animate
                    attributeName="r"
                    values="16;26;16"
                    dur="1.8s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values="0.25;0.05;0.25"
                    dur="1.8s"
                    repeatCount="indefinite"
                  />
                </circle>
                <circle
                  cx={s.sx}
                  cy={s.sy}
                  r={6}
                  className="fill-info stroke-background"
                  strokeWidth={2}
                />
              </g>
            )
          })()}
      </svg>

      {mode === 'draw' && (
        <>
          {/* Instruction — centered on the map, shown once per session. */}
          {showHint && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
              <span className="bg-popover text-foreground border-border rounded-2xl border px-4 py-3 text-center text-sm font-medium shadow-lg">
                Tap the map to add boundary points · {draft.length} point
                {draft.length === 1 ? '' : 's'}
              </span>
            </div>
          )}
          {/* Undo / Clear — shown once there are points (source: GoogleMapCanvas). */}
          {draft.length > 0 && (
            <div className="absolute right-3 bottom-3 flex gap-2">
              <Button
                size="small"
                variant="outline"
                onClick={() => commit(draft.slice(0, -1))}
              >
                Undo
              </Button>
              <Button size="small" variant="outline" onClick={() => commit([])}>
                Clear
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
