import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import type { FeedbackThemeDetail } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import ThemeDetailPage from './ThemeDetailPage'

vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
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
      personId: 'person-1',
      occurredAt: new Date('2026-09-25T18:00:00.000Z'),
      channel: 'door_knock',
      transcript: 'He thinks the new bike lanes slow down deliveries.',
      stance: 'opposes',
      desiredOutcome: 'Move the loading zone',
      actorName: 'Kamal Al Sawafi',
    },
    {
      feedbackId: 'memo-2',
      personId: 'person-2',
      occurredAt: new Date('2026-09-24T18:00:00.000Z'),
      channel: 'phone_bank',
      transcript: 'She feels safer walking her kids to school.',
      stance: 'supports',
      desiredOutcome: null,
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
    ).toEqual(['Move the loading zone', 'Keep the lanes'])
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

  it('leads back to the effort’s report', async () => {
    mockTheme()
    renderPage()

    expect(
      await screen.findByRole('link', { name: 'Back to what we heard' }),
    ).toHaveAttribute('href', `/dashboard/issue-capture/${OUTREACH_ID}`)
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
