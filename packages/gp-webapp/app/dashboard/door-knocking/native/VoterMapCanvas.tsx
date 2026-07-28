'use client'

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer } from '@deck.gl/layers'
import 'maplibre-gl/dist/maplibre-gl.css'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import { PolygonLayer } from '@deck.gl/layers'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { NEXT_PUBLIC_GEOAPIFY_TILES_KEY } from 'appEnv'
import { DecodedPack } from './packDecoder'
import { FilterResult } from './filterEngine'

// Canvas colors, not DOM: deck.gl consumes raw RGBA arrays, so these are
// hand-picked to sit near the theme families (teal=unknowns/knockable,
// amber=not home, green=supporter, red=non-supporter, slate=inaccessible /
// not a voter, violet=refused). Indexes match DOOR_KNOCK_STATUSES order.
const STATUS_COLORS: Array<[number, number, number, number]> = [
  [13, 148, 136, 200], // unknown
  [217, 119, 6, 210], // not_home
  [22, 163, 74, 210], // supporter
  [220, 38, 38, 210], // non_supporter
  [100, 116, 139, 200], // inaccessible
  [124, 58, 237, 210], // refused
  [100, 116, 139, 160], // not_a_voter
]
const UNMATCHED_COLOR: [number, number, number, number] = [190, 195, 200, 60]

export type PolygonRing = Array<[number, number]>

interface VoterMapCanvasProps {
  pack: DecodedPack
  filterResult: FilterResult
  turfs: DoorKnockingTurf[]
  focusTurf: DoorKnockingTurf | null
  // Bump to clear the in-progress drawing (e.g. after a turf is saved).
  clearDrawToken: number
  onPolygonChange: (ring: PolygonRing | null) => void
}

const hexToRgba = (
  hex: string,
  alpha: number,
): [number, number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
  alpha,
]

const buildColors = (
  filterResult: FilterResult,
  dotCount: number,
): Uint8Array => {
  const colors = new Uint8Array(dotCount * 4)
  for (let i = 0; i < dotCount; i++) {
    const matched = (filterResult.matchedPerDot[i] ?? 0) > 0
    const status = filterResult.statusPerDot[i] ?? 255
    const color = matched
      ? (STATUS_COLORS[status] ?? STATUS_COLORS[0])
      : UNMATCHED_COLOR
    const offset = i * 4
    colors[offset] = color?.[0] ?? 0
    colors[offset + 1] = color?.[1] ?? 0
    colors[offset + 2] = color?.[2] ?? 0
    colors[offset + 3] = color?.[3] ?? 0
  }
  return colors
}

const packBounds = (
  positions: Float32Array,
): [[number, number], [number, number]] | null => {
  if (positions.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < positions.length; i += 2) {
    const x = positions[i] ?? 0
    const y = positions[i + 1] ?? 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ]
}

export default function VoterMapCanvas({
  pack,
  filterResult,
  turfs,
  focusTurf,
  clearDrawToken,
  onPolygonChange,
}: VoterMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const hasTilesKey = NEXT_PUBLIC_GEOAPIFY_TILES_KEY.length > 0
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const drawRef = useRef<MapboxDraw | null>(null)
  const onPolygonChangeRef = useRef(onPolygonChange)
  onPolygonChangeRef.current = onPolygonChange

  useEffect(() => {
    if (!containerRef.current || !hasTilesKey) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: `https://maps.geoapify.com/v1/styles/positron/style.json?apiKey=${NEXT_PUBLIC_GEOAPIFY_TILES_KEY}`,
      center: [-98, 39],
      zoom: 4,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, trash: true },
    })
    // MapboxDraw predates maplibre's types but is runtime-compatible — the
    // POC shipped this exact pairing.
    map.addControl(draw as unknown as maplibregl.IControl, 'top-right')
    drawRef.current = draw

    const overlay = new MapboxOverlay({ layers: [] })
    map.addControl(overlay as unknown as maplibregl.IControl)
    overlayRef.current = overlay

    // One turf at a time: drawing a new shape replaces the previous one on
    // the map, so the stats panel always describes the single visible
    // polygon.
    const emitPolygon = () => {
      const polygons = draw
        .getAll()
        .features.filter((f) => f.geometry.type === 'Polygon')
      const last = polygons[polygons.length - 1]
      const stale = polygons
        .slice(0, -1)
        .map((f) => f.id)
        .filter((id): id is string => typeof id === 'string')
      if (stale.length > 0) {
        draw.delete(stale)
      }
      const ring =
        last && last.geometry.type === 'Polygon'
          ? (last.geometry.coordinates[0] as PolygonRing)
          : null
      onPolygonChangeRef.current(ring ?? null)
    }
    map.on('draw.create', emitPolygon)
    map.on('draw.update', emitPolygon)
    map.on('draw.delete', emitPolygon)

    const bounds = packBounds(pack.positions)
    if (bounds) {
      map.fitBounds(bounds, { padding: 48, animate: false })
    }

    return () => {
      overlayRef.current = null
      mapRef.current = null
      drawRef.current = null
      map.remove()
    }
    // The map mounts once per pack — everything dynamic flows through the
    // overlay effect below.
  }, [pack, hasTilesKey])

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    const dotCount = pack.manifest.counts.dots
    overlay.setProps({
      layers: [
        new PolygonLayer<DoorKnockingTurf>({
          id: 'saved-turfs',
          data: turfs,
          getPolygon: (turf) => turf.geoPoly.coordinates[0] ?? [],
          getFillColor: (turf) => hexToRgba(turf.color, 40),
          getLineColor: (turf) => hexToRgba(turf.color, 220),
          lineWidthMinPixels: 2,
          pickable: false,
        }),
        new ScatterplotLayer({
          id: 'voter-dots',
          data: {
            length: dotCount,
            attributes: {
              getPosition: { value: pack.positions, size: 2 },
              getFillColor: {
                value: buildColors(filterResult, dotCount),
                size: 4,
              },
            },
          },
          radiusMinPixels: 1.5,
          radiusMaxPixels: 6,
          getRadius: 5,
          pickable: false,
        }),
      ],
    })
  }, [pack, filterResult, turfs])

  useEffect(() => {
    if (!focusTurf || !mapRef.current) return
    const ring = focusTurf.geoPoly.coordinates[0] ?? []
    if (ring.length === 0) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of ring) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    mapRef.current.fitBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      { padding: 64 },
    )
  }, [focusTurf])

  useEffect(() => {
    if (clearDrawToken === 0) return
    drawRef.current?.deleteAll()
    onPolygonChangeRef.current(null)
  }, [clearDrawToken])

  // A missing key would otherwise render a silent blank map (401s from the
  // tile CDN) — fail loudly for developers instead.
  if (!hasTilesKey) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Set NEXT_PUBLIC_GEOAPIFY_TILES_KEY (a domain-restricted Geoapify tiles
        key) to render the map.
      </div>
    )
  }

  return <div ref={containerRef} className="h-full w-full" />
}
