import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { useProUpgrade3Flag } from '@shared/experiments/proUpgrade3Flag'
import UpdateToProPage from './UpdateToProPage'

vi.mock('@shared/experiments/proUpgrade3Flag', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@shared/experiments/proUpgrade3Flag')>()
  return { ...actual, useProUpgrade3Flag: vi.fn() }
})

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

// The splash chrome isn't under test here — only the cohort bounce. Stub the
// heavy layout/provider/card deps so the test exercises the redirect logic.
vi.mock('../../shared/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock(
  'app/dashboard/campaign-details/components/issues/CandidatePositionsProvider',
  () => ({
    CandidatePositionsProvider: ({
      children,
    }: {
      children: React.ReactNode
    }) => <div>{children}</div>,
  }),
)
vi.mock('app/dashboard/upgrade-to-pro/components/ProPricingCard', () => ({
  ProPricingCard: () => <div>pricing-card</div>,
}))

const mockUseProUpgrade3Flag = vi.mocked(useProUpgrade3Flag)

describe('UpdateToProPage cohort bounce', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects the cohort to the new wizard instead of the legacy splash', () => {
    mockUseProUpgrade3Flag.mockReturnValue({ ready: true, enabled: true })

    render(<UpdateToProPage campaign={null} />)

    expect(router.replace).toHaveBeenCalledWith('/dashboard/pro-upgrade')
    expect(screen.queryByText('Why pay more for less?')).not.toBeInTheDocument()
  })

  it('renders the legacy splash for the off-cohort and keeps the pro-sign-up CTA', () => {
    mockUseProUpgrade3Flag.mockReturnValue({ ready: true, enabled: false })

    render(<UpdateToProPage campaign={null} />)

    expect(router.replace).not.toHaveBeenCalled()
    expect(screen.getByText('Why pay more for less?')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Start today/ })).toHaveAttribute(
      'href',
      '/dashboard/pro-sign-up',
    )
  })

  it('does not redirect before the flag resolves', () => {
    mockUseProUpgrade3Flag.mockReturnValue({ ready: false, enabled: false })

    render(<UpdateToProPage campaign={null} />)

    expect(router.replace).not.toHaveBeenCalled()
    expect(screen.getByText('Why pay more for less?')).toBeInTheDocument()
  })
})
