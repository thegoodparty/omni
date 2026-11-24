import { describe, it, expect, vi, beforeEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import ErrorPage from './error'

vi.mock('@shared/observability/reportClientError', () => ({
  reportClientError: vi.fn(),
  reportClientInterruption: vi.fn(),
}))

import {
  reportClientError,
  reportClientInterruption,
} from '@shared/observability/reportClientError'

const mockReportClientError = vi.mocked(reportClientError)

const chunkLoadErrors = [
  // webpack
  new Error('Loading chunk 4 failed'),
  // Turbopack, which Next 16 builds with
  new Error(
    'Failed to load chunk /_next/static/chunks/17bg_j5w-edpf.js from module 355143',
  ),
]

beforeEach(() => {
  window.sessionStorage.clear()
  vi.clearAllMocks()
})

const stubReload = () => {
  const reloadSpy = vi.fn()
  const originalLocation = window.location
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, reload: reloadSpy },
  })

  return { reloadSpy, originalLocation }
}

const restoreLocation = (originalLocation: Location) =>
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  })

describe('Error', () => {
  it.each(chunkLoadErrors)(
    'logs a retry for %s without reporting an exception, then reloads',
    async (error) => {
      const { reloadSpy, originalLocation } = stubReload()

      render(<ErrorPage error={error} />)

      expect(reportClientInterruption).toHaveBeenCalledOnce()
      expect(mockReportClientError).not.toHaveBeenCalled()
      expect(reloadSpy).not.toHaveBeenCalled()

      await waitFor(() => {
        expect(reloadSpy).toHaveBeenCalled()
      })

      restoreLocation(originalLocation)
    },
  )

  it('does not reload for an error that is not a chunk-load error', () => {
    vi.useFakeTimers()
    const { reloadSpy, originalLocation } = stubReload()

    render(<ErrorPage error={new Error('gp-api timed out')} />)
    vi.advanceTimersByTime(1000)

    expect(reloadSpy).not.toHaveBeenCalled()

    restoreLocation(originalLocation)
    vi.useRealTimers()
  })
})
