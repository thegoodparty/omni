import { useEffect, useRef } from 'react'
import type { Map as MaplibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { NEXT_PUBLIC_GEOAPIFY_TILES_KEY } from 'appEnv'
import { basemapZoom, type DistrictCamera } from './districtDots'

// The provider and key the contacts and door-knocking maps use. Positron is
// its light grey style, so the dots read over the streets.
export const BASEMAP_STYLE_URL = `https://maps.geoapify.com/v1/styles/positron/style.json?apiKey=${NEXT_PUBLIC_GEOAPIFY_TILES_KEY}`

// Streets behind the story's dots. A picture, not a widget: no drag, zoom or
// scroll capture. The dots never wait on it, and a missing or refused key, no
// WebGL or a failed tile only leaves the muted frame behind them.
export const DistrictBasemap = ({
  camera,
}: {
  camera: DistrictCamera
}): React.JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || NEXT_PUBLIC_GEOAPIFY_TILES_KEY.length === 0) return
    let cancelled = false
    let map: MaplibreMap | null = null
    let observer: ResizeObserver | null = null
    const center: [number, number] = [camera.center.lng, camera.center.lat]

    const start = async () => {
      // maplibre touches `window` when its module loads, so it is loaded
      // here rather than in the server bundle.
      const { default: maplibregl } = await import('maplibre-gl')
      if (cancelled || container.clientWidth <= 0) return
      map = new maplibregl.Map({
        container,
        style: BASEMAP_STYLE_URL,
        center,
        zoom: basemapZoom(camera, container.clientWidth),
        interactive: false,
        attributionControl: false,
      })
      // Bound so a tile error is handled here and never reaches the console
      // or the step.
      map.on('error', () => undefined)
      map.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        'bottom-right',
      )
      // A compact attribution opens expanded and collapses only on the first
      // drag, which a map that cannot be dragged never gets.
      map.on('load', () => {
        container
          .querySelector('.maplibregl-ctrl-attrib')
          ?.classList.remove('maplibregl-compact-show')
      })
      if (typeof ResizeObserver === 'undefined') return
      observer = new ResizeObserver(() => {
        if (!map || container.clientWidth <= 0) return
        map.resize()
        map.jumpTo({ center, zoom: basemapZoom(camera, container.clientWidth) })
      })
      observer.observe(container)
    }
    start().catch(() => undefined)

    return () => {
      cancelled = true
      observer?.disconnect()
      map?.remove()
    }
  }, [camera])

  // maplibre's stylesheet sets `position: relative` on the element it is
  // given, and as unlayered CSS it beats Tailwind's layered `absolute`. On
  // that element `inset-0` would leave a zero-height map, so the wrapper is
  // what gets positioned and the map fills it.
  return (
    <div data-testid="district-story-basemap" className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
}
