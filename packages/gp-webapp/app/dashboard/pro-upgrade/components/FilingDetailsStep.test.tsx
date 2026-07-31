import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { apiRoutes } from 'gpApi/routes'
import { useCampaign } from '@shared/hooks/useCampaign'
import { submitTcrCompliance } from 'app/dashboard/profile/texting-compliance/util/registrationFormData.util'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import FilingDetailsStep, {
  ballotLevelToOfficeLevel,
  getInitialFilingDetailsState,
} from './FilingDetailsStep'
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
  useSnackbar: () => ({ errorSnackbar }),
}))

// AddressAutocomplete pulls in the Google Places widget; stub it with an input
// that fires onChange (typed text, e.g. a PO Box attempt), a button that fires
// onSelect so a test can supply a valid filing address, and the helperText so
// hint copy can be asserted.
vi.mock('@shared/AddressAutocomplete', () => ({
  default: ({
    value,
    onChange,
    onSelect,
    helperText,
  }: {
    value?: string
    onChange?: (value: string) => void
    onSelect: (place: { formatted_address: string; place_id: string }) => void
    helperText?: ReactNode
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
          onSelect({ formatted_address: '123 Main St', place_id: 'place-123' })
        }
      >
        select address
      </button>
      {helperText ? <div>{helperText}</div> : null}
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

type CampaignDetails = {
  einNumber?: string
  campaignCommittee?: string
  ballotLevel?: string
}

const seedCampaign = (details: CampaignDetails | null) =>
  mockUseCampaign.mockReturnValue([
    details === null ? null : ({ details } as never),
  ])

// Fill every field a non-federal candidate must provide for a valid submit.
// Email + phone are required for PIN delivery; the filing address is required
// too because the agentic Peerly submission derives the candidate's postal
// address from it (a blank address otherwise fails several paid steps later).
const fillValidNonFederalForm = () => {
  fireEvent.change(screen.getByLabelText('Campaign committee name'), {
    target: { value: 'Friends of Jane' },
  })
  fireEvent.change(screen.getByLabelText('Campaign filing link'), {
    target: { value: 'https://example.com/filing' },
  })
  fireEvent.change(screen.getByPlaceholderText('jane@gmail.com'), {
    target: { value: 'jane@example.com' },
  })
  fireEvent.change(screen.getByPlaceholderText('(555) 555-5555'), {
    target: { value: '4155551234' },
  })
  fireEvent.click(screen.getByTestId('select-address'))
}

describe('ballotLevelToOfficeLevel', () => {
  it('maps the capitalized manual-entry office-level labels to the backend enum', () => {
    expect(ballotLevelToOfficeLevel('Federal')).toBe('federal')
    expect(ballotLevelToOfficeLevel('State')).toBe('state')
    expect(ballotLevelToOfficeLevel('Local/Township/City')).toBe('local')
    expect(ballotLevelToOfficeLevel('County/Regional')).toBe('local')
  })

  it('maps the lowercase BallotReady position.level values case-insensitively', () => {
    // BallotReady search stores lowercase levels (e.g. onboarding fixtures use
    // `level: 'local'`); these must not fall through to the local default for
    // federal/state, which would hide the FEC fields and submit a wrong level.
    expect(ballotLevelToOfficeLevel('federal')).toBe('federal')
    expect(ballotLevelToOfficeLevel('state')).toBe('state')
    expect(ballotLevelToOfficeLevel('local')).toBe('local')
  })

  it('defaults an unknown or missing ballot level to local', () => {
    expect(ballotLevelToOfficeLevel(undefined)).toBe('local')
    expect(ballotLevelToOfficeLevel(null)).toBe('local')
    expect(ballotLevelToOfficeLevel('Something else')).toBe('local')
  })
})

describe('getInitialFilingDetailsState', () => {
  it('prefills committee + EIN and derives officeLevel, leaving contact info blank', () => {
    const state = getInitialFilingDetailsState({
      details: {
        einNumber: CLEAN_EIN,
        campaignCommittee: 'Friends of Jane',
        ballotLevel: 'State',
      },
    } as never)
    expect(state.ein).toBe(CLEAN_EIN)
    expect(state.campaignCommitteeName).toBe('Friends of Jane')
    expect(state.officeLevel).toBe('state')
    // Filing contact info must be entered fresh to match the official filing.
    expect(state.email).toBe('')
    expect(state.phone).toBe('')
  })
})

describe('FilingDetailsStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProUpgradeWizard.mockReturnValue({
      currentStep: 'filing-details',
      goToStep: vi.fn(),
      goToNextStep,
      goToPreviousStep,
    })
    // Default: a local candidate with EIN already collected at the prior step.
    seedCampaign({ einNumber: CLEAN_EIN, ballotLevel: 'Local/Township/City' })
    mockSubmit.mockResolvedValue(undefined)
  })

  it('fires the viewed analytics event once the form is shown', () => {
    render(<FilingDetailsStep />)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.FilingDetailsViewed,
    )
  })

  it('shows a loading placeholder (and no view event) until the campaign loads', () => {
    seedCampaign(null)
    render(<FilingDetailsStep />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.FilingDetailsViewed,
    )
  })

  it('renders the filing-details fields and the mismatch warning copy', () => {
    render(<FilingDetailsStep />)
    expect(
      screen.getByText('What are your campaign filing details?'),
    ).toBeInTheDocument()
    expect(screen.getByText(/it will take much longer/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Campaign committee name')).toBeInTheDocument()
    expect(screen.getByLabelText('Campaign filing link')).toBeInTheDocument()
    // Email + phone (PIN delivery) and the filing address (Peerly postal
    // address) are all required inputs.
    expect(screen.getByPlaceholderText('jane@gmail.com')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('(555) 555-5555')).toBeInTheDocument()
    expect(screen.getByTestId('select-address')).toBeInTheDocument()
  })

  it('marks the filing link required in its helper copy (ENG-10480)', () => {
    render(<FilingDetailsStep />)
    expect(screen.getByText(/Required — a link to your/i)).toBeInTheDocument()
  })

  it('navigates to the previous step from the footer Back button', () => {
    render(<FilingDetailsStep />)

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(goToPreviousStep).toHaveBeenCalledTimes(1)
    expect(mockSubmit).not.toHaveBeenCalled()
  })

  it('stacks the footer buttons full-width on mobile and rows them at sm+', () => {
    render(<FilingDetailsStep />)

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

  it('submits the mapped payload to createAgentic and advances on success', async () => {
    render(<FilingDetailsStep />)
    fillValidNonFederalForm()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1))
    expect(mockSubmit).toHaveBeenCalledWith(
      apiRoutes.campaign.tcrCompliance.createAgentic,
      expect.objectContaining({
        campaignCommitteeName: 'Friends of Jane',
        electionFilingLink: 'https://example.com/filing',
        officeLevel: 'local',
        ein: CLEAN_EIN,
        email: 'jane@example.com',
        phone: '4155551234',
        // The filing address is required and carries the selected place.
        address: { formatted_address: '123 Main St', place_id: 'place-123' },
        // Non-federal committees submit as CANDIDATE.
        committeeType: 'CANDIDATE',
      }),
      expect.any(String),
    )
    await waitFor(() => expect(goToNextStep).toHaveBeenCalledTimes(1))
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.DlcCompliance.RegistrationSubmitted,
      expect.objectContaining({ email: 'jane@example.com' }),
    )
    expect(errorSnackbar).not.toHaveBeenCalled()
  })

  it('does not submit and lists the failing fields when the form is invalid', () => {
    // EIN on file but nothing else filled → invalid form.
    seedCampaign({ einNumber: CLEAN_EIN, ballotLevel: 'Local/Township/City' })
    render(<FilingDetailsStep />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(mockSubmit).not.toHaveBeenCalled()
    expect(goToNextStep).not.toHaveBeenCalled()
    // The guiding banner must name what's wrong — a silent return reads as a
    // dead Continue button.
    const bannerHeading = screen.getByText('Please fix the following fields:')
    expect(bannerHeading).toBeInTheDocument()
    // The banner body must let long validation copy (the example fec.gov /
    // filing URLs) wrap inside the alert instead of forcing horizontal overflow
    // on narrow viewports (ENG-10358). `break-words` wraps the URL token,
    // `min-w-0` lets the alert grid track shrink below it, `w-full` keeps the
    // text filling the alert on desktop.
    expect(bannerHeading.parentElement).toHaveClass(
      'w-full',
      'min-w-0',
      'break-words',
    )
    // Each failing-field row must keep `list-item` so the global
    // `[data-slot] ul li { display: flex }` rule (globals.css) can't split the
    // bold label and message into two shrinking columns (ENG-10373).
    for (const item of screen.getAllByRole('listitem')) {
      expect(item).toHaveClass('list-item')
    }
    expect(screen.getByText('Campaign Committee Name')).toBeInTheDocument()
    // Email + phone (PIN delivery) and the filing address (Peerly postal
    // address) are all required, so the empty form lists all three.
    expect(screen.getByText('Filing Email')).toBeInTheDocument()
    expect(screen.getByText('Filing Phone')).toBeInTheDocument()
    expect(screen.getByText('Filing Address')).toBeInTheDocument()
    // `website` has no input in this form and must never be listed.
    expect(screen.queryByText('Website')).not.toBeInTheDocument()
  })

  it('blocks submit when email or phone is missing (86aj5bqvw)', () => {
    render(<FilingDetailsStep />)
    // Committee + filing link + email filled, but phone left blank.
    fireEvent.change(screen.getByLabelText('Campaign committee name'), {
      target: { value: 'Friends of Jane' },
    })
    fireEvent.change(screen.getByLabelText('Campaign filing link'), {
      target: { value: 'https://example.com/filing' },
    })
    fireEvent.change(screen.getByPlaceholderText('jane@gmail.com'), {
      target: { value: 'jane@example.com' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(mockSubmit).not.toHaveBeenCalled()
    expect(goToNextStep).not.toHaveBeenCalled()
    // The banner names the missing required contact field (phone), not email.
    expect(screen.getByText('Filing Phone')).toBeInTheDocument()
    expect(screen.queryByText('Filing Email')).not.toBeInTheDocument()
  })

  it('blocks submit when the filing address is missing', () => {
    render(<FilingDetailsStep />)
    // Everything but the address: a resolved address is required because the
    // agentic Peerly submission needs the candidate's postal address.
    fireEvent.change(screen.getByLabelText('Campaign committee name'), {
      target: { value: 'Friends of Jane' },
    })
    fireEvent.change(screen.getByLabelText('Campaign filing link'), {
      target: { value: 'https://example.com/filing' },
    })
    fireEvent.change(screen.getByPlaceholderText('jane@gmail.com'), {
      target: { value: 'jane@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('(555) 555-5555'), {
      target: { value: '4155551234' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(mockSubmit).not.toHaveBeenCalled()
    expect(goToNextStep).not.toHaveBeenCalled()
    expect(screen.getByText('Filing Address')).toBeInTheDocument()
  })

  it('steers a PO Box filer to a street address while they type', () => {
    // Google Places never suggests PO Boxes, so without this hint a PO Box
    // filer sees an empty dropdown and a field that can never validate — the
    // exact dead-end that blocked real Pro upgrades from the sales channel.
    render(<FilingDetailsStep />)

    fireEvent.change(screen.getByTestId('address-input'), {
      target: { value: 'PO Box 621' },
    })
    expect(
      screen.getByText(/Address search can't find PO Boxes/i),
    ).toBeInTheDocument()

    // A street address clears the hint.
    fireEvent.change(screen.getByTestId('address-input'), {
      target: { value: '123 Main St' },
    })
    expect(
      screen.queryByText(/Address search can't find PO Boxes/i),
    ).not.toBeInTheDocument()
  })

  it('clears a previously selected address when a PO Box is typed over it', () => {
    // Typing never fires onSelect, so without the clear the stale valid
    // address would submit silently while the field shows the PO Box hint.
    render(<FilingDetailsStep />)
    fillValidNonFederalForm()

    fireEvent.change(screen.getByTestId('address-input'), {
      target: { value: 'PO Box 621' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(mockSubmit).not.toHaveBeenCalled()
    expect(goToNextStep).not.toHaveBeenCalled()
    expect(screen.getByText('Filing Address')).toBeInTheDocument()
  })

  it('switches to manual entry with the typed input prefilled as line 1', () => {
    render(<FilingDetailsStep />)

    fireEvent.change(screen.getByTestId('address-input'), {
      target: { value: 'PO Box 621' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Enter address manually' }),
    )

    expect(screen.getByLabelText('Street address or PO Box')).toHaveValue(
      'PO Box 621',
    )
    // The autocomplete is replaced by the manual fields until switched back.
    expect(screen.queryByTestId('address-input')).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Search for your address instead' }),
    )
    expect(screen.getByTestId('address-input')).toBeInTheDocument()
  })

  it('submits a manually entered address (PO Box) as structured components', async () => {
    render(<FilingDetailsStep />)
    fireEvent.change(screen.getByLabelText('Campaign committee name'), {
      target: { value: 'Friends of Jane' },
    })
    fireEvent.change(screen.getByLabelText('Campaign filing link'), {
      target: { value: 'https://example.com/filing' },
    })
    fireEvent.change(screen.getByPlaceholderText('jane@gmail.com'), {
      target: { value: 'jane@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('(555) 555-5555'), {
      target: { value: '4155551234' },
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Enter address manually' }),
    )
    fireEvent.change(screen.getByLabelText('Street address or PO Box'), {
      target: { value: 'PO Box 621' },
    })
    fireEvent.change(screen.getByLabelText('City'), {
      target: { value: 'Toledo' },
    })
    // The state Select is the only combobox on a non-federal form.
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'WA' }))
    fireEvent.change(screen.getByLabelText('ZIP'), {
      target: { value: '98591' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1))
    const [, payload] = mockSubmit.mock.calls[0]!
    expect(payload).toEqual(
      expect.objectContaining({
        manualAddress: {
          addressLine1: 'PO Box 621',
          addressLine2: '',
          city: 'Toledo',
          state: 'WA',
          zip: '98591',
        },
      }),
    )
    await waitFor(() => expect(goToNextStep).toHaveBeenCalledTimes(1))
  })

  it('blocks submit when the manual address is incomplete', () => {
    render(<FilingDetailsStep />)
    fireEvent.change(screen.getByLabelText('Campaign committee name'), {
      target: { value: 'Friends of Jane' },
    })
    fireEvent.change(screen.getByLabelText('Campaign filing link'), {
      target: { value: 'https://example.com/filing' },
    })
    fireEvent.change(screen.getByPlaceholderText('jane@gmail.com'), {
      target: { value: 'jane@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('(555) 555-5555'), {
      target: { value: '4155551234' },
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Enter address manually' }),
    )
    // Street only — city/state/zip missing, so the address must stay invalid.
    fireEvent.change(screen.getByLabelText('Street address or PO Box'), {
      target: { value: 'PO Box 621' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(mockSubmit).not.toHaveBeenCalled()
    expect(goToNextStep).not.toHaveBeenCalled()
    expect(screen.getByText('Filing Address')).toBeInTheDocument()
  })

  it('allows submit once a valid address is selected', async () => {
    render(<FilingDetailsStep />)
    fillValidNonFederalForm()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1))
    const [, payload] = mockSubmit.mock.calls[0]!
    expect(payload).toEqual(
      expect.objectContaining({
        email: 'jane@example.com',
        phone: '4155551234',
        address: { formatted_address: '123 Main St', place_id: 'place-123' },
      }),
    )
    await waitFor(() => expect(goToNextStep).toHaveBeenCalledTimes(1))
  })

  it('redirects to the EIN step instead of rendering when the persisted EIN fails sanity', () => {
    // ENG-10346: this form has no EIN input, so an EIN error here is one the
    // candidate cannot fix in place. A direct-URL arrival (stale tab, bookmark)
    // with a legacy bad EIN is sent to the EIN step, which owns the field.
    seedCampaign({
      einNumber: '00-0000000',
      ballotLevel: 'Local/Township/City',
    })
    render(<FilingDetailsStep />)

    expect(router.replace).toHaveBeenCalledWith('/dashboard/pro-upgrade/ein')
    expect(
      screen.queryByText('What are your campaign filing details?'),
    ).not.toBeInTheDocument()
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.FilingDetailsViewed,
    )
  })

  it('redirects to the EIN step when no EIN is on file', () => {
    seedCampaign({ ballotLevel: 'Local/Township/City' })
    render(<FilingDetailsStep />)

    expect(router.replace).toHaveBeenCalledWith('/dashboard/pro-upgrade/ein')
  })

  it('surfaces an error and does not advance when the submit fails', async () => {
    mockSubmit.mockRejectedValue(new Error('boom'))
    render(<FilingDetailsStep />)
    fillValidNonFederalForm()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(errorSnackbar).toHaveBeenCalled())
    expect(goToNextStep).not.toHaveBeenCalled()
  })

  it('hides the FEC fields for a non-federal candidate', () => {
    render(<FilingDetailsStep />)
    expect(screen.queryByLabelText('FEC Committee ID')).not.toBeInTheDocument()
    expect(screen.queryByText('Committee type *')).not.toBeInTheDocument()
  })

  it('shows the FEC fields for a federal candidate', () => {
    seedCampaign({ einNumber: CLEAN_EIN, ballotLevel: 'Federal' })
    render(<FilingDetailsStep />)
    expect(screen.getByLabelText('FEC Committee ID')).toBeInTheDocument()
    expect(screen.getByText('Committee type *')).toBeInTheDocument()
  })

  it('submits fecCommitteeId + the chosen committeeType verbatim for a federal candidate', async () => {
    seedCampaign({ einNumber: CLEAN_EIN, ballotLevel: 'Federal' })
    render(<FilingDetailsStep />)

    fireEvent.change(screen.getByLabelText('Campaign committee name'), {
      target: { value: 'Friends of Jane' },
    })
    // Federal validation requires the filing link to be a fec.gov URL.
    fireEvent.change(screen.getByLabelText('Campaign filing link'), {
      target: { value: 'https://www.fec.gov/data/committee/C00123456' },
    })
    // Email + phone are both required regardless of office level.
    fireEvent.change(screen.getByPlaceholderText('jane@gmail.com'), {
      target: { value: 'jane@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('(555) 555-5555'), {
      target: { value: '4155551234' },
    })
    fireEvent.change(screen.getByLabelText('FEC Committee ID'), {
      target: { value: 'C00123456' },
    })
    // The filing address is required regardless of office level.
    fireEvent.click(screen.getByTestId('select-address'))
    // Committee type is the only Radix Select rendered (office level is hidden).
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'House' }))

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1))
    const [, payload] = mockSubmit.mock.calls[0]!
    // The federal branch must NOT strip the FEC id nor force CANDIDATE — that
    // distinction is the whole contract with the backend's federal branch.
    expect(payload).toEqual(
      expect.objectContaining({
        officeLevel: 'federal',
        fecCommitteeId: 'C00123456',
        committeeType: 'HOUSE',
      }),
    )
    expect(payload.committeeType).not.toBe('CANDIDATE')
    await waitFor(() => expect(goToNextStep).toHaveBeenCalledTimes(1))
  })

  it('does not double-submit on two rapid clicks', async () => {
    render(<FilingDetailsStep />)
    fillValidNonFederalForm()

    // Two synchronous clicks before the async `loading` prop can re-render: the
    // synchronous ref guard must block the second so only one TCR registration
    // is created.
    const button = screen.getByRole('button', { name: 'Continue' })
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1))
  })
})
