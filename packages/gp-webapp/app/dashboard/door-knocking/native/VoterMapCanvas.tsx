'use client'

import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer } from '@deck.gl/layers'
import 'maplibre-gl/dist/maplibre-gl.css'
import { PolygonLayer, TextLayer } from '@deck.gl/layers'
import { DOOR_KNOCK_STATUSES, DoorKnockingTurf } from '@goodparty_org/contracts'
import { NEXT_PUBLIC_GEOAPIFY_TILES_KEY } from 'appEnv'
import { STATUS_RGB } from './statusPresentation'
import { DecodedPack } from './packDecoder'
import { FilterResult } from './filterEngine'

// Dots and legend chips share one palette (statusPresentation.ts) so they
// cannot disagree; indexes match DOOR_KNOCK_STATUSES order (the status
// bytes in the filter result are array indexes).
const STATUS_COLORS: Array<[number, number, number, number]> =
  DOOR_KNOCK_STATUSES.map((status) => [...STATUS_RGB[status], 210])
const UNMATCHED_COLOR: [number, number, number, number] = [190, 195, 200, 60]
// The demo's action blue for the in-progress boundary.
const DRAW_BLUE: [number, number, number, number] = [19, 81, 216, 255]
const DRAW_BLUE_FILL: [number, number, number, number] = [19, 81, 216, 40]

export type PolygonRing = Array<[number, number]>

export interface RoutePin {
  seq: number
  lat: number
  lng: number
}

interface VoterMapCanvasProps {
  pack: DecodedPack
  filterResult: FilterResult
  turfs: DoorKnockingTurf[]
  // Numbered stop pins for the open route's walk view.
  routePins: RoutePin[]
  focusTurf: DoorKnockingTurf | null
  // Bump to enter polygon-draw mode (the page owns the Draw button).
  startDrawToken: number
  // Bump to clear the in-progress drawing (e.g. after a turf is saved).
  clearDrawToken: number
  onPolygonChange: (ring: PolygonRing | null) => void
  // Fires with the vertex count as points are placed (0 on start/clear) —
  // the page uses it to dismiss the draw instructions on the first click.
  onDrawPointCount?: (count: number) => void
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
  routePins,
  focusTurf,
  startDrawToken,
  clearDrawToken,
  onPolygonChange,
  onDrawPointCount,
}: VoterMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const hasTilesKey = NEXT_PUBLIC_GEOAPIFY_TILES_KEY.length > 0
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  // Click-to-add-vertex drawing (mapbox-gl-draw's finish gesture is
  // unreliable on maplibre): every click appends a point and the shape
  // closes itself from whatever points exist — there is no finish gesture.
  const drawActiveRef = useRef(false)
  const [drawPoints, setDrawPoints] = useState<PolygonRing>([])
  const drawPointsRef = useRef<PolygonRing>([])
  const dragIndexRef = useRef<number | null>(null)
  const justDraggedRef = useRef(false)
  const onPolygonChangeRef = useRef(onPolygonChange)
  onPolygonChangeRef.current = onPolygonChange
  const onDrawPointCountRef = useRef(onDrawPointCount)
  onDrawPointCountRef.current = onDrawPointCount

  useEffect(() => {
    if (!containerRef.current || !hasTilesKey) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: `https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey=${NEXT_PUBLIC_GEOAPIFY_TILES_KEY}`,
      center: [-98, 39],
      zoom: 4,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    const overlay = new MapboxOverlay({ layers: [] })
    map.addControl(overlay as unknown as maplibregl.IControl)
    overlayRef.current = overlay

    map.on('click', (event) => {
      if (!drawActiveRef.current) return
      // A vertex drag that ends within click tolerance still fires a click —
      // don't turn it into a new point.
      if (justDraggedRef.current) {
        justDraggedRef.current = false
        return
      }
      const point: [number, number] = [event.lngLat.lng, event.lngLat.lat]
      const last = drawPointsRef.current[drawPointsRef.current.length - 1]
      // A double-click lands as two clicks at the same spot — one vertex.
      if (last && last[0] === point[0] && last[1] === point[1]) return
      const next = [...drawPointsRef.current, point]
      drawPointsRef.current = next
      setDrawPoints(next)
      onDrawPointCountRef.current?.(next.length)
      onPolygonChangeRef.current(next.length >= 3 ? next : null)
    })

    // Vertex dragging: grab a boundary point and move it. The shape updates
    // live; the page's counts settle on release (a 180k-dot ray-cast per
    // mousemove is wasted work mid-drag).
    const pickVertex = (x: number, y: number): number | null => {
      const info = overlayRef.current?.pickObject({
        x,
        y,
        radius: 8,
        layerIds: ['draw-vertices'],
      })
      return info && info.index >= 0 ? info.index : null
    }
    map.on('mousedown', (event) => {
      if (!drawActiveRef.current) return
      const index = pickVertex(event.point.x, event.point.y)
      if (index === null) return
      dragIndexRef.current = index
      map.dragPan.disable()
      event.preventDefault()
    })
    map.on('mousemove', (event) => {
      if (!drawActiveRef.current) return
      if (dragIndexRef.current !== null) {
        const next = [...drawPointsRef.current]
        next[dragIndexRef.current] = [event.lngLat.lng, event.lngLat.lat]
        drawPointsRef.current = next
        setDrawPoints(next)
        return
      }
      map.getCanvas().style.cursor =
        pickVertex(event.point.x, event.point.y) !== null ? 'move' : ''
    })
    map.on('mouseup', () => {
      if (dragIndexRef.current === null) return
      dragIndexRef.current = null
      justDraggedRef.current = true
      map.dragPan.enable()
      const points = drawPointsRef.current
      onPolygonChangeRef.current(points.length >= 3 ? points : null)
    })

    const bounds = packBounds(pack.positions)
    if (bounds) {
      map.fitBounds(bounds, { padding: 48, animate: false })
    }

    return () => {
      overlayRef.current = null
      mapRef.current = null
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
        new PolygonLayer<PolygonRing>({
          id: 'draw-preview',
          data: drawPoints.length >= 3 ? [drawPoints] : [],
          getPolygon: (ring) => ring,
          getFillColor: DRAW_BLUE_FILL,
          getLineColor: DRAW_BLUE,
          lineWidthMinPixels: 2.5,
          pickable: false,
        }),
        new ScatterplotLayer<[number, number]>({
          id: 'draw-vertices',
          data: drawPoints,
          getPosition: (point) => point,
          getFillColor: DRAW_BLUE,
          getLineColor: [255, 255, 255, 255],
          stroked: true,
          lineWidthMinPixels: 1.5,
          radiusMinPixels: 5,
          radiusMaxPixels: 8,
          getRadius: 6,
          pickable: true,
        }),
        new ScatterplotLayer<RoutePin>({
          id: 'route-pins',
          data: routePins,
          getPosition: (pin) => [pin.lng, pin.lat],
          getFillColor: [11, 21, 40, 235],
          getLineColor: [255, 255, 255, 255],
          lineWidthMinPixels: 2,
          stroked: true,
          radiusMinPixels: 11,
          radiusMaxPixels: 14,
          getRadius: 12,
          pickable: false,
        }),
        new TextLayer<RoutePin>({
          id: 'route-pin-numbers',
          data: routePins,
          getPosition: (pin) => [pin.lng, pin.lat],
          getText: (pin) => String(pin.seq),
          getColor: [255, 255, 255, 255],
          getSize: 12,
          fontWeight: 700,
          pickable: false,
        }),
      ],
    })
  }, [pack, filterResult, turfs, routePins, drawPoints])

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

  // Fit once per distinct route: refit when the pin set actually changes,
  // not on every rerender that passes the same array contents.
  const fittedRouteRef = useRef<string | null>(null)
  useEffect(() => {
    if (routePins.length === 0) {
      fittedRouteRef.current = null
      return
    }
    const first = routePins[0]
    const last = routePins[routePins.length - 1]
    const signature = `${routePins.length}:${first?.lat},${first?.lng}:${last?.lat},${last?.lng}`
    if (fittedRouteRef.current === signature || !mapRef.current) return
    fittedRouteRef.current = signature
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const pin of routePins) {
      if (pin.lng < minX) minX = pin.lng
      if (pin.lng > maxX) maxX = pin.lng
      if (pin.lat < minY) minY = pin.lat
      if (pin.lat > maxY) maxY = pin.lat
    }
    mapRef.current.fitBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      { padding: 80 },
    )
  }, [routePins])

  useEffect(() => {
    if (startDrawToken === 0) return
    drawActiveRef.current = true
    dragIndexRef.current = null
    drawPointsRef.current = []
    setDrawPoints([])
    onDrawPointCountRef.current?.(0)
    onPolygonChangeRef.current(null)
    // Adding vertices shouldn't fight the zoom gesture.
    mapRef.current?.doubleClickZoom.disable()
  }, [startDrawToken])

  useEffect(() => {
    if (clearDrawToken === 0) return
    drawActiveRef.current = false
    dragIndexRef.current = null
    drawPointsRef.current = []
    setDrawPoints([])
    onDrawPointCountRef.current?.(0)
    onPolygonChangeRef.current(null)
    mapRef.current?.doubleClickZoom.enable()
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
