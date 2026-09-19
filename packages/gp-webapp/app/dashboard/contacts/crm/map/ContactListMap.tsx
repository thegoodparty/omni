import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Button } from '@styleguide'
import { NEXT_PUBLIC_GEOAPIFY_TILES_KEY } from 'appEnv'
import {
  ringInsertIndex,
  type PolygonRing,
} from 'app/dashboard/shared/ringGeometry'
import type { Person } from '../shared/contacts-types'
import {
  boundsOf,
  toContactPoints,
  type ContactPoint,
} from './contactListPoints'

// Same tile style the door-knocking canvas uses, so the two maps in the
// product read as one map rather than two products.
const STYLE_URL = `https://maps.geoapify.com/v1/styles/osm-liberty/style.json?apiKey=${NEXT_PUBLIC_GEOAPIFY_TILES_KEY}`

// No sources, no layers: a valid style that needs no network, used only to
// replace one the tile host refused. See the error handler below.
const EMPTY_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
}

// `--primary` resolved to channels deck.gl can take, the way VoterMapCanvas
// does it: nothing on a deck.gl canvas can reach a CSS variable, so the token
// chain (--primary -> --color-brand-blue-500 -> #1e63ec) is written out and
// the test is what keeps it honest.
const PRIMARY_BLUE: [number, number, number] = [30, 99, 236]
// Stable identity, so a caller that passes no `people` does not remount the
// dots on every render through a fresh [] default.
const EMPTY_PEOPLE: Person[] = []

const DOT: [number, number, number, number] = [...PRIMARY_BLUE, 200]
const DOT_SELECTED: [number, number, number, number] = [255, 255, 255, 255]

// A dot's radius grows with how many people share the point, so an apartment
// building reads as bigger than a single-family house. Square-rooted because
// area is what the eye compares: scaling the radius linearly would make a
// 12-unit building look 12x a house rather than the ~3.5x it is.
const BASE_RADIUS_PX = 5
const MAX_RADIUS_PX = 22
const radiusFor = (count: number): number =>
  Math.min(MAX_RADIUS_PX, BASE_RADIUS_PX * Math.sqrt(count))

// Enough slop that a dot is a comfortable tap target without swallowing its
// neighbours on a dense block.
const PICK_RADIUS_PX = 6
const FIT_PADDING_PX = 48

// The drawn boundary, in the same blue as the dots it encloses — one shape on
// one map rather than two things that happen to be on screen together. The
// fill is weak enough to read the streets and the dots through, because what
// is inside the boundary is the whole question being asked of it.
const BOUNDARY_LINE: [number, number, number, number] = [...PRIMARY_BLUE, 255]
const BOUNDARY_FILL: [number, number, number, number] = [...PRIMARY_BLUE, 40]
const VERTEX_FILL: [number, number, number, number] = [255, 255, 255, 255]
const VERTEX_RADIUS_PX = 6
const VERTEX_PICK_RADIUS_PX = 10

interface ContactListMapProps {
  // Exactly one of `people` and `contactPoints` is given. Person records are
  // what every surface with an overlay behind its dots has in hand; the draw
  // step does not, so it asks gp-api for bare coordinates instead of pulling
  // thirty columns per constituent it will never read.
  people?: Person[]
  contactPoints?: ContactPoint[]
  selectedPersonId?: string | null
  // Omitted where the dots are markers rather than an index into anything.
  // The Chief of Staff chat is that case: there is no person overlay in a
  // transcript, so a dot that highlighted and opened a list of names would be
  // offering a door with nothing behind it. Absent, the layer is not pickable
  // at all rather than pickable-but-inert, so the cursor never suggests
  // otherwise.
  onSelectPerson?: (personId: string) => void
  // Whether `people` is only the first page of a longer list. It changes what
  // the unmappable count can honestly claim: `unmappable` is measured over
  // the rows actually fetched, so on a truncated list it describes the page
  // and not the list, and the wording has to say so.
  truncated?: boolean
  // Screen space at the bottom of the canvas that something else is covering
  // — the draw panel's control bar. Added to the framing padding so the fit
  // puts every dot ABOVE the chrome rather than centring the list and leaving
  // the southernmost people underneath it, which on a north-south district is
  // most of a neighbourhood.
  bottomInsetPx?: number
  // The boundary narrowing this list, as an open ring. Given without
  // `onDrawRingChange` it is a saved outline drawn read-only — a locked list
  // still shows the geography it was cut with. Given with it, the map is the
  // drawing surface: a click places a vertex and a handle can be dragged.
  drawRing?: PolygonRing
  onDrawRingChange?: (ring: PolygonRing) => void
}

export default function ContactListMap({
  people = EMPTY_PEOPLE,
  contactPoints,
  selectedPersonId,
  onSelectPerson,
  truncated = false,
  bottomInsetPx = 0,
  drawRing,
  onDrawRingChange,
}: ContactListMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  // Same guard VoterMapCanvas carries, for the same reason: the key is empty
  // rather than absent when unset, so without this the style URL goes out as
  // `?apiKey=`, the tile CDN 401s, and the surface renders as a blank panel
  // with nothing to explain it. On an environment that has no key — a preview
  // or a fresh local box — that is indistinguishable from the feature being
  // broken, which is exactly how it was first reported.
  const hasTilesKey = NEXT_PUBLIC_GEOAPIFY_TILES_KEY.length > 0
  // Which multi-resident dot the user opened, if any. A single-resident dot
  // selects its person directly and never lands here.
  const [openPoint, setOpenPoint] = useState<ContactPoint | null>(null)
  const [basemapBlocked, setBasemapBlocked] = useState(false)

  // The map instance is built once and outlives every prop, so the handlers
  // registered on it read the current ring and writer through refs rather
  // than closing over the render that mounted it.
  const isDrawing = Boolean(onDrawRingChange)
  const ringRef = useRef<PolygonRing>(drawRing ?? [])
  ringRef.current = drawRing ?? []
  const onDrawRingChangeRef = useRef(onDrawRingChange)
  onDrawRingChangeRef.current = onDrawRingChange
  const dragIndexRef = useRef<number | null>(null)
  // A vertex drag that ends inside the browser's click tolerance still fires
  // a click; without this it would place a second vertex on top of the one
  // just moved.
  const justDraggedRef = useRef(false)

  const derived = useMemo(() => toContactPoints(people), [people])
  // Coordinates given directly carry no unmappable count. The query behind
  // them selects lat/lng, so every row it returns has a location and the
  // response cannot describe the ones it dropped — a caller that needs to
  // say "N have no location on file" has to count them itself.
  const { points, unmappable } = contactPoints
    ? { points: contactPoints, unmappable: 0 }
    : derived

  // Switching lists inside an open sheet re-renders this component rather
  // than remounting it, so an open popover would survive the swap and its
  // buttons would still carry the previous list's people. Clicking one then
  // selects someone who is not in the list on screen.
  useEffect(() => {
    setOpenPoint(null)
  }, [points])

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !hasTilesKey) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [-98, 39],
      zoom: 3,
      attributionControl: false,
    })
    // A present-but-rejected key fails differently from a missing one, and
    // far more confusingly: the deck.gl overlay is independent of the
    // basemap, so the dots draw normally over blank white and the surface
    // looks like a half-broken feature rather than a config problem. The
    // tiles key is domain-restricted (appEnv.ts), so any host not on its
    // allowlist — every Vercel preview — lands here.
    let swappedToEmptyStyle = false
    map.on('error', (event) => {
      const status = (event.error as { status?: number } | undefined)?.status
      if (status !== 401 && status !== 403) return
      setBasemapBlocked(true)
      // And give the map a style it CAN load, because the dots depend on it.
      // A style that 401s leaves the map permanently unloaded, and the deck
      // overlay takes its viewport from the map's render loop — so the camera
      // moves to the list (fitBounds works fine) while the dots stay at the
      // opening view over the middle of the country, piled into one blob.
      // Panning the map by hand was the only thing that resynced them.
      // Swapping in an empty style finishes the load and the dots land where
      // the camera already is; setStyle preserves it, so there is nothing to
      // re-fit. Guarded because the error fires per failed tile request.
      if (swappedToEmptyStyle) return
      swappedToEmptyStyle = true
      map.setStyle(EMPTY_STYLE)
    })
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right',
    )
    // Slop on top of each dot's drawn radius. A Deck prop, not a layer one.
    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
      pickingRadius: PICK_RADIUS_PX,
    })
    map.addControl(overlay)

    // Drawing. Every handler below no-ops unless a writer is present, so a
    // caller that never passes one gets the map it always had.
    const pickVertex = (x: number, y: number): number | null => {
      const info = overlayRef.current?.pickObject({
        x,
        y,
        radius: VERTEX_PICK_RADIUS_PX,
        layerIds: ['boundary-vertices'],
      })
      return info && info.index >= 0 ? info.index : null
    }
    map.on('click', (event) => {
      const write = onDrawRingChangeRef.current
      if (!write) return
      if (justDraggedRef.current) {
        justDraggedRef.current = false
        return
      }
      const point: [number, number] = [event.lngLat.lng, event.lngLat.lat]
      // A double-click arrives as two clicks at one spot. Checked against
      // every vertex, not just the last: the second click now lands ON the
      // one the first placed and would splice a twin beside it.
      if (
        ringRef.current.some(
          (vertex) => vertex[0] === point[0] && vertex[1] === point[1],
        )
      ) {
        return
      }
      const next = [...ringRef.current]
      next.splice(ringInsertIndex(ringRef.current, point), 0, point)
      write(next)
    })
    map.on('mousedown', (event) => {
      justDraggedRef.current = false
      if (!onDrawRingChangeRef.current) return
      const index = pickVertex(event.point.x, event.point.y)
      if (index === null) return
      dragIndexRef.current = index
      map.dragPan.disable()
      map.getCanvas().style.cursor = 'grabbing'
      event.preventDefault()
    })
    map.on('mousemove', (event) => {
      const write = onDrawRingChangeRef.current
      const index = dragIndexRef.current
      if (!write || index === null) return
      const next = [...ringRef.current]
      next[index] = [event.lngLat.lng, event.lngLat.lat]
      write(next)
      // maplibre's own handlers reset the cursor to 'grab' on every
      // mousemove even with dragPan disabled, so one set in mousedown does
      // not survive the drag.
      map.getCanvas().style.cursor = 'grabbing'
    })
    map.on('mouseup', () => {
      if (dragIndexRef.current === null) return
      dragIndexRef.current = null
      justDraggedRef.current = true
      map.dragPan.enable()
      map.getCanvas().style.cursor = ''
    })

    mapRef.current = map
    overlayRef.current = overlay
    return () => {
      overlayRef.current = null
      mapRef.current = null
      map.remove()
    }
  }, [hasTilesKey])

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    const selectedKey = selectedPersonId ?? null
    const ring = drawRing ?? []
    overlay.setProps({
      layers: [
        new ScatterplotLayer<ContactPoint>({
          id: 'contacts',
          data: points,
          // A dot that opened a person mid-draw would take the boundary's
          // click and turn a vertex into a navigation.
          pickable: Boolean(onSelectPerson) && !isDrawing,
          radiusUnits: 'pixels',
          lineWidthUnits: 'pixels',
          stroked: true,
          getLineWidth: 1,
          getLineColor: PRIMARY_BLUE.concat(255) as [
            number,
            number,
            number,
            number,
          ],
          getPosition: (p) => [p.lng, p.lat],
          getRadius: (p) => radiusFor(p.residents.length),
          getFillColor: (p) =>
            selectedKey && p.residents.some((r) => r.id === selectedKey)
              ? DOT_SELECTED
              : DOT,
          radiusMinPixels: BASE_RADIUS_PX,
          updateTriggers: { getFillColor: [selectedKey] },
          onClick: ({ object }) => {
            if (!object || !onSelectPerson) return false
            if (object.residents.length === 1) {
              setOpenPoint(null)
              onSelectPerson(object.residents[0]!.id)
              return true
            }
            setOpenPoint(object)
            return true
          },
        }),
        // Appended rather than always present: with no boundary to draw the
        // overlay gets exactly the one layer it has always had.
        ...(ring.length >= 3
          ? [
              new PolygonLayer<PolygonRing>({
                id: 'boundary',
                data: [ring],
                getPolygon: (r) => r,
                getFillColor: BOUNDARY_FILL,
                getLineColor: BOUNDARY_LINE,
                lineWidthMinPixels: 2.5,
                pickable: false,
              }),
            ]
          : []),
        // Handles only while the boundary is editable — a saved outline on a
        // locked list has nothing to grab.
        ...(isDrawing && ring.length > 0
          ? [
              new ScatterplotLayer<[number, number]>({
                id: 'boundary-vertices',
                data: ring,
                getPosition: (point) => point,
                // Hollow: a filled disc reads as another placed dot rather
                // than as something to grab, which at the density a block is
                // drawn at is indistinguishable from the people underneath.
                getFillColor: VERTEX_FILL,
                getLineColor: BOUNDARY_LINE,
                stroked: true,
                filled: true,
                lineWidthMinPixels: 2.5,
                radiusUnits: 'pixels',
                getRadius: VERTEX_RADIUS_PX,
                radiusMinPixels: 5,
                pickable: true,
              }),
            ]
          : []),
      ],
    })
  }, [points, selectedPersonId, onSelectPerson, drawRing, isDrawing])

  // Frame the list once it is known, and again whenever the list changes
  // underneath (a re-cut segment is a different set of people, and leaving the
  // camera where it was would show the old neighbourhood).
  useEffect(() => {
    const map = mapRef.current
    const bounds = boundsOf(points)
    if (!map || !bounds) return
    map.fitBounds(
      [
        [bounds.minLng, bounds.minLat],
        [bounds.maxLng, bounds.maxLat],
      ],
      {
        padding: {
          top: FIT_PADDING_PX,
          left: FIT_PADDING_PX,
          right: FIT_PADDING_PX,
          bottom: FIT_PADDING_PX + bottomInsetPx,
        },
        duration: 0,
        maxZoom: 16,
      },
    )
  }, [points, bottomInsetPx])

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
      <div
        ref={containerRef}
        className="h-full w-full"
        data-testid="contact-map"
      />

      {/* Both notices are absolute over the dots rather than replacing them:
          the points are real and still worth reading, and hiding them would
          throw away the half of the map that works. Stacked in one column
          because a blocked basemap and unmappable people co-occur routinely —
          a preview deploy of a list with partial coordinates hits both — and
          positioning them independently put one on top of the other. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col items-start gap-1">
        {basemapBlocked ? (
          <div className="w-full rounded-md bg-background/95 px-2 py-1 text-center text-xs text-muted-foreground shadow">
            The background map could not load here. Its tiles key does not allow
            this domain.
          </div>
        ) : null}

        {unmappable > 0 ? (
          <div className="rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow">
            {unmappable} of {people.length.toLocaleString()}
            {truncated ? ' shown' : ''} have no location on file
          </div>
        ) : null}
      </div>

      {openPoint && onSelectPerson ? (
        <div className="absolute bottom-3 left-3 max-h-56 w-64 overflow-auto rounded-md bg-background p-2 shadow-lg">
          <div className="mb-1 px-1 text-xs text-muted-foreground">
            {openPoint.residents.length} people at this address
          </div>
          {openPoint.residents.map((resident) => (
            <Button
              key={resident.id}
              variant="ghost"
              size="small"
              className="w-full justify-start font-normal"
              onClick={() => {
                setOpenPoint(null)
                onSelectPerson(resident.id)
              }}
            >
              {[resident.firstName, resident.lastName]
                .filter(Boolean)
                .join(' ') || 'Unnamed constituent'}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
