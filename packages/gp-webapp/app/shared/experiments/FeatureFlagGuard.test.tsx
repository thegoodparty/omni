import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import FeatureFlagGuard from './FeatureFlagGuard'

const { mockUseFlagOn } = vi.hoisted(() => ({ mockUseFlagOn: vi.fn() }))

vi.mock('./FeatureFlagsProvider', () => ({
  useFlagOn: (...args: unknown[]) => mockUseFlagOn(...args),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockUseFlagOn.mockReturnValue({ ready: true, on: true })
})

describe('FeatureFlagGuard', () => {
  it('renders the children and exposes the flag by default', () => {
    render(
      <FeatureFlagGuard flagKey="some-flag">
        <div>gated</div>
      </FeatureFlagGuard>,
    )

    expect(screen.getByText('gated')).toBeInTheDocument()
    expect(mockUseFlagOn).toHaveBeenCalledWith('some-flag', {
      trackExposure: true,
    })
  })

  it('reads the flag without exposing when trackExposure is false', () => {
    render(
      <FeatureFlagGuard flagKey="some-flag" trackExposure={false}>
        <div>gated</div>
      </FeatureFlagGuard>,
    )

    expect(screen.getByText('gated')).toBeInTheDocument()
    expect(mockUseFlagOn).toHaveBeenCalledWith('some-flag', {
      trackExposure: false,
    })
  })

  it('shows a spinner until the flags resolve', () => {
    mockUseFlagOn.mockReturnValue({ ready: false, on: false })

    render(
      <FeatureFlagGuard flagKey="some-flag">
        <div>gated</div>
      </FeatureFlagGuard>,
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('gated')).not.toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('redirects away once the flag resolves off', () => {
    mockUseFlagOn.mockReturnValue({ ready: true, on: false })

    render(
      <FeatureFlagGuard flagKey="some-flag" redirectTo="/dashboard/elsewhere">
        <div>gated</div>
      </FeatureFlagGuard>,
    )

    expect(screen.queryByText('gated')).not.toBeInTheDocument()
    expect(router.replace).toHaveBeenCalledWith('/dashboard/elsewhere')
  })
})
