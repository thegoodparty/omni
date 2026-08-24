'use client'

import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer } from '@deck.gl/layers'
import 'maplibre-gl/dist/maplibre-gl.css'
import { PathLayer, PolygonLayer, TextLayer } from '@deck.gl/layers'
import {
  DOOR_KNOCK_STATUSES,
  DoorKnockingTurf,
  DoorKnockStatus,
  RoutePathGeometry,
} from '@goodparty_org/contracts'
import { NEXT_PUBLIC_GEOAPIFY_TILES_KEY } from 'appEnv'
import { STATUS_RGB } from './statusPresentation'
import { DecodedPack } from './packDecoder'
import { FilterResult } from './filterEngine'
import LiveLocationControl from './LiveLocationControl'
import { LiveLocationFix, useLiveLocation } from './useLiveLocation'

// Dots and legend chips share one palette (statusPresentation.ts) so they
// cannot disagree; indexes match DOOR_KNOCK_STATUSES order (the status
// bytes in the filter result are array indexes).
const STATUS_COLORS: Array<[number, number, number, number]> =
  DOOR_KNOCK_STATUSES.map((status) => [...STATUS_RGB[status], 210])
const UNMATCHED_COLOR: [number, number, number, number] = [190, 195, 200, 60]
// The demo's action blue for the in-progress boundary.
const DRAW_BLUE: [number, number, number, number] = [19, 81, 216, 255]
const DRAW_BLUE_FILL: [number, number, number, number] = [19, 81, 216, 40]
// "You are here": the same action blue, muted when the fix is too coarse to
// trust, so a bad fix reads as a guess rather than a claim.
const LOCATION_BLUE: [number, number, number, number] = [19, 81, 216, 255]
const LOCATION_BLUE_APPROX: [number, number, number, number] = [
  19, 81, 216, 120,
]
const LOCATION_HALO: [number, number, number, number] = [19, 81, 216, 38]
// Slop in pixels around a route pin's own 11-14px radius. The whole feature is
// used one-handed on a phone in the street, so the tap target has to clear the
// ~44px a thumb needs rather than the ~24px the pin is drawn at.
const PIN_TAP_RADIUS = 12

export type PolygonRing = Array<[number, number]>

export interface RoutePin {
  // Which stop this pin is, so a tap can be turned back into a door to open.
  // `seq` orders the route and is not the route payload's identity for a stop.
  stopId: number
  seq: number
  lat: number
  lng: number
  status: DoorKnockStatus
  // Whether anyone at this stop is still a target (`stopIsKnockable`). A stop
  // where every resident is flagged rolls up over an empty list, so `status` is
  // the same `unknown` grey as a stop nobody has been to — and the pin is what
  // a canvasser is actually standing in front of, so this is the surface where
  // that ambiguity costs a walk to a door they were told to skip.
  knockable: boolean
}

interface VoterMapCanvasProps {
  pack: DecodedPack
  filterResult: FilterResult
  turfs: DoorKnockingTurf[]
  // Numbered stop pins for the open route's walk view.
  routePins: RoutePin[]
  // Closed-loop routes draw the return leg back to stop 1.
  routeLoop: boolean
  // Road-following path frozen at knock; straight legs are the fallback.
  routeGeometry: RoutePathGeometry | null
  focusTurf: DoorKnockingTurf | null
  // Street-level opening view; without it the map frames the whole pack.
  initialZoom?: number
  // Bump to enter polygon-draw mode (the page owns the Draw button), and to
  // restart it: emptying the ring while staying in draw mode is exactly what
  // the draw step's Clear does.
  startDrawToken: number
  // Bump to clear the in-progress drawing AND leave draw mode (e.g. after a
  // turf is saved, or when the flow closes).
  clearDrawToken: number
  // Bump to drop the most recently added vertex. Add-only by design: a drag
  // corrects itself by dragging again, so the ring stays the whole history
  // instead of becoming an edit stack.
  undoDrawToken: number
  onPolygonChange: (ring: PolygonRing | null) => void
  // Fires with the vertex count as points are placed (0 on start/clear) —
  // the page uses it to dismiss the draw instructions on the first click.
  onDrawPointCount?: (count: number) => void
  // A tap on a numbered stop pin, which is the canvasser's way into that
  // door's log from the map. Never fires while drawing: a tap is a vertex
  // there, and the two are different modes.
  onRoutePinClick?: (pin: RoutePin) => void
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

// Where the map opens when the page names a zoom instead of a framing. The
// bounding box's midpoint is a geometric artifact rather than a place: an
// L-shaped or crescent district, one split by a lake or a park, or two towns
// with farmland between them all put it where nobody lives — and at street
// zoom an empty midpoint is the entire screen, which is how the opening view
// was reported as having no dots in it at all. The bbox is also the statistic
// a single bad coordinate moves furthest, since it reads only the four
// extremes and the pack's coordinates are unvalidated vendor data (gp-api's
// voterPack service gates on rooftop accuracy and a numeric-text regex, never
// on a range or on the district's own shape).
//
// So the anchor is a component-wise median and the answer is the real dot
// nearest it. The median holds up where a mean would not: a cluster holding
// more than half the dots brackets the median rank on both axes, so a
// two-town district opens in the larger town rather than the fields between,
// and one mis-keyed row moves the anchor by one rank instead of by its own
// distance. Snapping to a real dot is what makes the guarantee unconditional
// — the center is a coordinate someone lives at for any shape, including the
// even two-way split where the median itself lands in the gap.
export const packOpeningCenter = (
  positions: Float32Array,
): [number, number] | null => {
  const dots = positions.length >> 1
  if (dots === 0) return null
  const lngs = new Float32Array(dots)
  const lats = new Float32Array(dots)
  for (let i = 0; i < dots; i++) {
    lngs[i] = positions[i * 2] ?? 0
    lats[i] = positions[i * 2 + 1] ?? 0
  }
  // TypedArray sort is numeric without a comparator. O(n log n) once at
  // mount, in place of the O(n) sweep `packBounds` did on this branch.
  lngs.sort()
  lats.sort()
  const mid = dots >> 1
  const anchorLng = lngs[mid] ?? 0
  const anchorLat = lats[mid] ?? 0
  // Scaled for the reason distanceToSegment below scales: compared in bare
  // degrees a district's east-west spread reads wider than it is on the
  // ground, and the wrong dot wins.
  const lngScale = Math.cos((anchorLat * Math.PI) / 180)
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < dots; i++) {
    const dx = ((positions[i * 2] ?? 0) - anchorLng) * lngScale
    const dy = (positions[i * 2 + 1] ?? 0) - anchorLat
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return [positions[best * 2] ?? 0, positions[best * 2 + 1] ?? 0]
}

// Shortest distance from `point` to the segment a-b. Longitude is scaled by
// cos(latitude) first because a degree of longitude is only ~0.75 of a degree
// of latitude at US latitudes — compared in raw degrees, a tall narrow ring's
// long sides read as closer than they are and the wrong edge wins.
const distanceToSegment = (
  point: [number, number],
  a: [number, number],
  b: [number, number],
  lngScale: number,
): number => {
  const px = point[0] * lngScale
  const ax = a[0] * lngScale
  const dx = b[0] * lngScale - ax
  const dy = b[1] - a[1]
  const lengthSq = dx * dx + dy * dy
  const projected =
    lengthSq === 0 ? 0 : ((px - ax) * dx + (point[1] - a[1]) * dy) / lengthSq
  const t = Math.max(0, Math.min(1, projected))
  return Math.hypot(px - (ax + t * dx), point[1] - (a[1] + t * dy))
}

// Where a tap belongs in the ring being drawn. Under three points there are no
// edges yet, so it appends; from three the ring is read as closed and the point
// splices into whichever edge it is nearest. Appending unconditionally meant a
// tap between two existing vertices jumped the boundary across the shape and
// back, leaving a criss-crossed, self-intersecting outline.
export const ringInsertIndex = (
  ring: PolygonRing,
  point: [number, number],
): number => {
  if (ring.length < 3) return ring.length
  const lngScale = Math.cos((point[1] * Math.PI) / 180)
  let bestIndex = ring.length
  let bestDistance = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    if (!a || !b) continue
    const distance = distanceToSegment(point, a, b, lngScale)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = i + 1
    }
  }
  return bestIndex
}

export default function VoterMapCanvas({
  pack,
  filterResult,
  turfs,
  routePins,
  routeLoop,
  routeGeometry,
  focusTurf,
  initialZoom,
  startDrawToken,
  clearDrawToken,
  undoDrawToken,
  onPolygonChange,
  onDrawPointCount,
  onRoutePinClick,
}: VoterMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const hasTilesKey = NEXT_PUBLIC_GEOAPIFY_TILES_KEY.length > 0
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  // The mount effect's one read of the pack is the opening view, which — like
  // initialZoom beside it — is a mount-time fact and not a controlled camera.
  // Depending on the object instead tied the map's lifetime to the pack's
  // identity: a refetch after a walk destroyed the MapLibre instance through
  // map.remove() and re-framed the district, throwing away wherever the
  // canvasser had panned to. The overlay effect below still depends on `pack`,
  // which is what repaints the dots.
  const packRef = useRef(pack)
  packRef.current = pack
  // Click-to-add-vertex drawing (mapbox-gl-draw's finish gesture is
  // unreliable on maplibre): every click appends a point and the shape
  // closes itself from whatever points exist — there is no finish gesture.
  const drawActiveRef = useRef(false)
  const [drawPoints, setDrawPoints] = useState<PolygonRing>([])
  const drawPointsRef = useRef<PolygonRing>([])
  // Ring indexes in the order they were placed. The array used to BE that
  // record — appending meant the newest vertex was always the last element —
  // and edge insertion takes it away, so undo (still last-add only) needs it
  // kept explicitly. Drags are deliberately absent: a moved vertex is corrected
  // by moving it again, and recording them would turn this into an edit stack.
  const addOrderRef = useRef<number[]>([])
  const dragIndexRef = useRef<number | null>(null)
  const justDraggedRef = useRef(false)
  const endDragRef = useRef<(() => void) | null>(null)
  const onPolygonChangeRef = useRef(onPolygonChange)
  onPolygonChangeRef.current = onPolygonChange
  const onDrawPointCountRef = useRef(onDrawPointCount)
  onDrawPointCountRef.current = onDrawPointCount
  const onRoutePinClickRef = useRef(onRoutePinClick)
  onRoutePinClickRef.current = onRoutePinClick
  // Opt-in: nothing is watched until the canvasser asks to be shown.
  const [locationEnabled, setLocationEnabled] = useState(false)
  const location = useLiveLocation(locationEnabled)
  const locationFix = location.fix

  useEffect(() => {
    if (!containerRef.current || !hasTilesKey) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: `https://maps.geoapify.com/v1/styles/osm-liberty/style.json?apiKey=${NEXT_PUBLIC_GEOAPIFY_TILES_KEY}`,
      center: [-98, 39],
      zoom: 4,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    // osm-liberty ships transit overlays and 3D building extrusions we
    // don't want on a canvassing map. Transit hides entirely; buildings
    // keep their footprints but flatten (height 0) — canvassers want to see
    // building outlines when zoomed in, just not in 3D.
    map.on('style.load', () => {
      for (const layer of map.getStyle().layers ?? []) {
        if (layer.type === 'fill-extrusion') {
          map.setPaintProperty(layer.id, 'fill-extrusion-height', 0)
          map.setPaintProperty(layer.id, 'fill-extrusion-base', 0)
          continue
        }
        if (/transit|railway|rail|ferry|aeroway/i.test(layer.id)) {
          map.setLayoutProperty(layer.id, 'visibility', 'none')
        }
      }
    })

    const overlay = new MapboxOverlay({ layers: [] })
    map.addControl(overlay as unknown as maplibregl.IControl)
    overlayRef.current = overlay

    // Same picking idiom as pickVertex below. The radius is slop on top of the
    // pin's own drawn radius, because this is tapped with a thumb in the street.
    const pickRoutePin = (x: number, y: number): RoutePin | null => {
      const info = overlayRef.current?.pickObject({
        x,
        y,
        radius: PIN_TAP_RADIUS,
        layerIds: ['route-pins'],
      })
      return (info?.object as RoutePin | undefined) ?? null
    }

    map.on('click', (event) => {
      if (!drawActiveRef.current) {
        // Knock mode: the pin under the thumb is the door to log. Gated on the
        // same flag the vertex path is, so a pin tap can never become a vertex
        // and a drawing tap can never open a door. On the landing map the pin
        // layer has no data, so nothing is picked.
        const pin = pickRoutePin(event.point.x, event.point.y)
        if (pin) onRoutePinClickRef.current?.(pin)
        return
      }
      // A vertex drag that ends within click tolerance still fires a click —
      // don't turn it into a new point.
      if (justDraggedRef.current) {
        justDraggedRef.current = false
        return
      }
      const point: [number, number] = [event.lngLat.lng, event.lngLat.lat]
      // A double-click lands as two clicks at the same spot — one vertex.
      // Checked against every vertex rather than the last one: the second click
      // now lands ON the vertex the first placed and splices beside it, so
      // "twice in the same spot" stopped meaning "twice at the end of the ring".
      if (
        drawPointsRef.current.some(
          (vertex) => vertex[0] === point[0] && vertex[1] === point[1],
        )
      ) {
        return
      }
      const index = ringInsertIndex(drawPointsRef.current, point)
      const next = [...drawPointsRef.current]
      next.splice(index, 0, point)
      addOrderRef.current = [
        ...addOrderRef.current.map((added) =>
          added >= index ? added + 1 : added,
        ),
        index,
      ]
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
    const beginDrag = (point: { x: number; y: number }): boolean => {
      if (!drawActiveRef.current) return false
      const index = pickVertex(point.x, point.y)
      if (index === null) return false
      dragIndexRef.current = index
      map.dragPan.disable()
      return true
    }
    const moveDrag = (lngLat: { lng: number; lat: number }) => {
      if (dragIndexRef.current === null) return false
      const next = [...drawPointsRef.current]
      next[dragIndexRef.current] = [lngLat.lng, lngLat.lat]
      drawPointsRef.current = next
      setDrawPoints(next)
      return true
    }
    const endDrag = () => {
      if (dragIndexRef.current === null) return
      dragIndexRef.current = null
      justDraggedRef.current = true
      map.dragPan.enable()
      const points = drawPointsRef.current
      onPolygonChangeRef.current(points.length >= 3 ? points : null)
    }
    endDragRef.current = endDrag

    map.on('mousedown', (event) => {
      if (beginDrag(event.point)) event.preventDefault()
    })
    map.on('mousemove', (event) => {
      if (!drawActiveRef.current) return
      if (moveDrag(event.lngLat)) return
      map.getCanvas().style.cursor =
        pickVertex(event.point.x, event.point.y) !== null ? 'move' : ''
    })
    map.on('mouseup', endDrag)
    // Releasing outside the canvas (or the window) never fires the map's
    // mouseup — without this, dragPan stays disabled for the session.
    const canvas = map.getCanvas()
    canvas.addEventListener('mouseleave', endDrag)
    const onWindowMouseUp = (event: MouseEvent) => {
      const target = event.target
      const releasedOnCanvas =
        target instanceof Node && (target === canvas || canvas.contains(target))
      endDrag()
      // justDraggedRef exists so the click that follows a release inside the
      // canvas doesn't become a vertex, and that click clears it. A release
      // outside never produces the click, so the flag would survive and eat
      // the next intentional one — clear it here instead. Checked against the
      // release point rather than dragIndexRef: this listener also sees the
      // in-canvas mouseup bubble up, by which time endDrag has already nulled
      // the index, so keying on the index would clear the flag every time and
      // put the spurious vertex back.
      if (!releasedOnCanvas) justDraggedRef.current = false
    }
    window.addEventListener('mouseup', onWindowMouseUp)
    // MapLibre does not synthesize mouse events from touch drags — mirror
    // the drag handlers so vertices are repositionable on phones.
    map.on('touchstart', (event) => {
      if (event.points.length !== 1) return
      if (beginDrag(event.point)) event.preventDefault()
    })
    map.on('touchmove', (event) => {
      // dragPan is disabled mid-drag, so maplibre's TouchPanHandler is no
      // longer suppressing the native scroll. MapTouchEvent.preventDefault
      // only sets maplibre's internal flag; the page keeps scrolling unless
      // the underlying touchmove (registered non-passive) is prevented.
      if (moveDrag(event.lngLat)) event.originalEvent.preventDefault()
    })
    map.on('touchend', endDrag)
    map.on('touchcancel', endDrag)

    // Read at mount only: this names the opening view, not a controlled
    // zoom — reacting to it later would fight the canvasser's own panning.
    if (initialZoom === undefined) {
      const bounds = packBounds(packRef.current.positions)
      if (bounds) map.fitBounds(bounds, { padding: 48, animate: false })
    } else {
      const center = packOpeningCenter(packRef.current.positions)
      if (center) map.jumpTo({ center, zoom: initialZoom })
    }

    return () => {
      canvas.removeEventListener('mouseleave', endDrag)
      window.removeEventListener('mouseup', onWindowMouseUp)
      endDragRef.current = null
      overlayRef.current = null
      mapRef.current = null
      map.remove()
    }
    // The map lives as long as its container — everything dynamic, the pack
    // included, flows through the overlay effect below.
  }, [hasTilesKey])

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
        new PathLayer<[number, number][]>({
          id: 'route-path',
          // Straight seq-order legs: the road-following polylines are
          // deliberately not stored (Geoapify caching terms) — this is the
          // designed fallback geometry.
          data: (() => {
            // Prefer the frozen road-following geometry; straight seq-order
            // legs only when a route shipped without one.
            if (routeGeometry) {
              return routeGeometry.type === 'MultiLineString'
                ? routeGeometry.coordinates
                : [routeGeometry.coordinates]
            }
            if (routePins.length < 2) return []
            const ordered = [...routePins].sort((a, b) => a.seq - b.seq)
            const path = ordered.map(
              (pin) => [pin.lng, pin.lat] as [number, number],
            )
            if (routeLoop && path[0]) path.push(path[0])
            return [path]
          })(),
          getPath: (path) => path,
          getColor: [19, 81, 216, 200],
          widthMinPixels: 3,
          capRounded: true,
          jointRounded: true,
          pickable: false,
        }),
        new ScatterplotLayer<RoutePin>({
          id: 'route-pins',
          data: routePins,
          getPosition: (pin) => [pin.lng, pin.lat],
          // A stop with nobody left to knock draws hollow: the fill drops to
          // near-transparent and its own status color moves to the ring. An
          // eighth fill color would read as another outcome and would owe the
          // legend an entry, but "not a target" is a different question from
          // "which status" — an outline answers it without joining the seven
          // colors a canvasser is still learning.
          getFillColor: (pin) =>
            pin.knockable
              ? [...STATUS_RGB[pin.status], 235]
              : [255, 255, 255, 220],
          getLineColor: (pin) =>
            pin.knockable
              ? [255, 255, 255, 255]
              : [...STATUS_RGB[pin.status], 235],
          // Thicker ring on a hollow pin, so at street zoom the outline is the
          // thing that reads rather than a hairline around a white dot.
          getLineWidth: (pin) => (pin.knockable ? 2 : 3),
          lineWidthUnits: 'pixels',
          updateTriggers: {
            getFillColor: routePins,
            getLineColor: routePins,
            getLineWidth: routePins,
          },
          lineWidthMinPixels: 2,
          stroked: true,
          radiusMinPixels: 11,
          radiusMaxPixels: 14,
          getRadius: 12,
          // The map's click handler picks this layer to turn a tap into a door.
          pickable: true,
        }),
        new TextLayer<RoutePin>({
          id: 'route-pin-numbers',
          data: routePins,
          getPosition: (pin) => [pin.lng, pin.lat],
          getText: (pin) => String(pin.seq),
          // The numeral sits on the fill, so it has to invert with it — white
          // on a hollow pin is a number nobody can read.
          getColor: (pin) =>
            pin.knockable
              ? [255, 255, 255, 255]
              : [...STATUS_RGB[pin.status], 255],
          updateTriggers: { getColor: routePins },
          getSize: 12,
          fontWeight: 700,
          pickable: false,
        }),
        // The canvasser's own position, drawn last so it stays readable on
        // top of the route it is being compared against.
        new ScatterplotLayer<LiveLocationFix>({
          id: 'live-location-accuracy',
          data: locationFix ? [locationFix] : [],
          getPosition: (fix) => [fix.lng, fix.lat],
          // Real metres, so the halo means something on the street. Capped
          // in pixels because a fallback wifi/IP fix can be kilometres wide
          // and would otherwise wash out the whole viewport.
          radiusUnits: 'meters',
          getRadius: (fix) => fix.accuracyMeters,
          radiusMaxPixels: 140,
          getFillColor: LOCATION_HALO,
          stroked: false,
          pickable: false,
          updateTriggers: { getPosition: locationFix, getRadius: locationFix },
        }),
        new ScatterplotLayer<LiveLocationFix>({
          id: 'live-location-dot',
          data: locationFix ? [locationFix] : [],
          getPosition: (fix) => [fix.lng, fix.lat],
          getFillColor: location.approximate
            ? LOCATION_BLUE_APPROX
            : LOCATION_BLUE,
          getLineColor: [255, 255, 255, 255],
          stroked: true,
          lineWidthMinPixels: 2.5,
          radiusMinPixels: 7,
          radiusMaxPixels: 9,
          getRadius: 8,
          pickable: false,
          updateTriggers: {
            getPosition: locationFix,
            getFillColor: location.approximate,
          },
        }),
      ],
    })
  }, [
    pack,
    filterResult,
    turfs,
    routePins,
    routeLoop,
    routeGeometry,
    drawPoints,
    locationFix,
    location.approximate,
  ])

  // One recenter per time the canvasser turns location on: they asked where
  // they are, so show them — but only on that first fix, so the camera is
  // never yanked away from the route mid-walk as fixes keep arriving.
  const recenteredRef = useRef(false)
  useEffect(() => {
    if (!locationEnabled) {
      recenteredRef.current = false
      return
    }
    if (!locationFix || recenteredRef.current || !mapRef.current) return
    recenteredRef.current = true
    mapRef.current.easeTo({
      center: [locationFix.lng, locationFix.lat],
      duration: 600,
    })
  }, [locationEnabled, locationFix])

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
    endDragRef.current?.()
    drawActiveRef.current = true
    drawPointsRef.current = []
    addOrderRef.current = []
    setDrawPoints([])
    onDrawPointCountRef.current?.(0)
    onPolygonChangeRef.current(null)
    // Adding vertices shouldn't fight the zoom gesture.
    mapRef.current?.doubleClickZoom.disable()
  }, [startDrawToken])

  useEffect(() => {
    if (undoDrawToken === 0) return
    // Settle any in-flight drag first, or it would keep writing to an index
    // this undo is about to remove.
    endDragRef.current?.()
    // Still "drop the vertex you just placed", but that is no longer the last
    // element of the ring: a tap splices into the nearest edge, so placement
    // order is read off addOrderRef instead. Repeated bumps keep walking back
    // through the placements, which is what the array's own order used to give
    // for free. An empty record has nothing to undo rather than throwing.
    const order = [...addOrderRef.current]
    const removed = order.pop()
    if (removed === undefined) return
    addOrderRef.current = order.map((added) =>
      added > removed ? added - 1 : added,
    )
    const next = drawPointsRef.current.filter((_, index) => index !== removed)
    drawPointsRef.current = next
    setDrawPoints(next)
    onDrawPointCountRef.current?.(next.length)
    // Same gate the click handler uses, so undoing from 3 points to 2 drops
    // the polygon (and with it the counts) rather than leaving stale ones up.
    onPolygonChangeRef.current(next.length >= 3 ? next : null)
  }, [undoDrawToken])

  useEffect(() => {
    if (clearDrawToken === 0) return
    // Finish any in-flight vertex drag first — nulling the index without
    // ending the drag would leave dragPan disabled for the session.
    endDragRef.current?.()
    drawActiveRef.current = false
    drawPointsRef.current = []
    addOrderRef.current = []
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

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <LiveLocationControl
        location={location}
        enabled={locationEnabled}
        onToggle={setLocationEnabled}
      />
    </div>
  )
}
