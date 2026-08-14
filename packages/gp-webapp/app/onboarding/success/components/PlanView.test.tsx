import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PlanView from './PlanView'
import { buildPlanData, type PlanInput } from './planContent'
import { generateCampaignPlanPdfBlob } from '../pdf/downloadCampaignPlanPdf'
import { uploadCampaignPlanPdf } from '../pdf/sharePlanPdf'

vi.mock('@styleguide/hooks/use-mobile', () => ({
  useIsMobile: vi.fn(() => false),
}))

// The sections grid pulls in charts, polling hooks, and images that are
// irrelevant to the share wiring under test.
vi.mock('./PlanSections', () => ({
  default: () => <div data-testid="plan-sections" />,
}))

vi.mock('../pdf/downloadCampaignPlanPdf', () => ({
  downloadCampaignPlanPdf: vi.fn().mockResolvedValue(undefined),
  generateCampaignPlanPdfBlob: vi
    .fn()
    .mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' })),
}))

vi.mock('../pdf/sharePlanPdf', () => ({
  uploadCampaignPlanPdf: vi
    .fn()
    .mockResolvedValue(
      'https://gp-api-dev.goodparty.org/v1/campaign-plan-shares/7/x.pdf',
    ),
}))

window.scrollTo = vi.fn()

const makeInput = (): PlanInput => ({
  candidateName: 'Test Candidate',
  race: 'Test Office',
  district: '',
  city: '',
  state: 'CA',
  partisanType: 'nonpartisan',
  electionDateIso: '2026-11-03',
  filingDateStartIso: '2026-07-01',
  filingDateEndIso: '2026-08-07',
  winNumber: 1000,
  projectedTurnout: 2000,
  voterContactGoal: 5000,
  runningAgainst: [],
  customIssues: [],
  stances: [],
  hubspotIncumbent: null,
  filingFee: null,
  filingRequirementsText: null,
  registeredVoters: null,
  uniqueCellphones: null,
  uniqueLandlines: null,
  projectedTurnoutLower: null,
  projectedTurnoutUpper: null,
  winNumberLower: null,
  winNumberUpper: null,
  raceCandidates: [],
  milestones: null,
})

const sectionState = { isGenerating: false, isError: false }

const planViewProps = (plan = buildPlanData(makeInput())) =>
  ({
    plan,
    planReady: true,
    state: 'CA',
    strategyState: sectionState,
    eventsState: sectionState,
    pressOutletsState: sectionState,
    voterInsightsContext: {},
    onDownload: vi.fn(),
    onShared: vi.fn(),
    onContinue: vi.fn(),
    showConfetti: false,
  }) as const

const renderPlanView = () => render(<PlanView {...planViewProps()} />)

describe('PlanView share button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the share modal from the hero share button', async () => {
    renderPlanView()
    await userEvent.click(
      screen.getByRole('button', { name: /share campaign plan/i }),
    )
    expect(
      await screen.findByText('Share your campaign plan'),
    ).toBeInTheDocument()
    const copyButton = await screen.findByRole('button', {
      name: /copy link/i,
    })
    await waitFor(() => expect(copyButton).toBeEnabled())
  })

  it('does not open the share modal when planReady is false', async () => {
    render(<PlanView {...planViewProps()} planReady={false} />)
    await userEvent.click(
      screen.getByRole('button', { name: /share campaign plan/i }),
    )
    expect(
      screen.queryByText('Share your campaign plan'),
    ).not.toBeInTheDocument()
  })

  it('uploads the pdf once even across close and re-open', async () => {
    renderPlanView()
    const shareButton = screen.getByRole('button', {
      name: /share campaign plan/i,
    })

    await userEvent.click(shareButton)
    await screen.findByRole('button', { name: /copy link/i })

    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(
        screen.queryByText('Share your campaign plan'),
      ).not.toBeInTheDocument(),
    )

    await userEvent.click(shareButton)
    await screen.findByRole('button', { name: /copy link/i })

    expect(generateCampaignPlanPdfBlob).toHaveBeenCalledTimes(1)
    expect(uploadCampaignPlanPdf).toHaveBeenCalledTimes(1)
  })

  it('re-uploads when the plan changes between shares', async () => {
    const { rerender } = renderPlanView()
    const shareButton = screen.getByRole('button', {
      name: /share campaign plan/i,
    })

    await userEvent.click(shareButton)
    await screen.findByRole('button', { name: /copy link/i })
    expect(uploadCampaignPlanPdf).toHaveBeenCalledTimes(1)

    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(
        screen.queryByText('Share your campaign plan'),
      ).not.toBeInTheDocument(),
    )

    // Async plan sections settling rebuilds `plan` with a new identity —
    // the cached upload must not survive it.
    const updatedPlan = buildPlanData({
      ...makeInput(),
      candidateName: 'Updated Candidate',
    })
    rerender(<PlanView {...planViewProps(updatedPlan)} />)

    await userEvent.click(shareButton)
    await screen.findByRole('button', { name: /copy link/i })

    expect(generateCampaignPlanPdfBlob).toHaveBeenCalledTimes(2)
    expect(uploadCampaignPlanPdf).toHaveBeenCalledTimes(2)
    expect(vi.mocked(generateCampaignPlanPdfBlob).mock.calls[1]?.[0]).toBe(
      updatedPlan,
    )
  })

  it('refreshes the link when the plan changes while the modal is open', async () => {
    const { rerender } = renderPlanView()
    await userEvent.click(
      screen.getByRole('button', { name: /share campaign plan/i }),
    )
    await screen.findByRole('button', { name: /copy link/i })
    expect(uploadCampaignPlanPdf).toHaveBeenCalledTimes(1)

    // Plan updates (e.g. background refetch) with the modal still open —
    // the displayed link must refresh without a close/reopen.
    const updatedPlan = buildPlanData({
      ...makeInput(),
      candidateName: 'Updated Candidate',
    })
    rerender(<PlanView {...planViewProps(updatedPlan)} />)

    await waitFor(() => expect(uploadCampaignPlanPdf).toHaveBeenCalledTimes(2))
    expect(vi.mocked(generateCampaignPlanPdfBlob).mock.calls[1]?.[0]).toBe(
      updatedPlan,
    )
  })

  it('does not fire a second generate when closed and reopened while upload is in-flight', async () => {
    // Use a deferred promise so we can control exactly when the blob resolves.
    let resolveBlob!: (b: Blob) => void
    const blobPromise = new Promise<Blob>((res) => {
      resolveBlob = res
    })
    vi.mocked(generateCampaignPlanPdfBlob).mockReturnValueOnce(blobPromise)

    renderPlanView()
    const shareButton = screen.getByRole('button', {
      name: /share campaign plan/i,
    })

    // Open — the modal appears in loading state.
    await userEvent.click(shareButton)
    await screen.findByText('Share your campaign plan')
    expect(generateCampaignPlanPdfBlob).toHaveBeenCalledTimes(1)

    // Close while the upload is still pending.
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(
        screen.queryByText('Share your campaign plan'),
      ).not.toBeInTheDocument(),
    )

    // Reopen — must NOT trigger a second generate call.
    await userEvent.click(shareButton)
    await screen.findByText('Share your campaign plan')
    expect(generateCampaignPlanPdfBlob).toHaveBeenCalledTimes(1)

    // Now let the blob (and upload) resolve — the modal should become ready.
    resolveBlob(new Blob(['pdf'], { type: 'application/pdf' }))
    const copyButton = await screen.findByRole('button', { name: /copy link/i })
    await waitFor(() => expect(copyButton).toBeEnabled())

    expect(uploadCampaignPlanPdf).toHaveBeenCalledTimes(1)
  })
})
