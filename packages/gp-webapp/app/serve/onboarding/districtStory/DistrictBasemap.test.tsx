import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { DistrictStoryMap } from './DistrictStoryMap'
import {
  basemapZoom,
  buildAbstractDots,
  buildDistrictDots,
  type DistrictMapMode,
} from './districtDots'

// maplibre needs WebGL, so the map is stood in for. What this protects is
// how the story builds it: once, as a picture, framed on the district.
const created: Array<Record<string, unknown>> = []
const handlers = new Map<string, () => void>()
const removed = vi.fn()

vi.mock('maplibre-gl', () => {
  class FakeMap {
    container: HTMLElement
    constructor(options: Record<string, unknown>) {
      created.push(options)
      this.container = options.container as HTMLElement
    }
    on(event: string, handler: () => void) {
      handlers.set(event, handler)
    }
    // How maplibre mounts a compact attribution once the tiles name their
    // sources: a <details> already expanded.
    addControl() {
      const attribution = document.createElement('details')
      attribution.className =
        'maplibregl-ctrl maplibregl-ctrl-attrib maplibregl-compact maplibregl-compact-show'
      attribution.setAttribute('open', '')
      const button = document.createElement('summary')
      button.className = 'maplibregl-ctrl-attrib-button'
      button.setAttribute('aria-label', 'Toggle attribution')
      attribution.append(button)
      this.container.append(attribution)
    }
    resize() {
      return undefined
    }
    jumpTo() {
      return undefined
    }
    remove() {
      removed()
    }
  }
  return {
    default: { Map: FakeMap, AttributionControl: class {} },
  }
})

vi.mock('appEnv', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  NEXT_PUBLIC_GEOAPIFY_TILES_KEY: 'test-key',
}))

const points = Array.from({ length: 2_000 }, (_, index) => ({
  lat: 35.58 + (index % 100) * 0.0004,
  lng: -82.56 + Math.floor(index / 100) * 0.0005,
}))
const model = buildDistrictDots(points)!

const WIDTH = 400
const widthDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'clientWidth',
)
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => WIDTH,
  })
})
afterAll(() => {
  if (widthDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDescriptor)
  }
})
beforeEach(() => {
  created.length = 0
  handlers.clear()
  removed.mockClear()
})

const renderMap = (mode: DistrictMapMode) =>
  render(<DistrictStoryMap model={model} mode={mode} animate intro={false} />)

describe('the district basemap', () => {
  it('loads street tiles behind the dots, framed on the district', async () => {
    renderMap('all')
    await waitFor(() => expect(created).toHaveLength(1))
    const options = created[0]!
    expect(options.style).toBe(
      'https://maps.geoapify.com/v1/styles/positron/style.json?apiKey=test-key',
    )
    expect(options.center).toEqual([
      model.camera!.center.lng,
      model.camera!.center.lat,
    ])
    expect(options.zoom).toBeCloseTo(basemapZoom(model.camera!, WIDTH))
    expect(
      screen
        .getByTestId('district-story-frame')
        .contains(screen.getByTestId('district-story-basemap')),
    ).toBe(true)
  })

  // maplibre-gl.css gives the map element `position: relative`, unlayered,
  // so it beats any Tailwind position utility on that element and an
  // `absolute inset-0` map collapses to zero height: no tiles, no
  // attribution. The map has to fill a wrapper that does the positioning.
  it('gives maplibre an element it can size, inside the positioned frame', async () => {
    renderMap('all')
    await waitFor(() => expect(created).toHaveLength(1))
    const container = created[0]!.container as HTMLElement
    const basemap = screen.getByTestId('district-story-basemap')
    expect(basemap).toHaveClass('absolute', 'inset-0')
    expect(basemap).not.toBe(container)
    expect(basemap.contains(container)).toBe(true)
    expect(container).toHaveClass('h-full', 'w-full')
    expect(container.className).not.toMatch(
      /\b(absolute|relative|fixed|static|sticky|inset-[^\s]*)\b/,
    )
  })

  it('sits under a transparent dot layer, with the muted fill behind it', async () => {
    renderMap('all')
    await waitFor(() => expect(created).toHaveLength(1))
    const frame = screen.getByTestId('district-story-frame')
    const basemap = screen.getByTestId('district-story-basemap')
    const dots = screen.getByTestId('district-story-map')
    expect(frame).toHaveClass('bg-muted')
    expect([...frame.children]).toEqual([basemap, dots])
    expect(dots.getAttribute('class')).not.toMatch(/\bbg-/)
    expect(basemap.className).not.toMatch(/\bbg-/)
  })

  it('is a picture, not a widget', async () => {
    renderMap('all')
    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0]!.interactive).toBe(false)
    expect(screen.getByTestId('district-story-map')).toHaveClass(
      'pointer-events-none',
    )
  })

  it('draws the dots without waiting on the tiles, and no outline', () => {
    renderMap('all')
    const map = screen.getByTestId('district-story-map')
    expect(map.querySelectorAll('circle')).toHaveLength(model.dots.length)
    expect(map.querySelector('path')).toBeNull()
  })

  it('keeps one map through every step', async () => {
    const { rerender } = renderMap('all')
    await waitFor(() => expect(created).toHaveLength(1))
    const first = screen
      .getByTestId('district-story-map')
      .querySelector('circle')
    for (const mode of ['dim', 'sample', 'grow', 'sample'] as const) {
      rerender(
        <DistrictStoryMap model={model} mode={mode} animate intro={false} />,
      )
    }
    expect(created).toHaveLength(1)
    expect(removed).not.toHaveBeenCalled()
    expect(
      screen.getByTestId('district-story-map').querySelector('circle'),
    ).toBe(first)
  })

  it('keeps the attribution behind its button until it is tapped', async () => {
    renderMap('all')
    await waitFor(() => expect(handlers.has('load')).toBe(true))
    const basemap = screen.getByTestId('district-story-basemap')
    const attribution = basemap.querySelector('.maplibregl-ctrl-attrib')!
    expect(attribution).toHaveClass('maplibregl-compact-show')
    handlers.get('load')!()
    expect(attribution).toHaveClass('maplibregl-compact')
    expect(attribution).not.toHaveClass('maplibregl-compact-show')
    expect(
      screen.getByRole('button', { name: 'Toggle attribution' }),
    ).toBeInTheDocument()
  })

  it('swallows tile errors', async () => {
    renderMap('all')
    await waitFor(() => expect(handlers.has('error')).toBe(true))
    expect(() => handlers.get('error')!()).not.toThrow()
  })

  it('leaves the stand-in district without tiles', () => {
    render(
      <DistrictStoryMap
        model={buildAbstractDots()}
        mode="all"
        animate={false}
        intro={false}
      />,
    )
    expect(screen.queryByTestId('district-story-basemap')).toBeNull()
    expect(
      screen.getByTestId('district-story-map').querySelector('path'),
    ).not.toBeNull()
  })
})
