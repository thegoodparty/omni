import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type {
  FeedbackReportMemo,
  FeedbackReportResponse,
  FeedbackThemeSummary,
} from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { reportQueryKey } from '../queries'
import WhatWeHeardPage from './WhatWeHeardPage'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

// A disabled Summarize says why in its tooltip, which opens on the focusable
// wrapper the styleguide's disabled-tooltip pattern puts around it.
const expectReason = async (text: string) => {
  const trigger = await waitFor(() => {
    const wrapper = screen
      .getByRole('button', { name: 'Summarize notes' })
      .closest('[data-slot="tooltip-trigger"]')
    expect(wrapper).not.toBeNull()
    return wrapper as HTMLElement
  })
  fireEvent.focus(trigger)
  expect(await screen.findByRole('tooltip')).toHaveTextContent(text)
}

// The real layout pulls in the user, the campaign and the nav, none of which
// this page's states depend on.
vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  __esModule: true,
  default: ({
    children,
    navHeader,
  }: {
    children: React.ReactNode
    navHeader?: { label: string }
  }) => (
    <div>
      <div data-testid="nav-header">{navHeader?.label}</div>
      {children}
    </div>
  ),
}))

const OUTREACH_ID = 41

const memo = (
  fields: Partial<FeedbackReportMemo> = {},
): FeedbackReportMemo => ({
  id: 'memo-1',
  personId: 'person-1',
  occurredAt: new Date('2026-09-25T18:00:00.000Z'),
  channel: 'door_knock',
  transcript: 'She wants the storm drains on Elm cleared before winter.',
  issues: [
    {
      id: 'issue-storm-drains',
      position: 0,
      issueLabel: 'Storm drains',
      stance: 'supports',
      desiredOutcome: 'Clear the drains',
    },
  ],
  actorName: 'Kamal Al Sawafi',
  confirmedAt: new Date('2026-09-25T18:01:00.000Z'),
  ...fields,
})

const theme = (
  fields: Partial<FeedbackThemeSummary> = {},
): FeedbackThemeSummary => ({
  id: 'theme-1',
  rank: 1,
  title: 'Street flooding',
  summary: 'Drains back up on Elm and 5th after every storm.',
  conversationCount: 3,
  stanceCounts: { supports: 2, opposes: 0, mixed: 1, unclear: 0 },
  desiredOutcomes: ['Clear the drains'],
  tag: null,
  ...fields,
})

const MEMOS = [
  memo(),
  memo({
    id: 'memo-2',
    personId: 'person-2',
    transcript: 'He thinks the new bike lanes slow down deliveries.',
    issues: [
      {
        id: 'issue-delivery-delays',
        position: 0,
        issueLabel: 'Delivery delays',
        stance: 'opposes',
        desiredOutcome: null,
      },
    ],
    actorName: null,
    confirmedAt: null,
  }),
]

const report = (
  fields: Partial<FeedbackReportResponse> = {},
): FeedbackReportResponse => ({
  question: 'What should the city fix first?',
  channel: 'door_knock',
  floor: 5,
  denominators: { conversations: 84, memos: 61, confirmed: 54, pending: 7 },
  run: null,
  themes: [],
  memos: MEMOS,
  ...fields,
})

const run = (status: 'running' | 'completed' | 'failed') => ({
  id: 'run-1',
  status,
  createdAt: new Date('2026-09-26T00:00:00.000Z'),
  completedAt:
    status === 'running' ? null : new Date('2026-09-26T00:05:00.000Z'),
  engine: 'mock',
})

const COMPLETED = report({
  run: run('completed'),
  // Handed over in the run's own rank order, which is not the order the
  // page shows them in: a theme more people raised ranks higher.
  themes: [
    theme({
      id: 'theme-a',
      rank: 1,
      title: 'Street flooding',
      conversationCount: 3,
    }),
    theme({
      id: 'theme-b',
      rank: 2,
      title: 'Bike lanes',
      conversationCount: 9,
    }),
    theme({
      id: 'theme-c',
      rank: 3,
      title: 'Park lighting',
      conversationCount: 5,
    }),
  ],
})

const mockReport = (data: FeedbackReportResponse) =>
  api.mock('GET /v1/constituent-feedback/efforts/:outreachId/report', {
    status: 200,
    data,
  })

const FLOODING_TAG = {
  id: 'tag-1',
  name: 'Street flooding',
  status: 'proposed',
} as const

const proposal = (id: string, name: string, proposedByRunId: string) => ({
  id,
  name,
  status: 'proposed' as const,
  source: 'synthesis' as const,
  declaredTopIssueId: null,
  mergedIntoId: null,
  proposedByRunId,
  feedbackCount: 3,
})

// The org's proposals: the page's own completed run's flooding tag, and
// one from an unrelated effort's run.
const mockProposals = () =>
  api.mock('GET /v1/constituent-feedback/tags', {
    status: 200,
    data: {
      tags: [
        proposal('tag-1', 'Street flooding', 'run-1'),
        proposal('tag-2', 'Snow removal', 'run-other'),
      ],
    },
  })

const mockNoProposals = () =>
  api.mock('GET /v1/constituent-feedback/tags', {
    status: 200,
    data: { tags: [] },
  })

const renderPage = (isServe = false) =>
  render(<WhatWeHeardPage outreachId={OUTREACH_ID} isServe={isServe} />)

const FORBIDDEN = /poll|survey|representative|statistically significant/i

beforeEach(() => {
  testQueryClient.clear()
  vi.mocked(trackEvent).mockClear()
  mockNoProposals()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('WhatWeHeardPage', () => {
  it('heads the page with the question and states every denominator', async () => {
    mockReport(report())
    renderPage()

    expect(
      await screen.findByRole('heading', {
        name: 'What should the city fix first?',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === 'P' &&
          element.textContent ===
            '84 people answered. 61 left a note. 54 confirmed.',
      ),
    ).toBeInTheDocument()
  })

  // The waiting notes are confirmed from the review list, so the clause
  // that counts them is the way there.
  it('links the waiting notes to the review list', async () => {
    mockReport(report())
    renderPage()

    expect(
      await screen.findByRole('link', { name: '7 waiting for review' }),
    ).toHaveAttribute('href', `/dashboard/issue-capture/${OUTREACH_ID}/review`)
  })

  it('drops the review clause when nothing is waiting', async () => {
    mockReport(
      report({
        denominators: {
          conversations: 84,
          memos: 61,
          confirmed: 61,
          pending: 0,
        },
      }),
    )
    renderPage()

    expect(
      await screen.findByText(
        '84 people answered. 61 left a note. 61 confirmed.',
      ),
    ).toBeInTheDocument()
  })

  it('names the outreach in the title bar, the way the hub names it', async () => {
    mockReport(report())
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: {
        id: OUTREACH_ID,
        createdAt: new Date('2026-08-10T00:00:00Z'),
        updatedAt: new Date('2026-08-10T00:00:00Z'),
        campaignId: 1,
        outreachType: 'nativePhoneBanking',
        projectId: null,
        name: 'Introduction calls',
        status: null,
        error: null,
        audienceRequest: null,
        script: null,
        message: null,
        date: null,
        imageUrl: null,
        voterFileFilterId: null,
        doorKnockingRouteId: null,
        phoneListId: null,
        identityId: null,
        didState: null,
        didNpaSubset: [],
        title: null,
        textCount: null,
        billableTextCount: null,
        campaignPlanDueDate: null,
        organizationSlug: null,
        archivedAt: null,
      },
    })
    renderPage()

    await waitFor(() =>
      expect(screen.getByTestId('nav-header')).toHaveTextContent(
        'Introduction calls',
      ),
    )
  })

  it('links back to the outreach hub with this effort open', async () => {
    mockReport(report())
    renderPage()

    const back = await screen.findByRole('link', {
      name: 'Back to Voter Outreach',
    })
    expect(back).toHaveAttribute(
      'href',
      `/dashboard/outreach?outreachId=${OUTREACH_ID}`,
    )
  })

  it('links a Serve official back to Constituent Outreach', async () => {
    mockReport(report())
    renderPage(true)

    const back = await screen.findByRole('link', {
      name: 'Back to Constituent Outreach',
    })
    expect(back).toHaveAttribute('href', '/dashboard/constituent-outreach')
  })

  it('names the page when the effort asked no question', async () => {
    mockReport(report({ question: null }))
    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'What we heard' }),
    ).toBeInTheDocument()
  })

  describe('while a run is in flight', () => {
    it('shows the banner with every note under it, and no button', async () => {
      mockReport(report({ run: run('running') }))
      renderPage()

      expect(
        await screen.findByText(
          'Summarizing what you heard. This usually takes a few minutes.',
        ),
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          'She wants the storm drains on Elm cleared before winter.',
        ),
      ).toBeInTheDocument()
      expect(
        screen.getByText('He thinks the new bike lanes slow down deliveries.'),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Summarize notes' }),
      ).toBeNull()
    })

    it('polls until the run lands, then shows the themes in place', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      let reads = 0
      api.mock(
        'GET /v1/constituent-feedback/efforts/:outreachId/report',
        () => {
          reads += 1
          return {
            status: 200,
            data: reads === 1 ? report({ run: run('running') }) : COMPLETED,
          }
        },
      )
      renderPage()

      expect(
        await screen.findByText(
          'Summarizing what you heard. This usually takes a few minutes.',
        ),
      ).toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })

      expect(await screen.findByText('Bike lanes')).toBeInTheDocument()
      expect(
        screen.queryByText(
          'Summarizing what you heard. This usually takes a few minutes.',
        ),
      ).toBeNull()

      // A completed run stops the polling: another interval passes and the
      // report is not asked for a third time.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(reads).toBe(2)
    })
  })

  describe('under the floor', () => {
    it('lists what people said, says when themes appear, and shows no cards', async () => {
      mockReport(
        report({
          denominators: {
            conversations: 6,
            memos: 4,
            confirmed: 3,
            pending: 1,
          },
          run: run('completed'),
          themes: [theme()],
        }),
      )
      renderPage()

      expect(
        await screen.findByRole('heading', { name: 'What people said so far' }),
      ).toBeInTheDocument()
      await expectReason('Themes appear after 5 confirmed notes.')
      expect(
        screen.getByText(
          'She wants the storm drains on Elm cleared before winter.',
        ),
      ).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /see details/i })).toBeNull()
      expect(screen.queryByText('Street flooding')).toBeNull()
      // Pressing it could only come back with the reason above.
      expect(
        screen.getByRole('button', { name: 'Summarize notes' }),
      ).toBeDisabled()
    })

    it('takes the floor from the report rather than knowing it', async () => {
      mockReport(
        report({
          floor: 8,
          denominators: {
            conversations: 9,
            memos: 7,
            confirmed: 7,
            pending: 0,
          },
        }),
      )
      renderPage()

      await expectReason('Themes appear after 8 confirmed notes.')
    })

    it('marks a note nobody has reviewed', async () => {
      mockReport(
        report({
          denominators: {
            conversations: 6,
            memos: 2,
            confirmed: 1,
            pending: 1,
          },
        }),
      )
      renderPage()

      expect(await screen.findByText(/Not yet reviewed/)).toBeInTheDocument()
      expect(screen.getAllByText(/Not yet reviewed/)).toHaveLength(1)
      expect(screen.getByText(/Summary by Kamal Al Sawafi/)).toBeInTheDocument()
    })
  })

  describe('with a completed run', () => {
    it('ranks the cards by how many conversations touched each theme', async () => {
      mockReport(COMPLETED)
      renderPage()

      await screen.findByText('Bike lanes')
      const links = screen.getAllByRole('link', { name: /see details/i })
      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        `/dashboard/issue-capture/${OUTREACH_ID}/theme/theme-b`,
        `/dashboard/issue-capture/${OUTREACH_ID}/theme/theme-c`,
        `/dashboard/issue-capture/${OUTREACH_ID}/theme/theme-a`,
      ])
      expect(
        screen.getByRole('heading', { name: 'Rank 1: Bike lanes' }),
      ).toBeInTheDocument()
      expect(links[0]).toHaveAccessibleName('See details for Bike lanes')
      expect(screen.getByText('9 conversations')).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { name: 'Every note' }),
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          'She wants the storm drains on Elm cleared before winter.',
        ),
      ).toBeInTheDocument()
    })

    // The strip is the page's themes' own proposals, not every proposal in
    // the org: another effort's never appear.
    it('reviews the proposed tags of the themes on the page', async () => {
      mockReport(
        report({
          run: run('completed'),
          themes: [
            theme({ tag: FLOODING_TAG }),
            theme({
              id: 'theme-b',
              title: 'Bike lanes',
              tag: { id: 'tag-4', name: 'Bike lanes', status: 'accepted' },
            }),
          ],
        }),
      )
      mockProposals()
      renderPage()

      const strip = await screen.findByRole('region', {
        name: 'New tags to review',
      })
      expect(within(strip).getByText('Street flooding')).toBeInTheDocument()
      expect(within(strip).queryByText('Snow removal')).toBeNull()
      expect(within(strip).queryByText('Bike lanes')).toBeNull()
    })

    it('splits each card by where people stand', async () => {
      mockReport(report({ run: run('completed'), themes: [theme()] }))
      renderPage()

      const split = await screen.findByLabelText('Where people stand')
      expect(split).toHaveTextContent('2For it')
      expect(split).toHaveTextContent('0Against it')
      expect(split).toHaveTextContent('1Mixed')
      expect(split).toHaveTextContent('0Unclear')
    })

    it('reads one conversation in the singular', async () => {
      mockReport(
        report({
          run: run('completed'),
          themes: [theme({ conversationCount: 1 })],
        }),
      )
      renderPage()

      expect(await screen.findByText('1 conversation')).toBeInTheDocument()
    })
  })

  describe('when the last run failed', () => {
    it('says so, offers the button again, and keeps the previous themes', async () => {
      mockReport(report({ run: run('failed'), themes: [theme()] }))
      renderPage()

      expect(
        await screen.findByText("We couldn't summarize this time."),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Summarize notes' }),
      ).toBeEnabled()
      expect(screen.getByText('Street flooding')).toBeInTheDocument()
    })

    // The themes on the page are the last completed run's, while the
    // report's run is the failed one, which proposed nothing.
    it('still reviews the proposed tags of the themes it keeps up', async () => {
      mockReport(
        report({
          run: { ...run('failed'), id: 'run-2' },
          themes: [theme({ tag: FLOODING_TAG })],
        }),
      )
      mockProposals()
      renderPage()

      const strip = await screen.findByRole('region', {
        name: 'New tags to review',
      })
      expect(within(strip).getByText('Street flooding')).toBeInTheDocument()
      expect(within(strip).queryByText('Snow removal')).toBeNull()
    })
  })

  describe('the button', () => {
    it('starts a run and shows the banner once the report says so', async () => {
      let posted = 0
      mockReport(report())
      api.mock(
        'POST /v1/constituent-feedback/efforts/:outreachId/synthesize',
        ({ params }) => {
          posted += 1
          expect(params.outreachId).toBe(String(OUTREACH_ID))
          mockReport(report({ run: run('running') }))
          return { status: 200, data: run('running') }
        },
      )
      renderPage()

      fireEvent.click(
        await screen.findByRole('button', { name: 'Summarize notes' }),
      )

      expect(
        await screen.findByText(
          'Summarizing what you heard. This usually takes a few minutes.',
        ),
      ).toBeInTheDocument()
      expect(posted).toBe(1)
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.IssueCapture.SynthesisRequested,
        {
          scope: 'effort',
          channel: 'doorKnocking',
          confirmedCount: 54,
          product: 'win',
        },
      )
    })

    it('turns off with the floor as its reason on a 422', async () => {
      mockReport(report())
      api.mock('POST /v1/constituent-feedback/efforts/:outreachId/synthesize', {
        status: 422,
        data: {
          message: 'Not enough confirmed notes to summarize',
          confirmed: 4,
          required: 5,
        },
      })
      renderPage()

      fireEvent.click(
        await screen.findByRole('button', { name: 'Summarize notes' }),
      )

      await expectReason('Themes appear after 5 confirmed notes.')
      expect(
        screen.getByRole('button', { name: 'Summarize notes' }),
      ).toBeDisabled()
    })

    it('turns off with the cooldown as its reason on a 429', async () => {
      mockReport(report())
      api.mock('POST /v1/constituent-feedback/efforts/:outreachId/synthesize', {
        status: 429,
        data: { message: 'This effort was summarized moments ago' },
      })
      renderPage()

      fireEvent.click(
        await screen.findByRole('button', { name: 'Summarize notes' }),
      )

      await expectReason(
        'This was summarized a few minutes ago. Try again later.',
      )
      expect(
        screen.getByRole('button', { name: 'Summarize notes' }),
      ).toBeDisabled()
    })

    // The cooldown lifts by itself and the report cannot say when, so the
    // next read of the report is when the button offers itself again.
    it('offers itself again on the next read after a 429', async () => {
      let reads = 0
      api.mock(
        'GET /v1/constituent-feedback/efforts/:outreachId/report',
        () => {
          reads += 1
          return { status: 200, data: report() }
        },
      )
      api.mock('POST /v1/constituent-feedback/efforts/:outreachId/synthesize', {
        status: 429,
        data: { message: 'This effort was summarized moments ago' },
      })
      renderPage()

      fireEvent.click(
        await screen.findByRole('button', { name: 'Summarize notes' }),
      )
      await expectReason(
        'This was summarized a few minutes ago. Try again later.',
      )
      // A refusal changes nothing on the report, so it is not re-read.
      expect(reads).toBe(1)

      await act(async () => {
        await testQueryClient.invalidateQueries({
          queryKey: reportQueryKey(OUTREACH_ID),
        })
      })

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Summarize notes' }),
        ).toBeEnabled(),
      )
      expect(reads).toBe(2)
      expect(
        screen.queryByText(
          'This was summarized a few minutes ago. Try again later.',
        ),
      ).toBeNull()
    })

    it('offers itself again once confirmed notes reach the floor after a 422', async () => {
      const at = (confirmed: number) =>
        report({
          denominators: { conversations: 9, memos: 7, confirmed, pending: 0 },
        })
      let reads = 0
      api.mock(
        'GET /v1/constituent-feedback/efforts/:outreachId/report',
        () => {
          reads += 1
          // The page read 5 and the API counted fewer: one lost its
          // confirmation in between. The re-read after the 422 still says
          // 5; a later one says 6.
          return { status: 200, data: at(reads <= 2 ? 5 : 6) }
        },
      )
      api.mock('POST /v1/constituent-feedback/efforts/:outreachId/synthesize', {
        status: 422,
        data: {
          message: 'Not enough confirmed notes to summarize',
          confirmed: 4,
          required: 5,
        },
      })
      renderPage()

      fireEvent.click(
        await screen.findByRole('button', { name: 'Summarize notes' }),
      )
      await expectReason('Themes appear after 5 confirmed notes.')
      await waitFor(() => expect(reads).toBe(2))
      expect(
        screen.getByRole('button', { name: 'Summarize notes' }),
      ).toBeDisabled()

      await act(async () => {
        await testQueryClient.invalidateQueries({
          queryKey: reportQueryKey(OUTREACH_ID),
        })
      })

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Summarize notes' }),
        ).toBeEnabled(),
      )
      expect(
        screen.queryByText('Themes appear after 5 confirmed notes.'),
      ).toBeNull()
    })
  })

  it('records the view once, with counts and never words', async () => {
    mockReport(COMPLETED)
    renderPage(true)

    await screen.findByText('Bike lanes')
    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(
        EVENTS.IssueCapture.ReportViewed,
        {
          scope: 'effort',
          channel: 'doorKnocking',
          themeCount: 3,
          confirmedCount: 54,
          product: 'serve',
        },
      ),
    )
    expect(
      vi
        .mocked(trackEvent)
        .mock.calls.filter(
          ([name]) => name === EVENTS.IssueCapture.ReportViewed,
        ),
    ).toHaveLength(1)
  })

  describe('copy', () => {
    const STATES: [string, FeedbackReportResponse][] = [
      ['running', report({ run: run('running') })],
      [
        'under the floor',
        report({
          denominators: {
            conversations: 2,
            memos: 2,
            confirmed: 1,
            pending: 1,
          },
        }),
      ],
      ['completed', COMPLETED],
      ['failed', report({ run: run('failed'), themes: [theme()] })],
      [
        'empty',
        report({
          memos: [],
          denominators: {
            conversations: 0,
            memos: 0,
            confirmed: 0,
            pending: 0,
          },
        }),
      ],
    ]

    it.each(STATES)(
      'never says poll, survey, representative or statistically significant (%s)',
      async (_state, data) => {
        for (const isServe of [false, true]) {
          testQueryClient.clear()
          mockReport(data)
          const { container, unmount } = renderPage(isServe)
          await screen.findByText(/people answered|person answered/)
          expect(container.textContent).not.toMatch(FORBIDDEN)
          unmount()
        }
      },
    )

    it.each(STATES)(
      'speaks to a candidate about voters and an official about constituents (%s)',
      async (_state, data) => {
        testQueryClient.clear()
        mockReport(data)
        const win = renderPage(false)
        await screen.findByText(/people answered|person answered/)
        expect(win.container.textContent).not.toMatch(/constituent/i)
        win.unmount()

        testQueryClient.clear()
        mockReport(data)
        const serve = renderPage(true)
        await screen.findByText(/people answered|person answered/)
        expect(serve.container.textContent).not.toMatch(/voter/i)
        serve.unmount()
      },
    )

    it('names the people in each product’s own word when there are no notes', async () => {
      const empty = report({
        memos: [],
        denominators: { conversations: 0, memos: 0, confirmed: 0, pending: 0 },
      })
      mockReport(empty)
      const win = renderPage(false)
      expect(
        await screen.findByText(/conversations with voters/),
      ).toBeInTheDocument()
      win.unmount()

      testQueryClient.clear()
      mockReport(empty)
      renderPage(true)
      expect(
        await screen.findByText(/conversations with constituents/),
      ).toBeInTheDocument()
    })
  })
})
