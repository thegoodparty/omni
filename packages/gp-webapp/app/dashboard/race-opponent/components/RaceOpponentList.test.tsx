import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { RaceOpponentResponse } from 'gpApi/api-endpoints'
import RaceOpponentList from './RaceOpponentList'

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: vi.fn(),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

// A mock handler that never settles, so the request stays in flight and the
// component's loading state (collecting / submittingManual) holds for the
// duration of the assertion.
const noop = (): void => undefined
const pendingForever = (): Promise<never> => new Promise<never>(noop)

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

// A completed run that found no opponents — the state that surfaces the manual
// entry form (behind the "Add opponents manually" disclosure).
const completedEmpty: RaceOpponentResponse = {
  ...empty,
  collectionStatus: 'completed',
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

  // The non-busy states still surface the status pill on the list view.
  it.each([
    ['idle', 'Idle'],
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

  // While the run is busy (discovering/running) the page shows the cosmetic
  // processing screen instead of the bare status pill.
  it.each(['discovering', 'running'] as const)(
    'shows the processing screen while %s',
    (status) => {
      render(
        <RaceOpponentList
          initialData={{ ...empty, collectionStatus: status }}
        />,
      )
      expect(screen.getByText('Researching your opponents')).toBeInTheDocument()
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

  it('shows the manual entry form when collection completed with no opponents', () => {
    render(
      <RaceOpponentList
        initialData={{ ...empty, collectionStatus: 'completed' }}
      />,
    )

    expect(
      screen.getByText(/no opponents found in this analysis/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /add opponents manually/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/no opponent research yet/i),
    ).not.toBeInTheDocument()
  })

  it('shows the never-run prompt (not the manual form) when idle', () => {
    render(<RaceOpponentList initialData={empty} />)

    expect(screen.getByText(/no opponent research yet/i)).toBeInTheDocument()
    // idle has never run, so it must not claim a finished analysis or offer the
    // manual form.
    expect(
      screen.queryByText(/no opponents found in this analysis/i),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /add opponents manually/i }),
    ).not.toBeInTheDocument()
  })

  it('shows the processing screen (not the manual form) while discovering', () => {
    render(
      <RaceOpponentList
        initialData={{ ...empty, collectionStatus: 'discovering' }}
      />,
    )

    // A run in flight shows the ENG-10610 processing screen, not the manual
    // form or the idle empty-state prompt.
    expect(screen.getByText('Researching your opponents')).toBeInTheDocument()
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

    render(<RaceOpponentList initialData={completedEmpty} />)

    await user.click(
      screen.getByRole('button', { name: /add opponents manually/i }),
    )
    await user.type(screen.getByLabelText('Name'), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /run the analysis/i }))

    // The returned 'running' status moves the page into the processing screen;
    // the manual form unmounts — the page actually left the manual-entry state.
    await waitFor(() =>
      expect(
        screen.getByText('Researching your opponents'),
      ).toBeInTheDocument(),
    )
    expect(
      screen.queryByText(/add the opponents you want to analyze/i),
    ).not.toBeInTheDocument()
  })

  it('only fires one request on a re-entrant submit (synchronous guard)', async () => {
    // The first request stays pending so submittingManualRef is still set when
    // the second submit fires. We dispatch the second one as a form submit
    // event (not a button click): the button is disabled while the request is
    // in flight, so a click would be a no-op and the test would pass on the
    // button-disable alone. The form submit bypasses that, leaving only the
    // synchronous ref-guard to coalesce the two — so this fails if the guard
    // is removed.
    const requestSpy = vi.fn()
    api.mock(
      'POST /v1/campaigns/mine/race-opponent/opponents/manual',
      (): Promise<never> => {
        requestSpy()
        return pendingForever()
      },
    )
    const user = userEvent.setup()

    render(<RaceOpponentList initialData={completedEmpty} />)

    await user.click(
      screen.getByRole('button', { name: /add opponents manually/i }),
    )
    await user.type(screen.getByLabelText('Name'), 'Jane Doe')
    const submit = screen.getByRole('button', { name: /run the analysis/i })
    const form = submit.closest('form')
    expect(form).not.toBeNull()

    await user.click(submit)
    await waitFor(() => expect(requestSpy).toHaveBeenCalledTimes(1))

    // Re-entrant submit while the first is still in flight — guard must bail.
    fireEvent.submit(form!)
    fireEvent.submit(form!)

    await waitFor(() => expect(requestSpy).toHaveBeenCalledTimes(1))
    expect(requestSpy).toHaveBeenCalledTimes(1)
  })

  it('disables "Collect now" while a manual submit is in flight', async () => {
    // Hold the manual POST pending so submittingManual stays true; "Collect
    // now" must not be clickable during that window (no concurrent paid run).
    api.mock(
      'POST /v1/campaigns/mine/race-opponent/opponents/manual',
      pendingForever,
    )
    const user = userEvent.setup()

    render(<RaceOpponentList initialData={completedEmpty} />)

    await user.click(
      screen.getByRole('button', { name: /add opponents manually/i }),
    )
    await user.type(screen.getByLabelText('Name'), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /run the analysis/i }))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /collect now/i }),
      ).toBeDisabled(),
    )
  })

  it('disables the manual submit while a collect is in flight', async () => {
    // Hold the collect POST pending so collecting stays true; the form's "Run
    // the analysis" must be disabled during that window.
    api.mock('POST /v1/campaigns/mine/race-opponent/collect', pendingForever)
    const user = userEvent.setup()

    render(<RaceOpponentList initialData={completedEmpty} />)

    await user.click(
      screen.getByRole('button', { name: /add opponents manually/i }),
    )
    await user.type(screen.getByLabelText('Name'), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /collect now/i }))

    // While collecting, the form's submit enters its loading state ("Starting…")
    // and is disabled — so no concurrent manual run can be triggered.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /starting/i })).toBeDisabled(),
    )
    expect(
      screen.queryByRole('button', { name: /run the analysis/i }),
    ).not.toBeInTheDocument()
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

  it('triggers a collection and shows the processing screen for the returned running status', async () => {
    api.mock('POST /v1/campaigns/mine/race-opponent/collect', {
      status: 200,
      data: { runId: 'run-1', status: 'running' },
    })
    const user = userEvent.setup()

    render(<RaceOpponentList initialData={empty} />)

    await user.click(screen.getByRole('button', { name: /collect now/i }))

    await waitFor(() =>
      expect(
        screen.getByText('Researching your opponents'),
      ).toBeInTheDocument(),
    )
  })

  it('shows the processing screen when collection enters the discovering state', async () => {
    api.mock('POST /v1/campaigns/mine/race-opponent/collect', {
      status: 200,
      data: { runId: 'opposition-1', status: 'discovering' },
    })
    const user = userEvent.setup()

    render(<RaceOpponentList initialData={empty} />)

    await user.click(screen.getByRole('button', { name: /collect now/i }))

    await waitFor(() =>
      expect(
        screen.getByText('Researching your opponents'),
      ).toBeInTheDocument(),
    )
    // The Collect button is part of the list view, which the processing screen
    // replaces while busy — so it's no longer on screen to re-fire a paid run.
    expect(
      screen.queryByRole('button', { name: /collect now/i }),
    ).not.toBeInTheDocument()
  })

  it('polls while discovering and auto-fires collect once discovery completes', async () => {
    // First poll: discovery still running. Second poll: discovery finished
    // (status left 'discovering'), which should auto-fire collect.
    api.mockOrdered('GET /v1/campaigns/mine/race-opponent', [
      { status: 200, data: { ...empty, collectionStatus: 'discovering' } },
      { status: 200, data: { ...empty, collectionStatus: 'idle' } },
      { status: 200, data: { ...empty, collectionStatus: 'running' } },
    ])
    const collectHandler = vi.fn(() => ({
      status: 200 as const,
      data: { runId: 'collection-1', status: 'running' as const },
    }))
    api.mock('POST /v1/campaigns/mine/race-opponent/collect', collectHandler)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(
        <RaceOpponentList
          initialData={{ ...empty, collectionStatus: 'discovering' }}
        />,
      )

      // While busy the processing screen is shown (not the bare status pill).
      expect(screen.getByText('Researching your opponents')).toBeInTheDocument()

      // Two 5s poll ticks: discovering -> idle (auto-fires collect -> running).
      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(5000)

      await waitFor(() => expect(collectHandler).toHaveBeenCalledTimes(1))
      // Still busy (running): the processing screen stays up.
      expect(screen.getByText('Researching your opponents')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the processing screen while running, then the ready state, then the report when opponents arrive', async () => {
    // running -> completed with opponents. The real status drives the
    // transition; the report only appears after real data is present. Timers are
    // advanced manually (no shouldAdvanceTime) so the brief ready-hold window is
    // observable rather than auto-expiring before the assertion.
    api.mockOrdered('GET /v1/campaigns/mine/race-opponent', [
      { status: 200, data: withSummary },
    ])
    vi.useFakeTimers()
    try {
      render(
        <RaceOpponentList
          initialData={{ ...empty, collectionStatus: 'running' }}
        />,
      )

      expect(screen.getByText('Researching your opponents')).toBeInTheDocument()
      // The report (opponent name) is not present while running.
      expect(
        screen.queryByRole('button', { name: /Jane Rival/i }),
      ).not.toBeInTheDocument()

      // Poll flips real status to completed -> brief ready terminal state.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(
        screen.getByText('Your opponent report is ready'),
      ).toBeInTheDocument()

      // After the ready hold, the report replaces the processing screen.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500)
      })
      expect(
        screen.getByRole('button', { name: /Jane Rival/i }),
      ).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not transition to the report while still running even after the fake step timer has run long', async () => {
    // Real status stays 'running' across many step-timer cycles. The cosmetic
    // timer "finishing" must NOT reveal the report before real data lands.
    api.mock('GET /v1/campaigns/mine/race-opponent', {
      status: 200,
      data: { ...empty, collectionStatus: 'running' },
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(
        <RaceOpponentList
          initialData={{ ...empty, collectionStatus: 'running' }}
        />,
      )

      // Run far past the 4-step cosmetic animation (4s each) and several polls.
      await vi.advanceTimersByTimeAsync(4000 * 8)

      // Still on the processing screen, never the ready state or the report.
      expect(screen.getByText('Researching your opponents')).toBeInTheDocument()
      expect(
        screen.queryByText('Your opponent report is ready'),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /Jane Rival/i }),
      ).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the processing screen during the transient idle gap of an active run (no flicker)', async () => {
    // Two-call discovery reports 'idle' between discovery finishing and the
    // auto-fired collect flipping to 'running'. The processing screen must NOT
    // flicker out to the empty/report view during that gap.
    api.mockOrdered('GET /v1/campaigns/mine/race-opponent', [
      // First poll lands the transient idle, which auto-fires collect -> running.
      { status: 200, data: { ...empty, collectionStatus: 'idle' } },
    ])
    // Capture the POST so we can assert the collectingRef guard holds it to a
    // single dispatch: if that guard were removed, the auto-fire effect plus a
    // re-render could fire collect() twice and a static-object mock wouldn't
    // notice. A call-count assertion does.
    const collectHandler = vi.fn(() => ({
      status: 200 as const,
      data: { runId: 'collection-1', status: 'running' as const },
    }))
    api.mock('POST /v1/campaigns/mine/race-opponent/collect', collectHandler)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(
        <RaceOpponentList
          initialData={{ ...empty, collectionStatus: 'discovering' }}
        />,
      )

      expect(screen.getByText('Researching your opponents')).toBeInTheDocument()

      // Poll lands the transient idle; the auto-fired collect then flips to
      // running. Throughout, the screen must stay up and never flash the empty
      // "no opponent research yet" state.
      await vi.advanceTimersByTimeAsync(5000)

      await waitFor(() =>
        expect(
          screen.getByText('Researching your opponents'),
        ).toBeInTheDocument(),
      )
      expect(
        screen.queryByText(/no opponent research yet/i),
      ).not.toBeInTheDocument()
      // The collectingRef guard dispatched collect exactly once.
      expect(collectHandler).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-syncs from the server and recovers if the collect POST hangs past its deadline', async () => {
    // The processing screen treats an in-flight collect as still-running and the
    // status poll is paused during that window, so a collect that never resolves
    // would otherwise trap the user. The 30s deadline must reject, surface the
    // error, and re-sync from the server — picking up a run the POST may have
    // started server-side before the client deadline fired (stale 'idle' would
    // otherwise let a second click double-dispatch a paid run).
    const errorSnackbar = vi.fn()
    vi.mocked(useSnackbar).mockReturnValue({
      successSnackbar: vi.fn(),
      errorSnackbar,
      displaySnackbar: vi.fn(),
    })
    // First GET = the poll that lands the transient idle (a one-time handler
    // registered last, so MSW serves it first). Every later GET — the
    // post-timeout re-sync — falls through to this persistent handler, which
    // reports the server actually started the run ('running').
    const getStatus = vi.fn(() => ({
      status: 200 as const,
      data: { ...empty, collectionStatus: 'running' as const },
    }))
    api.mock('GET /v1/campaigns/mine/race-opponent', getStatus)
    api.mockOrdered('GET /v1/campaigns/mine/race-opponent', [
      { status: 200, data: { ...empty, collectionStatus: 'idle' } },
    ])
    // A collect POST that never resolves — only the deadline can end it.
    const neverResolves = new Promise<never>(() => undefined)
    api.mock(
      'POST /v1/campaigns/mine/race-opponent/collect',
      () => neverResolves,
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(
        <RaceOpponentList
          initialData={{ ...empty, collectionStatus: 'discovering' }}
        />,
      )

      // Poll lands the transient idle, which auto-fires the (hanging) collect.
      // The screen stays up while the collect is in flight.
      await vi.advanceTimersByTimeAsync(5000)
      expect(screen.getByText('Researching your opponents')).toBeInTheDocument()

      // Past the 30s deadline the collect rejects: the error surfaces and the
      // component re-syncs status from the server.
      await vi.advanceTimersByTimeAsync(30000)

      await waitFor(() =>
        expect(errorSnackbar).toHaveBeenCalledWith(
          'Failed to start collection. Please try again.',
        ),
      )
      // The catch path issued a status re-fetch (the second GET handler).
      await waitFor(() => expect(getStatus).toHaveBeenCalled())
      // The re-sync reports the server started the run, so the screen recovers
      // into the processing state rather than dropping to the navigable list.
      await waitFor(() =>
        expect(
          screen.getByText('Researching your opponents'),
        ).toBeInTheDocument(),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries the re-sync once if the first re-fetch also fails, then recovers', async () => {
    // If the re-sync GET in the collect catch path ITSELF fails (transient
    // network as the deadline fired), one delayed retry must recover rather than
    // stranding the user — otherwise the same double-dispatch hole the re-sync
    // closed reopens.
    const errorSnackbar = vi.fn()
    vi.mocked(useSnackbar).mockReturnValue({
      successSnackbar: vi.fn(),
      errorSnackbar,
      displaySnackbar: vi.fn(),
    })
    // First GET (one-time, served first) = the poll landing the transient idle.
    // The persistent handler serves every later GET: the first re-sync attempt
    // 500s, the delayed retry succeeds with 'running'.
    let getCalls = 0
    const getStatus = vi.fn(() => {
      getCalls += 1
      if (getCalls === 1) {
        return { status: 500 as const, data: { error: 'transient' } }
      }
      return {
        status: 200 as const,
        data: { ...empty, collectionStatus: 'running' as const },
      }
    })
    api.mock('GET /v1/campaigns/mine/race-opponent', getStatus)
    api.mockOrdered('GET /v1/campaigns/mine/race-opponent', [
      { status: 200, data: { ...empty, collectionStatus: 'idle' } },
    ])
    const neverResolves = new Promise<never>(() => undefined)
    api.mock(
      'POST /v1/campaigns/mine/race-opponent/collect',
      () => neverResolves,
    )
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(
        <RaceOpponentList
          initialData={{ ...empty, collectionStatus: 'discovering' }}
        />,
      )

      await vi.advanceTimersByTimeAsync(5000)
      expect(screen.getByText('Researching your opponents')).toBeInTheDocument()

      // Deadline fires: collect rejects, the first re-sync attempt 500s.
      await vi.advanceTimersByTimeAsync(30000)
      await waitFor(() =>
        expect(errorSnackbar).toHaveBeenCalledWith(
          'Failed to start collection. Please try again.',
        ),
      )

      // The delayed retry (one poll interval later) succeeds and recovers the
      // processing screen off the server's real 'running' status.
      await vi.advanceTimersByTimeAsync(5000)
      await waitFor(() => expect(getCalls).toBeGreaterThanOrEqual(2))
      await waitFor(() =>
        expect(
          screen.getByText('Researching your opponents'),
        ).toBeInTheDocument(),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves the processing screen when an uncontested run settles to a terminal idle', async () => {
    // collect() returns a terminal 'idle' for an uncontested/unavailable race
    // (no collection run dispatched). The screen must NOT wedge — once the
    // in-flight collect resolves to idle, the user drops to the empty state.
    api.mockOrdered('GET /v1/campaigns/mine/race-opponent', [
      { status: 200, data: { ...empty, collectionStatus: 'idle' } },
    ])
    api.mock('POST /v1/campaigns/mine/race-opponent/collect', {
      status: 200,
      data: { runId: null, status: 'idle' },
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(
        <RaceOpponentList
          initialData={{ ...empty, collectionStatus: 'discovering' }}
        />,
      )

      expect(screen.getByText('Researching your opponents')).toBeInTheDocument()

      // Poll lands idle (auto-fires collect, which settles back to idle); the
      // screen must give way to the empty state rather than spin forever.
      await vi.advanceTimersByTimeAsync(5000)

      await waitFor(() =>
        expect(
          screen.getByText(/no opponent research yet/i),
        ).toBeInTheDocument(),
      )
      expect(
        screen.queryByText('Researching your opponents'),
      ).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not show the processing screen for a brand-new idle user who has never run', () => {
    render(
      <RaceOpponentList initialData={{ ...empty, lastCollectedAt: null }} />,
    )

    // A genuine never-ran idle user sees the empty state, not the processing UI.
    expect(screen.getByText(/no opponent research yet/i)).toBeInTheDocument()
    expect(
      screen.queryByText('Researching your opponents'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /collect now/i }),
    ).toBeInTheDocument()
  })

  it('keeps the ready state latched across the full hold window before revealing the report', async () => {
    // The ready hold must not be dropped by an interim re-render (e.g. the
    // in-run tracking flipping off when 'completed' lands). It stays latched for
    // the entire hold window, then the report appears. Advancing in two sub-hold
    // steps proves the ready state persists mid-window rather than dropping early.
    api.mockOrdered('GET /v1/campaigns/mine/race-opponent', [
      { status: 200, data: withSummary },
    ])
    vi.useFakeTimers()
    try {
      render(
        <RaceOpponentList
          initialData={{ ...empty, collectionStatus: 'running' }}
        />,
      )

      // Poll flips real status to completed -> ready terminal state latches.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(
        screen.getByText('Your opponent report is ready'),
      ).toBeInTheDocument()

      // Part-way through the 1.5s hold the ready state is still shown (the
      // latch isn't dropped by an interim re-render) and the report isn't up yet.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700)
      })
      expect(
        screen.getByText('Your opponent report is ready'),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /Jane Rival/i }),
      ).not.toBeInTheDocument()

      // After the remainder of the hold, the report replaces the screen.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })
      expect(
        screen.getByRole('button', { name: /Jane Rival/i }),
      ).toBeInTheDocument()
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

  it('fires Win - Opponents Manually Added once with the submitted count on a manual submit', async () => {
    api.mock('POST /v1/campaigns/mine/race-opponent/opponents/manual', {
      status: 200,
      data: { runId: 'manual-run-1', status: 'running' },
    })
    const user = userEvent.setup()

    render(<RaceOpponentList initialData={completedEmpty} />)

    await user.click(
      screen.getByRole('button', { name: /add opponents manually/i }),
    )
    await user.type(screen.getByLabelText('Name'), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /run the analysis/i }))

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.RaceOpponent.OpponentsManuallyAdded,
        { campaignId: undefined, opponentCount: 1 },
      ),
    )
    const manualAddCalls = vi
      .mocked(trackEvent)
      .mock.calls.filter(
        ([name]) => name === EVENTS.RaceOpponent.OpponentsManuallyAdded,
      )
    expect(manualAddCalls).toHaveLength(1)
  })

  it('fires Win - Opponent Research Started once when a run goes busy on manual submit', async () => {
    api.mock('POST /v1/campaigns/mine/race-opponent/opponents/manual', {
      status: 200,
      data: { runId: 'manual-run-1', status: 'running' },
    })
    const user = userEvent.setup()

    render(<RaceOpponentList initialData={completedEmpty} />)

    await user.click(
      screen.getByRole('button', { name: /add opponents manually/i }),
    )
    await user.type(screen.getByLabelText('Name'), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /run the analysis/i }))

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.RaceOpponent.ResearchStarted,
        { campaignId: undefined },
      ),
    )
    const startedCalls = vi
      .mocked(trackEvent)
      .mock.calls.filter(
        ([name]) => name === EVENTS.RaceOpponent.ResearchStarted,
      )
    expect(startedCalls).toHaveLength(1)
  })

  it('fires Win - Opponent Research Started once across the discovering -> running progression of one run', async () => {
    // A Collect click starts a run that goes idle -> discovering ->
    // (transient idle) -> (auto-collect) -> running. ResearchStarted must fire
    // exactly once for the whole run, not on each busy sub-status, since both
    // legs are one research run.
    api.mockOrdered('GET /v1/campaigns/mine/race-opponent', [
      { status: 200, data: { ...empty, collectionStatus: 'idle' } },
    ])
    // First collect (the click) returns discovering; the auto-fired collect
    // after discovery returns running. Both are the same run.
    const collectHandler = vi.fn()
    collectHandler
      .mockReturnValueOnce({
        status: 200 as const,
        data: { runId: 'opposition-1', status: 'discovering' as const },
      })
      .mockReturnValue({
        status: 200 as const,
        data: { runId: 'collection-1', status: 'running' as const },
      })
    api.mock('POST /v1/campaigns/mine/race-opponent/collect', collectHandler)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(<RaceOpponentList initialData={empty} />)

      // Idle on mount: no run in flight, so nothing has fired yet.
      expect(
        vi
          .mocked(trackEvent)
          .mock.calls.filter(
            ([name]) => name === EVENTS.RaceOpponent.ResearchStarted,
          ),
      ).toHaveLength(0)

      // Click Collect: the run starts (idle -> discovering), firing once.
      await userEvent.click(
        screen.getByRole('button', { name: /collect now/i }),
      )
      await waitFor(() =>
        expect(trackEvent).toHaveBeenCalledWith(
          EVENTS.RaceOpponent.ResearchStarted,
          { campaignId: undefined },
        ),
      )

      // Poll lands the transient idle, auto-fires collect -> running (same run).
      await vi.advanceTimersByTimeAsync(5000)
      await waitFor(() => expect(collectHandler).toHaveBeenCalledTimes(2))

      // Still exactly one run-start across the whole discovering -> running run.
      const startedCalls = vi
        .mocked(trackEvent)
        .mock.calls.filter(
          ([name]) => name === EVENTS.RaceOpponent.ResearchStarted,
        )
      expect(startedCalls).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not fire Win - Opponent Research Started for a run already in flight on mount', () => {
    // A page that loads mid-run (reload, or a just-upgraded candidate whose run
    // is already running) must NOT count a run-start — only a start observed in
    // this session fires. Seeded from initialData so the mount is silent.
    render(
      <RaceOpponentList
        initialData={{ ...empty, collectionStatus: 'running' }}
      />,
    )

    expect(
      vi
        .mocked(trackEvent)
        .mock.calls.filter(
          ([name]) => name === EVENTS.RaceOpponent.ResearchStarted,
        ),
    ).toHaveLength(0)
  })
})
