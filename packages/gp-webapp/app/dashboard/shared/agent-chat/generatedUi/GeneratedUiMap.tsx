import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { NEXT_PUBLIC_GEOAPIFY_TILES_KEY } from 'appEnv'

// The tile style and refused-key fallback ContactListMap uses, so a generated
// map reads as the same map as the rest of the product.
const STYLE_URL = `https://maps.geoapify.com/v1/styles/osm-liberty/style.json?apiKey=${NEXT_PUBLIC_GEOAPIFY_TILES_KEY}`

const EMPTY_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
}

export type GeneratedUiMapProps = {
  center: { lat: number; lng: number }
  zoom?: number
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
      zoom: zoom ?? 13,
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
    markers.forEach((marker) => {
      new maplibregl.Marker({ color: '#1e63ec' })
        .setLngLat([marker.lng, marker.lat])
        .setPopup(new maplibregl.Popup({ offset: 24 }).setText(marker.label))
        .addTo(map)
    })
    if (markers.length > 1) {
      const bounds = new maplibregl.LngLatBounds()
      markers.forEach((marker) => bounds.extend([marker.lng, marker.lat]))
      map.fitBounds(bounds, { padding: 48, maxZoom: zoom ?? 15, duration: 0 })
    }
    return () => map.remove()
  }, [center.lat, center.lng, zoom, markers, hasTilesKey])

  return (
    <div className="relative h-64 w-full overflow-hidden rounded-lg border border-border">
      <div ref={containerRef} className="h-full w-full" />
      {basemapBlocked || !hasTilesKey ? (
        <div className="absolute inset-x-2 top-2 rounded-md bg-background/95 px-2 py-1 text-center text-xs text-muted-foreground shadow">
          The background map could not load here. Its tiles key does not allow
          this domain.
        </div>
      ) : null}
      <ul className="absolute bottom-2 left-2 flex list-none flex-col gap-1">
        {markers.map((marker) => (
          <li
            key={`${marker.lat},${marker.lng},${marker.label}`}
            className="rounded-md bg-background/95 px-2 py-1 text-xs font-medium text-foreground shadow"
          >
            {marker.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
