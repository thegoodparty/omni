import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import ProUpgradeWizard, { useProUpgradeWizard } from './ProUpgradeWizard'
import { usePathname } from 'next/navigation'
import { noop } from '@shared/utils/noop'
import { useSmsCompliance } from 'app/dashboard/shared/smsCutoff/useSmsCompliance'

// The global setup mocks next/navigation with useRouter only; this component
// also needs usePathname, so override the module for this file.
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: vi.fn(),
}))

vi.mock('app/dashboard/shared/smsCutoff/useSmsCompliance', () => ({
  useSmsCompliance: vi.fn(),
}))

const mockUsePathname = vi.mocked(usePathname)
const mockUseSmsCompliance = vi.mocked(useSmsCompliance)

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

const NextProbe = (): React.JSX.Element => {
  const { goToNextStep } = useProUpgradeWizard()
  return (
    <button type="button" onClick={goToNextStep}>
      probe-next
    </button>
  )
}

const CompleteProbe = (): React.JSX.Element => {
  const { complete } = useProUpgradeWizard()
  return (
    <button type="button" onClick={complete}>
      probe-complete
    </button>
  )
}

const CurrentStepProbe = (): React.JSX.Element => {
  const { currentStep } = useProUpgradeWizard()
  return <span>current-step:{currentStep ?? 'null'}</span>
}

describe('ProUpgradeWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'scrollTo').mockImplementation(noop)
    mockUsePathname.mockReturnValue('/dashboard/pro-upgrade/ein')
    mockUseSmsCompliance.mockReturnValue({
      smsCompliance: 'open',
      smsCutoffDate: null,
      generalElectionDate: null,
    })
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

  it('routes Back from the off-order filing-instructions route to the status step, not browser history', () => {
    for (const step of ['filing-instructions']) {
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

  it('routes Back from the filing-status step to guidance', () => {
    // The value prop lives in the Pro pitch dialog, so guidance is the first
    // ordered step.
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

  // Design (renderSgModal): the standalone route draws the same chrome the
  // outreach sheet does around the embedded flow — overline, bar stepper over
  // the six ordered steps, an Exit button — instead of the card and the
  // vertical stepper.
  it('draws the full-screen chrome with the bar stepper', () => {
    mockUsePathname.mockReturnValue('/dashboard/pro-upgrade/ein')

    render(
      <ProUpgradeWizard>
        <div>step-content</div>
      </ProUpgradeWizard>,
    )

    expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '3')
    expect(bar).toHaveAttribute('aria-valuemax', '6')
    expect(screen.queryByText('Campaign EIN')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /exit/i }))
    expect(router.push).toHaveBeenCalledWith('/dashboard')
  })

  it('places filing details between the EIN and payment', () => {
    mockUsePathname.mockReturnValue('/dashboard/pro-upgrade/filing-details')

    render(
      <ProUpgradeWizard>
        <NextProbe />
        <BackProbe />
      </ProUpgradeWizard>,
    )

    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '4',
    )

    fireEvent.click(screen.getByRole('button', { name: 'probe-next' }))
    expect(router.push).toHaveBeenCalledWith('/dashboard/pro-upgrade/payment')

    fireEvent.click(screen.getByRole('button', { name: 'probe-back' }))
    expect(router.push).toHaveBeenCalledWith('/dashboard/pro-upgrade/ein')
  })

  it('hides the header on the success screen', () => {
    mockUsePathname.mockReturnValue('/dashboard/pro-upgrade/success')

    render(
      <ProUpgradeWizard>
        <div>step-content</div>
      </ProUpgradeWizard>,
    )

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText('Upgrade to Pro')).not.toBeInTheDocument()
  })

  it('hands off to campaign verification on complete', () => {
    mockUsePathname.mockReturnValue('/dashboard/pro-upgrade/success')

    render(
      <ProUpgradeWizard>
        <CompleteProbe />
      </ProUpgradeWizard>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'probe-complete' }))

    expect(router.push).toHaveBeenCalledWith('/dashboard/campaign-verification')
  })

  it('returns to the dashboard on complete once texting has closed', () => {
    mockUseSmsCompliance.mockReturnValue({
      smsCompliance: 'closed',
      smsCutoffDate: '2026-10-15',
      generalElectionDate: '2026-11-03',
    })
    mockUsePathname.mockReturnValue('/dashboard/pro-upgrade/success')

    render(
      <ProUpgradeWizard>
        <CompleteProbe />
      </ProUpgradeWizard>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'probe-complete' }))

    expect(router.push).toHaveBeenCalledWith('/dashboard')
  })

  it('keeps the filing steps in the order once texting has closed', () => {
    mockUseSmsCompliance.mockReturnValue({
      smsCompliance: 'closed',
      smsCutoffDate: '2026-10-15',
      generalElectionDate: '2026-11-03',
    })
    mockUsePathname.mockReturnValue('/dashboard/pro-upgrade/ein')

    render(
      <ProUpgradeWizard>
        <NextProbe />
      </ProUpgradeWizard>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'probe-next' }))

    expect(router.replace).not.toHaveBeenCalled()
    expect(router.push).toHaveBeenCalledWith(
      '/dashboard/pro-upgrade/filing-details',
    )
  })

  it('never resolves the routeless interstitial step from a URL', () => {
    // `interstitial` has no page.tsx — it is only ever entered via
    // ProUpgradeFlow's initialStep — so a stray direct URL must not resolve
    // it as though it were a real route step.
    mockUsePathname.mockReturnValue('/dashboard/pro-upgrade/interstitial')

    render(
      <ProUpgradeWizard>
        <CurrentStepProbe />
      </ProUpgradeWizard>,
    )

    expect(screen.getByText('current-step:null')).toBeInTheDocument()
  })
})
