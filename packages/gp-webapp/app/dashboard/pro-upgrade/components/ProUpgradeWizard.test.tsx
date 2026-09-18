import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import ProUpgradeWizard, { useProUpgradeWizard } from './ProUpgradeWizard'
import { usePathname } from 'next/navigation'
import { noop } from '@shared/utils/noop'
import { useOutreachProGatingV2Flag } from 'app/shared/experiments/outreachProGatingV2Flag'

// The global setup mocks next/navigation with useRouter only; this component
// also needs usePathname, so override the module for this file.
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: vi.fn(),
}))

vi.mock('app/shared/experiments/outreachProGatingV2Flag', () => ({
  useOutreachProGatingV2Flag: vi.fn(() => ({ ready: true, enabled: false })),
}))

const mockUsePathname = vi.mocked(usePathname)
const mockUseFlag = vi.mocked(useOutreachProGatingV2Flag)

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
    mockUseFlag.mockReturnValue({ ready: true, enabled: false })
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

  it('holds the step children behind a spinner until the flag resolves', () => {
    // An unresolved flag reads off, so rendering a step before the answer
    // arrives would wire its Continue to the wrong next step.
    mockUseFlag.mockReturnValue({ ready: false, enabled: false })

    const { unmount } = render(
      <ProUpgradeWizard>
        <div>step-content</div>
      </ProUpgradeWizard>,
    )

    expect(screen.queryByText('step-content')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    // The chrome is held, not hidden.
    expect(screen.getByRole('link', { name: /exit/i })).toBeInTheDocument()
    unmount()

    mockUseFlag.mockReturnValue({ ready: true, enabled: false })
    render(
      <ProUpgradeWizard>
        <div>step-content</div>
      </ProUpgradeWizard>,
    )

    expect(screen.getByText('step-content')).toBeInTheDocument()
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

  it('routes Back from the filing-status step to the value prop in the default order', () => {
    mockUsePathname.mockReturnValue('/dashboard/pro-upgrade/status')

    render(
      <ProUpgradeWizard>
        <BackProbe />
      </ProUpgradeWizard>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'probe-back' }))

    expect(router.push).toHaveBeenCalledWith(
      '/dashboard/pro-upgrade/value-prop',
    )
  })

  it('routes Back from the filing-status step to guidance in purchase-only mode', () => {
    // Purchase-only drops the value prop (it lives in the Pro pitch dialog)
    // and makes guidance the first ordered step.
    mockUseFlag.mockReturnValue({ ready: true, enabled: true })
    mockUsePathname.mockReturnValue('/dashboard/pro-upgrade/status')

    render(
      <ProUpgradeWizard>
        <BackProbe />
      </ProUpgradeWizard>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'probe-back' }))

    expect(router.push).toHaveBeenCalledWith('/dashboard/pro-upgrade/guidance')
    expect(router.back).not.toHaveBeenCalled()
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
