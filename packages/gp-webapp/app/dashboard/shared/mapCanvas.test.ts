import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MapOptions } from 'maplibre-gl'
import { createMap } from './mapCanvas'

// The one thing this module owns is what a refused WebGL context costs, so the
// map is stood in for entirely: no canvas, no deck.gl.
const construction = vi.hoisted(() => ({
  failure: null as Error | null,
  options: null as unknown,
}))

const reportClientError = vi.hoisted(() => vi.fn())

vi.mock('maplibre-gl', () => ({
  default: {
    Map: class {
      constructor(options: unknown) {
        construction.options = options
        if (construction.failure) throw construction.failure
      }
    },
  },
}))

vi.mock('@shared/observability/reportClientError', () => ({
  reportClientError: (...args: unknown[]) => reportClientError(...args),
}))

const OPTIONS = { container: {} as HTMLElement, style: '{}' } as MapOptions

beforeEach(() => {
  construction.failure = null
  construction.options = null
  reportClientError.mockReset()
})

describe('createMap', () => {
  it('builds the map it was asked for', () => {
    const map = createMap(OPTIONS, 'contact-list-map')

    expect(map).not.toBeNull()
    expect(construction.options).toBe(OPTIONS)
    expect(reportClientError).not.toHaveBeenCalled()
  })

  // The reported bug: a browser whose GPU path is off or sandboxed throws out
  // of maplibre's constructor, and from an effect that throw took the whole
  // page instead of the map.
  it('answers null and reports, rather than throwing out of the caller', () => {
    const refusal = new Error('Failed to initialize WebGL')
    construction.failure = refusal

    expect(createMap(OPTIONS, 'voter-map-canvas')).toBeNull()
    expect(reportClientError).toHaveBeenCalledWith(refusal, {
      mapSurface: 'voter-map-canvas',
    })
  })
})
