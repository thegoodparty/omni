import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import type {
  OpponentProfileResponse,
  StartOpponentResearchRequest,
} from 'gpApi/api-endpoints'
import OpponentResearch from './OpponentResearch'

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: vi.fn(),
}))

const queuedResearch = (opponentName: string) => ({
  research: {
    id: 5,
    kind: 'opponent' as const,
    opponentName,
    electionCandidacyId: null,
    status: 'queued' as const,
    runId: null,
    attempts: 1,
    completedAt: null,
    lastViewedAt: null,
    createdAt: '2026-06-27T12:00:00.000Z',
    updatedAt: '2026-06-27T12:00:00.000Z',
  },
})

const completedProfile = (opponentName: string): OpponentProfileResponse => ({
  research: {
    ...queuedResearch(opponentName).research,
    status: 'completed',
    completedAt: '2026-06-27T12:05:00.000Z',
    findings: [
      {
        id: 1,
        researchId: 5,
        claim: 'Voted against the transit bond',
        sourceUrl: 'https://news.example.com/vote',
        sourceExtract: 'Voted no.',
        sourceTitle: 'City Record',
        sourceReachableAt: '2026-06-27T12:00:00.000Z',
        category: 'Voting record',
        occurredAt: null,
        draftedResponse: null,
        createdAt: '2026-06-27T12:00:00.000Z',
      },
    ],
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useSnackbar).mockReturnValue({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  })
})

describe('<OpponentResearch>', () => {
  it('does not start research until the candidate confirms', () => {
    const researchCall = vi.fn()
    api.mock(
      'POST /v1/campaigns/mine/race-opponent/opponents/research',
      (req) => {
        researchCall((req.body as StartOpponentResearchRequest).opponentName)
        return { status: 200, data: queuedResearch('Jane Doe') }
      },
    )

    render(
      <OpponentResearch
        opponentNames={['Jane Doe', 'John Smith']}
        initialProfile={null}
        initialActivity={null}
      />,
    )

    // The confirm step is shown and research has not been dispatched on mount —
    // a roster default must never auto-run.
    expect(screen.getByText('Confirm your opponent')).toBeInTheDocument()
    expect(researchCall).not.toHaveBeenCalled()
  })

  it('dispatches research for the confirmed opponent on confirm', async () => {
    const researchCall = vi.fn()
    api.mock(
      'POST /v1/campaigns/mine/race-opponent/opponents/research',
      (req) => {
        researchCall((req.body as StartOpponentResearchRequest).opponentName)
        return { status: 200, data: queuedResearch('Jane Doe') }
      },
    )
    const user = userEvent.setup()

    render(
      <OpponentResearch
        opponentNames={['Jane Doe', 'John Smith']}
        initialProfile={null}
        initialActivity={null}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /confirm and research/i }),
    )

    // The first roster name is the default selection; research dispatches for it
    // and only after the explicit confirm click.
    await waitFor(() => expect(researchCall).toHaveBeenCalledWith('Jane Doe'))
    expect(researchCall).toHaveBeenCalledTimes(1)
  })

  it('renders the Handbook when a completed pass exists', () => {
    render(
      <OpponentResearch
        opponentNames={['Jane Doe']}
        initialProfile={completedProfile('Jane Doe')}
        initialActivity={null}
      />,
    )

    expect(
      screen.getByText('Voted against the transit bond'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Confirm your opponent')).not.toBeInTheDocument()
  })
})
