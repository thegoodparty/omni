import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'
import { useCampaign } from '@shared/hooks/useCampaign'
import { updateCampaign } from 'app/onboarding/shared/ajaxActions'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import EinStep from './EinStep'
import { useProUpgradeWizard } from './ProUpgradeWizard'

vi.mock('./ProUpgradeWizard', () => ({
  useProUpgradeWizard: vi.fn(),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: vi.fn(),
}))

vi.mock('app/onboarding/shared/ajaxActions', () => ({
  updateCampaign: vi.fn(),
}))

const errorSnackbar = vi.fn()
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar }),
}))

// Keep EVENTS real; stub trackEvent so we don't hit analytics in tests. The real
// EinCheckInput / AsyncValidationIcon also call trackEvent, so a real EVENTS
// tree keeps those wired without exploding.
vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const mockUseProUpgradeWizard = vi.mocked(useProUpgradeWizard)
const mockUseCampaign = vi.mocked(useCampaign)
const mockUpdateCampaign = vi.mocked(updateCampaign)
const goToNextStep = vi.fn()
const goToPreviousStep = vi.fn()

// A well-formed EIN with an IRS-issued prefix (12) that is not a placeholder.
const CLEAN_EIN = '12-3456780'

const setEin = (value: string) => {
  fireEvent.change(screen.getByLabelText('Campaign EIN'), { target: { value } })
}

const seedCampaign = (einNumber?: string) =>
  mockUseCampaign.mockReturnValue([
    einNumber ? ({ details: { einNumber } } as never) : null,
  ])

describe('EinStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProUpgradeWizard.mockReturnValue({
      currentStep: 'ein',
      goToStep: vi.fn(),
      goToNextStep,
      goToPreviousStep,
    })
    // Default: no EIN on file yet, persistence succeeds.
    seedCampaign(undefined)
    mockUpdateCampaign.mockResolvedValue({ id: 1 } as never)
  })

  it('fires the viewed analytics event on mount', () => {
    render(<EinStep />)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.EinViewed,
    )
  })

  it('navigates to the previous step from the footer Back button', () => {
    render(<EinStep />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(goToPreviousStep).toHaveBeenCalledTimes(1)
    expect(mockUpdateCampaign).not.toHaveBeenCalled()
  })

  it('renders the EIN input and the IRS link', () => {
    render(<EinStep />)
    expect(screen.getByLabelText('Campaign EIN')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /get a free ein/i })
    expect(link).toHaveAttribute('href', expect.stringContaining('irs.gov'))
  })

  it('shows the add-your-EIN banner when Continue is clicked without a complete EIN', () => {
    // Figma 7490:26881: Continue stays enabled and an attempt with a missing /
    // incomplete EIN surfaces the error banner — a silently disabled button
    // gives the candidate nothing to act on.
    render(<EinStep />)

    const continueButton = screen.getByRole('button', { name: 'Continue' })
    expect(continueButton).toBeEnabled()
    fireEvent.click(continueButton)

    expect(screen.getByText('Please add your campaign EIN')).toBeInTheDocument()
    expect(mockUpdateCampaign).not.toHaveBeenCalled()
    expect(goToNextStep).not.toHaveBeenCalled()
  })

  it('clears the banner once the EIN becomes valid after a failed attempt', async () => {
    render(<EinStep />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Please add your campaign EIN')).toBeInTheDocument()

    setEin(CLEAN_EIN)

    await waitFor(() =>
      expect(
        screen.queryByText('Please add your campaign EIN'),
      ).not.toBeInTheDocument(),
    )
  })

  it('shows the Phase 1 error copy and blocks Continue for a non-IRS-prefix EIN', async () => {
    render(<EinStep />)

    // 07 is not an IRS-issued prefix, but the value passes the shape-only check.
    setEin('07-1234567')

    expect(
      await screen.findByText(/prefix isn't one the IRS issues/i),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(mockUpdateCampaign).not.toHaveBeenCalled()
    expect(goToNextStep).not.toHaveBeenCalled()
  })

  it('shows the placeholder error copy and blocks Continue for a placeholder EIN', async () => {
    render(<EinStep />)

    // All-same-digit is a classic placeholder the sanity check rejects.
    setEin('00-0000000')

    expect(
      await screen.findByText(/looks like a placeholder/i),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(mockUpdateCampaign).not.toHaveBeenCalled()
    expect(goToNextStep).not.toHaveBeenCalled()
  })

  it('persists einNumber + validatedEin and advances for a clean EIN', async () => {
    render(<EinStep />)

    setEin(CLEAN_EIN)

    const continueButton = screen.getByRole('button', { name: 'Continue' })
    await waitFor(() => expect(continueButton).toBeEnabled())

    fireEvent.click(continueButton)

    await waitFor(() => expect(goToNextStep).toHaveBeenCalledTimes(1))
    expect(mockUpdateCampaign).toHaveBeenCalledWith([
      { key: 'details.einNumber', value: CLEAN_EIN },
      { key: 'details.validatedEin', value: true },
    ])
    // The cache write is load-bearing: ProUpgradeEntry derives the resume step
    // from the campaign in this cache, so without it a returning candidate is
    // re-asked for the EIN they just entered.
    expect(testQueryClient.getQueryData(CAMPAIGN_QUERY_KEY)).toEqual({ id: 1 })
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.EinContinue,
    )
    expect(errorSnackbar).not.toHaveBeenCalled()
  })

  it('shows an error and does not advance when persistence fails', async () => {
    // updateCampaign swallows API errors and returns false; advancing anyway
    // would strand an un-persisted EIN (re-entry would re-prompt).
    mockUpdateCampaign.mockResolvedValue(false)

    render(<EinStep />)

    setEin(CLEAN_EIN)
    const continueButton = screen.getByRole('button', { name: 'Continue' })
    await waitFor(() => expect(continueButton).toBeEnabled())

    fireEvent.click(continueButton)

    await waitFor(() => expect(errorSnackbar).toHaveBeenCalled())
    expect(goToNextStep).not.toHaveBeenCalled()
    expect(testQueryClient.getQueryData(CAMPAIGN_QUERY_KEY)).toBeUndefined()
    // The continue event must not fire for a write that never committed.
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.EinContinue,
    )
  })

  it('prefills a previously entered EIN and treats the step as complete', async () => {
    seedCampaign(CLEAN_EIN)

    render(<EinStep />)

    expect(screen.getByLabelText('Campaign EIN')).toHaveValue(CLEAN_EIN)
    // A prefilled, valid EIN means the step is already satisfied: Continue is
    // enabled on mount with no edits.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    )
  })

  it('syncs a persisted EIN that resolves after first render', async () => {
    // No SSR initialData: the shared campaign query is still pending on mount,
    // so useCampaign returns null, then resolves with the saved EIN.
    seedCampaign(undefined)
    const { rerender } = render(<EinStep />)
    expect(screen.getByLabelText('Campaign EIN')).toHaveValue('')

    seedCampaign(CLEAN_EIN)
    rerender(<EinStep />)

    await waitFor(() =>
      expect(screen.getByLabelText('Campaign EIN')).toHaveValue(CLEAN_EIN),
    )
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('surfaces the error immediately for a prefilled complete-but-bad EIN', () => {
    // A legacy EIN saved before the sanity rules existed: format-valid but a
    // non-IRS prefix. Entry derivation (and the filing-details guard) routes
    // these candidates here to fix it, so the reason must show on mount — a
    // neutral field would give them nothing to act on.
    seedCampaign('07-1234567')

    render(<EinStep />)

    expect(screen.getByLabelText('Campaign EIN')).toHaveValue('07-1234567')
    expect(
      screen.getByText(/prefix isn't one the IRS issues/i),
    ).toBeInTheDocument()
  })

  it('keeps the error banner up while a routed-in bad EIN is being retyped', async () => {
    // Editing makes the EIN incomplete (`validatedEin` goes neutral), but the
    // candidate was routed here to fix a bad EIN — the guidance must not
    // vanish mid-edit before anything is actually fixed.
    seedCampaign('07-1234567')

    render(<EinStep />)
    expect(
      screen.getByText(/prefix isn't one the IRS issues/i),
    ).toBeInTheDocument()

    setEin('0')

    expect(
      await screen.findByText('Please add your campaign EIN'),
    ).toBeInTheDocument()
  })
})
