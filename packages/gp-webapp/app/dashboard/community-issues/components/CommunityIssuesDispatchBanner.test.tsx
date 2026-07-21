import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import CommunityIssuesDispatchBanner from './CommunityIssuesDispatchBanner'

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => '/',
}))

const mockList = (status: 'running' | 'completed' | 'failed') =>
  api.mock('GET /v1/community-issues', {
    status: 200,
    data: {
      issues: [],
      refresh: { status, lastCompletedAt: '2026-07-09T14:41:59.323Z' },
    },
  })

const mockDispatch = (dispatched: number) =>
  api.mock('POST /v1/community-issues/dispatch-if-needed', {
    status: 200,
    data: { dispatched, skipped: 0 },
  })

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

beforeEach(() => {
  vi.clearAllMocks()
  mockDispatch(0)
})

describe('<CommunityIssuesDispatchBanner>', () => {
  it('does not repeatedly refresh while a run stays running', async () => {
    mockList('running')

    render(<CommunityIssuesDispatchBanner initiallyRunning />)

    expect(
      await screen.findByText(/refreshing your community issues/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/we'll email you when they're ready/i),
    ).toBeInTheDocument()

    // A running poll response must not trigger router.refresh(): the run is
    // still in flight and we are far below the attempt cap. The bug fired
    // router.refresh() in a tight loop here, producing a request storm.
    await settle()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes exactly once and clears when the run completes', async () => {
    mockList('completed')

    render(<CommunityIssuesDispatchBanner initiallyRunning />)

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        screen.queryByText(/refreshing your community issues/i),
      ).not.toBeInTheDocument(),
    )

    await settle()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shows the banner for a returning user whose landing dispatched a run', async () => {
    // The stale-user catch-up path: initiallyRunning=false, but
    // dispatch-if-needed reports a fresh run was dispatched. That alone must
    // flip polling on and surface the banner (guards against a `dispatched >= 0`
    // regression that would show the banner on every page load).
    mockDispatch(1)
    mockList('running')

    render(<CommunityIssuesDispatchBanner initiallyRunning={false} />)

    expect(
      await screen.findByText(/refreshing your community issues/i),
    ).toBeInTheDocument()

    await settle()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes once when a returning user’s dispatched run completes', async () => {
    mockDispatch(1)
    mockList('completed')

    render(<CommunityIssuesDispatchBanner initiallyRunning={false} />)

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  })

  it('renders nothing and never refreshes when idle', async () => {
    mockList('completed')

    const { container } = render(
      <CommunityIssuesDispatchBanner initiallyRunning={false} />,
    )

    await settle()
    expect(container).toBeEmptyDOMElement()
    expect(refresh).not.toHaveBeenCalled()
  })
})
