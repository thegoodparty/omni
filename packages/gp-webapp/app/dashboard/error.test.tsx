import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import DashboardError from './error'

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

describe('DashboardError', () => {
  it('renders the fallback message and reports the error', () => {
    const error = new Error('gp-api timed out')
    render(<DashboardError error={error} reset={vi.fn()} />)

    expect(
      screen.getByText(/something went wrong loading this page/i),
    ).toBeInTheDocument()
    expect(mockReportClientError).toHaveBeenCalledWith(error)
  })

  it('calls reset exactly once when "Try again" is clicked', () => {
    const reset = vi.fn()
    render(<DashboardError error={new Error('boom')} reset={reset} />)

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(reset).toHaveBeenCalledTimes(1)
  })

  it.each(chunkLoadErrors)(
    'logs a retry for %s without reporting an exception, then reloads',
    async (error) => {
      const reloadSpy = vi.fn()
      const originalLocation = window.location
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...originalLocation, reload: reloadSpy },
      })

      render(<DashboardError error={error} reset={vi.fn()} />)

      expect(reportClientInterruption).toHaveBeenCalledOnce()
      expect(mockReportClientError).not.toHaveBeenCalled()
      expect(reloadSpy).not.toHaveBeenCalled()

      await waitFor(() => {
        expect(reloadSpy).toHaveBeenCalled()
      })

      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      })
    },
  )
})
