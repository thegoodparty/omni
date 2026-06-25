import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useCampaign } from '@shared/hooks/useCampaign'
import GuidanceStep from './GuidanceStep'
import { useProUpgradeWizard } from './ProUpgradeWizard'

vi.mock('./ProUpgradeWizard', () => ({
  useProUpgradeWizard: vi.fn(),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: vi.fn(),
}))

// Keep EVENTS real; stub trackEvent so we don't hit analytics in tests.
vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const mockUseProUpgradeWizard = vi.mocked(useProUpgradeWizard)
const mockUseCampaign = vi.mocked(useCampaign)
const goToStep = vi.fn()
const goToNextStep = vi.fn()
const goToPreviousStep = vi.fn()

describe('GuidanceStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProUpgradeWizard.mockReturnValue({
      currentStep: 'guidance',
      goToStep,
      goToNextStep,
      goToPreviousStep,
    })
    mockUseCampaign.mockReturnValue([null])
  })

  it('fires the viewed analytics event on mount', () => {
    render(<GuidanceStep />)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.GuidanceViewed,
    )
  })

  it('renders the heading and all four numbered checklist items', () => {
    render(<GuidanceStep />)

    expect(
      screen.getByText(/we'll need to gather a few things/i),
    ).toBeInTheDocument()

    for (const label of [
      'Your campaign EIN',
      'Your campaign filing details',
      'Your candidate profile',
      'Payment',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }

    // The four ordinal markers, per the Figma numbered list.
    for (const ordinal of ['1', '2', '3', '4']) {
      expect(screen.getByText(ordinal)).toBeInTheDocument()
    }
  })

  it('shows the filing window on item 2 when the campaign has one', () => {
    mockUseCampaign.mockReturnValue([
      {
        details: {
          filingPeriodsStart: '2026-05-14',
          filingPeriodsEnd: '2026-08-25',
        },
      } as never,
    ])

    render(<GuidanceStep />)

    // Same format the dead-end filing-instructions screen renders, so the two
    // surfaces can't drift.
    expect(
      screen.getByText('May 14, 2026 – August 25, 2026'),
    ).toBeInTheDocument()
  })

  it('renders item 2 label-only when no filing window is available', () => {
    mockUseCampaign.mockReturnValue([{ details: {} } as never])

    render(<GuidanceStep />)

    expect(screen.getByText('Your campaign filing details')).toBeInTheDocument()
    // No empty range / en-dash artifact when the window is absent.
    expect(screen.queryByText(/–/)).not.toBeInTheDocument()
  })

  it('navigates to the previous step from the footer Back button', () => {
    render(<GuidanceStep />)

    screen.getByRole('button', { name: 'Back' }).click()

    expect(goToPreviousStep).toHaveBeenCalledTimes(1)
    expect(goToStep).not.toHaveBeenCalled()
  })

  it('stacks the footer buttons full-width on mobile and rows them at sm+', () => {
    render(<GuidanceStep />)

    const back = screen.getByRole('button', { name: 'Back' })
    const next = screen.getByRole('button', { name: /let's go/i })

    // The footer stacks vertically on mobile, becomes a row at sm+ — what keeps
    // the two large buttons inside the mobile viewport.
    const footer = back.parentElement as HTMLElement
    expect(footer).toBe(next.parentElement)
    expect(footer).toHaveClass('flex-col-reverse', 'sm:flex-row')

    // Full-width when stacked so neither overflows; auto-width back in the row.
    for (const button of [back, next]) {
      expect(button).toHaveClass('w-full', 'sm:w-auto')
    }
  })

  it('advances explicitly to the EIN step when "Let\'s go!" is clicked', () => {
    render(<GuidanceStep />)

    screen.getByRole('button', { name: /let's go/i }).click()

    // GUIDANCE is off the linear order, so it must navigate to EIN explicitly
    // rather than via goToNextStep (which would no-op from an off-order route).
    expect(goToStep).toHaveBeenCalledWith('ein')
    expect(goToNextStep).not.toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.GuidanceContinue,
    )
  })
})
