import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import type { RaceOpponentResponse } from 'gpApi/api-endpoints'
import RaceOpponentList from './RaceOpponentList'

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: vi.fn(),
}))

const populated: RaceOpponentResponse = {
  collectionStatus: 'completed',
  lastCollectedAt: '2026-06-20T12:00:00.000Z',
  opponents: [
    {
      opponentName: 'Jane Rival',
      items: [
        {
          id: 1,
          opponentName: 'Jane Rival',
          sourceType: 'ballotpedia',
          sourceUrl: 'https://ballotpedia.org/Jane_Rival',
          content: { bio: 'A bio' },
          collectedAt: '2026-06-20T12:00:00.000Z',
        },
        {
          id: 2,
          opponentName: 'Jane Rival',
          sourceType: 'opponent_website',
          sourceUrl: 'https://janerival.example.com',
          content: 'Plain text content',
          collectedAt: '2026-06-20T12:00:00.000Z',
        },
      ],
    },
  ],
}

const empty: RaceOpponentResponse = {
  collectionStatus: 'idle',
  lastCollectedAt: null,
  opponents: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useSnackbar).mockReturnValue({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  })
})

describe('<RaceOpponentList>', () => {
  it('groups items by opponent and source with working source links', () => {
    render(<RaceOpponentList initialData={populated} />)

    expect(
      screen.getByRole('heading', { name: 'Jane Rival' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Ballotpedia')).toBeInTheDocument()
    expect(screen.getByText('Opponent website')).toBeInTheDocument()

    const ballotpediaLink = screen.getByRole('link', {
      name: /ballotpedia\.org\/Jane_Rival/i,
    })
    expect(ballotpediaLink).toHaveAttribute(
      'href',
      'https://ballotpedia.org/Jane_Rival',
    )

    const websiteLink = screen.getByRole('link', {
      name: /janerival\.example\.com/i,
    })
    expect(websiteLink).toHaveAttribute('href', 'https://janerival.example.com')
    expect(screen.getByText('Plain text content')).toBeInTheDocument()
  })

  it('renders the empty state without crashing when there is no data', () => {
    render(<RaceOpponentList initialData={empty} />)

    expect(
      screen.getByText(/no opponent data collected yet/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('triggers a collection and reflects the returned status', async () => {
    api.mock('POST /v1/campaigns/mine/race-opponent/collect', {
      status: 200,
      data: { runId: 'run-1', status: 'running' },
    })
    const user = userEvent.setup()

    render(<RaceOpponentList initialData={empty} />)

    await user.click(screen.getByRole('button', { name: /collect now/i }))

    await waitFor(() => expect(screen.getByText('Running')).toBeInTheDocument())
  })

  it('shows discovering and keeps Collect disabled while discovering', async () => {
    api.mock('POST /v1/campaigns/mine/race-opponent/collect', {
      status: 200,
      data: { runId: 'opposition-1', status: 'discovering' },
    })
    const user = userEvent.setup()

    render(<RaceOpponentList initialData={empty} />)

    await user.click(screen.getByRole('button', { name: /collect now/i }))

    await waitFor(() =>
      expect(screen.getByText('Discovering opponents')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /collect now/i })).toBeDisabled()
  })

  it('polls while discovering and auto-fires collect once discovery completes', async () => {
    // First poll: discovery still running. Second poll: discovery finished
    // (status left 'discovering'), which should auto-fire collect.
    api.mockOrdered('GET /v1/campaigns/mine/race-opponent', [
      { status: 200, data: { ...empty, collectionStatus: 'discovering' } },
      { status: 200, data: { ...empty, collectionStatus: 'idle' } },
      { status: 200, data: { ...empty, collectionStatus: 'running' } },
    ])
    api.mock('POST /v1/campaigns/mine/race-opponent/collect', {
      status: 200,
      data: { runId: 'collection-1', status: 'running' },
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(
        <RaceOpponentList
          initialData={{ ...empty, collectionStatus: 'discovering' }}
        />,
      )

      // Two 5s poll ticks: discovering -> idle (auto-fires collect -> running).
      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(5000)

      await waitFor(() =>
        expect(screen.getByText('Running')).toBeInTheDocument(),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not auto-fire collect when discovery fails (no re-dispatch loop)', async () => {
    api.mockOrdered('GET /v1/campaigns/mine/race-opponent', [
      { status: 200, data: { ...empty, collectionStatus: 'failed' } },
      { status: 200, data: { ...empty, collectionStatus: 'failed' } },
    ])
    const collectHandler = vi.fn(() => ({
      status: 200 as const,
      data: { runId: 'should-not-fire', status: 'discovering' as const },
    }))
    api.mock('POST /v1/campaigns/mine/race-opponent/collect', collectHandler)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(
        <RaceOpponentList
          initialData={{ ...empty, collectionStatus: 'discovering' }}
        />,
      )

      // Poll resolves the discovery as failed; the auto-fire must not trigger.
      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(5000)

      await waitFor(() => expect(screen.getByText('Failed')).toBeInTheDocument())
      expect(collectHandler).not.toHaveBeenCalled()
      expect(
        screen.getByRole('button', { name: /collect now/i }),
      ).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })
})
