import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useCampaign } from '@shared/hooks/useCampaign'
import type { Campaign } from 'helpers/types'
import { formatSmsCutoffDate } from 'app/dashboard/campaign-verification/verificationCopy'
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
const exit = vi.fn()

describe('GuidanceStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProUpgradeWizard.mockReturnValue({
      currentStep: 'guidance',
      channel: null,
      goToStep,
      goToNextStep,
      goToPreviousStep,
      exit,
      complete: vi.fn(),
    })
    mockUseCampaign.mockReturnValue([null])
  })

  it('fires the viewed analytics event on mount', () => {
    render(<GuidanceStep />)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.GuidanceViewed,
    )
  })

  it('returns to the pitch from Back when an outreach flow launched it', () => {
    mockUseProUpgradeWizard.mockReturnValue({
      currentStep: 'guidance',
      channel: 'sms',
      goToStep,
      goToNextStep,
      goToPreviousStep,
      exit,
      complete: vi.fn(),
    })
    render(<GuidanceStep />)

    screen.getByRole('button', { name: 'Back' }).click()

    expect(goToPreviousStep).toHaveBeenCalledTimes(1)
    expect(goToStep).not.toHaveBeenCalled()
  })

  it('stacks the footer buttons full-width on mobile and rows them at sm+', () => {
    render(<GuidanceStep />)

    const back = screen.getByRole('button', { name: 'Back' })
    const next = screen.getByRole('button', { name: 'Continue' })

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

  it('lists the verification details collected before checkout, in order', () => {
    render(<GuidanceStep />)

    expect(
      screen.getByRole('heading', {
        name: "Let's gather a few things to unlock Pro",
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Have this information available to verify your campaign.',
      ),
    ).toBeInTheDocument()

    // The filing, contact and PIN rows are campaign verification's intro
    // rows, word for word; the wait for the PIN reads last, after payment.
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent)
    expect(rows).toEqual([
      'Your campaign EINYour campaign EIN helps verify your candidacy and comply with texting regulations.',
      'Your filing detailsThe committee name and filing link or document from your election authority',
      'Contact detailsThe email, phone or address exactly as it appears on your filing',
      'PaymentAdd your payment details to activate Pro at $10 per month. You can cancel any time.',
      'About 1 to 2 weeksA PIN arrives once the carriers clear your campaign',
    ])
    expect(screen.queryByText('Your candidate profile')).not.toBeInTheDocument()
    expect(screen.getByText('Ready when you are.')).toBeInTheDocument()
  })

  it('gathers the same things whichever channel launched it', () => {
    for (const channel of ['sms', 'robocall', null] as const) {
      mockUseProUpgradeWizard.mockReturnValue({
        currentStep: 'guidance',
        channel,
        goToStep,
        goToNextStep,
        goToPreviousStep,
        exit,
        complete: vi.fn(),
      })
      const { unmount } = render(<GuidanceStep />)

      expect(screen.getAllByRole('listitem')).toHaveLength(5)
      expect(screen.getByText('Your filing details')).toBeInTheDocument()
      unmount()
    }
  })

  it('advances to the filing-status step when Continue is clicked', () => {
    render(<GuidanceStep />)

    screen.getByRole('button', { name: 'Continue' }).click()

    expect(goToStep).toHaveBeenCalledWith('status')
    expect(goToNextStep).not.toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.GuidanceContinue,
    )
  })

  it('leaves the flow from Back, since guidance leads the order', () => {
    render(<GuidanceStep />)

    screen.getByRole('button', { name: 'Back' }).click()

    expect(exit).toHaveBeenCalledTimes(1)
    expect(goToPreviousStep).not.toHaveBeenCalled()
  })

  describe('SMS compliance window', () => {
    const smsCampaign = (smsCompliance: 'closing' | 'closed') =>
      ({
        smsCompliance,
        smsCutoffDate: '2026-10-15',
        generalElectionDate: '2026-11-03',
      }) as Campaign
    const cutoff = formatSmsCutoffDate('2026-10-15')
    const closedReason = `The ${cutoff} deadline to get verified for texting has passed.`

    it('keeps the rows minus the PIN wait under a closed banner', () => {
      mockUseCampaign.mockReturnValue([smsCampaign('closed')])
      render(<GuidanceStep />)

      expect(screen.getByRole('alert')).toHaveTextContent(closedReason)
      expect(
        screen.getByRole('heading', {
          name: "Let's gather a few things to unlock Pro",
        }),
      ).toBeInTheDocument()
      const rows = screen.getAllByRole('listitem').map((row) => row.textContent)
      expect(rows).toEqual([
        'Your campaign EINYour campaign EIN helps verify your candidacy and comply with texting regulations.',
        'Your filing detailsThe committee name and filing link or document from your election authority',
        'Contact detailsThe email, phone or address exactly as it appears on your filing',
        'PaymentAdd your payment details to activate Pro at $10 per month. You can cancel any time.',
      ])
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.ProUpgrade.SmsCutoff.NoticeViewed,
        {
          source: 'generic',
          cutoffDate: '2026-10-15',
          generalElectionDate: '2026-11-03',
        },
      )
    })

    it('continues to the filing-status step when closed and records the banner as completed', () => {
      mockUseCampaign.mockReturnValue([smsCampaign('closed')])
      render(<GuidanceStep />)

      screen.getByRole('button', { name: 'Continue' }).click()

      expect(goToStep).toHaveBeenCalledWith('status')
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.ProUpgrade.SmsCutoff.NoticeCompleted,
        {
          source: 'generic',
          cutoffDate: '2026-10-15',
          generalElectionDate: '2026-11-03',
        },
      )
    })

    it('keeps every row and adds the cutoff date while closing', () => {
      mockUseCampaign.mockReturnValue([smsCampaign('closing')])
      render(<GuidanceStep />)

      expect(
        screen.getByText(
          `In order to send SMS, you must finish these steps by ${cutoff}.`,
        ),
      ).toBeInTheDocument()
      expect(screen.getAllByRole('listitem')).toHaveLength(5)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(trackEvent).not.toHaveBeenCalledWith(
        EVENTS.ProUpgrade.SmsCutoff.NoticeViewed,
        expect.anything(),
      )
    })
  })
})
