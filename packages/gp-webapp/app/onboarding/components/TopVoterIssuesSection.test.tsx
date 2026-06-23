import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, render as rtlRender } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { TopVoterIssuesSection } from './TopVoterIssuesSection'

const mockReportErrorToSentry = vi.fn()
vi.mock('@shared/sentry', () => ({
  reportErrorToSentry: (...args: unknown[]) => mockReportErrorToSentry(...args),
}))

const issues = [
  { label: 'Public Safety', score: 82, priority: 'high' as const },
  { label: 'Affordable Housing', score: 71, priority: 'high' as const },
  { label: 'Education', score: 64, priority: 'medium' as const },
  { label: 'Healthcare', score: 55, priority: 'medium' as const },
  { label: 'Climate', score: 41, priority: 'low' as const },
]

beforeEach(() => {
  testQueryClient.clear()
  mockReportErrorToSentry.mockReset()
})

describe('TopVoterIssuesSection', () => {
  it('renders skeleton placeholders while the request is pending', () => {
    api.mock(
      'GET /v1/onboarding/voter-issues',
      () => new Promise(() => undefined),
    )

    const { container } = render(
      <TopVoterIssuesSection ballotReadyPositionId="br-1" office="Mayor" />,
    )

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(
      0,
    )
  })

  it('renders nothing when the API returns an empty list', async () => {
    api.mock('GET /v1/onboarding/voter-issues', {
      status: 200,
      data: { issues: [] },
    })

    const { container } = render(
      <TopVoterIssuesSection ballotReadyPositionId="br-1" office="Mayor" />,
    )

    await waitFor(() => {
      expect(container.firstChild).toBeNull()
    })
  })

  it('renders nothing and reports the error when the request fails', async () => {
    api.mock('GET /v1/onboarding/voter-issues', {
      status: 500,
      data: { message: 'boom' },
    })

    const noRetryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { container } = rtlRender(
      <QueryClientProvider client={noRetryClient}>
        <TopVoterIssuesSection ballotReadyPositionId="br-1" office="Mayor" />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(mockReportErrorToSentry).toHaveBeenCalled()
    })
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing and fires no request without an office identifier', () => {
    // Manual-office campaigns have neither a BR position id nor an org
    // position — the org has no resolvable district and the request would
    // be a guaranteed 404.
    const { container } = render(<TopVoterIssuesSection office="Mayor" />)

    expect(container.firstChild).toBeNull()
    expect(mockReportErrorToSentry).not.toHaveBeenCalled()
  })

  it('shows the static district copy and ignores office or location props', async () => {
    api.mock('GET /v1/onboarding/voter-issues', {
      status: 200,
      data: { issues: issues.slice(0, 1) },
    })

    render(
      <TopVoterIssuesSection
        ballotReadyPositionId="br-1"
        office="Mayor of Springfield"
        city="Austin"
        state="TX"
      />,
    )

    expect(
      await screen.findByText(
        /voters in your district care about most right now/i,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Mayor of Springfield/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Austin, TX/)).not.toBeInTheDocument()
  })

  it('renders the default voter wording when no copy overrides are supplied', async () => {
    api.mock('GET /v1/onboarding/voter-issues', {
      status: 200,
      data: { issues: issues.slice(0, 1) },
    })

    render(
      <TopVoterIssuesSection ballotReadyPositionId="br-1" office="Mayor" />,
    )

    expect(
      await screen.findByText('Top issues for your voters'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'The issues voters in your district care about most right now.',
      ),
    ).toBeInTheDocument()
  })

  it('renders custom heading and description when overrides are supplied', async () => {
    // The serve (elected-official) flow addresses constituents, not voters,
    // and pipes constituent copy through these override props. Guards against
    // a regression that drops the prop forwarding and silently reverts to the
    // candidate wording.
    api.mock('GET /v1/onboarding/voter-issues', {
      status: 200,
      data: { issues: issues.slice(0, 1) },
    })

    render(
      <TopVoterIssuesSection
        ballotReadyPositionId="br-1"
        office="Mayor"
        heading="Top issues for your constituents"
        description="The issues constituents in your district care about most right now."
      />,
    )

    expect(
      await screen.findByText('Top issues for your constituents'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'The issues constituents in your district care about most right now.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Top issues for your voters'),
    ).not.toBeInTheDocument()
  })

  it('refetches when ballotReadyPositionId changes (no stale cross-office cache)', async () => {
    api.mockOrdered('GET /v1/onboarding/voter-issues', [
      {
        status: 200,
        data: {
          issues: [
            { label: 'Beverly Hills issue', score: 80, priority: 'high' },
          ],
        },
      },
      {
        status: 200,
        data: {
          issues: [{ label: 'NYC issue', score: 90, priority: 'high' }],
        },
      },
    ])

    const { rerender } = render(
      <TopVoterIssuesSection
        ballotReadyPositionId="bh-123"
        office="Beverly Hills City Council"
      />,
    )

    expect(await screen.findByText('Beverly Hills issue')).toBeInTheDocument()

    rerender(
      <TopVoterIssuesSection
        ballotReadyPositionId="nyc-456"
        office="NYC City Council"
      />,
    )

    expect(await screen.findByText('NYC issue')).toBeInTheDocument()
    expect(screen.queryByText('Beverly Hills issue')).not.toBeInTheDocument()
  })

  it('renders issues as a numbered ranking without score bars or percentages', async () => {
    api.mock('GET /v1/onboarding/voter-issues', {
      status: 200,
      data: { issues },
    })

    render(
      <TopVoterIssuesSection ballotReadyPositionId="br-1" office="Mayor" />,
    )

    expect(await screen.findByText('Public Safety')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.queryByText(/voters care/i)).not.toBeInTheDocument()
  })

  it('collapses to the first three issues and expands on demand', async () => {
    api.mock('GET /v1/onboarding/voter-issues', {
      status: 200,
      data: { issues },
    })

    render(
      <TopVoterIssuesSection ballotReadyPositionId="br-1" office="Mayor" />,
    )

    expect(await screen.findByText('Public Safety')).toBeInTheDocument()
    expect(screen.getByText('Affordable Housing')).toBeInTheDocument()
    expect(screen.getByText('Education')).toBeInTheDocument()
    expect(screen.queryByText('Healthcare')).not.toBeInTheDocument()
    expect(screen.queryByText('Climate')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /view 2 more/i }))

    expect(screen.getByText('Healthcare')).toBeInTheDocument()
    expect(screen.getByText('Climate')).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: /show fewer issues/i }),
    )
    expect(screen.queryByText('Healthcare')).not.toBeInTheDocument()
  })
})
