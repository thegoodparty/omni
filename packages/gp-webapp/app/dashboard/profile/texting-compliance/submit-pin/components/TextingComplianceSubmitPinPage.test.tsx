import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import {
  PeerlyCvVerificationStatus,
  type ComplianceStateOutput,
} from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
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
