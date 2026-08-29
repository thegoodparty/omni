import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import ProUpgradeWizard, { useProUpgradeWizard } from './ProUpgradeWizard'
import { usePathname } from 'next/navigation'
import { noop } from '@shared/utils/noop'

// The global setup mocks next/navigation with useRouter only; this component
// also needs usePathname, so override the module for this file.
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: vi.fn(),
}))

const mockUsePathname = vi.mocked(usePathname)

// Context probe: the wizard chrome no longer renders Back itself (steps own
// their footer Back buttons), so navigation behavior is exercised through the
// context the steps consume.
const BackProbe = (): React.JSX.Element => {
  const { goToPreviousStep } = useProUpgradeWizard()
  return (
    <button type="button" onClick={goToPreviousStep}>
      probe-back
    </button>
  )
}

describe('ProUpgradeWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'scrollTo').mockImplementation(noop)
    mockUsePathname.mockReturnValue('/dashboard/pro-upgrade/ein')
  })

  it('renders the step children', () => {
    render(
      <ProUpgradeWizard>
        <div>step-content</div>
      </ProUpgradeWizard>,
    )

    expect(screen.getByText('step-content')).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('renders an Exit link to the dashboard', () => {
    render(
      <ProUpgradeWizard>
        <div>step-content</div>
      </ProUpgradeWizard>,
    )

    expect(screen.getByRole('link', { name: /exit/i })).toHaveAttribute(
      'href',
      '/dashboard',
    )
  })

  it('shows the vertical stepper with the active step on a collection step', () => {
    mockUsePathname.mockReturnValue('/dashboard/pro-upgrade/filing-details')

    render(
      <ProUpgradeWizard>
        <div>step-content</div>
      </ProUpgradeWizard>,
    )

    const active = screen.getByText('Campaign details').closest('li')
    expect(active).toHaveAttribute('aria-current', 'step')
    // Steps before the active one are announced as completed; upcoming ones
    // are not.
    const completed = screen.getByText('Campaign EIN').closest('li')
    expect(completed).not.toHaveAttribute('aria-current')
    expect(completed).toHaveAttribute('aria-label', 'Campaign EIN - completed')
    expect(
      screen.getByText('Candidate profile').closest('li'),
    ).not.toHaveAttribute('aria-label')
    expect(screen.getByText('Payment')).toBeInTheDocument()
    // The old top-of-card progress bar is gone from the design.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('routes Back from the off-order routes to the status step, not browser history', () => {
    for (const step of ['filing-instructions', 'guidance']) {
      mockUsePathname.mockReturnValue(`/dashboard/pro-upgrade/${step}`)
      const { unmount } = render(
        <ProUpgradeWizard>
          <BackProbe />
        </ProUpgradeWizard>,
      )

      fireEvent.click(screen.getByRole('button', { name: 'probe-back' }))

      // A candidate can land here from a direct URL with no wizard history;
      // router.back() would exit the flow entirely.
      expect(router.push).toHaveBeenCalledWith('/dashboard/pro-upgrade/status')
      expect(router.back).not.toHaveBeenCalled()
      router.push?.mockClear()
      unmount()
    }
  })

  it('does not show the stepper on payment or on steps outside the collection steps', () => {
    for (const step of [
      'payment',
      'value-prop',
      'status',
      'guidance',
      'success',
    ]) {
      mockUsePathname.mockReturnValue(`/dashboard/pro-upgrade/${step}`)
      const { unmount } = render(
        <ProUpgradeWizard>
          <div>step-content</div>
        </ProUpgradeWizard>,
      )
      expect(screen.queryByText('Campaign EIN')).not.toBeInTheDocument()
      unmount()
    }
  })
})
