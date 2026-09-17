import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer } from '@deck.gl/layers'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Button } from '@styleguide'
import { NEXT_PUBLIC_GEOAPIFY_TILES_KEY } from 'appEnv'
import type { Person } from '../shared/contacts-types'
import {
  boundsOf,
  toContactPoints,
  type ContactPoint,
} from './contactListPoints'

// Same tile style the door-knocking canvas uses, so the two maps in the
// product read as one map rather than two products.
const STYLE_URL = `https://maps.geoapify.com/v1/styles/osm-liberty/style.json?apiKey=${NEXT_PUBLIC_GEOAPIFY_TILES_KEY}`

// `--primary` resolved to channels deck.gl can take, the way VoterMapCanvas
// does it: nothing on a deck.gl canvas can reach a CSS variable, so the token
// chain (--primary -> --color-brand-blue-500 -> #1e63ec) is written out and
// the test is what keeps it honest.
const PRIMARY_BLUE: [number, number, number] = [30, 99, 236]
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

interface ContactListMapProps {
  people: Person[]
  selectedPersonId?: string | null
  onSelectPerson: (personId: string) => void
}

export default function ContactListMap({
  people,
  selectedPersonId,
  onSelectPerson,
}: ContactListMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  // Which multi-resident dot the user opened, if any. A single-resident dot
  // selects its person directly and never lands here.
  const [openPoint, setOpenPoint] = useState<ContactPoint | null>(null)

  const { points, unmappable } = useMemo(
    () => toContactPoints(people),
    [people],
  )

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [-98, 39],
      zoom: 3,
      attributionControl: false,
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
    mapRef.current = map
    overlayRef.current = overlay
    return () => {
      overlayRef.current = null
      mapRef.current = null
      map.remove()
    }
  }, [])

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    const selectedKey = selectedPersonId ?? null
    overlay.setProps({
      layers: [
        new ScatterplotLayer<ContactPoint>({
          id: 'contacts',
          data: points,
          pickable: true,
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
            if (!object) return false
            if (object.residents.length === 1) {
              setOpenPoint(null)
              onSelectPerson(object.residents[0]!.id)
              return true
            }
            setOpenPoint(object)
            return true
          },
        }),
      ],
    })
  }, [points, selectedPersonId, onSelectPerson])

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
      { padding: FIT_PADDING_PX, duration: 0, maxZoom: 16 },
    )
  }, [points])

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full"
        data-testid="contact-map"
      />

      {unmappable > 0 ? (
        <div className="absolute left-3 top-3 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow">
          {unmappable} of {people.length} have no location on file
        </div>
      ) : null}

      {openPoint ? (
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
