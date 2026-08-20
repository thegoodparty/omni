import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import type { DoorKnockingPackManifest } from '@goodparty_org/contracts'
import VoterMapCanvas, {
  type PolygonRing,
  type RoutePin,
} from './VoterMapCanvas'
import { STATUS_RGB } from './statusPresentation'
import type { DecodedPack } from './packDecoder'
import type { FilterResult } from './filterEngine'

vi.mock('appEnv', () => ({ NEXT_PUBLIC_GEOAPIFY_TILES_KEY: 'test-tiles-key' }))

interface MapEvent {
  lngLat: { lng: number; lat: number }
  point: { x: number; y: number }
}

interface MockLayerProps {
  id: string
  data: unknown
  // Accessors the pin layers derive per pin, so a test can ask what a given
  // pin would actually be drawn as.
  getFillColor?: (pin: RoutePin) => number[]
  getLineColor?: (pin: RoutePin) => number[]
  getLineWidth?: (pin: RoutePin) => number
  getColor?: (pin: RoutePin) => number[]
}

const gl = vi.hoisted(() => {
  const handlers = new Map<string, (event: MapEvent) => void>()
  let canvas: HTMLCanvasElement | null = null
  const map = {
    addControl: vi.fn(),
    on: vi.fn((event: string, handler: (event: MapEvent) => void) => {
      handlers.set(event, handler)
    }),
    getStyle: () => ({ layers: [] }),
    setPaintProperty: vi.fn(),
    setLayoutProperty: vi.fn(),
    getCanvas: () => (canvas ??= document.createElement('canvas')),
    fitBounds: vi.fn(),
    jumpTo: vi.fn(),
    easeTo: vi.fn(),
    remove: vi.fn(),
    dragPan: { enable: vi.fn(), disable: vi.fn() },
    doubleClickZoom: { enable: vi.fn(), disable: vi.fn() },
  }
  const overlay = {
    layers: [] as MockLayerProps[],
    setProps: (props: { layers: Array<{ props: MockLayerProps }> }) => {
      overlay.layers = props.layers.map((layer) => layer.props)
    },
    pickObject: () => null,
  }
  return { handlers, map, overlay }
})

vi.mock('maplibre-gl', () => ({
  default: {
    Map: class {
      constructor() {
        return gl.map
      }
    },
    NavigationControl: class {},
  },
}))

vi.mock('@deck.gl/mapbox', () => ({
  MapboxOverlay: class {
    constructor() {
      return gl.overlay
    }
  },
}))

vi.mock('@deck.gl/layers', () => {
  class MockLayer {
    props: MockLayerProps
    constructor(props: MockLayerProps) {
      this.props = props
    }
  }
  return {
    ScatterplotLayer: MockLayer,
    PolygonLayer: MockLayer,
    PathLayer: MockLayer,
    TextLayer: MockLayer,
  }
})

const manifest: DoorKnockingPackManifest = {
  version: 1,
  generatedAt: '2026-08-14T00:00:00.000Z',
  counts: { people: 2, households: 2, dots: 2 },
  dims: [{ key: 'canvassStatus', values: ['unknown'] }],
  arrays: [
    { name: 'positions', type: 'f32', byteOffset: 0, elementCount: 4 },
    { name: 'personToHousehold', type: 'u32', byteOffset: 16, elementCount: 2 },
    { name: 'householdToDot', type: 'u32', byteOffset: 24, elementCount: 2 },
    { name: 'dim:canvassStatus', type: 'u8', byteOffset: 32, elementCount: 2 },
  ],
}

const pack: DecodedPack = {
  manifest,
  positions: new Float32Array([-87.66, 41.92, -87.64, 41.94]),
  personToHousehold: new Uint32Array([0, 1]),
  householdToDot: new Uint32Array([0, 1]),
  dimPlanes: new Map([['canvassStatus', new Uint8Array([0, 0])]]),
}

const filterResult: FilterResult = {
  people: 2,
  households: 2,
  matchedPerDot: new Uint32Array([1, 1]),
  statusPerDot: new Uint8Array([0, 0]),
}

const POINTS: PolygonRing = [
  [-87.66, 41.92],
  [-87.65, 41.92],
  [-87.65, 41.93],
  [-87.66, 41.93],
]

const clickMap = (point: [number, number]) => {
  act(() => {
    gl.handlers.get('click')?.({
      lngLat: { lng: point[0], lat: point[1] },
      point: { x: 0, y: 0 },
    })
  })
}

const layerData = (id: string) =>
  gl.overlay.layers.find((layer) => layer.id === id)?.data

const layer = (id: string) => gl.overlay.layers.find((entry) => entry.id === id)

describe('VoterMapCanvas drawing', () => {
  const baseProps = {
    pack,
    filterResult,
    turfs: [],
    routePins: [],
    routeLoop: false,
    routeGeometry: null,
    focusTurf: null,
    startDrawToken: 1,
    clearDrawToken: 0,
    undoDrawToken: 0,
  }

  beforeEach(() => {
    gl.handlers.clear()
    gl.overlay.layers = []
    vi.clearAllMocks()
  })

  it('undoes the most recently placed point', () => {
    const onPolygonChange = vi.fn()
    const onDrawPointCount = vi.fn()
    const { rerender } = render(
      <VoterMapCanvas
        {...baseProps}
        onPolygonChange={onPolygonChange}
        onDrawPointCount={onDrawPointCount}
      />,
    )
    POINTS.forEach(clickMap)
    expect(onPolygonChange).toHaveBeenLastCalledWith(POINTS)

    rerender(
      <VoterMapCanvas
        {...baseProps}
        undoDrawToken={1}
        onPolygonChange={onPolygonChange}
        onDrawPointCount={onDrawPointCount}
      />,
    )

    expect(onDrawPointCount).toHaveBeenLastCalledWith(3)
    expect(onPolygonChange).toHaveBeenLastCalledWith(POINTS.slice(0, 3))
    expect(layerData('draw-vertices')).toEqual(POINTS.slice(0, 3))
  })

  // Three points is where a ring starts existing, so undoing across that line
  // has to retract the shape too — otherwise the stats bar keeps reporting
  // doors for an area that is no longer drawn.
  it('drops the polygon when undo takes it from three points to two', () => {
    const onPolygonChange = vi.fn()
    const { rerender } = render(
      <VoterMapCanvas
        {...baseProps}
        onPolygonChange={onPolygonChange}
        onDrawPointCount={vi.fn()}
      />,
    )
    POINTS.slice(0, 3).forEach(clickMap)
    expect(onPolygonChange).toHaveBeenLastCalledWith(POINTS.slice(0, 3))
    expect(layerData('draw-preview')).toEqual([POINTS.slice(0, 3)])

    rerender(
      <VoterMapCanvas
        {...baseProps}
        undoDrawToken={1}
        onPolygonChange={onPolygonChange}
        onDrawPointCount={vi.fn()}
      />,
    )

    expect(onPolygonChange).toHaveBeenLastCalledWith(null)
    expect(layerData('draw-preview')).toEqual([])
    expect(layerData('draw-vertices')).toEqual(POINTS.slice(0, 2))
  })

  it('undoes one point per bump, down to an empty shape', () => {
    const onDrawPointCount = vi.fn()
    const { rerender } = render(
      <VoterMapCanvas
        {...baseProps}
        onPolygonChange={vi.fn()}
        onDrawPointCount={onDrawPointCount}
      />,
    )
    POINTS.slice(0, 2).forEach(clickMap)

    for (const token of [1, 2, 3]) {
      rerender(
        <VoterMapCanvas
          {...baseProps}
          undoDrawToken={token}
          onPolygonChange={vi.fn()}
          onDrawPointCount={onDrawPointCount}
        />,
      )
    }

    // The third bump has nothing left to drop rather than throwing.
    expect(onDrawPointCount).toHaveBeenLastCalledWith(0)
    expect(layerData('draw-vertices')).toEqual([])
  })

  // Clear is a restarted drawing session, not an exit from one: the canvasser
  // asked for a blank map to redraw on, not to leave the draw step.
  it('clears the shape and keeps taking new points', () => {
    const onPolygonChange = vi.fn()
    const onDrawPointCount = vi.fn()
    const { rerender } = render(
      <VoterMapCanvas
        {...baseProps}
        onPolygonChange={onPolygonChange}
        onDrawPointCount={onDrawPointCount}
      />,
    )
    POINTS.forEach(clickMap)

    rerender(
      <VoterMapCanvas
        {...baseProps}
        startDrawToken={2}
        onPolygonChange={onPolygonChange}
        onDrawPointCount={onDrawPointCount}
      />,
    )

    expect(onPolygonChange).toHaveBeenLastCalledWith(null)
    expect(onDrawPointCount).toHaveBeenLastCalledWith(0)
    expect(layerData('draw-vertices')).toEqual([])
    expect(layerData('draw-preview')).toEqual([])

    clickMap(POINTS[0] as [number, number])
    expect(onDrawPointCount).toHaveBeenLastCalledWith(1)
  })

  // Ending a walk invalidates the pack so the landing dots aren't stale, and
  // the refetch hands down a fresh object. Keyed on that identity, the mount
  // effect tore the MapLibre instance down through map.remove() and re-framed
  // the district — the canvasser was looking at one block and landed back at
  // district scale. The dots still have to recolour: that is the overlay
  // effect's job and it keeps its own dependency on the pack.
  it('repaints on a new pack without rebuilding the map', () => {
    const props = {
      ...baseProps,
      startDrawToken: 0,
      onPolygonChange: vi.fn(),
      onDrawPointCount: vi.fn(),
    }
    const { rerender } = render(<VoterMapCanvas {...props} />)
    expect(gl.map.fitBounds).toHaveBeenCalledTimes(1)

    // A refetched pack: same coordinates, new object identity, and one dot's
    // status changed by the knocks logged during the walk.
    const repainted: DecodedPack = {
      ...pack,
      dimPlanes: new Map([['canvassStatus', new Uint8Array([0, 0])]]),
    }
    const recoloured: FilterResult = {
      ...filterResult,
      statusPerDot: new Uint8Array([0, 1]),
    }
    rerender(
      <VoterMapCanvas {...props} pack={repainted} filterResult={recoloured} />,
    )

    expect(gl.map.remove).not.toHaveBeenCalled()
    // No second framing, so whatever the canvasser had panned to survives.
    expect(gl.map.fitBounds).toHaveBeenCalledTimes(1)
    expect(gl.map.jumpTo).not.toHaveBeenCalled()
    // And the dots did repaint: the overlay effect ran for the new pack.
    expect(layerData('voter-dots')).toEqual(
      expect.objectContaining({ length: repainted.manifest.counts.dots }),
    )
  })

  // A stop where every resident is flagged rolls up over an empty list, so its
  // status is the same `unknown` grey as a stop nobody has been to. The pin is
  // what a canvasser is standing in front of, so it draws hollow — an outline
  // says "not a target" where an eighth fill colour would say "another status".
  it('draws a stop with nobody knockable hollow, not in a new colour', () => {
    const knockable: RoutePin = {
      seq: 1,
      lat: 41.92,
      lng: -87.66,
      status: 'unknown',
      knockable: true,
    }
    // Same status, so nothing but knockability can tell these two apart.
    const flagged: RoutePin = { ...knockable, seq: 2, knockable: false }

    render(
      <VoterMapCanvas
        {...baseProps}
        startDrawToken={0}
        routePins={[knockable, flagged]}
        onPolygonChange={vi.fn()}
        onDrawPointCount={vi.fn()}
      />,
    )

    const pins = layer('route-pins')
    const status = [...STATUS_RGB.unknown]
    // The normal pin: status fill, white ring.
    expect(pins?.getFillColor?.(knockable)).toEqual([...status, 235])
    expect(pins?.getLineColor?.(knockable)).toEqual([255, 255, 255, 255])
    // The flagged pin inverts — and its ring is the status colour rather than
    // any new one, so no eighth colour enters the legend's vocabulary.
    expect(pins?.getFillColor?.(flagged)).toEqual([255, 255, 255, 220])
    expect(pins?.getLineColor?.(flagged)).toEqual([...status, 235])
    expect(pins?.getLineWidth?.(flagged)).toBeGreaterThan(
      pins?.getLineWidth?.(knockable) ?? 0,
    )
    // The numeral rides the fill, so it has to invert with it or it reads as a
    // blank pin.
    const numbers = layer('route-pin-numbers')
    expect(numbers?.getColor?.(knockable)).toEqual([255, 255, 255, 255])
    expect(numbers?.getColor?.(flagged)).toEqual([...status, 255])
  })

  it('opens at street level when given an initial zoom', () => {
    const { unmount } = render(
      <VoterMapCanvas
        {...baseProps}
        onPolygonChange={vi.fn()}
        onDrawPointCount={vi.fn()}
      />,
    )
    expect(gl.map.fitBounds).toHaveBeenCalled()
    expect(gl.map.jumpTo).not.toHaveBeenCalled()
    unmount()

    render(
      <VoterMapCanvas
        {...baseProps}
        initialZoom={16}
        onPolygonChange={vi.fn()}
        onDrawPointCount={vi.fn()}
      />,
    )
    // The pack's coordinates are f32, so the midpoint is only approximate.
    expect(gl.map.jumpTo).toHaveBeenCalledWith({
      center: [expect.closeTo(-87.65, 4), expect.closeTo(41.93, 4)],
      zoom: 16,
    })
  })
})
