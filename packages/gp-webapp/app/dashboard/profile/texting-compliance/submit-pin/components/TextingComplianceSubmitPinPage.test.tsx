import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  PeerlyCvVerificationStatus,
  type ComplianceStateOutput,
} from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { TcrCompliance, TcrComplianceStatus } from 'helpers/types'
import TextingComplianceSubmitPinPage from './TextingComplianceSubmitPinPage'

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
      getComplianceState: () => mockGetComplianceState(),
    }
  },
)

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
  }),
}))

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ email: 'jane@example.com' }, vi.fn(), false],
}))

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

const tcrWith = (status: TcrComplianceStatus): TcrCompliance => ({
  id: 'tcr-1',
  ein: '12-3456789',
  postalAddress: '123 Main St',
  committeeName: 'Jane for Council',
  websiteDomain: 'janeforcouncil.org',
  filingUrl: 'https://example.com/filing',
  phone: '5551234567',
  email: 'jane@example.com',
  status,
  createdAt: new Date(),
  updatedAt: new Date(),
  campaignId: 1,
})

const getPinField = (): HTMLElement | null =>
  screen.queryByRole('textbox', { name: /pin/i })

beforeEach(() => {
  mockGetComplianceState.mockReset()
})

// This page shipped with no CV gate at all, which is how a candidate whose
// CampaignVerify request was still IN_REVIEW got a PIN box (ENG-10866).
describe('TextingComplianceSubmitPinPage — CampaignVerify PIN gate', () => {
  it.each([
    [PeerlyCvVerificationStatus.APPROVED],
    [PeerlyCvVerificationStatus.VERIFIED],
  ])('renders the PIN field when the CV status is %s', async (cvStatus) => {
    mockGetComplianceState.mockResolvedValue(stateWith(cvStatus))

    render(
      <TextingComplianceSubmitPinPage tcrCompliance={tcrWith('submitted')} />,
    )

    await waitFor(() => expect(getPinField()).not.toBeNull())
  })

  it.each([
    [PeerlyCvVerificationStatus.REQUESTED],
    [PeerlyCvVerificationStatus.IN_REVIEW],
    [PeerlyCvVerificationStatus.REJECTED],
    [null],
  ])(
    'renders the in-progress notice instead of the PIN field when the CV status is %s',
    async (cvStatus) => {
      mockGetComplianceState.mockResolvedValue(stateWith(cvStatus))

      render(
        <TextingComplianceSubmitPinPage tcrCompliance={tcrWith('submitted')} />,
      )

      await waitFor(() => {
        expect(
          screen.getByText(/hasn’t issued your PIN yet/i),
        ).toBeInTheDocument()
      })
      expect(getPinField()).toBeNull()
    },
  )

  it.each<[TcrComplianceStatus]>([['pending'], ['approved'], ['rejected']])(
    'renders the unavailable notice when the record is not awaiting a PIN (%s)',
    async (status) => {
      mockGetComplianceState.mockResolvedValue(
        stateWith(PeerlyCvVerificationStatus.APPROVED),
      )

      render(<TextingComplianceSubmitPinPage tcrCompliance={tcrWith(status)} />)

      await waitFor(() => {
        expect(
          screen.getByText(/this step isn’t available yet/i),
        ).toBeInTheDocument()
      })
      expect(getPinField()).toBeNull()
      expect(mockGetComplianceState).not.toHaveBeenCalled()
    },
  )
})

// This route submitted through its own clientFetch wrapper, which discards the
// HTTP status — so the 409 that distinguishes "no PIN was ever issued" from a
// wrong PIN could never reach the candidate here. It now shares useSubmitCvPin
// with every other surface.
describe('TextingComplianceSubmitPinPage — error copy', () => {
  const renderReadyAndSubmit = async () => {
    mockGetComplianceState.mockResolvedValue(
      stateWith(PeerlyCvVerificationStatus.APPROVED),
    )
    const user = userEvent.setup()
    render(
      <TextingComplianceSubmitPinPage tcrCompliance={tcrWith('submitted')} />,
    )
    const field = await waitFor(() => {
      const found = getPinField()
      expect(found).not.toBeNull()
      return found!
    })
    await user.type(field, '123456')
    await user.click(screen.getByRole('button', { name: /submit/i }))
  }

  it('surfaces the no-PIN-issued copy on a 409', async () => {
    api.mock(
      'POST /v1/campaigns/tcr-compliance/:tcrComplianceId/submit-cv-pin',
      { status: 409, data: { message: "CampaignVerify hasn't issued a PIN" } },
    )

    await renderReadyAndSubmit()

    await waitFor(() => {
      expect(
        screen.getByText(/hasn’t issued your PIN yet/i),
      ).toBeInTheDocument()
    })
    expect(screen.queryByText(/didn’t match/i)).toBeNull()
  })

  it('still reports a mismatch on a 400', async () => {
    api.mock(
      'POST /v1/campaigns/tcr-compliance/:tcrComplianceId/submit-cv-pin',
      { status: 400, data: { message: 'Invalid PIN' } },
    )

    await renderReadyAndSubmit()

    await waitFor(() => {
      expect(screen.getByText(/didn’t match/i)).toBeInTheDocument()
    })
  })
})
