import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { NEXT_PUBLIC_GEOAPIFY_TILES_KEY } from 'appEnv'

// The tile style ContactListMap and the door-knocking canvas use, so a
// generated map reads as the product's map.
const STYLE_URL = `https://maps.geoapify.com/v1/styles/osm-liberty/style.json?apiKey=${NEXT_PUBLIC_GEOAPIFY_TILES_KEY}`

const EMPTY_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
}

export type OpenUiMapMarker = { lat: number; lng: number; label: string }

const markerElement = (label: string): HTMLElement => {
  const element = document.createElement('div')
  element.className = 'flex flex-col items-center gap-1'
  const pill = document.createElement('span')
  pill.className =
    'max-w-48 truncate rounded-full border border-border bg-card px-2 py-0.5 text-xs font-medium text-foreground shadow-sm whitespace-nowrap'
  pill.textContent = label
  const dot = document.createElement('span')
  dot.className = 'size-3 rounded-full border-2 border-white bg-primary shadow'
  element.append(pill, dot)
  return element
}

export default function OpenUiMapCanvas({
  center,
  zoom,
  markers,
}: {
  center: { lat: number; lng: number }
  zoom: number
  markers: OpenUiMapMarker[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [basemapBlocked, setBasemapBlocked] = useState(false)
  // Generated props get a new identity on every evaluation of the program, so
  // the map rebuilds only when the markers actually change.
  const markersKey = JSON.stringify(markers)

  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: NEXT_PUBLIC_GEOAPIFY_TILES_KEY ? STYLE_URL : EMPTY_STYLE,
      center: [center.lng, center.lat],
      zoom,
      attributionControl: false,
    })
    let swappedToEmptyStyle = false
    map.on('error', (event) => {
      const status = (event.error as { status?: number } | undefined)?.status
      if (status !== 401 && status !== 403) return
      setBasemapBlocked(true)
      if (swappedToEmptyStyle) return
      swappedToEmptyStyle = true
      map.setStyle(EMPTY_STYLE)
    })
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right',
    )
    for (const marker of JSON.parse(markersKey) as OpenUiMapMarker[]) {
      new maplibregl.Marker({ element: markerElement(marker.label) })
        .setLngLat([marker.lng, marker.lat])
        .addTo(map)
    }
    return () => map.remove()
  }, [center.lat, center.lng, zoom, markersKey])

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={containerRef}
        className="h-64 w-full overflow-hidden rounded-xl border border-border bg-muted"
      />
      {basemapBlocked || !NEXT_PUBLIC_GEOAPIFY_TILES_KEY ? (
        <p className="text-xs text-muted-foreground">
          The street map is not available here, so only the pins show.
        </p>
      ) : null}
    </div>
  )
}
