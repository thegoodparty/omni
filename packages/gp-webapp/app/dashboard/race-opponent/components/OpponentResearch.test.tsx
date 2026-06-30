import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type {
  OpponentProfileResponse,
  RaceOpponentActivityResponse,
  StartOpponentResearchRequest,
} from 'gpApi/api-endpoints'
import OpponentResearch from './OpponentResearch'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

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
  researchStatus: 'completed',
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

const failedProfile = (opponentName: string): OpponentProfileResponse => ({
  research: {
    ...queuedResearch(opponentName).research,
    status: 'failed',
    findings: [],
  },
})

const activityFailedEmpty = (): RaceOpponentActivityResponse => ({
  findings: [],
  researchStatus: 'failed',
  refresh: { status: 'failed', lastCompletedAt: null },
})

const queuedProfile = (opponentName: string): OpponentProfileResponse => ({
  research: {
    ...queuedResearch(opponentName).research,
    findings: [],
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

  it('renders the failure UI (not the confirm gate) for a failed-returning candidate', () => {
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
        opponentNames={['Jane Doe']}
        initialProfile={null}
        initialActivity={activityFailedEmpty()}
      />,
    )

    // A failed run is unambiguous existing research: show the failure UI, never
    // the confirm gate, and never auto-fire a new run.
    expect(
      screen.getByText(/opponent research didn.t complete/i),
    ).toBeInTheDocument()
    expect(screen.queryByText('Confirm your opponent')).not.toBeInTheDocument()
    expect(researchCall).not.toHaveBeenCalled()
  })

  it('retries research for the confirmed opponent, not opponentNames[0]', async () => {
    const researchCall = vi.fn()
    api.mock(
      'POST /v1/campaigns/mine/race-opponent/opponents/research',
      (req) => {
        researchCall((req.body as StartOpponentResearchRequest).opponentName)
        return { status: 200, data: queuedResearch('Jane Smith') }
      },
    )
    const user = userEvent.setup()

    // John Doe is the roster default (opponentNames[0]); the failed pass was for
    // Jane Smith. Retry must target Jane Smith.
    render(
      <OpponentResearch
        opponentNames={['John Doe', 'Jane Smith']}
        initialProfile={failedProfile('Jane Smith')}
        initialActivity={null}
      />,
    )

    expect(
      screen.getByText(/opponent research didn.t complete/i),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /try again/i }))

    await waitFor(() => expect(researchCall).toHaveBeenCalledWith('Jane Smith'))
    expect(researchCall).not.toHaveBeenCalledWith('John Doe')
    expect(researchCall).toHaveBeenCalledTimes(1)
  })

  it('shows the empty Handbook (not the confirm gate) when a completed run found nothing', () => {
    render(
      <OpponentResearch
        opponentNames={['Jane Doe']}
        initialProfile={null}
        initialActivity={{
          findings: [],
          researchStatus: 'completed',
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

  it('polls a queued pass and transitions spinner -> Handbook on completion', async () => {
    // First poll still queued, second poll completed with a finding. The interval
    // must pick up the transition and render the Handbook.
    api.mockOrdered('GET /v1/campaigns/mine/race-opponent/opponents/profile', [
      { status: 200, data: queuedProfile('Jane Doe') },
      { status: 200, data: completedProfile('Jane Doe') },
    ])
    api.mock('GET /v1/campaigns/mine/race-opponent/opponents/activity', {
      status: 200,
      data: activityWithFinding(),
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(
        <OpponentResearch
          opponentNames={['Jane Doe']}
          initialProfile={queuedProfile('Jane Doe')}
          initialActivity={null}
        />,
      )

      // Starts on the spinner (queued), not the Handbook.
      expect(screen.getByText('Researching Jane Doe')).toBeInTheDocument()

      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(5000)

      await waitFor(() =>
        expect(
          screen.getAllByText('Voted against the transit bond').length,
        ).toBeGreaterThan(0),
      )
      // The spinner is gone once completed.
      expect(screen.queryByText('Researching Jane Doe')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the confirm gate when researchStatus is not_started', () => {
    render(
      <OpponentResearch
        opponentNames={['Jane Doe']}
        initialProfile={null}
        initialActivity={{
          findings: [],
          researchStatus: 'not_started',
          refresh: { status: 'running', lastCompletedAt: null },
        }}
      />,
    )

    // refresh.status defaults to 'running' with no run, but researchStatus is
    // authoritative: no row means show the confirm gate, not a spinner.
    expect(screen.getByText('Confirm your opponent')).toBeInTheDocument()
  })

  it('fires the profile view event when the Handbook renders', () => {
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
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.RaceOpponent.OpponentProfileViewed,
      expect.any(Object),
    )
  })

  it('fires the activity view event when the activity stream renders', () => {
    // A completed pass seeded from the activity stream renders both the Handbook
    // and the What's-new feed, so both view events fire once.
    render(
      <OpponentResearch
        opponentNames={['Jane Doe']}
        initialProfile={null}
        initialActivity={activityWithFinding()}
      />,
    )

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.RaceOpponent.OpponentActivityViewed,
      expect.any(Object),
    )
  })

  it('does not fire the view events on the confirm gate', () => {
    render(
      <OpponentResearch
        opponentNames={['Jane Doe']}
        initialProfile={null}
        initialActivity={null}
      />,
    )

    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.RaceOpponent.OpponentProfileViewed,
      expect.anything(),
    )
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.RaceOpponent.OpponentActivityViewed,
      expect.anything(),
    )
  })

  it('fires the profile view event once across poll ticks, not on every tick', async () => {
    api.mockOrdered('GET /v1/campaigns/mine/race-opponent/opponents/profile', [
      { status: 200, data: completedProfile('Jane Doe') },
      { status: 200, data: completedProfile('Jane Doe') },
    ])
    api.mock('GET /v1/campaigns/mine/race-opponent/opponents/activity', {
      status: 200,
      data: activityWithFinding(),
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(
        <OpponentResearch
          opponentNames={['Jane Doe']}
          initialProfile={queuedProfile('Jane Doe')}
          initialActivity={null}
        />,
      )

      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(5000)

      await waitFor(() =>
        expect(
          screen.getAllByText('Voted against the transit bond').length,
        ).toBeGreaterThan(0),
      )
      const profileCalls = vi
        .mocked(trackEvent)
        .mock.calls.filter(
          ([name]) => name === EVENTS.RaceOpponent.OpponentProfileViewed,
        )
      expect(profileCalls).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
