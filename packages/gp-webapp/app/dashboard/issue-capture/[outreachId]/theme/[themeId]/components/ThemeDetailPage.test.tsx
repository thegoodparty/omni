import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FeedbackThemeDetail } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import ThemeDetailPage from './ThemeDetailPage'

// The title bar is drawn as the real DashboardNavHeader draws it, an h1, since
// the theme's title lives there now.
// The note cards' Voter info sheet reads the org for its person query.
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'org-slug' }),
}))

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
      <h1>{navHeader?.label}</h1>
      {children}
    </div>
  ),
}))

const OUTREACH_ID = 41
const THEME_ID = 'theme-b'

const THEME: FeedbackThemeDetail = {
  id: THEME_ID,
  rank: 2,
  title: 'Bike lanes',
  summary: 'People split on the new lanes on Main.',
  details:
    'Shop owners say deliveries are slower. Parents say the lanes make the school run safer.',
  conversationCount: 4,
  stanceCounts: { supports: 1, opposes: 2, mixed: 1, unclear: 0 },
  desiredOutcomes: ['Move the loading zone', 'Keep the lanes'],
  tag: { id: 'tag-1', name: 'Bike lanes', status: 'proposed' },
  members: [
    {
      feedbackId: 'memo-1',
      textReplyId: null,
      personId: 'person-1',
      occurredAt: new Date('2026-09-25T18:00:00.000Z'),
      channel: 'door_knock',
      transcript: 'He thinks the new bike lanes slow down deliveries.',
      issues: [
        {
          id: 'issue-delivery-delays',
          position: 0,
          issueLabel: 'Delivery delays',
          stance: 'opposes',
          desiredOutcome: 'Move the loading zone',
        },
      ],
      actorName: 'Kamal Al Sawafi',
    },
    {
      feedbackId: 'memo-2',
      textReplyId: null,
      personId: 'person-2',
      occurredAt: new Date('2026-09-24T18:00:00.000Z'),
      channel: 'phone_bank',
      transcript: 'She feels safer walking her kids to school.',
      issues: [
        {
          id: 'issue-school-run-safety',
          position: 0,
          issueLabel: 'School run safety',
          stance: 'supports',
          desiredOutcome: null,
        },
      ],
      actorName: null,
    },
  ],
}

const mockTheme = (data: FeedbackThemeDetail = THEME) =>
  api.mock('GET /v1/constituent-feedback/themes/:id', ({ params }) => {
    expect(params.id).toBe(THEME_ID)
    return { status: 200, data }
  })

const renderPage = (isServe = false) =>
  render(
    <ThemeDetailPage
      outreachId={OUTREACH_ID}
      themeId={THEME_ID}
      isServe={isServe}
    />,
  )

beforeEach(() => {
  testQueryClient.clear()
})

describe('ThemeDetailPage', () => {
  it('shows the theme, how people stand on it, and what they want', async () => {
    mockTheme()
    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'Bike lanes' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('People split on the new lanes on Main.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Shop owners say deliveries/)).toBeInTheDocument()
    expect(screen.getByText('4 conversations')).toBeInTheDocument()

    const split = screen.getByLabelText('Where people stand')
    // Title, summary and where people stand, as on the report's card, then
    // details, then what they want, then the notes.
    const order = [
      split,
      screen.getByRole('heading', { name: 'Details' }),
      screen.getByRole('heading', { name: 'What people want' }),
      screen.getByRole('heading', { name: 'The notes' }),
    ]
    order
      .slice(1)
      .forEach((later, index) =>
        expect(
          order[index]!.compareDocumentPosition(later) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy(),
      )
    expect(split).toHaveTextContent('1For it')
    expect(split).toHaveTextContent('2Against it')
    expect(split).toHaveTextContent('1Mixed')
    expect(split).toHaveTextContent('0Unclear')

    expect(
      screen.getByRole('heading', { name: 'What people want' }),
    ).toBeInTheDocument()
    const asks = screen.getByRole('list', { name: 'What people want' })
    expect(
      within(asks)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Move the loading zone1', 'Keep the lanes1'])
  })

  it('ranks the asks by how many named them and keeps five in view', async () => {
    const asks = [
      ['Fix the park gate'],
      ['More patrols', 'More patrols'],
      ['More lighting', 'more lighting', 'More lighting'],
      ['Close the alley'],
      ['Cameras on Elm'],
      ['A crossing guard'],
      ['Trim the hedges'],
    ]
    const issues = asks.flat().map((desiredOutcome, position) => ({
      id: `issue-${position}`,
      position: 0,
      issueLabel: 'Safety',
      stance: 'supports' as const,
      desiredOutcome,
    }))
    mockTheme({
      ...THEME,
      desiredOutcomes: [...new Set(asks.flat())],
      members: issues.map((issue, index) => ({
        ...THEME.members[0]!,
        feedbackId: `memo-${index}`,
        issues: [issue],
      })),
    })
    renderPage()

    const list = await screen.findByRole('list', { name: 'What people want' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'More lighting3',
      'More patrols2',
      'Fix the park gate1',
      'Close the alley1',
      'Cameras on Elm1',
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Show 2 more' }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(7)
    expect(screen.queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull()
  })

  // The page opens with the top of the card it was opened from, so its
  // circle shows the card's number, which is the report's order rather
  // than the run's own rank.
  it('heads the page with the theme’s number on the report and its title', async () => {
    mockTheme()
    api.mock('GET /v1/constituent-feedback/efforts/:outreachId/report', {
      status: 200,
      data: {
        question: null,
        channel: 'door_knock',
        floor: 5,
        denominators: { conversations: 9, memos: 9, confirmed: 9, pending: 0 },
        run: null,
        themes: [
          { ...THEME, rank: 2, conversationCount: 9 },
          { ...THEME, id: 'theme-a', rank: 1, conversationCount: 3 },
        ],
        memos: [],
      },
    })
    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'Rank 1: Bike lanes' }),
    ).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
  })

  it('labels every note as the canvasser’s summary', async () => {
    mockTheme()
    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'The notes' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('He thinks the new bike lanes slow down deliveries.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Summary by Kamal Al Sawafi/)).toBeInTheDocument()
    expect(screen.getByText(/Summary by your team/)).toBeInTheDocument()
    expect(screen.getByText(/On the phone/)).toBeInTheDocument()
  })

  // A note can name several issues; each is listed with where the person
  // stands on it and what they asked for.
  it('lists the issues each note named', async () => {
    mockTheme({
      ...THEME,
      members: [
        {
          ...THEME.members[0]!,
          issues: [
            {
              id: 'issue-delivery-delays',
              position: 0,
              issueLabel: 'Delivery delays',
              stance: 'opposes',
              desiredOutcome: 'Move the loading zone',
            },
            {
              id: 'issue-parking',
              position: 1,
              issueLabel: 'Parking',
              stance: 'mixed',
              desiredOutcome: null,
            },
          ],
        },
      ],
    })
    renderPage()

    const issues = await screen.findByRole('list', { name: 'Issues' })
    expect(
      within(issues)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Issue 1:Delivery delaysAgainst itWants:Move the loading zone',
      'Issue 2:ParkingMixed',
    ])
  })

  it('leads back to the effort’s report', async () => {
    mockTheme()
    renderPage()

    expect(
      await screen.findByRole('link', { name: 'Back to what we heard' }),
    ).toHaveAttribute('href', `/dashboard/issue-capture/${OUTREACH_ID}`)
  })

  // A reply carries no stance and no ask, so a theme made of replies shows
  // neither card: four zeros would read as a finding. The replies are the
  // constituents' own words, not a summary credited to the team.
  it('lists a text send’s replies as their own words, with no stance split', async () => {
    mockTheme({
      ...THEME,
      stanceCounts: null,
      desiredOutcomes: [],
      members: [
        {
          feedbackId: null,
          textReplyId: 'reply-1',
          personId: 'person-3',
          occurredAt: new Date('2026-10-10T18:00:00.000Z'),
          channel: 'text',
          transcript: 'The lanes slow down my deliveries every morning.',
          issues: [],
          actorName: null,
        },
      ],
    })
    const { container } = renderPage(true)

    expect(
      await screen.findByRole('heading', { name: 'The replies' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('The lanes slow down my deliveries every morning.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Their reply')).toBeInTheDocument()
    expect(screen.getByText(/By text/)).toBeInTheDocument()
    expect(screen.queryByText(/Summary by/)).toBeNull()
    expect(
      screen.queryByRole('heading', { name: 'Where people stand' }),
    ).toBeNull()
    expect(container.textContent).not.toMatch(/voter/i)
  })

  it('shows the newest ten notes and the rest behind Show more', async () => {
    mockTheme({
      ...THEME,
      members: Array.from({ length: 12 }, (_, index) => ({
        ...THEME.members[0]!,
        feedbackId: `memo-${index}`,
        transcript: `Note ${index + 1}`,
      })),
    })
    renderPage()

    expect(await screen.findByText('Note 10')).toBeInTheDocument()
    expect(screen.queryByText('Note 11')).toBeNull()

    await userEvent.click(
      screen.getByRole('button', { name: 'Show 2 more notes' }),
    )
    expect(screen.getByText('Note 12')).toBeInTheDocument()
  })

  it('opens the person a note is about in a sheet, not another page', async () => {
    mockTheme()
    api.mock('GET /v1/contacts/:id', ({ params }) => {
      expect(params.id).toBe('person-1')
      return { status: 500, data: {} }
    })
    renderPage()

    const [first] = await screen.findAllByRole('button', { name: 'Voter data' })
    await userEvent.click(first!)

    const sheet = await screen.findByRole('dialog', { name: 'Voter data' })
    expect(
      await within(sheet).findByText(
        "We couldn't load this voter. Try again in a moment.",
      ),
    ).toBeInTheDocument()
  })

  it('leaves out the asks when nobody named one', async () => {
    mockTheme({ ...THEME, desiredOutcomes: [] })
    renderPage()

    await screen.findByRole('heading', { name: 'Bike lanes' })
    expect(
      screen.queryByRole('heading', { name: 'What people want' }),
    ).toBeNull()
  })

  it('never says poll, survey, representative or statistically significant', async () => {
    for (const isServe of [false, true]) {
      testQueryClient.clear()
      mockTheme()
      const { container, unmount } = renderPage(isServe)
      await screen.findByRole('heading', { name: 'Bike lanes' })
      expect(container.textContent).not.toMatch(
        /poll|survey|representative|statistically significant/i,
      )
      unmount()
    }
  })

  it('never says constituent to a candidate or voter to an official', async () => {
    mockTheme()
    const win = renderPage(false)
    await screen.findByRole('heading', { name: 'Bike lanes' })
    expect(win.container.textContent).not.toMatch(/constituent/i)
    win.unmount()

    testQueryClient.clear()
    mockTheme()
    const serve = renderPage(true)
    await screen.findByRole('heading', { name: 'Bike lanes' })
    expect(serve.container.textContent).not.toMatch(/voter/i)
  })
})
