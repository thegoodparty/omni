import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { NEXT_PUBLIC_GEOAPIFY_TILES_KEY } from 'appEnv'

// The tiles ContactListMap and the door-knocking canvas use.
const STYLE_URL = `https://maps.geoapify.com/v1/styles/osm-liberty/style.json?apiKey=${NEXT_PUBLIC_GEOAPIFY_TILES_KEY}`

const EMPTY_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
}

export interface GeneratedUiMapProps {
  center: { lat: number; lng: number }
  zoom: number
  markers: { lat: number; lng: number; label: string }[]
}

export default function GeneratedUiMap({
  center,
  zoom,
  markers,
}: GeneratedUiMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [basemapBlocked, setBasemapBlocked] = useState(false)
  const hasTilesKey = NEXT_PUBLIC_GEOAPIFY_TILES_KEY.length > 0

  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: hasTilesKey ? STYLE_URL : EMPTY_STYLE,
      center: [center.lng, center.lat],
      zoom,
      attributionControl: false,
    })
    // Same fallback as ContactListMap: the tiles key is domain-restricted, so
    // a preview host gets a 401 and the pins still need a style that loads.
    let swapped = false
    map.on('error', (event) => {
      const status = (event.error as { status?: number } | undefined)?.status
      if ((status !== 401 && status !== 403) || swapped) return
      swapped = true
      setBasemapBlocked(true)
      map.setStyle(EMPTY_STYLE)
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }))
    markers.forEach((marker) => {
      new maplibregl.Marker({ color: '#1e63ec' })
        .setLngLat([marker.lng, marker.lat])
        .setPopup(new maplibregl.Popup({ offset: 24 }).setText(marker.label))
        .addTo(map)
    })
    if (markers.length > 1) {
      const bounds = new maplibregl.LngLatBounds()
      markers.forEach((marker) => bounds.extend([marker.lng, marker.lat]))
      map.fitBounds(bounds, { padding: 48, maxZoom: zoom, duration: 0 })
    }
    return () => map.remove()
  }, [center.lat, center.lng, zoom, markers, hasTilesKey])

  return (
    <div className="relative h-64 w-full overflow-hidden rounded-lg bg-muted">
      <div ref={containerRef} className="h-full w-full" />
      {basemapBlocked || !hasTilesKey ? (
        <div className="absolute inset-x-2 top-2 rounded-md bg-background/95 px-2 py-1 text-center text-xs text-muted-foreground shadow">
          The background map could not load here. Its tiles key does not allow
          this domain.
        </div>
      ) : null}
    </div>
  )
}
