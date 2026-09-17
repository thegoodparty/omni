// Deliberately no `'use client'` directive. This module is imported only by
// AffectedResidentsView, which is itself a client component, so it is already
// in the client bundle — the directive marks a boundary, and a second one here
// would add nothing except a tick on the `check:use-client` ratchet. It does
// use hooks and the Google Maps imperative API, so it can only ever run on the
// client; that comes from its importer, not from a directive.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Script from 'next/script'
import type { AffectedResident } from 'gpApi/api-endpoints'
import { NEXT_PUBLIC_GOOGLE_MAPS_KEY } from 'appEnv'
import mapSkin from '@shared/utils/mapSkin'

// The runbook's map conventions, carried over from the Leaflet maps in
// lists/*.html so a new map matches rather than approximates: a four-bin purple
// ramp over equal-width bins between the list's min and max score, and a marker
// radius that grows with how many residents share the point.
const RAMP = ['#e3e0ee', '#b3a2c7', '#8265ac', '#54278f'] as const
const DARKEST = RAMP[RAMP.length - 1]

// No anchor site and no segment outline, deliberately. Only some issues have a
// point to measure from, and drawing an outline around a boundary that was
// inferred rather than published asserts a precision that does not exist — the
// per-resident confidence note is the honest place for that.
type Props = {
  residents: AffectedResident[]
}

type Cluster = {
  lat: number
  lon: number
  address: string
  residents: AffectedResident[]
  best: number
}

// Group by coordinate, not by address string. Every unit in an apartment
// building shares one lat/lon in L2, so grouping by address stacks a dozen
// coincident markers on one building and silently breaks the "larger points
// hold more residents" convention.
const clusterByCoordinate = (residents: AffectedResident[]): Cluster[] => {
  const byCoord = new Map<string, Cluster>()

  for (const resident of residents) {
    const key = `${resident.lat},${resident.lon}`
    const existing = byCoord.get(key)
    if (existing) {
      existing.residents.push(resident)
      existing.best = Math.max(existing.best, resident.affectednessScore)
      continue
    }
    byCoord.set(key, {
      lat: resident.lat,
      lon: resident.lon,
      address: resident.address,
      residents: [resident],
      best: resident.affectednessScore,
    })
  }

  return [...byCoord.values()]
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const ageLabel = (age: AffectedResident['age']) => {
  if (!age) return ''
  return age.basis === 'year-only'
    ? `age ${age.years} (year-only birthdate, ±1)`
    : `age ${age.years}`
}

// The popup answers "should I call this person": name, phone, age with its
// basis, and the reason sentence. The table alongside carries the rest.
const popupHtml = (cluster: Cluster) => {
  const rows = cluster.residents
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 8)
    .map(
      (r) => `
        <div style="margin-top:6px">
          <div style="font-weight:600">#${r.rank} ${escapeHtml(r.name)}</div>
          <div>${escapeHtml(r.phone)} (${r.phoneType})${
            r.age ? ` · ${escapeHtml(ageLabel(r.age))}` : ''
          }</div>
          <div style="color:#555">${escapeHtml(r.why)}</div>
        </div>`,
    )
    .join('')

  const more =
    cluster.residents.length > 8
      ? `<div style="margin-top:6px;color:#555">and ${
          cluster.residents.length - 8
        } more at this address</div>`
      : ''

  return `
    <div style="max-width:320px;font-size:12px;line-height:1.4">
      <div style="font-weight:700;font-size:13px">${escapeHtml(
        cluster.address,
      )}</div>
      <div style="color:#555">${cluster.residents.length} resident${
        cluster.residents.length === 1 ? '' : 's'
      } on this list</div>
      ${rows}${more}
    </div>`
}

const AffectedResidentsMap = ({ residents }: Props): React.JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const overlaysRef = useRef<Array<{ setMap: (map: null) => void }>>([])
  const infoRef = useRef<google.maps.InfoWindow | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)

  const clusters = useMemo(() => clusterByCoordinate(residents), [residents])

  const bins = useMemo(() => {
    const scores = residents.map((r) => r.affectednessScore)
    const min = Math.min(...scores)
    const max = Math.max(...scores)
    return { min, max, width: (max - min) / RAMP.length || 1 }
  }, [residents])

  const colorFor = useCallback(
    (score: number) => {
      const index = Math.min(
        RAMP.length - 1,
        Math.floor((score - bins.min) / bins.width),
      )
      return RAMP[Math.max(0, index)] ?? DARKEST
    },
    [bins],
  )

  useEffect(() => {
    if (!isLoaded || !window.google || !containerRef.current) return

    // There is no anchor to centre on, so the first cluster seeds the view and
    // fitBounds below corrects it. No clusters means nothing to draw.
    const first = clusters[0]
    if (!first) return

    if (!mapRef.current) {
      mapRef.current = new window.google.maps.Map(containerRef.current, {
        center: { lat: first.lat, lng: first.lon },
        zoom: 15,
        mapTypeControl: false,
        fullscreenControl: false,
        streetViewControl: false,
        styles: mapSkin,
      })
      infoRef.current = new window.google.maps.InfoWindow({
        headerDisabled: true,
      })
    }

    const map = mapRef.current
    overlaysRef.current.forEach((overlay) => overlay.setMap(null))
    overlaysRef.current = []

    const bounds = new window.google.maps.LatLngBounds()

    for (const cluster of clusters) {
      const marker = new window.google.maps.Marker({
        map,
        position: { lat: cluster.lat, lng: cluster.lon },
        title: `${cluster.address} (${cluster.residents.length})`,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 4 + Math.sqrt(cluster.residents.length) * 2.2,
          fillColor: colorFor(cluster.best),
          fillOpacity: 0.9,
          strokeColor: '#3f3f46',
          strokeWeight: 0.7,
        },
      })
      marker.addListener('click', () => {
        infoRef.current?.setContent(popupHtml(cluster))
        infoRef.current?.open({ anchor: marker, map })
      })
      overlaysRef.current.push(marker)
      bounds.extend({ lat: cluster.lat, lng: cluster.lon })
    }

    map.fitBounds(bounds)

    return () => {
      overlaysRef.current.forEach((overlay) => overlay.setMap(null))
      overlaysRef.current = []
    }
  }, [isLoaded, clusters, colorFor])

  return (
    <div className="flex flex-col gap-2">
      <Script
        src={`https://maps.googleapis.com/maps/api/js?key=${NEXT_PUBLIC_GOOGLE_MAPS_KEY}`}
        onReady={() => setIsLoaded(true)}
      />
      <div
        ref={containerRef}
        className="h-[420px] w-full overflow-hidden rounded-lg border border-border bg-muted"
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          Lower score
          {RAMP.map((color) => (
            <span
              key={color}
              className="inline-block size-3 rounded-full"
              style={{ backgroundColor: color }}
            />
          ))}
          Higher score
        </span>
        <span>Larger points hold more residents</span>
        <span>
          {clusters.length} locations, {residents.length} residents
        </span>
      </div>
    </div>
  )
}

export default AffectedResidentsMap
