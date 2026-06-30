import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { trackEvent } from 'helpers/analyticsHelper'
import type { RaceOpponentResponse } from 'gpApi/api-endpoints'
import RaceOpponentList from './RaceOpponentList'

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: vi.fn(),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
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

    // The candidate's name renders in its accordion trigger row (a button), not
    // a heading — identity lives in the row, the panel below holds the research.
    expect(
      screen.getByRole('button', { name: /Jane Rival/i }),
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

  const withAnalysis: RaceOpponentResponse = {
    ...withSummary,
    opponents: [
      {
        ...withSummary.opponents[0]!,
        summary: {
          ...withSummary.opponents[0]!.summary!,
          whyTheyMatter: 'The only incumbent with party-backed funding.',
          whatYouNeedToKnow: [
            'Two-term incumbent with name recognition.',
            'Backed by the county party committee.',
          ],
        },
      },
    ],
  }

  it('renders the why-they-matter callout and what-you-need-to-know list', () => {
    render(<RaceOpponentList initialData={withAnalysis} />)

    expect(screen.getByText('Why they matter most')).toBeInTheDocument()
    expect(
      screen.getByText('The only incumbent with party-backed funding.'),
    ).toBeInTheDocument()

    expect(screen.getByText('What you need to know')).toBeInTheDocument()
    expect(screen.getByText('2 items')).toBeInTheDocument()
    expect(
      screen.getByText('Two-term incumbent with name recognition.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Backed by the county party committee.'),
    ).toBeInTheDocument()
  })

  it('hides both sections when the analysis fields are absent', () => {
    render(<RaceOpponentList initialData={withSummary} />)

    expect(screen.queryByText('Why they matter most')).not.toBeInTheDocument()
    expect(screen.queryByText('What you need to know')).not.toBeInTheDocument()
  })

  const withWhereSoft: RaceOpponentResponse = {
    ...withSummary,
    opponents: [
      {
        ...withSummary.opponents[0]!,
        summary: {
          ...withSummary.opponents[0]!.summary!,
          whereSoft: [
            {
              text: 'No published long-term water position.',
              sources: [
                {
                  sourceType: 'ballotpedia',
                  sourceUrl: 'https://ballotpedia.org/Jane_Rival#water',
                },
              ],
            },
            // relaxed sourcing: an item with no source still renders
            { text: 'Skipped the 2026 candidate survey.' },
          ],
        },
      },
    ],
  }

  it('renders the where-theyre-soft section with a count and relaxed sourcing', () => {
    render(<RaceOpponentList initialData={withWhereSoft} />)

    expect(screen.getByText("Where they're soft")).toBeInTheDocument()
    expect(screen.getByText('2 openings')).toBeInTheDocument()
    expect(
      screen.getByText('No published long-term water position.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: /ballotpedia\.org\/Jane_Rival#water/i,
      }),
    ).toHaveAttribute('href', 'https://ballotpedia.org/Jane_Rival#water')
    expect(
      screen.getByText('Skipped the 2026 candidate survey.'),
    ).toBeInTheDocument()
  })

  it('hides the where-theyre-soft section when there are no items', () => {
    render(<RaceOpponentList initialData={withSummary} />)
    expect(screen.queryByText("Where they're soft")).not.toBeInTheDocument()
  })

  const withContrasts: RaceOpponentResponse = {
    ...withSummary,
    opponents: [
      {
        ...withSummary.opponents[0]!,
        summary: {
          ...withSummary.opponents[0]!.summary!,
          issueContrasts: [
            {
              issue: 'Housing',
              salience: 'high',
              whyItMatters: 'Families are being priced out of the district.',
              opponentStance: 'Backs the developer tax-credit bill.',
              opponentSources: [
                {
                  sourceType: 'ballotpedia',
                  sourceUrl: 'https://ballotpedia.org/Jane_Rival#contrast',
                },
              ],
              candidateStance: 'Supports more starter homes near transit.',
            },
          ],
        },
      },
    ],
  }

  it('renders an issue contrast card with both stances, source, and salience', () => {
    render(<RaceOpponentList initialData={withContrasts} />)

    expect(screen.getByText('Where you contrast')).toBeInTheDocument()
    expect(screen.getByText('High voter salience')).toBeInTheDocument()
    expect(
      screen.getByText('Families are being priced out of the district.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Backs the developer tax-credit bill.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Supports more starter homes near transit.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: /ballotpedia\.org\/Jane_Rival#contrast/i,
      }),
    ).toHaveAttribute('href', 'https://ballotpedia.org/Jane_Rival#contrast')
  })

  it('renders no Start or What-to-do action on a contrast card', () => {
    render(<RaceOpponentList initialData={withContrasts} />)
    expect(
      screen.queryByRole('button', { name: /start|what to do/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/what to do/i)).not.toBeInTheDocument()
  })

  it('hides the where-you-contrast section when there are no contrasts', () => {
    render(<RaceOpponentList initialData={withSummary} />)
    expect(screen.queryByText('Where you contrast')).not.toBeInTheDocument()
  })

  it('fires Win - Opponent Profile Viewed when an opponent detail is shown', () => {
    render(<RaceOpponentList initialData={withSummary} />)
    // No CampaignProvider in the test, so campaignId resolves to undefined, but
    // the key must be present in the payload.
    expect(trackEvent).toHaveBeenCalledWith('Win - Opponent Profile Viewed', {
      campaignId: undefined,
    })
    expect(trackEvent).toHaveBeenCalledTimes(1)
  })

  it('fires once per distinct opponent viewed and dedups a revisit', async () => {
    const twoOpponents: RaceOpponentResponse = {
      ...withSummary,
      opponents: [
        withSummary.opponents[0]!,
        {
          opponentName: 'Second Opponent',
          party: null,
          isIncumbent: null,
          items: [],
          summary: null,
        },
      ],
    }
    render(<RaceOpponentList initialData={twoOpponents} />)
    // First opponent's detail is shown on mount.
    expect(trackEvent).toHaveBeenCalledTimes(1)

    // Expanding the second opponent fires again (a new name).
    await userEvent.click(
      screen.getByRole('button', { name: /Second Opponent/i }),
    )
    expect(trackEvent).toHaveBeenCalledTimes(2)

    // Returning to the first opponent does NOT re-fire (deduped via viewedRef).
    await userEvent.click(screen.getByRole('button', { name: /Jane Rival/i }))
    expect(trackEvent).toHaveBeenCalledTimes(2)
  })

  const primaryThreatNotFirst: RaceOpponentResponse = {
    collectionStatus: 'completed',
    lastCollectedAt: '2026-06-20T12:00:00.000Z',
    opponents: [
      {
        opponentName: 'First Challenger',
        party: 'Democrat',
        isIncumbent: false,
        threatTier: 'watch_closely',
        summary: {
          opponentName: 'First Challenger',
          overview: {
            text: 'First challenger overview text.',
            sources: [
              {
                sourceType: 'ballotpedia',
                sourceUrl: 'https://ballotpedia.org/First_Challenger',
              },
            ],
          },
          background: {
            text: 'First challenger background text.',
            sources: [
              {
                sourceType: 'ballotpedia',
                sourceUrl: 'https://ballotpedia.org/First_Challenger#bg',
              },
            ],
          },
          keyPositions: [],
          generatedAt: '2026-06-20T12:00:00.000Z',
        },
        items: [],
      },
      {
        opponentName: 'Main Threat',
        party: 'Republican',
        isIncumbent: true,
        threatTier: 'primary_threat',
        summary: {
          opponentName: 'Main Threat',
          overview: {
            text: 'Main threat overview text.',
            sources: [
              {
                sourceType: 'ballotpedia',
                sourceUrl: 'https://ballotpedia.org/Main_Threat',
              },
            ],
          },
          background: {
            text: 'Main threat background text.',
            sources: [
              {
                sourceType: 'ballotpedia',
                sourceUrl: 'https://ballotpedia.org/Main_Threat#bg',
              },
            ],
          },
          keyPositions: [],
          generatedAt: '2026-06-20T12:00:00.000Z',
        },
        items: [],
      },
    ],
  }

  it('opens the primary-threat opponent on mount even when not first', () => {
    render(<RaceOpponentList initialData={primaryThreatNotFirst} />)

    // The primary-threat opponent's panel is open (its overview shows)...
    expect(screen.getByText('Main threat overview text.')).toBeInTheDocument()
    // ...while the first (non-threat) opponent's panel stays collapsed: only
    // one is open, and the default is the primary threat, not opponents[0].
    expect(
      screen.queryByText('First challenger overview text.'),
    ).not.toBeInTheDocument()

    // Analytics fires once on mount, for the opened primary-threat opponent
    // (driven by openName), not the first opponent in the list.
    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith('Win - Opponent Profile Viewed', {
      campaignId: undefined,
    })
  })

  it('collapses the open opponent panel when its own row is clicked', async () => {
    const user = userEvent.setup()
    render(<RaceOpponentList initialData={withSummary} />)

    // Jane opens by default, so her detail (Overview) is visible.
    expect(screen.getByText('Overview')).toBeInTheDocument()

    // Clicking the already-open row collapses it — the panel content is gone.
    await user.click(screen.getByRole('button', { name: /Jane Rival/i }))
    await waitFor(() =>
      expect(screen.queryByText('Overview')).not.toBeInTheDocument(),
    )

    // Clicking the row again re-opens it.
    await user.click(screen.getByRole('button', { name: /Jane Rival/i }))
    expect(screen.getByText('Overview')).toBeInTheDocument()
  })

  it('never renders a finance summary card', () => {
    render(<RaceOpponentList initialData={withSummary} />)
    expect(screen.queryByText(/finance|fundraising|cash on hand/i)).toBeNull()
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

  it('shows the manual entry form when collection settled with no opponents', () => {
    render(<RaceOpponentList initialData={empty} />)

    expect(screen.getByText(/no opponents found/i)).toBeInTheDocument()
    expect(
      screen.getByText(/add the opponents you want to analyze/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /run the analysis/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/no opponent research yet/i),
    ).not.toBeInTheDocument()
  })

  it('shows the working empty state (not the manual form) while discovering', () => {
    render(
      <RaceOpponentList
        initialData={{ ...empty, collectionStatus: 'discovering' }}
      />,
    )

    expect(screen.getByText(/no opponent research yet/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/add the opponents you want to analyze/i),
    ).not.toBeInTheDocument()
  })

  it('submits manual opponents and transitions into the processing state', async () => {
    api.mock('POST /v1/campaigns/mine/race-opponent/opponents/manual', {
      status: 200,
      data: { runId: 'manual-run-1', status: 'running' },
    })
    const user = userEvent.setup()

    render(<RaceOpponentList initialData={empty} />)

    await user.type(screen.getByLabelText('Name'), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /run the analysis/i }))

    await waitFor(() => expect(screen.getByText('Running')).toBeInTheDocument())
  })

  it('shows a failure state (not the manual form) when collection failed', () => {
    render(
      <RaceOpponentList
        initialData={{ ...empty, collectionStatus: 'failed' }}
      />,
    )

    expect(screen.getByText(/collection failed/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/add the opponents you want to analyze/i),
    ).not.toBeInTheDocument()
    // No live fresh-submit affordance on the failure state.
    expect(
      screen.queryByRole('button', { name: /run the analysis/i }),
    ).not.toBeInTheDocument()
  })

  it('acknowledges a completed run that found no opponents and gates a fresh submit', async () => {
    const user = userEvent.setup()
    render(
      <RaceOpponentList
        initialData={{ ...empty, collectionStatus: 'completed' }}
      />,
    )

    // Acknowledges the run rather than implying it never ran, and does NOT
    // surface an always-live submit that invites repeated paid re-runs.
    expect(
      screen.getByText(/no opponents found in this analysis/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /run the analysis/i }),
    ).not.toBeInTheDocument()

    // The manual form is still reachable behind an explicit disclosure.
    await user.click(
      screen.getByRole('button', { name: /add opponents manually/i }),
    )
    expect(
      screen.getByRole('button', { name: /run the analysis/i }),
    ).toBeInTheDocument()
  })

  it('renders a "The field" intro with the opponent count', () => {
    render(<RaceOpponentList initialData={withSummary} />)

    expect(screen.getByText('The field')).toBeInTheDocument()
    expect(
      screen.getByText('1 candidate filed for this seat'),
    ).toBeInTheDocument()
  })

  it('shows party and incumbency as a single descriptor on the opponent row', () => {
    render(<RaceOpponentList initialData={withSummary} />)

    // Identity now lives only in the accordion trigger row as a combined
    // "party · role" descriptor — the duplicate detail-header badges are gone.
    expect(screen.getByText('Democrat · Incumbent')).toBeInTheDocument()
    expect(screen.queryByText('Democrat')).not.toBeInTheDocument()
    expect(screen.queryByText('Incumbent')).not.toBeInTheDocument()
  })

  it('refreshes the opponent accordion in sync with the research list', async () => {
    // Start with no opponents, then Refresh returns an enriched roster. The
    // accordion is driven by the same client state, so the new opponent's row
    // and its expanded research must both appear after the refresh.
    api.mock('GET /v1/campaigns/mine/race-opponent', {
      status: 200,
      data: withSummary,
    })
    const user = userEvent.setup()

    render(<RaceOpponentList initialData={empty} />)
    expect(screen.queryByText('Democrat · Incumbent')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /refresh/i }))

    // The opponent row appears (its descriptor), and the panel auto-opens to
    // the first opponent (activeName fallback), rendering the Overview prose.
    await waitFor(() =>
      expect(screen.getByText('Democrat · Incumbent')).toBeInTheDocument(),
    )
    expect(
      screen.getByRole('button', { name: /Jane Rival/i }),
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
