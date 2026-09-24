import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'
import { updateCampaign } from 'app/onboarding/shared/ajaxActions'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import FilingStatusStep from './FilingStatusStep'
import { useProUpgradeWizard } from './ProUpgradeWizard'

vi.mock('./ProUpgradeWizard', () => ({
  useProUpgradeWizard: vi.fn(),
}))

vi.mock('app/onboarding/shared/ajaxActions', () => ({
  updateCampaign: vi.fn(),
}))

const errorSnackbar = vi.fn()
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar }),
}))

// Keep EVENTS real; stub trackEvent so we don't hit analytics in tests.
vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const mockUseProUpgradeWizard = vi.mocked(useProUpgradeWizard)
const mockUpdateCampaign = vi.mocked(updateCampaign)
const goToStep = vi.fn()
const goToPreviousStep = vi.fn()

describe('FilingStatusStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProUpgradeWizard.mockReturnValue({
      currentStep: 'status',
      purchaseOnly: false,
      channel: null,
      goToStep,
      goToNextStep: vi.fn(),
      goToPreviousStep,
      exit: vi.fn(),
      complete: vi.fn(),
    })
    // Default: persistence succeeds and returns the updated campaign.
    mockUpdateCampaign.mockResolvedValue({ id: 1 } as never)
  })

  it('fires the viewed analytics event on mount', () => {
    render(<FilingStatusStep />)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.FilingStatusViewed,
    )
  })

  it('renders both options with their titles and descriptions', () => {
    render(<FilingStatusStep />)
    expect(screen.getByText("Yes, I'm already filed")).toBeInTheDocument()
    expect(
      screen.getByText('I have my campaign EIN and filing documents ready'),
    ).toBeInTheDocument()
    expect(screen.getByText('No, not yet')).toBeInTheDocument()
    expect(
      screen.getByText('I still need to file for this election'),
    ).toBeInTheDocument()
  })

  it('navigates to the previous step from the footer Back button', () => {
    render(<FilingStatusStep />)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(goToPreviousStep).toHaveBeenCalledTimes(1)
    expect(mockUpdateCampaign).not.toHaveBeenCalled()
  })

  it('persists hasFiledForRace=true and advances to guidance when "Yes" is selected', async () => {
    render(<FilingStatusStep />)

    fireEvent.click(screen.getByText("Yes, I'm already filed"))

    await waitFor(() => expect(goToStep).toHaveBeenCalledWith('guidance'))
    expect(mockUpdateCampaign).toHaveBeenCalledWith([
      { key: 'details.hasFiledForRace', value: true },
    ])
    // The cache write is load-bearing: ProUpgradeEntry derives the resume step
    // from the campaign in this cache, so without it a returning candidate is
    // re-asked the question they just answered.
    expect(testQueryClient.getQueryData(CAMPAIGN_QUERY_KEY)).toEqual({ id: 1 })
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.FilingStatusAlreadyFiled,
    )
    expect(errorSnackbar).not.toHaveBeenCalled()
  })

  it('persists hasFiledForRace=false and routes to filing-instructions when "No" is selected', async () => {
    render(<FilingStatusStep />)

    fireEvent.click(screen.getByText('No, not yet'))

    await waitFor(() =>
      expect(goToStep).toHaveBeenCalledWith('filing-instructions'),
    )
    expect(mockUpdateCampaign).toHaveBeenCalledWith([
      { key: 'details.hasFiledForRace', value: false },
    ])
    expect(testQueryClient.getQueryData(CAMPAIGN_QUERY_KEY)).toEqual({ id: 1 })
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.FilingStatusNotFiled,
    )
    expect(errorSnackbar).not.toHaveBeenCalled()
  })

  it('shows an error and does not navigate when persistence fails', async () => {
    // updateCampaign swallows API errors and returns false; navigating anyway
    // would strand an un-persisted answer (re-entry would re-ask the question).
    mockUpdateCampaign.mockResolvedValue(false)

    render(<FilingStatusStep />)

    fireEvent.click(screen.getByText("Yes, I'm already filed"))

    await waitFor(() => expect(errorSnackbar).toHaveBeenCalled())
    expect(goToStep).not.toHaveBeenCalled()
    expect(testQueryClient.getQueryData(CAMPAIGN_QUERY_KEY)).toBeUndefined()
    // The selection event must not fire for a write that never committed.
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.FilingStatusAlreadyFiled,
    )
  })

  describe('purchase-only', () => {
    beforeEach(() => {
      mockUseProUpgradeWizard.mockReturnValue({
        currentStep: 'status',
        purchaseOnly: true,
        channel: null,
        goToStep,
        goToNextStep: vi.fn(),
        goToPreviousStep,
        exit: vi.fn(),
        complete: vi.fn(),
      })
    })

    it('asks the shortened question with its own two options', () => {
      render(<FilingStatusStep />)

      expect(
        screen.getByRole('heading', { name: 'Are you officially filed?' }),
      ).toBeInTheDocument()
      expect(
        screen.getByText('This confirms you are running for office.'),
      ).toBeInTheDocument()
      expect(
        screen.getByText('I have filed with my election authority.'),
      ).toBeInTheDocument()
      expect(screen.getByText('I have not filed yet.')).toBeInTheDocument()
    })

    // Design: the card is a selection and Continue confirms it.
    it('holds Continue until a card is picked', () => {
      render(<FilingStatusStep />)

      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
      fireEvent.click(screen.getByText('Yes'))
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
      expect(mockUpdateCampaign).not.toHaveBeenCalled()
    })

    it('skips guidance and goes straight to the EIN step on "Yes"', async () => {
      render(<FilingStatusStep />)

      fireEvent.click(screen.getByText('Yes'))
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

      // Guidance leads the purchase-only order, so "yes" must not double back.
      await waitFor(() => expect(goToStep).toHaveBeenCalledWith('ein'))
      expect(mockUpdateCampaign).toHaveBeenCalledWith([
        { key: 'details.hasFiledForRace', value: true },
      ])
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.ProUpgrade.Compliance.FilingStatusAlreadyFiled,
      )
    })

    it('still routes to the filing-instructions dead-end on "No"', async () => {
      render(<FilingStatusStep />)

      fireEvent.click(screen.getByText('No'))
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

      await waitFor(() =>
        expect(goToStep).toHaveBeenCalledWith('filing-instructions'),
      )
      expect(mockUpdateCampaign).toHaveBeenCalledWith([
        { key: 'details.hasFiledForRace', value: false },
      ])
    })
  })
})
