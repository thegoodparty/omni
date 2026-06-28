import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import type {
  OpponentProfileResponse,
  RaceOpponentActivityResponse,
  StartOpponentResearchRequest,
} from 'gpApi/api-endpoints'
import OpponentResearch from './OpponentResearch'

const activityWithFinding = (): RaceOpponentActivityResponse => ({
  findings: [
    {
      id: 9,
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
      newSinceLastVisit: false,
    },
  ],
  refresh: { status: 'completed', lastCompletedAt: '2026-06-27T12:05:00.000Z' },
})

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

  it('lands a returning candidate on the Handbook from activity, not the confirm gate', () => {
    const researchCall = vi.fn()
    api.mock(
      'POST /v1/campaigns/mine/race-opponent/opponents/research',
      (req) => {
        researchCall((req.body as StartOpponentResearchRequest).opponentName)
        return { status: 200, data: queuedResearch('Jane Doe') }
      },
    )

    // No initialProfile (the page can't key the active opponent), but the
    // activity stream already fetched shows research has run.
    render(
      <OpponentResearch
        opponentNames={['Jane Doe']}
        initialProfile={null}
        initialActivity={activityWithFinding()}
      />,
    )

    // The Handbook renders from the activity findings (the same finding also
    // appears in the What's-new feed below), and the confirm control is absent —
    // so research can't be re-fired on the existing pass.
    expect(
      screen.getAllByText('Voted against the transit bond').length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText('Confirm your opponent')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /confirm and research/i }),
    ).not.toBeInTheDocument()
    expect(researchCall).not.toHaveBeenCalled()
  })

  it('shows the confirm gate when a completed run exists but found nothing', () => {
    render(
      <OpponentResearch
        opponentNames={['Jane Doe']}
        initialProfile={null}
        initialActivity={{
          findings: [],
          refresh: {
            status: 'completed',
            lastCompletedAt: '2026-06-27T12:05:00.000Z',
          },
        }}
      />,
    )

    // A completed run with no findings is still "research exists" — show the
    // empty Handbook, not the confirm gate.
    expect(screen.queryByText('Confirm your opponent')).not.toBeInTheDocument()
    expect(screen.getByText(/no sourced findings yet/i)).toBeInTheDocument()
  })
})
