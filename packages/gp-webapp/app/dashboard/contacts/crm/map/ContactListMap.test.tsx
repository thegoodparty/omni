import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import type { Person } from '../shared/contacts-types'
import ContactListMap from './ContactListMap'

// maplibre needs a real canvas and deck.gl needs WebGL, so both are stood in
// for. The stand-ins are deliberately thin: what this file protects is which
// LAYERS the overlay is handed and which map events the component binds, and
// the Chief of Staff chat card depends on both being unchanged when no
// boundary is in play.
const mapHandlers = new Map<string, (event: unknown) => void>()
const overlaySetProps = vi.fn()
const pickObject = vi.fn()
const dragPan = { enable: vi.fn(), disable: vi.fn() }
const fitBounds = vi.fn()

vi.mock('maplibre-gl', () => {
  class FakeMap {
    on(event: string, handler: (payload: unknown) => void) {
      mapHandlers.set(event, handler)
    }
    addControl() {
      return undefined
    }
    setStyle() {
      return undefined
    }
    remove() {
      return undefined
    }
    fitBounds(...args: unknown[]) {
      fitBounds(...args)
    }
    getCanvas() {
      return { style: {} as Record<string, string> }
    }
    dragPan = dragPan
  }
  return {
    default: {
      Map: FakeMap,
      AttributionControl: class {},
    },
  }
})

vi.mock('@deck.gl/mapbox', () => ({
  MapboxOverlay: class {
    setProps(props: unknown) {
      overlaySetProps(props)
    }
    pickObject(...args: unknown[]) {
      return pickObject(...args)
    }
  },
}))

vi.mock('appEnv', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  NEXT_PUBLIC_GEOAPIFY_TILES_KEY: 'test-key',
}))

const person = (id: string, lat: string, lng: string) =>
  ({
    id,
    firstName: 'Ada',
    lastName: 'Byron',
    address: { latitude: lat, longitude: lng },
  }) as unknown as Person

const PEOPLE = [person('p1', '44.76', '-85.61'), person('p2', '44.77', '-85.6')]

const RING: Array<[number, number]> = [
  [-85.62, 44.75],
  [-85.6, 44.75],
  [-85.61, 44.77],
]

const lastLayers = (): Array<{ id: string; props: Record<string, unknown> }> =>
  (
    overlaySetProps.mock.calls.at(-1)?.[0] as {
      layers: Array<{ id: string; props: Record<string, unknown> }>
    }
  ).layers

beforeEach(() => {
  vi.clearAllMocks()
  mapHandlers.clear()
  pickObject.mockReturnValue(null)
})

describe('ContactListMap with draw mode off', () => {
  it('hands the overlay only the contacts layer, still pickable', () => {
    render(<ContactListMap people={PEOPLE} onSelectPerson={vi.fn()} />)

    const layers = lastLayers()
    expect(layers.map((layer) => layer.id)).toEqual(['contacts'])
    expect(layers[0]!.props.pickable).toBe(true)
  })

  // The Chief of Staff chat card passes people and nothing else.
  it('stays unpickable when no person handler is given', () => {
    render(<ContactListMap people={PEOPLE} />)

    expect(lastLayers().map((layer) => layer.id)).toEqual(['contacts'])
    expect(lastLayers()[0]!.props.pickable).toBe(false)
  })

  // The map instance outlives the props, so the click handler re-reads the
  // writer every time. A surface that stops offering one — and the chat
  // card, which never did — must not have its clicks reach the ring.
  it('stops writing vertices as soon as the writer goes away', () => {
    const onDrawRingChange = vi.fn()
    const { rerender } = render(
      <ContactListMap
        people={PEOPLE}
        drawRing={RING}
        onDrawRingChange={onDrawRingChange}
      />,
    )
    mapHandlers.get('click')?.({ lngLat: { lng: -85.61, lat: 44.7501 } })
    expect(onDrawRingChange).toHaveBeenCalledTimes(1)

    rerender(<ContactListMap people={PEOPLE} drawRing={RING} />)
    mapHandlers.get('click')?.({ lngLat: { lng: -85.605, lat: 44.7502 } })

    expect(onDrawRingChange).toHaveBeenCalledTimes(1)
    expect(lastLayers().map((layer) => layer.id)).toEqual([
      'contacts',
      'boundary',
    ])
  })
})

describe('ContactListMap with a boundary', () => {
  it('draws a saved ring with no handles and no writer', () => {
    render(<ContactListMap people={PEOPLE} drawRing={RING} />)

    expect(lastLayers().map((layer) => layer.id)).toEqual([
      'contacts',
      'boundary',
    ])
  })

  it('adds handles and stops the dots taking the click while drawing', () => {
    render(
      <ContactListMap
        people={PEOPLE}
        onSelectPerson={vi.fn()}
        drawRing={RING}
        onDrawRingChange={vi.fn()}
      />,
    )

    const layers = lastLayers()
    expect(layers.map((layer) => layer.id)).toEqual([
      'contacts',
      'boundary',
      'boundary-vertices',
    ])
    expect(layers[0]!.props.pickable).toBe(false)
  })

  it('splices a clicked point into the nearest edge', () => {
    const onDrawRingChange = vi.fn()
    render(
      <ContactListMap
        people={PEOPLE}
        drawRing={RING}
        onDrawRingChange={onDrawRingChange}
      />,
    )

    // On the first edge, between [-85.62, 44.75] and [-85.6, 44.75].
    mapHandlers.get('click')?.({ lngLat: { lng: -85.61, lat: 44.7501 } })

    expect(onDrawRingChange).toHaveBeenCalledWith([
      RING[0],
      [-85.61, 44.7501],
      RING[1],
      RING[2],
    ])
  })

  // A double-click arrives as two clicks at one coordinate.
  it('ignores a click landing exactly on an existing vertex', () => {
    const onDrawRingChange = vi.fn()
    render(
      <ContactListMap
        people={PEOPLE}
        drawRing={RING}
        onDrawRingChange={onDrawRingChange}
      />,
    )

    mapHandlers.get('click')?.({
      lngLat: { lng: RING[1]![0], lat: RING[1]![1] },
    })

    expect(onDrawRingChange).not.toHaveBeenCalled()
  })

  it('moves the grabbed handle and swallows the click that ends the drag', () => {
    const onDrawRingChange = vi.fn()
    render(
      <ContactListMap
        people={PEOPLE}
        drawRing={RING}
        onDrawRingChange={onDrawRingChange}
      />,
    )
    pickObject.mockReturnValue({ index: 2 })

    mapHandlers.get('mousedown')?.({
      point: { x: 10, y: 10 },
      preventDefault: vi.fn(),
    })
    mapHandlers.get('mousemove')?.({ lngLat: { lng: -85.59, lat: 44.78 } })

    expect(onDrawRingChange).toHaveBeenCalledWith([
      RING[0],
      RING[1],
      [-85.59, 44.78],
    ])
    expect(dragPan.disable).toHaveBeenCalled()

    onDrawRingChange.mockClear()
    mapHandlers.get('mouseup')?.({})
    mapHandlers.get('click')?.({ lngLat: { lng: -85.605, lat: 44.755 } })

    expect(dragPan.enable).toHaveBeenCalled()
    expect(onDrawRingChange).not.toHaveBeenCalled()
  })
})
