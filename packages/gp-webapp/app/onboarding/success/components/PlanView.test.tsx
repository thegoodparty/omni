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
  raceCandidates: [],
  milestones: null,
})

const sectionState = { isGenerating: false, isError: false }

const renderPlanView = () =>
  render(
    <PlanView
      plan={buildPlanData(makeInput())}
      planReady
      state="CA"
      strategyState={sectionState}
      eventsState={sectionState}
      pressOutletsState={sectionState}
      voterInsightsContext={{}}
      onDownload={vi.fn()}
      onContinue={vi.fn()}
      showConfetti={false}
    />,
  )

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
})
