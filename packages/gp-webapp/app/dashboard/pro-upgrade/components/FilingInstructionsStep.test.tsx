import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import FilingInstructionsStep from './FilingInstructionsStep'
import { useProUpgradeWizard } from './ProUpgradeWizard'

vi.mock('./ProUpgradeWizard', () => ({
  useProUpgradeWizard: vi.fn(),
}))

const successSnackbar = vi.fn()
const errorSnackbar = vi.fn()
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ successSnackbar, errorSnackbar }),
}))

// Keep EVENTS real; stub trackEvent so we don't hit analytics in tests.
vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const mockUseProUpgradeWizard = vi.mocked(useProUpgradeWizard)
const goToPreviousStep = vi.fn()

const CONTENT_ROUTE = 'GET /v1/campaigns/mine/filing-instructions' as const
const EMAIL_ROUTE = 'POST /v1/campaigns/mine/filing-instructions/email' as const

// The full content the server returns: preformatted window + fee/requirements/
// office/paperwork. Individual tests override pieces to exercise omission.
const fullContent = {
  filingWindow: 'June 1, 2026 – June 30, 2026',
  filingFee: 0,
  filingRequirementsText:
    'Signature requirement is between 20 and 100 qualified electors.',
  filingOfficeAddress: '270 Pleasant St, Rockland, ME 04841',
  filingPhoneNumber: '(207) 594-8431',
  paperworkInstructions:
    'Complete and submit the Declaration of Candidacy form.',
}

describe('FilingInstructionsStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProUpgradeWizard.mockReturnValue({
      currentStep: 'filing-instructions',
      goToStep: vi.fn(),
      goToNextStep: vi.fn(),
      goToPreviousStep,
    })
    api.mock(CONTENT_ROUTE, { status: 200, data: fullContent })
    api.mock(EMAIL_ROUTE, { status: 200, data: { success: true } })
  })

  it('fires the viewed analytics event on mount', () => {
    render(<FilingInstructionsStep />)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.FilingInstructionsViewed,
    )
  })

  it('renders the filing window, fee, and requirements from the server content', async () => {
    render(<FilingInstructionsStep />)

    expect(screen.getByText('Filing window')).toBeInTheDocument()
    // The server-formatted window string is rendered verbatim.
    expect(
      await screen.findByText('June 1, 2026 – June 30, 2026'),
    ).toBeInTheDocument()

    expect(screen.getByText('Filing requirements')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Filing fee is $0. Signature requirement is between 20 and 100 qualified electors.',
      ),
    ).toBeInTheDocument()
  })

  it('renders the office-contact block (address + phone) when present', async () => {
    render(<FilingInstructionsStep />)

    expect(await screen.findByText('Filing office')).toBeInTheDocument()
    expect(
      screen.getByText('270 Pleasant St, Rockland, ME 04841'),
    ).toBeInTheDocument()
    expect(screen.getByText('(207) 594-8431')).toBeInTheDocument()
    expect(screen.getByText('Paperwork')).toBeInTheDocument()
  })

  it('omits requirements, paperwork, and office blocks when the content has none', async () => {
    api.mock(CONTENT_ROUTE, {
      status: 200,
      data: {
        filingWindow: 'June 1, 2026 – June 30, 2026',
        filingFee: null,
        filingRequirementsText: null,
        filingOfficeAddress: null,
        filingPhoneNumber: null,
        paperworkInstructions: null,
      },
    })
    render(<FilingInstructionsStep />)

    // Window still renders (its own AC); the data-dependent blocks do not.
    expect(
      await screen.findByText('June 1, 2026 – June 30, 2026'),
    ).toBeInTheDocument()
    expect(screen.getByText('Filing window')).toBeInTheDocument()
    expect(screen.queryByText('Filing requirements')).not.toBeInTheDocument()
    expect(screen.queryByText('Paperwork')).not.toBeInTheDocument()
    expect(screen.queryByText('Filing office')).not.toBeInTheDocument()
  })

  it('surfaces an error snackbar when the content fetch fails', async () => {
    api.mock(CONTENT_ROUTE, { status: 500, data: { message: 'boom' } })

    render(<FilingInstructionsStep />)

    // The shared test query client uses the prod retry policy (2 retries with
    // backoff), so isError only flips after the attempts exhaust (~3s).
    await waitFor(
      () =>
        expect(errorSnackbar).toHaveBeenCalledWith(
          'Failed to load filing instructions. Please try again.',
        ),
      { timeout: 5000 },
    )
  })

  it('navigates to the previous step from the footer Back button', async () => {
    render(<FilingInstructionsStep />)
    await screen.findByText('June 1, 2026 – June 30, 2026')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(goToPreviousStep).toHaveBeenCalledTimes(1)
    expect(router.push).not.toHaveBeenCalled()
  })

  it('is a dead-end: offers a dashboard exit and no payment CTA', async () => {
    render(<FilingInstructionsStep />)
    await screen.findByText('June 1, 2026 – June 30, 2026')

    expect(
      screen.getByRole('button', { name: 'Continue to dashboard' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/payment/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/continue to payment/i)).not.toBeInTheDocument()
  })

  it('routes to the dashboard when the exit is clicked', async () => {
    render(<FilingInstructionsStep />)
    await screen.findByText('June 1, 2026 – June 30, 2026')

    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to dashboard' }),
    )

    expect(router.push).toHaveBeenCalledWith('/dashboard')
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.FilingInstructionsExit,
    )
  })

  it('stacks the footer buttons full-width on mobile and rows them at sm+', async () => {
    render(<FilingInstructionsStep />)
    await screen.findByText('June 1, 2026 – June 30, 2026')

    const back = screen.getByRole('button', { name: 'Back' })
    const exit = screen.getByRole('button', { name: 'Continue to dashboard' })

    // The shared footer stacks vertically on mobile, becomes a row at sm+ —
    // this is what keeps the two large buttons inside the mobile viewport.
    const footer = back.parentElement as HTMLElement
    expect(footer).toBe(exit.parentElement)
    expect(footer).toHaveClass('flex-col-reverse', 'sm:flex-row')

    // Full-width when stacked so neither overflows; auto-width back in the row.
    for (const button of [back, exit]) {
      expect(button).toHaveClass('w-full', 'sm:w-auto')
    }
  })

  it('emails the filing instructions and confirms success', async () => {
    const onRequest = vi.fn()
    api.mock(EMAIL_ROUTE, () => {
      onRequest()
      return { status: 200, data: { success: true } }
    })

    render(<FilingInstructionsStep />)

    fireEvent.click(screen.getByRole('button', { name: /email this to me/i }))

    await waitFor(() => expect(successSnackbar).toHaveBeenCalled())
    // The real clientRequest path hit the endpoint, not just a mocked fn.
    expect(onRequest).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ProUpgrade.Compliance.FilingInstructionsEmail,
    )
    expect(errorSnackbar).not.toHaveBeenCalled()
  })

  it('shows an error snackbar when the email request fails', async () => {
    api.mock(EMAIL_ROUTE, { status: 500, data: { message: 'boom' } })

    render(<FilingInstructionsStep />)

    fireEvent.click(screen.getByRole('button', { name: /email this to me/i }))

    await waitFor(() => expect(errorSnackbar).toHaveBeenCalled())
    expect(successSnackbar).not.toHaveBeenCalled()
  })
})
