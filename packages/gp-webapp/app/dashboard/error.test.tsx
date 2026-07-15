import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
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

const mockReportErrorToSentry = vi.mocked(reportErrorToSentry)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DashboardError', () => {
  it('renders the fallback message and reports the error to Sentry', () => {
    const error = new Error('gp-api timed out')
    render(<DashboardError error={error} reset={vi.fn()} />)

    expect(
      screen.getByText(/something went wrong loading this page/i),
    ).toBeInTheDocument()
    expect(mockReportErrorToSentry).toHaveBeenCalledWith(error)
  })

  it('calls reset exactly once when "Try again" is clicked', () => {
    const reset = vi.fn()
    render(<DashboardError error={new Error('boom')} reset={reset} />)

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('reloads the page on a chunk-load error', () => {
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

    expect(reloadSpy).toHaveBeenCalled()

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
  })
})
