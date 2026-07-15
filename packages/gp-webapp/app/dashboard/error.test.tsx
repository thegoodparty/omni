import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import DashboardError from './error'

vi.mock('gpApi/clientFetch', () => ({
  clientFetch: vi.fn(),
}))

vi.mock('@shared/sentry', () => ({
  reportErrorToSentry: vi.fn(),
}))

vi.mock('@clerk/nextjs', () => ({
  useUser: vi.fn(() => ({ user: null, isLoaded: true })),
}))

import { reportErrorToSentry } from '@shared/sentry'
import { clientFetch } from 'gpApi/clientFetch'
import { apiRoutes } from 'gpApi/routes'

const mockReportErrorToSentry = vi.mocked(reportErrorToSentry)
const mockClientFetch = vi.mocked(clientFetch)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DashboardError', () => {
  it('renders the fallback message and reports the error to Sentry', async () => {
    const error = new Error('gp-api timed out')
    render(<DashboardError error={error} reset={vi.fn()} />)

    expect(
      screen.getByText(/something went wrong loading this page/i),
    ).toBeInTheDocument()
    expect(mockReportErrorToSentry).toHaveBeenCalledWith(error)

    await waitFor(() => {
      expect(mockClientFetch).toHaveBeenCalledTimes(1)
    })
    expect(mockClientFetch).toHaveBeenCalledWith(
      apiRoutes.logError,
      expect.objectContaining({
        message: 'gp-api timed out',
        url: expect.any(String),
        userAgent: expect.any(String),
      }),
    )
  })

  it('calls reset exactly once when "Try again" is clicked', () => {
    const reset = vi.fn()
    render(<DashboardError error={new Error('boom')} reset={reset} />)

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('flushes telemetry to the error logger before reloading on a chunk-load error', async () => {
    const reloadSpy = vi.fn()
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    })

    render(
      <DashboardError
        error={new Error('Loading chunk 4 failed')}
        reset={vi.fn()}
      />,
    )

    expect(mockClientFetch).toHaveBeenCalledTimes(1)
    expect(mockClientFetch).toHaveBeenCalledWith(
      apiRoutes.logError,
      expect.objectContaining({ message: 'Loading chunk 4 failed' }),
    )
    expect(reloadSpy).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(reloadSpy).toHaveBeenCalled()
    })
    expect(mockClientFetch).toHaveBeenCalledTimes(1)

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
  })
})
