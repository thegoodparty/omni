import { describe, it, expect, vi, beforeEach } from 'vitest'

const LATENCY_MS = 50

const { mockServeAccess, mockGetPoll, mockGetPollTopIssues, mockRedirect } =
  vi.hoisted(() => ({
    mockServeAccess: vi.fn(),
    mockGetPoll: vi.fn(),
    mockGetPollTopIssues: vi.fn(),
    mockRedirect: vi.fn(),
  }))

vi.mock('../../shared/serveAccess', () => ({
  default: () => mockServeAccess(),
}))
vi.mock('../shared/serverApiCalls', () => ({
  getPoll: (id: string) => mockGetPoll(id),
  getPollTopIssues: (id: string) => mockGetPollTopIssues(id),
}))
vi.mock('../shared/hooks/PollProvider', () => ({
  PollProvider: () => null,
}))
vi.mock('../shared/hooks/IssuesProvider', () => ({
  IssuesProvider: () => null,
}))
vi.mock('./components/PollsDetailPage', () => ({
  default: () => null,
}))
vi.mock('helpers/metadataHelper', () => ({
  default: () => ({}),
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}))

import Page from './page'

class RedirectError extends Error {
  constructor(public url: string) {
    super(`redirect:${url}`)
    this.name = 'RedirectError'
  }
}

const POLL_ID = 'poll-123'
const params = Promise.resolve({ id: POLL_ID })
const runPage = () => Page({ params: Promise.resolve({ id: POLL_ID }) })

const delay = <T>(value: T, ms = LATENCY_MS): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms))

// Mirrors the ORIGINAL serial ordering to benchmark against the same latencies.
async function serialBaseline(): Promise<void> {
  await mockServeAccess()
  const { id } = await params
  const poll = await mockGetPoll(id)
  if (!poll) {
    mockRedirect('/dashboard/polls')
    return
  }
  await mockGetPollTopIssues(id)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockServeAccess.mockResolvedValue(undefined)
  mockRedirect.mockImplementation((url: string) => {
    throw new RedirectError(url)
  })
})

describe('polls/[id] Page behavior', () => {
  it('redirects to /dashboard/polls when the poll is missing', async () => {
    mockGetPoll.mockResolvedValue(undefined)
    mockGetPollTopIssues.mockResolvedValue({ results: [] })

    await expect(runPage()).rejects.toMatchObject({
      name: 'RedirectError',
      url: '/dashboard/polls',
    })
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard/polls')
  })

  it('still redirects for a missing poll even when top-issues rejects', async () => {
    // Parallelizing means top-issues is now in flight for a missing poll; its
    // rejection must NOT mask the redirect (the original never called it here).
    mockGetPoll.mockResolvedValue(undefined)
    mockGetPollTopIssues.mockRejectedValue(new Error('top-issues 404'))

    await expect(runPage()).rejects.toMatchObject({
      name: 'RedirectError',
      url: '/dashboard/polls',
    })
  })

  it('renders when the poll exists, wiring through the fetched issues', async () => {
    mockGetPoll.mockResolvedValue({ id: POLL_ID, name: 'Poll' })
    mockGetPollTopIssues.mockResolvedValue({ results: [{ id: 'i1' }] })

    await expect(runPage()).resolves.toBeDefined()
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(mockGetPoll).toHaveBeenCalledWith(POLL_ID)
    expect(mockGetPollTopIssues).toHaveBeenCalledWith(POLL_ID)
  })

  it('propagates a top-issues failure when the poll exists (behavior preserved)', async () => {
    mockGetPoll.mockResolvedValue({ id: POLL_ID, name: 'Poll' })
    mockGetPollTopIssues.mockRejectedValue(new Error('top-issues 500'))

    await expect(runPage()).rejects.toThrow('top-issues 500')
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('fetches poll and top-issues concurrently', async () => {
    let topIssuesStartedWhilePollPending = false
    let pollResolved = false
    mockGetPoll.mockImplementation(() =>
      delay({ id: POLL_ID }).then((v) => {
        pollResolved = true
        return v
      }),
    )
    mockGetPollTopIssues.mockImplementation(() => {
      topIssuesStartedWhilePollPending = !pollResolved
      return delay({ results: [] })
    })

    await runPage()
    expect(topIssuesStartedWhilePollPending).toBe(true)
  })
})

describe('polls/[id] Page benchmark', () => {
  it('parallelized page is measurably faster than the serial baseline', async () => {
    mockGetPoll.mockImplementation(() => delay({ id: POLL_ID }))
    mockGetPollTopIssues.mockImplementation(() => delay({ results: [] }))

    const beforeStart = performance.now()
    await serialBaseline()
    const beforeMs = performance.now() - beforeStart

    const afterStart = performance.now()
    await runPage()
    const afterMs = performance.now() - afterStart

    // eslint-disable-next-line no-console
    console.log(
      `[bench polls/[id]] before=${beforeMs.toFixed(1)}ms after=${afterMs.toFixed(1)}ms (latency ${LATENCY_MS}ms/call)`,
    )

    // BEFORE ~= getPoll + topIssues serial (~2L); AFTER ~= max(getPoll, topIssues) (~1L)
    expect(beforeMs).toBeGreaterThan(LATENCY_MS * 1.7)
    expect(afterMs).toBeLessThan(beforeMs)
    expect(beforeMs - afterMs).toBeGreaterThan(LATENCY_MS * 0.5)
  })
})
