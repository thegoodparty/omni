import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { apiRoutes } from 'gpApi/routes'
import { useCampaign } from '@shared/hooks/useCampaign'
import { submitTcrCompliance } from 'app/dashboard/profile/texting-compliance/util/registrationFormData.util'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { MIN_BIO_LENGTH } from 'app/dashboard/profile/texting-compliance/candidate-profile/candidateProfile.utils'
import { readVerificationDraft } from 'app/dashboard/campaign-verification/verificationDraft'
import FilingDetailsStep from './FilingDetailsStep'
import { useProUpgradeWizard } from './ProUpgradeWizard'

vi.mock('./ProUpgradeWizard', () => ({
  useProUpgradeWizard: vi.fn(),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: vi.fn(),
}))

// Keep toRegistrationFormData real (the test asserts the mapped payload shape);
// only stub the network submit so we can assert what it was called with and
// drive the success / failure branches.
vi.mock(
  'app/dashboard/profile/texting-compliance/util/registrationFormData.util',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('app/dashboard/profile/texting-compliance/util/registrationFormData.util')
      >()
    return { ...actual, submitTcrCompliance: vi.fn() }
  },
)

const errorSnackbar = vi.fn()
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar, successSnackbar: vi.fn() }),
}))

// The step renders campaign verification's real form, which
// also reads the user, the website (for the candidate profile) and the TCR
// record. Each is stubbed at its fetch, nothing above it.
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ email: 'jane@example.com' }, vi.fn(), false],
}))

vi.mock('app/shared/utils/RichEditor', async () => ({
  default: (await import('helpers/test-utils/RichEditorMock')).RichEditorMock,
}))

const { getUserWebsite } = vi.hoisted(() => ({ getUserWebsite: vi.fn() }))
vi.mock('app/dashboard/website/util/website.util', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('app/dashboard/website/util/website.util')
  >()),
  getUserWebsite,
}))

const { getTcrCompliance } = vi.hoisted(() => ({ getTcrCompliance: vi.fn() }))
vi.mock(
  'app/dashboard/profile/texting-compliance/util/tcrCompliance.util',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('app/dashboard/profile/texting-compliance/util/tcrCompliance.util')
    >()),
    getTcrCompliance,
  }),
)

// AddressAutocomplete pulls in the Google Places widget; stub it with an input
// that fires onChange (typed text, e.g. a PO Box) and a button that fires
// onSelect with address_components so a test can exercise the suggestion
// autofill.
vi.mock('@shared/AddressAutocomplete', () => ({
  default: ({
    value,
    onChange,
    onSelect,
  }: {
    value?: string
    onChange?: (value: string) => void
    onSelect: (place: {
      formatted_address: string
      place_id: string
      address_components: {
        types: string[]
        long_name: string
        short_name: string
      }[]
    }) => void
  }) => (
    <div>
      <input
        data-testid="address-input"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
      <button
        type="button"
        data-testid="select-address"
        onClick={() =>
          onSelect({
            formatted_address: '123 Main St',
            place_id: 'place-123',
            address_components: [
              { types: ['street_number'], long_name: '123', short_name: '123' },
              {
                types: ['route'],
                long_name: 'Main St',
                short_name: 'Main St',
              },
              {
                types: ['locality'],
                long_name: 'Springfield',
                short_name: 'Springfield',
              },
              {
                types: ['administrative_area_level_1'],
                long_name: 'Illinois',
                short_name: 'IL',
              },
              {
                types: ['postal_code'],
                long_name: '62704',
                short_name: '62704',
              },
            ],
          })
        }
      >
        select address
      </button>
    </div>
  ),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const mockUseProUpgradeWizard = vi.mocked(useProUpgradeWizard)
const mockUseCampaign = vi.mocked(useCampaign)
const mockSubmit = vi.mocked(submitTcrCompliance)
const goToNextStep = vi.fn()
const goToPreviousStep = vi.fn()

// A well-formed, non-placeholder EIN with an IRS-issued prefix.
const CLEAN_EIN = '12-3456780'

describe('FilingDetailsStep', () => {
  const CAMPAIGN_ID = 7
  const completeWebsite = {
    content: {
      about: {
        bio: 'b'.repeat(MIN_BIO_LENGTH),
        issues: [{ title: 'Roads', description: 'r'.repeat(MIN_BIO_LENGTH) }],
      },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    mockUseProUpgradeWizard.mockReturnValue({
      currentStep: 'filing-details',
      channel: null,
      goToStep: vi.fn(),
      goToNextStep,
      goToPreviousStep,
      exit: vi.fn(),
      complete: vi.fn(),
    })
    // The EIN was collected at the step before, so the form does not ask.
    mockUseCampaign.mockReturnValue([
      { id: CAMPAIGN_ID, details: { einNumber: CLEAN_EIN } } as never,
    ])
    getUserWebsite.mockResolvedValue(completeWebsite)
    getTcrCompliance.mockResolvedValue(null)
    mockSubmit.mockResolvedValue(undefined)
  })

  const fillVerificationForm = () => {
    const levelTrigger = screen
      .getAllByRole('combobox')
      .find((el) => el.textContent?.includes('Select an office level'))
    fireEvent.click(levelTrigger!)
    fireEvent.click(screen.getByRole('option', { name: 'Local' }))
    fireEvent.change(screen.getByLabelText('Candidate name'), {
      target: { value: 'Jane Smith' },
    })
    fireEvent.change(screen.getByLabelText('Campaign committee name'), {
      target: { value: 'Friends of Jane' },
    })
    fireEvent.change(screen.getByLabelText('Campaign filing link'), {
      target: { value: 'https://example.com/filing' },
    })
    fireEvent.change(screen.getByPlaceholderText('you@campaign.org'), {
      target: { value: 'jane@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('(555) 123-4567'), {
      target: { value: '4155551234' },
    })
    fireEvent.click(screen.getByTestId('select-address'))
  }

  it('renders campaign verification’s form with its design headings', async () => {
    render(<FilingDetailsStep />)

    expect(
      await screen.findByText('What are your campaign filing details?'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('What is your campaign filing contact information?'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
    // The EIN step already has it, so the verification form does not ask.
    expect(screen.queryByLabelText('EIN')).not.toBeInTheDocument()
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.FilingDetailsViewed,
    )
  })

  it('submits to createAgentic and advances to payment only after it lands', async () => {
    let resolveSubmit: () => void = () => undefined
    mockSubmit.mockReturnValue(
      new Promise<undefined>((resolve) => {
        resolveSubmit = () => resolve(undefined)
      }),
    )
    render(<FilingDetailsStep />)
    await screen.findByText('What are your campaign filing details?')
    fillVerificationForm()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1))
    expect(mockSubmit).toHaveBeenCalledWith(
      apiRoutes.campaign.tcrCompliance.createAgentic,
      expect.objectContaining({
        candidateName: 'Jane Smith',
        campaignCommitteeName: 'Friends of Jane',
        electionFilingLink: 'https://example.com/filing',
        officeLevel: 'local',
        ein: CLEAN_EIN,
        email: 'jane@example.com',
        phone: '4155551234',
        committeeType: 'CANDIDATE',
      }),
      expect.any(String),
    )
    expect(goToNextStep).not.toHaveBeenCalled()

    // The submit refetches the record, which now exists.
    getTcrCompliance.mockResolvedValue({ status: 'submitted' })
    resolveSubmit()

    await waitFor(() => expect(goToNextStep).toHaveBeenCalledTimes(1))
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.DlcCompliance.RegistrationSubmitted,
      expect.objectContaining({ email: 'jane@example.com' }),
    )
    // The form stays on screen until the wizard moves; a record that lands
    // mid-submit must not swap in the already-submitted notice.
    expect(screen.queryByText('Your details are saved')).toBeNull()
  })

  it('stays on the step when the submit fails', async () => {
    mockSubmit.mockRejectedValue(new Error('nope'))
    render(<FilingDetailsStep />)
    await screen.findByText('What are your campaign filing details?')
    fillVerificationForm()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.Outreach.DlcCompliance.RegistrationSubmitError,
        expect.anything(),
      ),
    )
    expect(goToNextStep).not.toHaveBeenCalled()
    expect(errorSnackbar).toHaveBeenCalled()
  })

  it('goes back to the EIN step from the form', async () => {
    render(<FilingDetailsStep />)
    await screen.findByText('What are your campaign filing details?')

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(goToPreviousStep).toHaveBeenCalledTimes(1)
    expect(mockSubmit).not.toHaveBeenCalled()
  })

  it('keeps unsubmitted input for a candidate who leaves before paying', async () => {
    render(<FilingDetailsStep />)
    await screen.findByText('What are your campaign filing details?')

    fireEvent.change(screen.getByLabelText('Candidate name'), {
      target: { value: 'Jane Smith' },
    })

    await waitFor(() =>
      expect(readVerificationDraft(CAMPAIGN_ID)?.filing).toMatchObject({
        candidateName: 'Jane Smith',
      }),
    )
  })

  it('asks for the candidate profile when it is missing', async () => {
    getUserWebsite.mockResolvedValue({
      content: { about: { bio: '', issues: [] } },
    })
    render(<FilingDetailsStep />)

    expect(
      await screen.findByText('Tell voters about yourself'),
    ).toBeInTheDocument()
  })

  // createAgentic hands back an existing record unchanged, so a candidate
  // who submitted, left at payment and came back is not asked to retype it.
  // Verification only starts at payment, so the saved details are not yet
  // "submitted for verification".
  it('drops the verification line from saved details once texting has closed', async () => {
    mockUseCampaign.mockReturnValue([
      {
        id: CAMPAIGN_ID,
        details: { einNumber: CLEAN_EIN },
        smsCompliance: 'closed',
        smsCutoffDate: '2026-10-15',
        generalElectionDate: '2026-11-03',
      } as never,
    ])
    getTcrCompliance.mockResolvedValue({ status: 'submitted' })
    render(<FilingDetailsStep />)

    expect(
      await screen.findByText('Your details are saved'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Verification starts when you finish your upgrade.'),
    ).not.toBeInTheDocument()
  })

  it('confirms saved details instead of asking again', async () => {
    getTcrCompliance.mockResolvedValue({ status: 'submitted' })
    render(<FilingDetailsStep />)

    expect(
      await screen.findByText('Your details are saved'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Verification starts when you finish your upgrade.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Submitted for verification'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('What are your campaign filing details?'),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(goToNextStep).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(goToPreviousStep).toHaveBeenCalledTimes(1)
    expect(mockSubmit).not.toHaveBeenCalled()
  })

  it('asks again when the earlier submission was rejected', async () => {
    // createAgentic replaces an error or rejected record, so the form is
    // the way to fix it.
    getTcrCompliance.mockResolvedValue({ status: 'rejected' })
    render(<FilingDetailsStep />)

    expect(
      await screen.findByText('What are your campaign filing details?'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Submitted for verification'),
    ).not.toBeInTheDocument()
  })
})
