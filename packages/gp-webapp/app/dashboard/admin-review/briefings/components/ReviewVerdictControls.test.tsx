import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import userEvent from '@testing-library/user-event'
import { api } from 'helpers/test-utils/api-mocking'
import ReviewVerdictControls from './ReviewVerdictControls'

const stopImpersonating = vi.fn()
vi.mock('@shared/user/stopImpersonating', () => ({
  stopImpersonatingAndReturnToAdmin: (...args: unknown[]) =>
    stopImpersonating(...args),
}))
vi.mock('@clerk/nextjs', () => ({
  useClerk: () => ({ signOut: vi.fn() }),
}))

const verdictResponse = {
  verdict: 'passed',
  failReason: null,
  reviewerEmail: 'rev@goodparty.org',
  reviewedAt: '2026-06-10T00:00:00.000Z',
} as const

describe('ReviewVerdictControls', () => {
  beforeEach(() => {
    stopImpersonating.mockClear()
  })

  it('passes the briefing then exits impersonation', async () => {
    api.mock('PUT /v1/meetings/:date/briefing/review-verdict', {
      status: 200,
      data: verdictResponse,
    })
    render(<ReviewVerdictControls meetingDate="2026-06-10" reviewsCount={0} />)

    await userEvent.click(screen.getByRole('button', { name: /pass/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm pass/i }))

    await waitFor(() => expect(stopImpersonating).toHaveBeenCalled())
  })

  it('requires a fail reason when there are no review comments', async () => {
    render(<ReviewVerdictControls meetingDate="2026-06-10" reviewsCount={0} />)

    await userEvent.click(screen.getByRole('button', { name: /fail/i }))

    expect(screen.getByRole('button', { name: /confirm fail/i })).toBeDisabled()

    await userEvent.type(
      screen.getByPlaceholderText(/why is this briefing failing/i),
      'Summary is wrong',
    )
    expect(screen.getByRole('button', { name: /confirm fail/i })).toBeEnabled()
  })

  it('allows a bare fail when review comments exist', async () => {
    api.mock('PUT /v1/meetings/:date/briefing/review-verdict', {
      status: 200,
      data: { ...verdictResponse, verdict: 'failed' },
    })
    render(<ReviewVerdictControls meetingDate="2026-06-10" reviewsCount={2} />)

    await userEvent.click(screen.getByRole('button', { name: /fail/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm fail/i }))

    await waitFor(() => expect(stopImpersonating).toHaveBeenCalled())
  })

  it('stays in the session when the request fails', async () => {
    api.mock('PUT /v1/meetings/:date/briefing/review-verdict', {
      status: 500,
      data: { message: 'boom' },
    })
    render(<ReviewVerdictControls meetingDate="2026-06-10" reviewsCount={0} />)

    await userEvent.click(screen.getByRole('button', { name: /pass/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm pass/i }))

    await waitFor(() =>
      expect(screen.getByText(/could not save/i)).toBeInTheDocument(),
    )
    expect(stopImpersonating).not.toHaveBeenCalled()
  })
})
