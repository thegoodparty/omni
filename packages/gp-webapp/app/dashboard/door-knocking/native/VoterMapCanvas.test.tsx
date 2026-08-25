import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type {
  DoorKnockingPackManifest,
  DoorKnockingTurf,
} from '@goodparty_org/contracts'
import VoterMapCanvas, {
  ringInsertIndex,
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
  pickable?: boolean
  radiusMinPixels?: number
  // Accessors the layers derive per row, so a test can ask what a given pin or
  // a given saved list would actually be drawn as. `unknown` because the mock
  // stands in for every layer on the canvas and each one has its own datum.
  getFillColor?: (datum: unknown) => number[]
  getLineColor?: (datum: unknown) => number[]
  getLineWidth?: (datum: unknown) => number
  getColor?: (datum: unknown) => number[]
}

interface PickParams {
  x: number
  y: number
  radius: number
  layerIds: string[]
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
    // Stands a pin under the tap, so a test can knock on a door the way a
    // canvasser does. Keyed by layer so the vertex picking the drag handlers
    // do is unaffected.
    pickedPin: null as { object: RoutePin } | null,
    lastPick: null as PickParams | null,
    setProps: (props: { layers: Array<{ props: MockLayerProps }> }) => {
      overlay.layers = props.layers.map((layer) => layer.props)
    },
    pickObject: (params: PickParams) => {
      overlay.lastPick = params
      return params.layerIds.includes('route-pins') ? overlay.pickedPin : null
    },
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

// A saved list as the rail hands it over. Only the ring, the colour and the
// archive stamp matter to the canvas; the rest is the row's own shape.
const turfFixture: DoorKnockingTurf = {
  id: 1,
  voterFileFilterId: 7,
  name: 'Elm St & 5th',
  color: '#2563eb',
  geoPoly: {
    type: 'Polygon',
    coordinates: [
      [
        [-87.66, 41.92],
        [-87.65, 41.92],
        [-87.65, 41.93],
        [-87.66, 41.92],
      ],
    ],
  },
  locked: true,
  doorCount: null,
  peopleCount: null,
  loggedCount: null,
  completedAt: null,
  archivedAt: null,
  createdAt: new Date('2026-07-21T00:00:00Z'),
  updatedAt: new Date('2026-07-21T00:00:00Z'),
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

describe('ringInsertIndex', () => {
  // Clockwise from the south-west corner: edge 0 is the south side, edge 1 the
  // east side, edge 2 the north side, edge 3 the closing west side.
  const SQUARE: PolygonRing = [
    [-87.66, 41.92],
    [-87.65, 41.92],
    [-87.65, 41.93],
    [-87.66, 41.93],
  ]

  it('appends until there is an edge to insert into', () => {
    expect(ringInsertIndex([], [-87.66, 41.92])).toBe(0)
    expect(ringInsertIndex(SQUARE.slice(0, 2), [-87.65, 41.93])).toBe(2)
  })

  it('splices a point between the two vertices it was tapped between', () => {
    expect(ringInsertIndex(SQUARE, [-87.6501, 41.925])).toBe(2)
  })

  it('picks the nearest edge for a point tapped outside the ring', () => {
    expect(ringInsertIndex(SQUARE, [-87.655, 41.918])).toBe(1)
  })

  // A degree of longitude is ~0.74 of a degree of latitude at Chicago's
  // latitude, so on a tall narrow ring raw degrees rank a long side as nearer
  // than it is on the ground. Here the east edge is ~994m away and the south
  // edge ~1113m, but in bare degrees the south edge reads as closer.
  it('measures on the ground, not in degrees, on a tall narrow ring', () => {
    const tall: PolygonRing = [
      [-87.7, 41.9],
      [-87.66, 41.9],
      [-87.66, 42.0],
      [-87.7, 42.0],
    ]

    expect(ringInsertIndex(tall, [-87.672, 41.91])).toBe(2)
  })
})

describe('VoterMapCanvas drawing', () => {
  const baseProps = {
    pack,
    filterResult,
    turfs: [],
    routePins: [],
    selectedStopId: null,
    routeLoop: false,
    routeGeometry: null,
    focusTurf: null,
    startDrawToken: 1,
    clearDrawToken: 0,
    undoDrawToken: 0,
    drawColor: '#2563eb',
    frameDrawToken: 0,
    frameDrawBottomPct: 0,
  }

  // The draw layers take their colours as flat values rather than per-datum
  // accessors, so they are read off the layer instead of called.
  const staticColor = (
    id: string,
    channel: 'getFillColor' | 'getLineColor',
  ): number[] => layer(id)?.[channel] as unknown as number[]

  beforeEach(() => {
    gl.handlers.clear()
    gl.overlay.layers = []
    gl.overlay.pickedPin = null
    gl.overlay.lastPick = null
    vi.clearAllMocks()
  })

  const packOfDots = (dots: Array<[number, number]>): DecodedPack => ({
    manifest: {
      ...manifest,
      counts: {
        people: dots.length,
        households: dots.length,
        dots: dots.length,
      },
      arrays: manifest.arrays.map((array) => ({
        ...array,
        elementCount:
          array.name === 'positions' ? dots.length * 2 : dots.length,
      })),
    },
    positions: new Float32Array(dots.flat()),
    personToHousehold: new Uint32Array(dots.map((_, index) => index)),
    householdToDot: new Uint32Array(dots.map((_, index) => index)),
    dimPlanes: new Map([['canvassStatus', new Uint8Array(dots.length)]]),
  })

  // Mounts the canvas over a district shaped by `dots` and reports where it
  // put the camera. Goes through the real mount effect rather than calling the
  // helper directly, since the wiring is half of what regressed.
  const openingCenterOf = (dots: Array<[number, number]>): [number, number] => {
    render(
      <VoterMapCanvas
        {...baseProps}
        pack={packOfDots(dots)}
        initialZoom={16}
        onPolygonChange={vi.fn()}
        onDrawPointCount={vi.fn()}
      />,
    )
    const jump = gl.map.jumpTo.mock.calls.at(-1)?.[0] as
      | { center: [number, number]; zoom: number }
      | undefined
    expect(jump?.zoom).toBe(16)
    return jump!.center
  }

  // The pack's coordinates are f32, so a dot only round-trips to about a
  // metre — identity is proximity, not equality.
  const expectIsOneOf = (
    center: [number, number],
    dots: Array<[number, number]>,
  ) => {
    const match = dots.find(
      ([lng, lat]) =>
        Math.abs(lng - center[0]) < 1e-5 && Math.abs(lat - center[1]) < 1e-5,
    )
    expect(
      match,
      `opened at ${center.join(', ')}, where there is no dot`,
    ).toBeDefined()
  }

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

  // Appending every tap meant a point placed between two existing vertices sent
  // the boundary across the shape and back — a criss-crossed outline from a
  // gesture that looks like "put a corner here".
  it('splices a tap between two vertices into that edge', () => {
    const onPolygonChange = vi.fn()
    render(
      <VoterMapCanvas
        {...baseProps}
        onPolygonChange={onPolygonChange}
        onDrawPointCount={vi.fn()}
      />,
    )
    POINTS.slice(0, 3).forEach(clickMap)

    // Just outside the edge running between vertices 1 and 2.
    const between: [number, number] = [-87.6495, 41.925]
    clickMap(between)

    expect(layerData('draw-vertices')).toEqual([
      POINTS[0],
      POINTS[1],
      between,
      POINTS[2],
    ])
    expect(onPolygonChange).toHaveBeenLastCalledWith([
      POINTS[0],
      POINTS[1],
      between,
      POINTS[2],
    ])
  })

  // Undo is still last-add only, but the ring stopped being the add history the
  // moment a tap could land in the middle of it — dropping the last element
  // would take a vertex the canvasser placed three taps ago.
  it('undoes the vertex just placed, not the last one in the ring', () => {
    const onPolygonChange = vi.fn()
    const { rerender } = render(
      <VoterMapCanvas
        {...baseProps}
        onPolygonChange={onPolygonChange}
        onDrawPointCount={vi.fn()}
      />,
    )
    POINTS.slice(0, 3).forEach(clickMap)
    const between: [number, number] = [-87.6495, 41.925]
    clickMap(between)

    rerender(
      <VoterMapCanvas
        {...baseProps}
        undoDrawToken={1}
        onPolygonChange={onPolygonChange}
        onDrawPointCount={vi.fn()}
      />,
    )

    expect(layerData('draw-vertices')).toEqual(POINTS.slice(0, 3))
    expect(onPolygonChange).toHaveBeenLastCalledWith(POINTS.slice(0, 3))
  })

  // A double-click arrives as two clicks at one spot. Under append semantics
  // the guard could look at the end of the ring; under insertion the second
  // click lands ON the vertex the first placed and would splice beside it.
  it('takes one vertex from a double-click on an inserted point', () => {
    const onDrawPointCount = vi.fn()
    render(
      <VoterMapCanvas
        {...baseProps}
        onPolygonChange={vi.fn()}
        onDrawPointCount={onDrawPointCount}
      />,
    )
    POINTS.slice(0, 3).forEach(clickMap)
    const between: [number, number] = [-87.6495, 41.925]
    clickMap(between)
    clickMap(between)

    expect(onDrawPointCount).toHaveBeenLastCalledWith(4)
    expect(layerData('draw-vertices')).toHaveLength(4)
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
      stopId: 11,
      seq: 1,
      lat: 41.92,
      lng: -87.66,
      status: 'unknown',
      knockable: true,
    }
    // Same status, so nothing but knockability can tell these two apart.
    const flagged: RoutePin = {
      ...knockable,
      stopId: 12,
      seq: 2,
      knockable: false,
    }

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

  // The list has always marked the stop the walk is on; the map drew nothing
  // for it, so the two surfaces described the same street in two vocabularies.
  // The ring goes OUTSIDE the pin because the pin's own fill and stroke are
  // already saying which status it is and whether anyone there is knockable.
  it('rings the marked stop without taking a channel off its pin', () => {
    const marked: RoutePin = {
      stopId: 11,
      seq: 1,
      lat: 41.92,
      lng: -87.66,
      status: 'unknown',
      knockable: true,
    }
    const other: RoutePin = { ...marked, stopId: 12, seq: 2 }

    const { rerender } = render(
      <VoterMapCanvas
        {...baseProps}
        startDrawToken={0}
        routePins={[marked, other]}
        onPolygonChange={vi.fn()}
        onDrawPointCount={vi.fn()}
      />,
    )
    // Nothing marked: the halo layer exists but has nothing in it, so the walk
    // map opens with no claim about where the canvasser is.
    expect(layerData('route-pin-selection')).toEqual([])

    rerender(
      <VoterMapCanvas
        {...baseProps}
        startDrawToken={0}
        routePins={[marked, other]}
        selectedStopId={11}
        onPolygonChange={vi.fn()}
        onDrawPointCount={vi.fn()}
      />,
    )

    // Matched on the stop's identity, not on the numeral both surfaces draw.
    expect(layerData('route-pin-selection')).toEqual([marked])
    const halo = layer('route-pin-selection')
    // Outside the pin, so the status fill and the hollow-pin ring survive it.
    expect(halo?.radiusMinPixels ?? 0).toBeGreaterThan(
      layer('route-pins')?.radiusMinPixels ?? 0,
    )
    // A mark and not a control: the tap has to reach the pin underneath, which
    // is the thing that opens the door.
    expect(halo?.pickable).toBe(false)
    expect(layer('route-pins')?.getFillColor?.(marked)).toEqual([
      ...STATUS_RGB.unknown,
      235,
    ])
  })

  // Archiving is a rail decision about which lists a candidate is working
  // through, so the outline stays — quiet, in its own colour, because that
  // colour is what ties a ring to the card that names it.
  it('draws an archived list’s ring at a fraction of its own strength', () => {
    const active = {
      ...turfFixture,
      id: 1,
      color: '#2563eb',
      archivedAt: null,
    }
    const archived = {
      ...turfFixture,
      id: 2,
      color: '#2563eb',
      archivedAt: new Date('2026-08-20T00:00:00Z'),
    }

    render(
      <VoterMapCanvas
        {...baseProps}
        startDrawToken={0}
        turfs={[active, archived]}
        onPolygonChange={vi.fn()}
        onDrawPointCount={vi.fn()}
      />,
    )

    const turfLayer = layer('saved-turfs')
    const activeLine = turfLayer?.getLineColor?.(active) ?? []
    const archivedLine = turfLayer?.getLineColor?.(archived) ?? []
    // Same hue, less of it — a recoloured ring would stop matching the card.
    expect(archivedLine.slice(0, 3)).toEqual(activeLine.slice(0, 3))
    expect(archivedLine[3]).toBeLessThan(activeLine[3] ?? 0)
    // Still drawn: the shelf is not a delete, and on the map that is the only
    // thing telling the two apart.
    expect(archivedLine[3]).toBeGreaterThan(0)
    expect(turfLayer?.getFillColor?.(archived)?.[3] ?? 0).toBeLessThan(
      turfLayer?.getFillColor?.(active)?.[3] ?? 0,
    )
  })

  // A canvasser standing in front of a house taps its pin — that was inert,
  // because the layer was unpickable and had no handler at all.
  it('opens the tapped stop, with a target a thumb can hit', () => {
    const onRoutePinClick = vi.fn()
    const pin: RoutePin = {
      stopId: 11,
      seq: 1,
      lat: 41.92,
      lng: -87.66,
      status: 'unknown',
      knockable: true,
    }
    gl.overlay.pickedPin = { object: pin }

    render(
      <VoterMapCanvas
        {...baseProps}
        startDrawToken={0}
        routePins={[pin]}
        onRoutePinClick={onRoutePinClick}
        onPolygonChange={vi.fn()}
        onDrawPointCount={vi.fn()}
      />,
    )
    clickMap([-87.66, 41.92])

    expect(layer('route-pins')?.pickable).toBe(true)
    expect(onRoutePinClick).toHaveBeenCalledWith(pin)
    // This is used one-handed in the street, so the drawn pin plus the pick
    // slop has to clear the ~44px diameter a thumb needs.
    expect(
      (layer('route-pins')?.radiusMinPixels ?? 0) +
        (gl.overlay.lastPick?.radius ?? 0),
    ).toBeGreaterThanOrEqual(22)
  })

  // Drawing and knocking are different modes, and the create flow's map has no
  // pins on it — but a tap that became both a vertex and a door would be the
  // worst of the two.
  it('does not open a door with a tap placed while drawing', () => {
    const onRoutePinClick = vi.fn()
    const onDrawPointCount = vi.fn()
    gl.overlay.pickedPin = {
      object: {
        stopId: 11,
        seq: 1,
        lat: 41.92,
        lng: -87.66,
        status: 'unknown',
        knockable: true,
      },
    }

    render(
      <VoterMapCanvas
        {...baseProps}
        onRoutePinClick={onRoutePinClick}
        onPolygonChange={vi.fn()}
        onDrawPointCount={onDrawPointCount}
      />,
    )
    clickMap([-87.66, 41.92])

    expect(onRoutePinClick).not.toHaveBeenCalled()
    expect(onDrawPointCount).toHaveBeenLastCalledWith(1)
  })

  // The confirm step asks a candidate to pick the colour their list will be
  // drawn in. The ring was a fixed blue, so the pick was made against nothing
  // that could show it — now the boundary wears it while it is being chosen.
  it('draws the in-progress boundary in the colour being picked', () => {
    const { rerender } = render(
      <VoterMapCanvas
        {...baseProps}
        onPolygonChange={vi.fn()}
        onDrawPointCount={vi.fn()}
      />,
    )
    POINTS.slice(0, 3).forEach(clickMap)
    expect(staticColor('draw-preview', 'getLineColor')).toEqual([
      37, 99, 235, 255,
    ])

    rerender(
      <VoterMapCanvas
        {...baseProps}
        drawColor="#16a34a"
        onPolygonChange={vi.fn()}
        onDrawPointCount={vi.fn()}
      />,
    )

    const line = staticColor('draw-preview', 'getLineColor')
    const fill = staticColor('draw-preview', 'getFillColor')
    expect(line).toEqual([22, 163, 74, 255])
    // Same hue behind the outline and much weaker, so the streets the shape is
    // being cut around stay readable through it.
    expect(fill.slice(0, 3)).toEqual(line.slice(0, 3))
    expect(fill[3]).toBeLessThan(line[3] ?? 0)
    // The corners belong to the same boundary, so they move with it — a blue
    // handle on a green ring reads as two shapes.
    expect(staticColor('draw-vertices', 'getFillColor')).toEqual(line)
  })

  // The map fills its container, so a step that covers the bottom of it and
  // uncovers the top strip reveals empty streets while the shape stays centred
  // behind the chrome. The covered band has to reach the camera as padding, or
  // the reveal is a picture of somewhere else.
  const framePadding = (): Record<string, number> =>
    (
      gl.map.fitBounds.mock.calls.at(-1) as
        | [unknown, { padding: Record<string, number> }]
        | undefined
    )?.[1].padding ?? {}

  it('frames the drawing into the band the chrome leaves uncovered', () => {
    Object.defineProperty(gl.map.getCanvas(), 'clientHeight', {
      value: 800,
      configurable: true,
    })
    const { rerender } = render(
      <VoterMapCanvas
        {...baseProps}
        onPolygonChange={vi.fn()}
        onDrawPointCount={vi.fn()}
      />,
    )
    POINTS.forEach(clickMap)

    rerender(
      <VoterMapCanvas
        {...baseProps}
        frameDrawToken={1}
        frameDrawBottomPct={70}
        onPolygonChange={vi.fn()}
        onDrawPointCount={vi.fn()}
      />,
    )

    // The shape's own box, not the pack's — this is a fit around what was
    // drawn.
    expect(gl.map.fitBounds.mock.calls.at(-1)?.[0]).toEqual([
      [-87.66, 41.92],
      [-87.65, 41.93],
    ])
    const covered = framePadding()
    expect(covered.bottom).toBeGreaterThan(covered.top ?? 0)
    // What is left is the band above the sheet: roughly the 30% it uncovers,
    // and never nothing.
    const band = 800 - (covered.top ?? 0) - (covered.bottom ?? 0)
    expect(band).toBeGreaterThan(0)
    expect(band).toBeLessThan(800 * 0.31)

    // Nothing covering the map pads it evenly, so the same request on a full
    // -height map centres the shape rather than pushing it up.
    rerender(
      <VoterMapCanvas
        {...baseProps}
        frameDrawToken={2}
        frameDrawBottomPct={0}
        onPolygonChange={vi.fn()}
        onDrawPointCount={vi.fn()}
      />,
    )
    expect(framePadding().bottom).toBe(framePadding().top)
  })

  // The band the confirm step uncovers is a picture: it is shielded from taps,
  // so every button standing in it is one that answers nothing when pressed.
  it('takes the map controls down for a step showing the map as a picture', () => {
    // The locate button hides itself where geolocation is unavailable, which
    // jsdom is, so give it something to offer before asking whether the step
    // took it away.
    Object.defineProperty(navigator, 'geolocation', {
      value: { watchPosition: vi.fn(), clearWatch: vi.fn() },
      configurable: true,
    })
    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      configurable: true,
    })
    const { container, rerender } = render(
      <VoterMapCanvas
        {...baseProps}
        onPolygonChange={vi.fn()}
        onDrawPointCount={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Show my location')).toBeInTheDocument()

    rerender(
      <VoterMapCanvas
        {...baseProps}
        controlsHidden
        onPolygonChange={vi.fn()}
        onDrawPointCount={vi.fn()}
      />,
    )

    expect(screen.queryByLabelText('Show my location')).not.toBeInTheDocument()
    // maplibre's navigation stack is maplibre's own DOM inside the container,
    // so it goes away by CSS rather than by being removed and rebuilt on a step
    // change — the map element carries the rule that hides it.
    expect(container.innerHTML).toContain('maplibregl-ctrl-top-right')
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
    expect(gl.map.jumpTo).toHaveBeenCalledWith({
      center: expect.anything(),
      zoom: 16,
    })
  })

  // The reported bug: correctly zoomed, wrongly centered. The map opened on
  // the midpoint of the pack's bounding box, which on a district that isn't a
  // rectangle is a spot nobody lives at — and at zoom 16 that spot is the
  // whole screen.
  it('opens on a real dot for a district whose bbox midpoint is empty', () => {
    // An L: a bar along the south edge and a bar up the west edge. The bbox
    // spans lng -87.70..-87.60 and lat 41.90..41.98, so its midpoint is
    // (-87.65, 41.94) — the empty north-east quadrant the L wraps around.
    const dots: Array<[number, number]> = [
      [-87.7, 41.9],
      [-87.68, 41.9],
      [-87.66, 41.9],
      [-87.64, 41.9],
      [-87.62, 41.9],
      [-87.6, 41.9],
      [-87.7, 41.92],
      [-87.7, 41.94],
      [-87.7, 41.96],
      [-87.7, 41.98],
    ]

    const center = openingCenterOf(dots)

    expect(center).not.toEqual([-87.65, 41.94])
    expectIsOneOf(center, dots)
  })

  // The case that breaks a mean as badly as it breaks the bbox midpoint: two
  // population centers with nothing between them. Both put the camera in the
  // farmland; the median lands in the larger town, because a cluster holding
  // more than half the dots brackets the median rank on both axes.
  it('opens in the larger town of a two-cluster district', () => {
    const town: Array<[number, number]> = [
      [-87.7, 41.9],
      [-87.69, 41.9],
      [-87.7, 41.91],
      [-87.69, 41.91],
      [-87.695, 41.905],
      [-87.68, 41.9],
      [-87.68, 41.91],
    ]
    const village: Array<[number, number]> = [
      [-87.4, 42.2],
      [-87.39, 42.2],
      [-87.4, 42.21],
    ]

    const center = openingCenterOf([...town, ...village])

    expectIsOneOf(center, town)
  })

  // One voter record geocoded hundreds of miles away drags min/max — and so
  // the bbox midpoint — most of the way to it, because the box reads only the
  // four extremes. Nothing in the pack's read path bounds a coordinate, so
  // this is a shape the data can take.
  it('is not moved by a single far-away coordinate', () => {
    const neighborhood: Array<[number, number]> = [
      [-87.7, 41.9],
      [-87.69, 41.9],
      [-87.7, 41.91],
      [-87.69, 41.91],
      [-87.695, 41.905],
    ]
    const strays: Array<[number, number]> = [[-74.0, 40.71]]

    const center = openingCenterOf([...neighborhood, ...strays])

    expectIsOneOf(center, neighborhood)
  })
})
