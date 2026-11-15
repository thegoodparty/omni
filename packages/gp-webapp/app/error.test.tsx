import { describe, it, expect, vi, beforeEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import ErrorPage from './error'

vi.mock('@shared/observability/reportClientError', () => ({
  reportClientError: vi.fn(),
}))

import { reportClientError } from '@shared/observability/reportClientError'

const mockReportClientError = vi.mocked(reportClientError)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Error', () => {
  it('reports a chunk-load error, then reloads once Faro has had time to send it', async () => {
    const reloadSpy = vi.fn()
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    })

    const error = new Error('Loading chunk 4 failed')
    render(<ErrorPage error={error} />)

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
