import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import DashboardError from './error'

vi.mock('@shared/observability/reportClientError', () => ({
  reportClientError: vi.fn(),
}))

import { reportClientError } from '@shared/observability/reportClientError'

const mockReportClientError = vi.mocked(reportClientError)

beforeEach(() => {
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

  it('reports a chunk-load error, then reloads once Faro has had time to send it', async () => {
    const reloadSpy = vi.fn()
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    })

    const error = new Error('Loading chunk 4 failed')
    render(<DashboardError error={error} reset={vi.fn()} />)

    expect(mockReportClientError).toHaveBeenCalledWith(error)
    expect(reloadSpy).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalled()
    })

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
  })
})
