import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { RaceOpponentResponse } from 'gpApi/api-endpoints'
import RaceOpponentList from './RaceOpponentList'
import { downloadOpponentBriefsPdf } from '../pdf/downloadOpponentBriefPdf'

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: vi.fn(),
}))

// react-pdf's rendering path can't run in jsdom; the button's contract is that
// it hands the on-screen opponents to the download helper, so mock the helper
// and assert the wiring.
vi.mock('../pdf/downloadOpponentBriefPdf', () => ({
  downloadOpponentBriefsPdf: vi.fn().mockResolvedValue(undefined),
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
      websiteUrl: 'https://janerival.example.com',
      summary: {
        opponentName: 'Jane Rival',
        overview: {
          text: 'Two-term incumbent with strong party backing.',
          sources: [
            {
              url: 'https://ballotpedia.org/Jane_Rival',
              title: 'Source title',
              publisher: 'Ballotpedia',
              sourceType: 'ballotpedia',
              sourceUrl: 'https://ballotpedia.org/Jane_Rival',
            },
          ],
        },
        whyTheyreRunning: {
          text: 'Running to defend her record on housing affordability.',
        },
        background: {
          text: 'Served on the city council before the legislature.',
          sources: [
            // Rich-only v2 shape (no legacy sourceType/sourceUrl): a freshly
            // persisted v2 row's sources look like this — the card v2 rewrite
            // (ENG-10635) reads sources off `url` directly, no fallback.
            {
              url: 'https://janerival.example.com/about',
              title: 'Source title',
              publisher: 'Campaign website',
            },
          ],
        },
        issuesThatMatter: {
          items: ['Housing affordability', 'Transit expansion'],
          sources: [
            // A distinct host from the overview source so the two SourceRow
            // chips are individually addressable by their accessible name.
            {
              url: 'https://localnews.example.com/jane-rival-issues',
              title: 'Source title',
              publisher: 'Local News',
            },
          ],
        },
        keyPositions: [
          {
            label: 'Housing',
            detail: 'Backed the developer tax-credit version of the bill.',
            sources: [
              {
                url: 'https://ballotpedia.org/Jane_Rival#housing',
                title: 'Source title',
                publisher: 'Ballotpedia',
                sourceType: 'ballotpedia',
                sourceUrl: 'https://ballotpedia.org/Jane_Rival#housing',
              },
            ],
          },
        ],
        generatedAt: '2026-06-20T12:00:00.000Z',
      },
      // No items: gp-api omits the raw source-research rows once a structured
      // summary exists (ENG-10622). The summary is the only view here.
    },
  ],
}

// A summary with only the pre-v2 fields (overview/background/keyPositions),
// no whyTheyreRunning/issuesThatMatter — the shape an unregenerated legacy row
// still parses as. The removed sections (why they matter, what you need to
// know, where soft, contrasts, key positions) must never render, even though
// this fixture's keyPositions is non-empty.
const legacySummary: RaceOpponentResponse = {
  collectionStatus: 'completed',
  lastCollectedAt: '2026-06-20T12:00:00.000Z',
  opponents: [
    {
      opponentName: 'Legacy Rival',
      party: 'Republican',
      isIncumbent: false,
      summary: {
        opponentName: 'Legacy Rival',
        overview: {
          text: 'Legacy overview text.',
          sources: [
            {
              url: 'https://ballotpedia.org/Legacy_Rival',
              title: 'Source title',
              publisher: 'Ballotpedia',
              sourceType: 'ballotpedia',
              sourceUrl: 'https://ballotpedia.org/Legacy_Rival',
            },
          ],
        },
        background: {
          text: 'Legacy background text.',
          sources: [
            {
              url: 'https://ballotpedia.org/Legacy_Rival#bg',
              title: 'Source title',
              publisher: 'Ballotpedia',
              sourceType: 'ballotpedia',
              sourceUrl: 'https://ballotpedia.org/Legacy_Rival#bg',
            },
          ],
        },
        keyPositions: [
          {
            label: 'Housing',
            detail: 'A legacy key position.',
            sources: [
              {
                url: 'https://ballotpedia.org/Legacy_Rival#housing',
                title: 'Source title',
                publisher: 'Ballotpedia',
                sourceType: 'ballotpedia',
                sourceUrl: 'https://ballotpedia.org/Legacy_Rival#housing',
              },
            ],
          },
        ],
        whyTheyMatter: 'A legacy why-they-matter callout.',
        whatYouNeedToKnow: [{ text: 'A legacy takeaway.' }],
        whereSoft: [{ text: 'A legacy soft spot.' }],
        issueContrasts: [
          {
            issue: 'Housing',
            salience: 'high',
            whyItMatters: 'A legacy contrast reason.',
            opponentStance: 'A legacy opponent stance.',
            candidateStance: 'A legacy candidate stance.',
          },
        ],
        generatedAt: '2026-06-20T12:00:00.000Z',
      },
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
// entry form directly.
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
  it('renders the four v2 sections with citations and never a <pre> dump', () => {
    const { container } = render(<RaceOpponentList initialData={withSummary} />)

    // The candidate's name renders in its accordion trigger row (a button), not
    // a heading — identity lives in the row, the panel below holds the research.
    expect(
      screen.getByRole('button', { name: /Jane Rival/i }),
    ).toBeInTheDocument()

    // Overview has no heading; the other three sections show their uppercase
    // blue label.
    expect(screen.queryByText('Overview')).not.toBeInTheDocument()
    expect(screen.getByText("Why they're running")).toBeInTheDocument()
    expect(screen.getByText('Their background')).toBeInTheDocument()
    expect(
      screen.getByText('Issues that matter most to them'),
    ).toBeInTheDocument()

    expect(
      screen.getByText('Two-term incumbent with strong party backing.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Running to defend her record on housing affordability.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Served on the city council before the legislature.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Housing affordability')).toBeInTheDocument()
    expect(screen.getByText('Transit expansion')).toBeInTheDocument()

    // Removed sections never render, even though this fixture's summary still
    // carries a legacy, non-empty keyPositions array.
    expect(screen.queryByText('Key positions')).not.toBeInTheDocument()
    expect(screen.queryByText('Why they matter most')).not.toBeInTheDocument()
    expect(screen.queryByText('What you need to know')).not.toBeInTheDocument()
    expect(screen.queryByText("Where they're soft")).not.toBeInTheDocument()
    expect(
      screen.queryByText('Where you contrast, and what to do about it'),
    ).not.toBeInTheDocument()

    // No raw JSON dump on the page.
    expect(container.querySelector('pre')).toBeNull()
  })

  it('renders the overview citation via the source chip, reading sources.url directly', () => {
    render(<RaceOpponentList initialData={withSummary} />)

    // The source chip's accessible name includes the domain; the chip opens a
    // hover-card carousel rather than rendering a plain citation link.
    expect(
      screen.getByRole('button', { name: /source: ballotpedia\.org/i }),
    ).toBeInTheDocument()
  })

  it('renders the Campaign website link when websiteUrl is present, opening in a new tab', () => {
    render(<RaceOpponentList initialData={withSummary} />)

    const link = screen.getByRole('link', { name: /campaign website/i })
    expect(link).toHaveAttribute('href', 'https://janerival.example.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('omits the Campaign website link when websiteUrl is absent', () => {
    render(<RaceOpponentList initialData={legacySummary} />)
    expect(
      screen.queryByRole('link', { name: /campaign website/i }),
    ).not.toBeInTheDocument()
  })

  it('renders only overview and background for a legacy summary, without crashing', () => {
    render(<RaceOpponentList initialData={legacySummary} />)

    expect(screen.getByText('Legacy overview text.')).toBeInTheDocument()
    expect(screen.getByText('Their background')).toBeInTheDocument()
    expect(screen.getByText('Legacy background text.')).toBeInTheDocument()

    // The removed sections never render, even though this legacy summary
    // still carries their (now-deprecated) fields.
    expect(screen.queryByText("Why they're running")).not.toBeInTheDocument()
    expect(
      screen.queryByText('Issues that matter most to them'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Key positions')).not.toBeInTheDocument()
    expect(screen.queryByText('A legacy key position.')).not.toBeInTheDocument()
    expect(screen.queryByText('Why they matter most')).not.toBeInTheDocument()
    expect(
      screen.queryByText('A legacy why-they-matter callout.'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('What you need to know')).not.toBeInTheDocument()
    expect(screen.queryByText('A legacy takeaway.')).not.toBeInTheDocument()
    expect(screen.queryByText("Where they're soft")).not.toBeInTheDocument()
    expect(screen.queryByText('A legacy soft spot.')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Where you contrast, and what to do about it'),
    ).not.toBeInTheDocument()
  })

  it('opens exactly one candidate at a time: opening the second collapses the first', async () => {
    const user = userEvent.setup()
    const twoOpponents: RaceOpponentResponse = {
      ...withSummary,
      opponents: [
        withSummary.opponents[0]!,
        {
          opponentName: 'Legacy Rival',
          party: 'Republican',
          isIncumbent: false,
          summary: legacySummary.opponents[0]!.summary,
        },
      ],
    }
    render(<RaceOpponentList initialData={twoOpponents} />)

    // Jane (the primary threat by default-open logic, here just opponents[0])
    // is open on mount.
    expect(
      screen.getByText('Two-term incumbent with strong party backing.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Legacy Rival/i }))

    // Opening the second candidate closes the first — only one detail body is
    // visible at a time (type=single accordion).
    expect(screen.getByText('Legacy overview text.')).toBeInTheDocument()
    expect(
      screen.queryByText('Two-term incumbent with strong party backing.'),
    ).not.toBeInTheDocument()
  })

  it('wires the expanded blue-ring and collapsed hover-state classes onto the card', () => {
    // jsdom doesn't compute CSS, so both accordion items carry the same static
    // data-state-scoped Tailwind tokens regardless of which is currently open
    // — Radix resolves them via its own `data-state` attribute at runtime.
    // This pins the literal class tokens the design calls for onto the card.
    const { container } = render(<RaceOpponentList initialData={withSummary} />)

    const card = container.querySelector('[data-state]')
    expect(card).not.toBeNull()
    expect(card).toHaveClass(
      'overflow-hidden',
      'rounded-xl',
      'data-[state=open]:border-primary',
      'data-[state=open]:ring-2',
      'data-[state=open]:ring-primary/30',
      'data-[state=closed]:border-border',
      'data-[state=closed]:hover:border-foreground/30',
    )
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
                url: 'https://ballotpedia.org/First_Challenger',
                title: 'Source title',
                publisher: 'Ballotpedia',
                sourceType: 'ballotpedia',
                sourceUrl: 'https://ballotpedia.org/First_Challenger',
              },
            ],
          },
          background: {
            text: 'First challenger background text.',
            sources: [
              {
                url: 'https://ballotpedia.org/First_Challenger#bg',
                title: 'Source title',
                publisher: 'Ballotpedia',
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
                url: 'https://ballotpedia.org/Main_Threat',
                title: 'Source title',
                publisher: 'Ballotpedia',
                sourceType: 'ballotpedia',
                sourceUrl: 'https://ballotpedia.org/Main_Threat',
              },
            ],
          },
          background: {
            text: 'Main threat background text.',
            sources: [
              {
                url: 'https://ballotpedia.org/Main_Threat#bg',
                title: 'Source title',
                publisher: 'Ballotpedia',
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

    // Jane opens by default, so her detail (the overview prose) is visible.
    expect(
      screen.getByText('Two-term incumbent with strong party backing.'),
    ).toBeInTheDocument()

    // Clicking the already-open row collapses it — the panel content is gone.
    await user.click(screen.getByRole('button', { name: /Jane Rival/i }))
    await waitFor(() =>
      expect(
        screen.queryByText('Two-term incumbent with strong party backing.'),
      ).not.toBeInTheDocument(),
    )

    // Clicking the row again re-opens it.
    await user.click(screen.getByRole('button', { name: /Jane Rival/i }))
    expect(
      screen.getByText('Two-term incumbent with strong party backing.'),
    ).toBeInTheDocument()
  })

  it('exports the on-screen opponents when Export brief is clicked', async () => {
    const user = userEvent.setup()
    render(
      <RaceOpponentList initialData={withSummary} raceContext="Test race" />,
    )

    const exportButton = screen.getByRole('button', { name: /Export brief/i })
    expect(exportButton).toBeEnabled()

    await user.click(exportButton)

    expect(downloadOpponentBriefsPdf).toHaveBeenCalledWith(
      withSummary.opponents,
      'Test race',
    )
  })

  it('disables Export brief when no opponent has a structured summary', () => {
    render(<RaceOpponentList initialData={nullSummary} />)

    expect(screen.getByRole('button', { name: /Export brief/i })).toBeDisabled()
  })

  it('shows an error snackbar and re-enables the button when pdf export fails', async () => {
    const errorSnackbar = vi.fn()
    vi.mocked(useSnackbar).mockReturnValue({
      successSnackbar: vi.fn(),
      errorSnackbar,
      displaySnackbar: vi.fn(),
    })
    vi.mocked(downloadOpponentBriefsPdf).mockRejectedValueOnce(
      new Error('render failed'),
    )
    const user = userEvent.setup()
    render(
      <RaceOpponentList initialData={withSummary} raceContext="Test race" />,
    )

    const exportButton = screen.getByRole('button', { name: /Export brief/i })
    await user.click(exportButton)

    await waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(
        'Failed to export the brief. Please try again.',
      ),
    )
    expect(exportButton).toBeEnabled()
  })

  it('never renders a finance summary card', () => {
    render(<RaceOpponentList initialData={withSummary} />)
    expect(screen.queryByText(/finance|fundraising|cash on hand/i)).toBeNull()
  })

  it('does not render a "View source research" section when a summary is present', () => {
    render(<RaceOpponentList initialData={withSummary} />)

    // The raw-scrape disclosure was removed: the summary is the only view, and
    // the raw scrape is not surfaced when a summary exists.
    expect(
      screen.queryByRole('button', { name: /view source research/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Raw scraped Ballotpedia text about Jane Rival.'),
    ).not.toBeInTheDocument()
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

  it('shows the manual entry form directly when collection completed with no opponents', () => {
    render(
      <RaceOpponentList
        initialData={{ ...empty, collectionStatus: 'completed' }}
      />,
    )

    // The form's fields are live up front — no "Add opponents manually"
    // disclosure to click through first.
    expect(screen.getByText('No opponents found')).toBeInTheDocument()
    expect(
      screen.getByText(/add the opponents you want to analyze/i),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /run the analysis/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /add opponents manually/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/no opponent research yet/i),
    ).not.toBeInTheDocument()
  })

  it('auto-starts collection and shows the processing screen for a never-ran idle user', async () => {
    // A Pro user landing here with no prior run (idle + lastCollectedAt null)
    // should not have to click anything — the agentic flow kicks off on mount
    // and the processing screen takes over, with no manual "start" prompt.
    const collectHandler = vi.fn(() => ({
      status: 200 as const,
      data: { runId: 'run-1', status: 'running' as const },
    }))
    api.mock('POST /v1/campaigns/mine/race-opponent/collect', collectHandler)

    render(<RaceOpponentList initialData={empty} />)

    await waitFor(() =>
      expect(
        screen.getByText('Researching your opponents'),
      ).toBeInTheDocument(),
    )
    // Dispatched exactly once, and no legacy "start" prompt is shown.
    expect(collectHandler).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByText(/no opponent research yet/i),
    ).not.toBeInTheDocument()
  })

  it('drops the never-ran idle-mount auto-start to the manual form when collect settles to idle (uncontested)', async () => {
    // The idle-MOUNT auto-start path (neverRan + autoStartPending) is distinct
    // from the discovering-mount auto-fire. For an already-discovered uncontested
    // race, /collect returns idle without dispatching a paid run. Once the
    // in-flight collect resolves, autoStartPending must drop (autoStartedRef set +
    // collecting cleared) and the screen give way to AddOpponentsForm — it must
    // NOT wedge on the processing screen.
    const collectHandler = vi.fn(() => ({
      status: 200 as const,
      data: { runId: null, status: 'idle' as const },
    }))
    api.mock('POST /v1/campaigns/mine/race-opponent/collect', collectHandler)

    render(<RaceOpponentList initialData={empty} />)

    // On mount the processing screen holds while the auto-start is pending/in flight.
    expect(screen.getByText('Researching your opponents')).toBeInTheDocument()

    // Once collect() settles to idle, the manual form replaces the screen.
    await waitFor(() =>
      expect(screen.getByText('No opponents found')).toBeInTheDocument(),
    )
    expect(
      screen.queryByText('Researching your opponents'),
    ).not.toBeInTheDocument()
    // collect fired exactly once — no re-dispatch loop.
    expect(collectHandler).toHaveBeenCalledTimes(1)
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

  it('does not double-dispatch collect when "Try again" on a failed mount settles to idle', async () => {
    // Mounting on 'failed' arms the auto-start guard (a failed run means a run
    // already ran). So when the manual "Try again" collect resolves to a terminal
    // 'idle' (uncontested server path), `neverRan` flips true but the auto-start
    // must NOT re-fire a second collect() — that would risk a double paid run.
    const collectHandler = vi.fn(() => ({
      status: 200 as const,
      data: { runId: null, status: 'idle' as const },
    }))
    api.mock('POST /v1/campaigns/mine/race-opponent/collect', collectHandler)
    const user = userEvent.setup()

    render(
      <RaceOpponentList
        initialData={{ ...empty, collectionStatus: 'failed' }}
      />,
    )

    await user.click(screen.getByRole('button', { name: /try again/i }))

    // The idle result surfaces the manual form; collect fired exactly once (the
    // click), with no auto-start re-dispatch.
    await waitFor(() =>
      expect(screen.getByText('No opponents found')).toBeInTheDocument(),
    )
    expect(collectHandler).toHaveBeenCalledTimes(1)
  })

  it('does not auto-dispatch collect when a manual submit from a completed mount settles to idle', async () => {
    // Mounting on any non-idle status (here 'completed') arms the auto-start
    // guard. If the manual-form submit resolves to a terminal 'idle' (uncontested
    // server path, which patches only collectionStatus and leaves lastCollectedAt
    // null), `neverRan` flips true — but the armed guard must stop the auto-start
    // effect from firing a second, paid collect().
    api.mock('POST /v1/campaigns/mine/race-opponent/opponents/manual', {
      status: 200,
      data: { runId: null, status: 'idle' },
    })
    const collectHandler = vi.fn(() => ({
      status: 200 as const,
      data: { runId: 'should-not-fire', status: 'discovering' as const },
    }))
    api.mock('POST /v1/campaigns/mine/race-opponent/collect', collectHandler)
    const user = userEvent.setup()

    render(<RaceOpponentList initialData={completedEmpty} />)

    await user.type(screen.getByLabelText('Name'), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /run the analysis/i }))

    // Settles back to the manual form, and collect was never auto-dispatched.
    await waitFor(() =>
      expect(screen.getByText('No opponents found')).toBeInTheDocument(),
    )
    expect(collectHandler).not.toHaveBeenCalled()
  })

  it('surfaces the manual submit directly on a completed run that found no opponents', () => {
    render(
      <RaceOpponentList
        initialData={{ ...empty, collectionStatus: 'completed' }}
      />,
    )

    // The completed-with-zero state drops the candidate straight into the
    // manual form — the submit is live without a disclosure step.
    expect(screen.getByText('No opponents found')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /run the analysis/i }),
    ).toBeInTheDocument()
  })

  it('renders the field-header heading with the opponent count and no eyebrow label', () => {
    render(<RaceOpponentList initialData={withSummary} />)

    expect(
      screen.getByRole('heading', { name: '1 candidate filed for this seat' }),
    ).toBeInTheDocument()
    // The old "The field" eyebrow and "Focus on the candidate..." copy are gone
    // with the redesign.
    expect(screen.queryByText('The field')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/focus on the candidate most likely/i),
    ).not.toBeInTheDocument()
  })

  it('renders the office/district subtitle next to the field heading, without the election date', () => {
    render(
      <RaceOpponentList
        initialData={withSummary}
        raceContext="State House, District 21 · Election November 3, 2026"
        racePlace="State House, District 21"
      />,
    )

    // The subtitle reads from racePlace, not raceContext — the election date
    // that raceContext carries for the PDF export header never shows here.
    expect(
      screen.getByText(
        'We identified and ranked every candidate running for State House, District 21.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/november 3, 2026/i)).not.toBeInTheDocument()
  })

  it('falls back to a generic subtitle when no racePlace is known', () => {
    render(
      <RaceOpponentList
        initialData={withSummary}
        raceContext="Election November 3, 2026"
      />,
    )

    expect(
      screen.getByText(
        'We identified and ranked every candidate running in your race.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/running for/i)).not.toBeInTheDocument()
  })

  it('renders the export button as icon-only with an accessible name', () => {
    render(<RaceOpponentList initialData={withSummary} />)

    const exportButton = screen.getByRole('button', { name: 'Export brief' })
    expect(exportButton).toHaveAccessibleName('Export brief')
    // Icon-only: no visible "Export brief" text node, only the aria-label.
    expect(exportButton).not.toHaveTextContent('Export brief')
  })

  it('shows party and incumbency as a single descriptor on the opponent row', () => {
    render(<RaceOpponentList initialData={withSummary} />)

    // Identity now lives only in the accordion trigger row as a combined
    // "party · role" descriptor — the duplicate detail-header badges are gone.
    expect(screen.getByText('Democrat · Incumbent')).toBeInTheDocument()
    expect(screen.queryByText('Democrat')).not.toBeInTheDocument()
    expect(screen.queryByText('Incumbent')).not.toBeInTheDocument()
  })

  it('auto-starts into the processing screen when collect returns the discovering state', async () => {
    // The two-call flow: the auto-started collect first dispatches discovery
    // (status 'discovering'), which must land the user on the processing screen.
    api.mock('POST /v1/campaigns/mine/race-opponent/collect', {
      status: 200,
      data: { runId: 'opposition-1', status: 'discovering' },
    })

    render(<RaceOpponentList initialData={empty} />)

    await waitFor(() =>
      expect(
        screen.getByText('Researching your opponents'),
      ).toBeInTheDocument(),
    )
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

  it('leaves the processing screen for the manual form when an uncontested run settles to a terminal idle', async () => {
    // collect() returns a terminal 'idle' for an uncontested/unavailable race
    // (no collection run dispatched). The screen must NOT wedge — once the
    // in-flight collect resolves to idle, the user drops to the manual entry
    // form ("we looked and found nobody, add them by hand").
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
      // screen must give way to the manual form rather than spin forever.
      await vi.advanceTimersByTimeAsync(5000)

      await waitFor(() =>
        expect(screen.getByText('No opponents found')).toBeInTheDocument(),
      )
      expect(
        screen.queryByText('Researching your opponents'),
      ).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
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
        expect(screen.getByText(/collection failed/i)).toBeInTheDocument(),
      )
      // Failure is terminal: collect is NOT auto-dispatched (retry is manual,
      // via the "Try again" button on the failure card).
      expect(collectHandler).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: /try again/i })).toBeEnabled()
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
    // The auto-start on mount begins a run that goes idle -> discovering ->
    // (transient idle) -> (auto-collect) -> running. ResearchStarted must fire
    // exactly once for the whole run, not on each busy sub-status, since both
    // legs are one research run.
    api.mockOrdered('GET /v1/campaigns/mine/race-opponent', [
      { status: 200, data: { ...empty, collectionStatus: 'idle' } },
    ])
    // The auto-started collect returns discovering; the auto-fired collect after
    // discovery returns running. Both are the same run.
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

      // Auto-start on mount begins the run (idle -> discovering), firing once.
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

  it('fires Win - Opponent Research Started exactly once when a failed auto-start precedes a manual submit', async () => {
    // The auto-start collect() fails before any run is server-confirmed (status
    // never leaves idle), so ResearchStarted must NOT fire for it — it only fires
    // off a confirmed run (discovering/running). A later manual submit that does
    // start a run then fires it exactly once, with no double count.
    api.mock('POST /v1/campaigns/mine/race-opponent/collect', {
      status: 500,
      data: { error: 'boom' },
    })
    // The catch-path re-sync reports still-idle (the run never started).
    api.mock('GET /v1/campaigns/mine/race-opponent', {
      status: 200,
      data: empty,
    })
    api.mock('POST /v1/campaigns/mine/race-opponent/opponents/manual', {
      status: 200,
      data: { runId: 'manual-run-1', status: 'running' },
    })
    const user = userEvent.setup()

    render(<RaceOpponentList initialData={empty} />)

    // The failed auto-start drops to the manual form; no run-start counted yet.
    await waitFor(() =>
      expect(screen.getByText('No opponents found')).toBeInTheDocument(),
    )
    expect(
      vi
        .mocked(trackEvent)
        .mock.calls.filter(
          ([name]) => name === EVENTS.RaceOpponent.ResearchStarted,
        ),
    ).toHaveLength(0)

    await user.type(screen.getByLabelText('Name'), 'Jane Doe')
    await user.click(screen.getByRole('button', { name: /run the analysis/i }))

    // The manual submit starts a confirmed run → exactly one run-start total.
    await waitFor(() =>
      expect(
        vi
          .mocked(trackEvent)
          .mock.calls.filter(
            ([name]) => name === EVENTS.RaceOpponent.ResearchStarted,
          ),
      ).toHaveLength(1),
    )
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
