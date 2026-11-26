import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Map as MaplibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useQuery } from '@tanstack/react-query'
import { NEXT_PUBLIC_GEOAPIFY_TILES_KEY } from 'appEnv'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@styleguide/components/ui/icons'
import { BASEMAP_STYLE_URL } from '../districtStory/DistrictBasemap'
import { prefersReducedMotion, useRise } from './Reveal'
import { cx, Tap, vars } from './parts'
import {
  cameraAnchorY,
  createVoiceTour,
  projectPlace,
  TOUR_OPEN_ZOOM,
  type TourCamera,
  type TourPlace,
  type TourView,
  type VoiceTour,
} from './voiceTour'
import { WARM_WELCOME_COPY } from './warmWelcomeConfig'

// The tour counts zoom on a 256px world; maplibre's world is 512px.
const toMapZoom = (zoom: number): number => zoom - 1

// The streets under a picture of a place. A picture, not a widget: no drag,
// zoom or scroll capture. A missing key, no WebGL or a refused tile leaves
// the muted frame, and nothing that sits on top of it waits for the map.
const useLiveMap = (
  containerRef: RefObject<HTMLDivElement | null>,
  center: TourPlace | null,
  zoom: number,
): RefObject<MaplibreMap | null> => {
  const mapRef = useRef<MaplibreMap | null>(null)
  const start = useRef({ center, zoom })
  const has = center !== null

  useEffect(() => {
    const container = containerRef.current
    const at = start.current.center
    if (!container || !at || NEXT_PUBLIC_GEOAPIFY_TILES_KEY.length === 0) {
      return
    }
    let cancelled = false
    let observer: ResizeObserver | null = null

    const open = async (): Promise<void> => {
      // maplibre touches `window` when its module loads, so it is loaded
      // here rather than in the server bundle.
      const { default: maplibregl } = await import('maplibre-gl')
      if (cancelled || container.clientWidth <= 0) return
      const map = new maplibregl.Map({
        container,
        style: BASEMAP_STYLE_URL,
        center: [at.lon, at.lat],
        zoom: toMapZoom(start.current.zoom),
        interactive: false,
        attributionControl: false,
      })
      mapRef.current = map
      map.on('error', () => undefined)
      map.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        'bottom-right',
      )
      // A compact attribution opens expanded and collapses only on the
      // first drag, which a map that cannot be dragged never gets.
      map.on('load', () => {
        container
          .querySelector('.maplibregl-ctrl-attrib')
          ?.classList.remove('maplibregl-compact-show')
      })
      if (typeof ResizeObserver === 'undefined') return
      observer = new ResizeObserver(() => {
        if (container.clientWidth > 0) map.resize()
      })
      observer.observe(container)
    }
    open().catch(() => undefined)

    return () => {
      cancelled = true
      observer?.disconnect()
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [containerRef, has])

  return mapRef
}

// Geoapify's geocoder, on the key the maps already use. Only a public
// meeting place is ever looked up.
const geocode = async (address: string): Promise<TourPlace | null> => {
  const params = new URLSearchParams({
    text: address,
    limit: '1',
    filter: 'countrycode:us',
    format: 'json',
    apiKey: NEXT_PUBLIC_GEOAPIFY_TILES_KEY,
  })
  const response = await fetch(
    `https://api.geoapify.com/v1/geocode/search?${params.toString()}`,
  )
  if (!response.ok) return null
  const body: unknown = await response.json()
  const first =
    typeof body === 'object' && body !== null && 'results' in body
      ? (body as { results?: { lat?: unknown; lon?: unknown }[] }).results?.[0]
      : undefined
  return typeof first?.lat === 'number' && typeof first.lon === 'number'
    ? { lat: first.lat, lon: first.lon }
    : null
}

// Where a meeting place is on the map, when it can be found.
export const useMeetingPoint = (address: string): TourPlace | null => {
  const query = useQuery({
    queryKey: ['serve-warm-welcome-meeting-point', address] as const,
    enabled:
      address.trim().length > 0 && NEXT_PUBLIC_GEOAPIFY_TILES_KEY.length > 0,
    staleTime: Infinity,
    retry: false,
    queryFn: () => geocode(address).catch(() => null),
  })
  return query.data ?? null
}

const THUMB_ZOOM = 16

// The small map on the meeting card, with a red pin on the place.
export const PlaceThumb = ({
  point,
}: {
  point: TourPlace
}): React.JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null)
  useLiveMap(containerRef, point, THUMB_ZOOM)
  return (
    <div className="thumb" aria-hidden>
      <div className="mapgl">
        <div ref={containerRef} />
      </div>
      <i className="tint" />
      <i className="vig" />
      <i className="pinm" />
    </div>
  )
}

export interface MapVoice extends TourPlace {
  id: string
  quote: string
}

// A map of the official's own town that moves between places where
// residents have said something, showing one short comment at each. A place
// is a soft zone, never a pin: it says "around here", which is all the data
// should say.
export const VoicesMap = ({
  voices,
  place,
  startDelayMs,
}: {
  voices: MapVoice[]
  place: string | null
  startDelayMs: number
}): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.residents
  const frameRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const zoneRefs = useRef<(HTMLSpanElement | null)[]>([])
  const tourRef = useRef<VoiceTour | null>(null)
  const [view, setView] = useState<TourView | null>(null)
  const rise = useRise(150)

  const home = useMemo((): TourPlace | null => {
    if (voices.length === 0) return null
    return {
      lat: voices.reduce((sum, voice) => sum + voice.lat, 0) / voices.length,
      lon: voices.reduce((sum, voice) => sum + voice.lon, 0) / voices.length,
    }
  }, [voices])
  const mapRef = useLiveMap(containerRef, home, TOUR_OPEN_ZOOM)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !home) return
    const draw = (camera: TourCamera): void => {
      const size = { width: frame.clientWidth, height: frame.clientHeight }
      voices.forEach((voice, index) => {
        const zone = zoneRefs.current[index]
        if (!zone) return
        const at = projectPlace(voice, camera, size)
        zone.style.transform = `translate(${at.x.toFixed(1)}px,${at.y.toFixed(1)}px) scale(${at.scale.toFixed(4)})`
        zone.style.opacity = String(at.opacity)
      })
      const map = mapRef.current
      if (!map) return
      const anchor = cameraAnchorY(size.height)
      map.jumpTo({
        center: [camera.lon, camera.lat],
        zoom: toMapZoom(camera.zoom),
        padding: {
          top: 0,
          left: 0,
          right: 0,
          bottom: Math.max(0, size.height - 2 * anchor),
        },
      })
    }
    const tour = createVoiceTour({
      places: voices,
      home,
      animate: !prefersReducedMotion(),
      onCamera: draw,
      onView: setView,
    })
    tourRef.current = tour
    tour.start(startDelayMs)
    return () => {
      tour.stop()
      tourRef.current = null
    }
  }, [voices, home, mapRef, startDelayMs])

  const shown = view ? voices[view.index] : undefined

  return (
    <div
      className="map wide ui"
      style={rise}
      ref={frameRef}
      role="group"
      aria-label={copy.mapAlt(place)}
      onPointerEnter={() => tourRef.current?.hover(true)}
      onPointerLeave={() => tourRef.current?.hover(false)}
    >
      <div className="mapgl">
        <div ref={containerRef} />
      </div>
      <i className="tint" />
      <i className="vig" />
      <div className="pins">
        {voices.map((voice, index) => (
          <span
            key={voice.id}
            className={cx('zone', view?.live === index && 'live')}
            ref={(element) => {
              zoneRefs.current[index] = element
            }}
          >
            <i />
          </span>
        ))}
      </div>
      <div
        className={cx('msg', view?.up && 'up', view?.paused && 'paused')}
        style={vars({ '--hold': `${view?.holdSeconds ?? 6.55}s` })}
      >
        <span className="qm" aria-hidden>
          “
        </span>
        <q aria-live="polite">{shown?.quote ?? ''}</q>
        <div className="mfoot">
          <span className="mctl">
            <Tap
              className="mbtn"
              aria-label={copy.previous}
              onClick={() => tourRef.current?.go(-1)}
            >
              <ChevronLeftIcon className="i" aria-hidden />
            </Tap>
            <svg className="hring" viewBox="0 0 24 24" aria-hidden>
              <circle className="track" cx="12" cy="12" r="10" />
              <circle className="arc" cx="12" cy="12" r="10" />
            </svg>
            <Tap
              className="mbtn"
              aria-label={copy.nextMessage}
              onClick={() => tourRef.current?.go(1)}
            >
              <ChevronRightIcon className="i" aria-hidden />
            </Tap>
          </span>
        </div>
      </div>
    </div>
  )
}
