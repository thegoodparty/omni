import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { router } from 'helpers/test-utils/router-mocking'
import { api } from 'helpers/test-utils/api-mocking'
import {
  PeerlyCvVerificationStatus,
  type ComplianceStateOutput,
} from '@goodparty_org/contracts'
import type { TcrCompliance, TcrComplianceStatus } from 'helpers/types'
import { EVENTS } from 'helpers/analyticsHelper'
import EnterPin from './EnterPin'

const mockGetTcrCompliance = vi.fn<() => Promise<TcrCompliance | null>>()
const mockGetComplianceState =
  vi.fn<() => Promise<ComplianceStateOutput | null>>()
vi.mock(
  'app/dashboard/profile/texting-compliance/util/tcrCompliance.util',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('app/dashboard/profile/texting-compliance/util/tcrCompliance.util')
      >()
    return {
      ...actual,
      getTcrCompliance: () => mockGetTcrCompliance(),
      getComplianceState: () => mockGetComplianceState(),
    }
  },
)

const stateWith = (
  peerlyCvStatus: ComplianceStateOutput['peerlyCvStatus'],
): ComplianceStateOutput => ({
  stage: 'awaiting_pin',
  domain: null,
  websiteId: null,
  peerlyVerificationId: 'cv-1',
  peerlyCvStatus,
  pinDelivery: null,
  internalTestingApprovedAt: null,
  hasComplianceRecord: true,
})

const mockSuccessSnackbar = vi.fn()
const mockErrorSnackbar = vi.fn()
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: mockSuccessSnackbar,
    errorSnackbar: mockErrorSnackbar,
  }),
}))

const mockUseUser = vi.fn(() => [{ email: 'jane@example.com' }, vi.fn(), false])
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => mockUseUser(),
}))

const mockTrackEvent = vi.fn()
vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return {
    ...actual,
    trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  }
})

const baseTcrCompliance: TcrCompliance = {
  id: 'tcr-1',
  ein: '12-3456789',
  postalAddress: '123 Main St',
  committeeName: 'Jane for Council',
  websiteDomain: 'janeforcouncil.org',
  filingUrl: 'https://example.com/filing',
  phone: '5551234567',
  email: 'jane@example.com',
  status: 'submitted',
  createdAt: new Date(),
  updatedAt: new Date(),
  campaignId: 1,
}

const tcrWith = (status: TcrComplianceStatus | null): TcrCompliance => ({
  ...baseTcrCompliance,
  status,
})

const getDigitInputs = (): HTMLInputElement[] =>
  screen
    .queryAllByRole('textbox')
    .filter((el) =>
      (el.getAttribute('aria-label') ?? '').startsWith('Digit '),
    ) as HTMLInputElement[]

const fillPin = async (
  user: ReturnType<typeof userEvent.setup>,
  pin: string,
): Promise<void> => {
  const inputs = getDigitInputs()
  for (let i = 0; i < pin.length; i++) {
    await user.type(inputs[i]!, pin.charAt(i))
  }
}

beforeEach(() => {
  mockGetTcrCompliance.mockReset()
  mockGetComplianceState.mockReset()
  // Default to a PIN-issued CV so the awaiting-PIN surface renders the form;
  // the CV gating tests override this per-case.
  mockGetComplianceState.mockResolvedValue(
    stateWith(PeerlyCvVerificationStatus.APPROVED),
  )
  mockSuccessSnackbar.mockReset()
  mockErrorSnackbar.mockReset()
  mockTrackEvent.mockReset()
  ;(router.push as ReturnType<typeof vi.fn>).mockClear()
})

describe('EnterPin — gating', () => {
  it('renders the PIN form when status is `submitted` (awaiting_pin)', async () => {
    mockGetTcrCompliance.mockResolvedValue(tcrWith('submitted'))
    render(<EnterPin />)
    await waitFor(() => {
      expect(getDigitInputs()).toHaveLength(6)
    })
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument()
  })

  it.each<[TcrComplianceStatus | null]>([['rejected'], ['error'], [null]])(
    'renders OutOfStateNotice (not the form) when status is %s',
    async (status) => {
      mockGetTcrCompliance.mockResolvedValue(tcrWith(status))
      render(<EnterPin />)
      await waitFor(() => {
        expect(
          screen.getByText(/this step isn’t available yet/i),
        ).toBeInTheDocument()
      })
      expect(screen.queryByRole('button', { name: /submit/i })).toBeNull()
      expect(router.push).not.toHaveBeenCalled()
    },
  )

  it.each<[TcrComplianceStatus]>([['pending'], ['approved']])(
    'redirects to /dashboard/account when status is %s (already past PIN step)',
    async (status) => {
      mockGetTcrCompliance.mockResolvedValue(tcrWith(status))
      render(<EnterPin />)
      await waitFor(() => {
        expect(router.push).toHaveBeenCalledWith('/dashboard/account')
      })
      expect(screen.queryByRole('button', { name: /submit/i })).toBeNull()
    },
  )

  it('renders OutOfStateNotice when no tcrCompliance record exists', async () => {
    mockGetTcrCompliance.mockResolvedValue(null)
    render(<EnterPin />)
    await waitFor(() => {
      expect(
        screen.getByText(/this step isn’t available yet/i),
      ).toBeInTheDocument()
    })
  })
})

// ENG-10866: a `submitted` record only means the registration reached Peerly.
// APPROVED is the only CV status under which a PIN exists (VERIFIED means one
// was issued and consumed — the retry path still needs the form).
describe('EnterPin — CampaignVerify PIN gate (ENG-10866)', () => {
  it.each([
    [PeerlyCvVerificationStatus.APPROVED],
    [PeerlyCvVerificationStatus.VERIFIED],
  ])('renders the PIN form when the CV status is %s', async (cvStatus) => {
    mockGetTcrCompliance.mockResolvedValue(tcrWith('submitted'))
    mockGetComplianceState.mockResolvedValue(stateWith(cvStatus))

    render(<EnterPin />)

    await waitFor(() => expect(getDigitInputs()).toHaveLength(6))
  })

  it.each([
    [PeerlyCvVerificationStatus.REQUESTED],
    [PeerlyCvVerificationStatus.IN_REVIEW],
    [PeerlyCvVerificationStatus.REJECTED],
    [null],
  ])(
    'renders the in-progress notice (never the PIN form) when the CV status is %s',
    async (cvStatus) => {
      mockGetTcrCompliance.mockResolvedValue(tcrWith('submitted'))
      mockGetComplianceState.mockResolvedValue(stateWith(cvStatus))

      render(<EnterPin />)

      await waitFor(() => {
        expect(
          screen.getByText(/hasn’t issued your PIN yet/i),
        ).toBeInTheDocument()
      })
      expect(getDigitInputs()).toHaveLength(0)
      expect(screen.queryByRole('button', { name: /submit/i })).toBeNull()
      expect(mockTrackEvent).not.toHaveBeenCalledWith(
        EVENTS.ProUpgrade.Compliance.PinEntryViewed,
      )
    },
  )

  it('renders the in-progress notice when compliance state cannot be read', async () => {
    mockGetTcrCompliance.mockResolvedValue(tcrWith('submitted'))
    mockGetComplianceState.mockResolvedValue(null)

    render(<EnterPin />)

    await waitFor(() => {
      expect(
        screen.getByText(/hasn’t issued your PIN yet/i),
      ).toBeInTheDocument()
    })
    expect(getDigitInputs()).toHaveLength(0)
  })
})

describe('EnterPin — funnel view event (ENG-10294)', () => {
  it('fires PIN Entry Viewed once the PIN form is shown (status submitted)', async () => {
    mockGetTcrCompliance.mockResolvedValue(tcrWith('submitted'))
    render(<EnterPin />)
    await waitFor(() => {
      expect(mockTrackEvent).toHaveBeenCalledWith(
        EVENTS.ProUpgrade.Compliance.PinEntryViewed,
      )
    })
  })

  it.each<[TcrComplianceStatus | null]>([['pending'], ['approved'], [null]])(
    'does not fire PIN Entry Viewed when the form is never shown (status %s)',
    async (status) => {
      mockGetTcrCompliance.mockResolvedValue(tcrWith(status))
      render(<EnterPin />)
      // Let the gating/redirect effects settle before asserting non-emission.
      await waitFor(() => {
        expect(mockGetTcrCompliance).toHaveBeenCalled()
      })
      expect(mockTrackEvent).not.toHaveBeenCalledWith(
        EVENTS.ProUpgrade.Compliance.PinEntryViewed,
      )
    },
  )
})

describe('EnterPin — submit flow', () => {
  it('happy path: submits PIN, fires analytics, invalidates cache, redirects', async () => {
    const user = userEvent.setup()
    mockGetTcrCompliance.mockResolvedValue(tcrWith('submitted'))

    let receivedBody: { pin?: string } = {}
    api.mock(
      'POST /v1/campaigns/tcr-compliance/:tcrComplianceId/submit-cv-pin',
      ({ body, params }) => {
        receivedBody = body
        expect(params.tcrComplianceId).toBe('tcr-1')
        return { status: 200, data: undefined }
      },
    )

    render(<EnterPin />)
    await waitFor(() => expect(getDigitInputs()).toHaveLength(6))

    await fillPin(user, '123456')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/dashboard/account')
    })

    expect(receivedBody).toEqual({ pin: '123456' })
    // Submit fires the PIN-verification event. (The mount-time PinEntryViewed
    // funnel event also fires for `submitted` status — assert the specific
    // submit event rather than a raw call count.)
    expect(mockTrackEvent).toHaveBeenCalledWith(
      EVENTS.Outreach.DlcCompliance.PinVerificationCompleted,
      expect.objectContaining({ dlcComplianceStatus: 'Yes' }),
    )
    expect(mockSuccessSnackbar).toHaveBeenCalledWith(
      expect.stringMatching(/PIN submitted/i),
    )
    expect(mockErrorSnackbar).not.toHaveBeenCalled()
  })

  it('400 response: renders "PIN didn’t match", no redirect, no snackbar error, form re-enables', async () => {
    const user = userEvent.setup()
    mockGetTcrCompliance.mockResolvedValue(tcrWith('submitted'))

    api.mock(
      'POST /v1/campaigns/tcr-compliance/:tcrComplianceId/submit-cv-pin',
      { status: 400, data: { message: 'invalid PIN' } },
    )

    render(<EnterPin />)
    await waitFor(() => expect(getDigitInputs()).toHaveLength(6))

    await fillPin(user, '123456')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /that PIN didn’t match/i,
      )
    })

    expect(router.push).not.toHaveBeenCalled()
    expect(mockErrorSnackbar).not.toHaveBeenCalled()
    // Form re-enabled.
    expect(screen.getByRole('button', { name: /submit/i })).toBeEnabled()
    expect(getDigitInputs()[0]).not.toBeDisabled()
  })

  it('409 response: says no PIN was issued, never that the PIN was wrong', async () => {
    const user = userEvent.setup()
    mockGetTcrCompliance.mockResolvedValue(tcrWith('submitted'))

    api.mock(
      'POST /v1/campaigns/tcr-compliance/:tcrComplianceId/submit-cv-pin',
      { status: 409, data: { message: "CampaignVerify hasn't issued a PIN" } },
    )

    render(<EnterPin />)
    await waitFor(() => expect(getDigitInputs()).toHaveLength(6))

    await fillPin(user, '123456')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /hasn’t issued your PIN yet/i,
      )
    })
    expect(screen.getByRole('alert')).not.toHaveTextContent(/didn’t match/i)
    expect(router.push).not.toHaveBeenCalled()
  })

  it('500 response: renders generic verify error (does not claim PIN mismatch)', async () => {
    const user = userEvent.setup()
    mockGetTcrCompliance.mockResolvedValue(tcrWith('submitted'))

    api.mock(
      'POST /v1/campaigns/tcr-compliance/:tcrComplianceId/submit-cv-pin',
      { status: 500, data: { message: 'peerly upstream blew up' } },
    )

    render(<EnterPin />)
    await waitFor(() => expect(getDigitInputs()).toHaveLength(6))

    await fillPin(user, '123456')
    await user.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /couldn’t verify that PIN/i,
      )
    })
    // Should not say "didn't match" — that's reserved for client-validation
    // errors (4xx), not generic upstream failures.
    expect(screen.getByRole('alert')).not.toHaveTextContent(/didn’t match/i)
    // No Peerly internals leaked.
    expect(screen.queryByText(/peerly/i)).toBeNull()
    expect(router.push).not.toHaveBeenCalled()
  })
})
