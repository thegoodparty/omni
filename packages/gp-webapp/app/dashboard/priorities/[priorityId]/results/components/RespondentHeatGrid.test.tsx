import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RespondentHeatGrid } from './RespondentHeatGrid'

// The basemap and deck.gl are stood in for: what this file protects is what a
// browser with no WebGL gets, and maplibre refuses one from its constructor.
const construction = vi.hoisted(() => ({ failure: null as Error | null }))

vi.mock('maplibre-gl', () => ({
  default: {
    Map: class {
      constructor() {
        if (construction.failure) throw construction.failure
      }
      on() {
        return undefined
      }
      addControl() {
        return undefined
      }
      remove() {
        return undefined
      }
      getContainer() {
        return document.createElement('div')
      }
    },
    AttributionControl: class {},
    NavigationControl: class {},
  },
}))

vi.mock('@deck.gl/mapbox', () => ({
  MapboxOverlay: class {
    setProps() {
      return undefined
    }
  },
}))

vi.mock('@deck.gl/layers', () => ({
  PolygonLayer: class {},
}))

vi.mock('appEnv', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  NEXT_PUBLIC_GEOAPIFY_TILES_KEY: 'test-key',
}))

const POINTS = [
  { lat: 44.76, lng: -85.61 },
  { lat: 44.77, lng: -85.6 },
]

beforeEach(() => {
  construction.failure = null
})

describe('RespondentHeatGrid', () => {
  it('says the map could not be drawn instead of throwing', () => {
    construction.failure = new Error('Failed to initialize WebGL')

    render(<RespondentHeatGrid points={POINTS} />)

    expect(
      screen.getByText(/could not be drawn on this device/),
    ).toBeInTheDocument()
  })
})
