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

const withSummary: RaceOpponentResponse = {
  collectionStatus: 'completed',
  lastCollectedAt: '2026-06-20T12:00:00.000Z',
  opponents: [
    {
      opponentName: 'Jane Rival',
      party: 'Democrat',
      isIncumbent: true,
      summary: {
        opponentName: 'Jane Rival',
        overview: {
          text: 'Two-term incumbent with strong party backing.',
          sources: [
            {
              sourceType: 'ballotpedia',
              sourceUrl: 'https://ballotpedia.org/Jane_Rival',
            },
          ],
        },
        background: {
          text: 'Served on the city council before the legislature.',
          sources: [
            {
              sourceType: 'opponent_website',
              sourceUrl: 'https://janerival.example.com/about',
            },
          ],
        },
        keyPositions: [
          {
            label: 'Housing',
            detail: 'Backed the developer tax-credit version of the bill.',
            sources: [
              {
                sourceType: 'ballotpedia',
                sourceUrl: 'https://ballotpedia.org/Jane_Rival#housing',
              },
            ],
          },
        ],
        generatedAt: '2026-06-20T12:00:00.000Z',
      },
      items: [
        {
          id: 1,
          opponentName: 'Jane Rival',
          sourceType: 'ballotpedia',
          sourceUrl: 'https://ballotpedia.org/Jane_Rival',
          content: 'Raw scraped Ballotpedia text about Jane Rival.',
          collectedAt: '2026-06-20T12:00:00.000Z',
        },
      ],
    },
  ],
}

const nullSummary: RaceOpponentResponse = {
  collectionStatus: 'completed',
  lastCollectedAt: '2026-06-20T12:00:00.000Z',
  opponents: [
    {
      opponentName: 'Jane Rival',
      party: null,
      isIncumbent: null,
      summary: null,
      items: [
        {
          id: 1,
          opponentName: 'Jane Rival',
          sourceType: 'ballotpedia',
          sourceUrl: 'https://ballotpedia.org/Jane_Rival',
          content: { bio: 'A short biography' },
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
  it('renders the structured summary sections with citations and never a <pre> dump', () => {
    const { container } = render(<RaceOpponentList initialData={withSummary} />)

    // The research-list section heading (h2); the overview card renders the
    // name as an h3, so anchor on the level to disambiguate.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Jane Rival' }),
    ).toBeInTheDocument()

    // Overview + background prose render as the primary content. The overview
    // text also appears in the card's truncated summary line, so it renders in
    // two places.
    expect(screen.getByText('Overview')).toBeInTheDocument()
    expect(
      screen.getAllByText('Two-term incumbent with strong party backing.')
        .length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Background')).toBeInTheDocument()
    expect(
      screen.getByText('Served on the city council before the legislature.'),
    ).toBeInTheDocument()

    // Each section carries a citation from summary.sources.
    expect(
      screen.getByRole('link', { name: /ballotpedia\.org\/Jane_Rival$/i }),
    ).toHaveAttribute('href', 'https://ballotpedia.org/Jane_Rival')
    expect(
      screen.getByRole('link', {
        name: /janerival\.example\.com\/about/i,
      }),
    ).toHaveAttribute('href', 'https://janerival.example.com/about')

    // No raw JSON dump on the page.
    expect(container.querySelector('pre')).toBeNull()
  })

  it('renders a key position with its label, detail, and source link', () => {
    render(<RaceOpponentList initialData={withSummary} />)

    expect(screen.getByText('Key positions')).toBeInTheDocument()
    expect(screen.getByText('Housing')).toBeInTheDocument()
    expect(
      screen.getByText('Backed the developer tax-credit version of the bill.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: /ballotpedia\.org\/Jane_Rival#housing/i,
      }),
    ).toHaveAttribute('href', 'https://ballotpedia.org/Jane_Rival#housing')
  })

  it('keeps the raw source research collapsed by default when a summary is present', () => {
    render(<RaceOpponentList initialData={withSummary} />)

    const trigger = screen.getByRole('button', {
      name: /view source research/i,
    })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByText('Raw scraped Ballotpedia text about Jane Rival.'),
    ).not.toBeInTheDocument()
  })

  it('reveals the raw source research when the section is expanded', async () => {
    const user = userEvent.setup()
    render(<RaceOpponentList initialData={withSummary} />)

    await user.click(
      screen.getByRole('button', { name: /view source research/i }),
    )

    expect(
      screen.getByText('Raw scraped Ballotpedia text about Jane Rival.'),
    ).toBeInTheDocument()
  })

  it('falls back to readable, source-linked raw text when summary is null', () => {
    const { container } = render(<RaceOpponentList initialData={nullSummary} />)

    expect(screen.getByText('Ballotpedia')).toBeInTheDocument()
    expect(screen.getByText('Opponent website')).toBeInTheDocument()

    // Object content renders as readable key/value lines, not JSON.
    expect(screen.getByText('bio')).toBeInTheDocument()
    expect(screen.getByText('A short biography')).toBeInTheDocument()
    expect(screen.getByText('Plain text content')).toBeInTheDocument()

    expect(
      screen.getByRole('link', { name: /janerival\.example\.com/i }),
    ).toHaveAttribute('href', 'https://janerival.example.com')

    // No collapsed "view source research" wrapper in the fallback, and no <pre>.
    expect(
      screen.queryByRole('button', { name: /view source research/i }),
    ).not.toBeInTheDocument()
    expect(container.querySelector('pre')).toBeNull()
  })

  it.each([
    ['idle', 'Idle'],
    ['discovering', 'Discovering opponents'],
    ['running', 'Running'],
    ['completed', 'Completed'],
    ['failed', 'Failed'],
  ] as const)(
    'renders the %s status indicator with its label',
    (status, label) => {
      render(
        <RaceOpponentList
          initialData={{ ...empty, collectionStatus: status }}
        />,
      )
      expect(screen.getByText(label)).toBeInTheDocument()
    },
  )

  it('omits the "last collected" line when lastCollectedAt is null', () => {
    render(
      <RaceOpponentList initialData={{ ...empty, lastCollectedAt: null }} />,
    )
    expect(screen.queryByText(/last collected/i)).not.toBeInTheDocument()
  })

  it('shows a "last collected" line when lastCollectedAt is set', () => {
    render(
      <RaceOpponentList
        initialData={{ ...empty, lastCollectedAt: '2026-06-20T12:00:00.000Z' }}
      />,
    )
    expect(screen.getByText(/last collected/i)).toBeInTheDocument()
  })

  it('renders a clean empty state with a Collect affordance when there is no data', () => {
    render(<RaceOpponentList initialData={empty} />)

    expect(screen.getByText(/no opponent research yet/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /collect now/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders a "The field" intro with the opponent count', () => {
    render(<RaceOpponentList initialData={withSummary} />)

    expect(screen.getByText('The field')).toBeInTheDocument()
    expect(
      screen.getByText('1 candidate filed for this seat'),
    ).toBeInTheDocument()
  })

  it('shows party/incumbency as a selector descriptor and as detail badges', () => {
    render(<RaceOpponentList initialData={withSummary} />)

    // The selector card shows a combined "party · role" descriptor line...
    expect(screen.getByText('Democrat · Incumbent')).toBeInTheDocument()
    // ...and the selected opponent's detail header shows them as separate
    // badges (each an exact-text node, distinct from the descriptor line).
    expect(screen.getByText('Democrat')).toBeInTheDocument()
    expect(screen.getByText('Incumbent')).toBeInTheDocument()
  })

  it('refreshes the overview cards in sync with the research list', async () => {
    // Start with no opponents, then Refresh returns an enriched roster. The
    // cards are driven by the same client state as the list, so the new
    // opponent's badges (card-only UI) must appear after the refresh.
    api.mock('GET /v1/campaigns/mine/race-opponent', {
      status: 200,
      data: withSummary,
    })
    const user = userEvent.setup()

    render(<RaceOpponentList initialData={empty} />)
    expect(screen.queryByText('Incumbent')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() =>
      expect(screen.getAllByText('Incumbent').length).toBeGreaterThanOrEqual(1),
    )
    // List content updated from the same state, not just the cards: the
    // research-list section heading and Overview prose both appear after the
    // refresh (the overview text shows in both the card and the list).
    expect(
      screen.getByRole('heading', { level: 2, name: 'Jane Rival' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Overview')).toBeInTheDocument()
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

      await waitFor(() =>
        expect(screen.getByText('Failed')).toBeInTheDocument(),
      )
      expect(collectHandler).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: /collect now/i })).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })
})
