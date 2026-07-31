import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { FormDataProvider, type FormDataState } from '@shared/hooks/useFormData'
import TextingComplianceRegistrationForm, {
  validateRegistrationForm,
} from './TextingComplianceRegistrationForm'

// Mock only the external Google Places dependency so AddressAutocomplete
// renders its real input without loading the Maps script.
vi.mock('react-google-autocomplete', () => ({
  usePlacesWidget: () => ({ ref: { current: null } }),
}))

const validInitialState = (
  overrides: Partial<FormDataState> = {},
): FormDataState => ({
  electionFilingLink: 'https://example.gov/filings/123',
  campaignCommitteeName: 'Jane for Council',
  officeLevel: 'local',
  ein: '12-3456780',
  phone: '5555550123',
  address: { formatted_address: '123 Main St', place_id: 'abc' },
  website: 'https://janeforcity.com',
  email: 'jane@example.com',
  ...overrides,
})

type SubmitMock = ReturnType<typeof vi.fn<(formData: FormDataState) => void>>

const renderForm = (
  initialState: FormDataState,
  onSubmit: SubmitMock = vi.fn<(formData: FormDataState) => void>(),
  requireWebsite = false,
): SubmitMock => {
  render(
    <FormDataProvider
      initialState={initialState}
      validator={(d) => validateRegistrationForm(d, { requireWebsite })}
    >
      <TextingComplianceRegistrationForm
        onSubmit={onSubmit}
        requireWebsite={requireWebsite}
      />
    </FormDataProvider>,
  )
  return onSubmit
}

beforeEach(() => {
  // jsdom does not implement scrollTo; the invalid-submit path calls it.
  window.scrollTo = vi.fn()
})

describe('TextingComplianceRegistrationForm — submit behavior', () => {
  it('keeps the Submit button enabled even when the form is invalid', () => {
    renderForm({})
    expect(screen.getByRole('button', { name: /submit/i })).toBeEnabled()
  })

  it('does not submit an invalid form and surfaces guiding errors', async () => {
    const user = userEvent.setup()
    const onSubmit = renderForm({})

    await user.click(screen.getByRole('button', { name: /submit/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    const bannerHeading = screen.getByText(/please fix the following fields/i)
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
    // Field-specific guidance (only rendered in the error banner) is shown.
    expect(screen.getByText(/select an option/i)).toBeInTheDocument()
    // The invalid Office Level select (identified by its placeholder — the
    // State select is a second combobox now) is marked with an error state.
    const officeLevelTrigger = screen
      .getAllByRole('combobox')
      .find((el) => el.textContent?.includes('Select an office level'))
    expect(officeLevelTrigger).toHaveAttribute('aria-invalid', 'true')
  })

  it('submits the (non-federal) form when it is valid', async () => {
    const user = userEvent.setup()
    // Use the production default (requireWebsite=true) with a real website so
    // the test exercises the same validation path users hit.
    const onSubmit = renderForm(validInitialState(), undefined, true)

    const button = screen.getByRole('button', { name: /submit/i })
    expect(button).toBeEnabled()
    await user.click(button)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    // Non-federal: committeeType is defaulted to CANDIDATE.
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignCommitteeName: 'Jane for Council',
        committeeType: 'CANDIDATE',
      }),
    )
    // No error banner when the form is valid.
    expect(screen.queryByText(/please fix the following fields/i)).toBeNull()
  })

  it('never lists `website` in the banner, even when requireWebsite is true', async () => {
    const user = userEvent.setup()
    // requireWebsite=true makes an empty website invalid, but this form renders
    // no website input, so it must not appear in the banner. Email is also left
    // empty so the banner has a real, fixable field to show.
    const onSubmit = renderForm(
      validInitialState({ website: '', email: '' }),
      undefined,
      true,
    )

    await user.click(screen.getByRole('button', { name: /submit/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(
      screen.getByText(/please fix the following fields/i),
    ).toBeInTheDocument()
    // The fixable field's guidance is shown...
    expect(
      screen.getByText(/valid email address as it appears/i),
    ).toBeInTheDocument()
    // ...but `website` (no input here) is not — neither its name nor message.
    expect(screen.queryByText('Valid URL')).toBeNull()
  })

  it('submits a valid federal form with fecCommitteeId and committeeType verbatim', async () => {
    const user = userEvent.setup()
    const onSubmit = renderForm(
      validInitialState({
        officeLevel: 'federal',
        electionFilingLink: 'https://fec.gov/data/committee/C00123456',
        fecCommitteeId: 'C00123456',
        committeeType: 'HOUSE',
      }),
      undefined,
      true,
    )

    await user.click(screen.getByRole('button', { name: /submit/i }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    // Federal payload keeps fecCommitteeId and the entered committeeType,
    // rather than forcing committeeType to 'CANDIDATE' (the non-federal case).
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        fecCommitteeId: 'C00123456',
        committeeType: 'HOUSE',
      }),
    )
  })

  it('shows the submission error banner when hasSubmissionError is true', () => {
    render(
      <FormDataProvider
        initialState={validInitialState()}
        validator={(d) => validateRegistrationForm(d)}
      >
        <TextingComplianceRegistrationForm
          onSubmit={vi.fn()}
          hasSubmissionError
        />
      </FormDataProvider>,
    )

    expect(screen.getByText(/form submission failed/i)).toBeInTheDocument()
    // The Submit button stays available so the user can retry.
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument()
  })

  it('hides the submission error banner when hasSubmissionError is false', () => {
    render(
      <FormDataProvider
        initialState={validInitialState()}
        validator={(d) => validateRegistrationForm(d)}
      >
        <TextingComplianceRegistrationForm
          onSubmit={vi.fn()}
          hasSubmissionError={false}
        />
      </FormDataProvider>,
    )

    expect(screen.queryByText(/form submission failed/i)).toBeNull()
  })

  it('renders the full address field set with autocomplete on the street input', () => {
    renderForm(
      validInitialState({ address: { formatted_address: '', place_id: '' } }),
    )

    expect(
      screen.getByPlaceholderText(
        'Start typing to search, or enter it yourself',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText('Apt, suite, unit (optional)'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('City')).toBeInTheDocument()
    expect(screen.getByText('State *')).toBeInTheDocument()
    expect(screen.getByLabelText('ZIP')).toBeInTheDocument()
  })

  it('submits a PO Box typed straight into the address fields', async () => {
    // No suggestion ever fires for a PO Box — the same fields just get
    // filled in by hand, no mode switch involved.
    const user = userEvent.setup()
    const onSubmit = renderForm(
      validInitialState({ address: { formatted_address: '', place_id: '' } }),
      undefined,
      true,
    )

    fireEvent.change(
      screen.getByPlaceholderText(
        'Start typing to search, or enter it yourself',
      ),
      { target: { value: 'PO Box 621' } },
    )
    fireEvent.change(screen.getByLabelText('City'), {
      target: { value: 'Toledo' },
    })
    const stateTrigger = screen
      .getAllByRole('combobox')
      .find((el) => el.textContent === 'State')
    fireEvent.click(stateTrigger!)
    fireEvent.click(screen.getByRole('option', { name: 'WA' }))
    fireEvent.change(screen.getByLabelText('ZIP'), {
      target: { value: '98591' },
    })

    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        manualAddress: expect.objectContaining({
          addressLine1: 'PO Box 621',
          city: 'Toledo',
          state: 'WA',
          zip: '98591',
        }),
      }),
    )
  })

  it('drops a selected address and requires the components when the street is edited', async () => {
    // A placeId submission is resolved from Google server-side, so an edited
    // street must invalidate the selection; the remaining components (empty
    // here) then gate the submit.
    const user = userEvent.setup()
    const onSubmit = renderForm(validInitialState(), undefined, true)

    fireEvent.change(
      screen.getByPlaceholderText(
        'Start typing to search, or enter it yourself',
      ),
      { target: { value: 'PO Box 621' } },
    )
    await user.click(screen.getByRole('button', { name: /submit/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(
      screen.getByText(/city, state, and zip are required/i),
    ).toBeInTheDocument()
  })

  it('submits a manual address in place of an autocomplete selection', async () => {
    const user = userEvent.setup()
    // manualAddress present = the form is in manual-entry mode; the cleared
    // autocomplete selection must not be required.
    const onSubmit = renderForm(
      validInitialState({
        address: { formatted_address: '', place_id: '' },
        manualAddress: {
          addressLine1: 'PO Box 621',
          addressLine2: '',
          city: 'Toledo',
          state: 'WA',
          zip: '98591',
        },
      }),
      undefined,
      true,
    )

    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        manualAddress: expect.objectContaining({
          addressLine1: 'PO Box 621',
          city: 'Toledo',
          state: 'WA',
          zip: '98591',
        }),
      }),
    )
  })

  it('blocks submit while the manual address is incomplete', async () => {
    const user = userEvent.setup()
    const onSubmit = renderForm(
      validInitialState({
        address: { formatted_address: '', place_id: '' },
        manualAddress: {
          addressLine1: 'PO Box 621',
          addressLine2: '',
          city: '',
          state: 'WA',
          zip: '98591',
        },
      }),
      undefined,
      true,
    )

    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(
      screen.getByText(/city, state, and zip are required/i),
    ).toBeInTheDocument()
  })

  it('does not double-submit on two rapid clicks', async () => {
    const user = userEvent.setup()
    const onSubmit = renderForm(validInitialState(), undefined, true)

    const button = screen.getByRole('button', { name: /submit/i })
    await user.click(button)
    await user.click(button)

    // The synchronous ref guard blocks the second click even though the parent
    // `loading` prop never flips in this isolated render.
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
