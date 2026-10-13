import { useEffect, useMemo, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { PolygonLayer } from '@deck.gl/layers'
import 'maplibre-gl/dist/maplibre-gl.css'
import { NEXT_PUBLIC_GEOAPIFY_TILES_KEY } from 'appEnv'
import { boundsOfPoints, toGridCells, type GridCell } from './respondentGrid'

// The contact map's style, so every map in the product reads as one.
const STYLE_URL = `https://maps.geoapify.com/v1/styles/osm-liberty/style.json?apiKey=${NEXT_PUBLIC_GEOAPIFY_TILES_KEY}`
const EMPTY_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
}
// `--primary` written out: a deck.gl canvas cannot read a CSS variable.
const PRIMARY_BLUE: [number, number, number] = [30, 99, 236]
const FIT_PADDING_PX = 40

// Opacity carries the count, so one hue stays legible over the streets and
// the busiest square is always the darkest.
const fillFor = (
  count: number,
  max: number,
): [number, number, number, number] => [
  ...PRIMARY_BLUE,
  Math.round(40 + (count / max) * 180),
]

export const RespondentHeatGrid = ({
  points,
}: {
  points: { lat: number; lng: number }[]
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const cells = useMemo(() => toGridCells(points), [points])
  const bounds = useMemo(() => boundsOfPoints(points), [points])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      attributionControl: false,
      ...(bounds
        ? { bounds, fitBoundsOptions: { padding: FIT_PADDING_PX } }
        : { center: [-98.5, 39.8], zoom: 3 }),
    })
    let swapped = false
    map.on('error', (event) => {
      const status = (event.error as { status?: number } | undefined)?.status
      if ((status !== 401 && status !== 403) || swapped) return
      swapped = true
      map.setStyle(EMPTY_STYLE)
    })
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right',
    )
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }))
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] })
    map.addControl(overlay)
    overlayRef.current = overlay
    return () => {
      overlayRef.current = null
      map.remove()
    }
  }, [bounds])

  useEffect(() => {
    const max = cells.reduce((top, cell) => Math.max(top, cell.count), 1)
    overlayRef.current?.setProps({
      layers: [
        new PolygonLayer<GridCell>({
          id: 'respondent-grid',
          data: cells,
          getPolygon: (cell) => cell.polygon,
          getFillColor: (cell) => fillFor(cell.count, max),
          getLineColor: [...PRIMARY_BLUE, 120],
          lineWidthMinPixels: 1,
          stroked: true,
          filled: true,
        }),
      ],
    })
    // bounds: a new map instance has a fresh overlay with no layers on it.
  }, [cells, bounds])

  return (
    <div
      ref={containerRef}
      className="h-80 w-full overflow-hidden rounded-lg border border-border"
    />
  )
}
