import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import userEvent from '@testing-library/user-event'
import { api } from 'helpers/test-utils/api-mocking'
import ReviewVerdictControls, {
  FAIL_REASON_TEMPLATE,
} from './ReviewVerdictControls'

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

  it('links to the scoring guidelines above the fail text box', async () => {
    render(<ReviewVerdictControls meetingDate="2026-06-10" reviewsCount={0} />)

    expect(
      screen.queryByRole('link', { name: /scoring guidelines/i }),
    ).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /fail/i }))

    expect(
      screen.getByRole('link', { name: /scoring guidelines/i }),
    ).toHaveAttribute(
      'href',
      'https://goodparty.clickup.com/90132012119/v/dc/2ky4jq2q-109293/2ky4jq2q-90393',
    )
  })

  it('prefills the fail reason with the scoring template', async () => {
    render(<ReviewVerdictControls meetingDate="2026-06-10" reviewsCount={0} />)

    await userEvent.click(screen.getByRole('button', { name: /fail/i }))

    expect(
      screen.getByPlaceholderText(/why is this briefing failing/i),
    ).toHaveValue(FAIL_REASON_TEMPLATE)
  })

  it('blocks a fail with no comments only when the reason is emptied', async () => {
    render(<ReviewVerdictControls meetingDate="2026-06-10" reviewsCount={0} />)

    await userEvent.click(screen.getByRole('button', { name: /fail/i }))

    // Template is prefilled, so the verdict is submittable out of the box.
    expect(screen.getByRole('button', { name: /confirm fail/i })).toBeEnabled()

    await userEvent.clear(
      screen.getByPlaceholderText(/why is this briefing failing/i),
    )
    expect(screen.getByRole('button', { name: /confirm fail/i })).toBeDisabled()
  })

  it('sends the trimmed reason in the PUT body on fail', async () => {
    const bodies: Array<Record<string, unknown>> = []
    api.mock('PUT /v1/meetings/:date/briefing/review-verdict', (req) => {
      bodies.push(req.body)
      return { status: 200, data: { ...verdictResponse, verdict: 'failed' } }
    })
    render(<ReviewVerdictControls meetingDate="2026-06-10" reviewsCount={0} />)

    await userEvent.click(screen.getByRole('button', { name: /fail/i }))
    const textarea = screen.getByPlaceholderText(
      /why is this briefing failing/i,
    )
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Tone is too casual')
    await userEvent.click(screen.getByRole('button', { name: /confirm fail/i }))

    await waitFor(() => expect(stopImpersonating).toHaveBeenCalled())
    expect(bodies).toEqual([
      { verdict: 'failed', failReason: 'Tone is too casual' },
    ])
  })

  it('omits failReason from the PUT body on pass', async () => {
    const bodies: Array<Record<string, unknown>> = []
    api.mock('PUT /v1/meetings/:date/briefing/review-verdict', (req) => {
      bodies.push(req.body)
      return { status: 200, data: verdictResponse }
    })
    render(<ReviewVerdictControls meetingDate="2026-06-10" reviewsCount={0} />)

    await userEvent.click(screen.getByRole('button', { name: /pass/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm pass/i }))

    await waitFor(() => expect(stopImpersonating).toHaveBeenCalled())
    expect(bodies).toEqual([{ verdict: 'passed' }])
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

  it('omits failReason on a bare fail when review comments exist', async () => {
    const bodies: Array<Record<string, unknown>> = []
    api.mock('PUT /v1/meetings/:date/briefing/review-verdict', (req) => {
      bodies.push(req.body)
      return { status: 200, data: { ...verdictResponse, verdict: 'failed' } }
    })
    render(<ReviewVerdictControls meetingDate="2026-06-10" reviewsCount={2} />)

    await userEvent.click(screen.getByRole('button', { name: /fail/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm fail/i }))

    await waitFor(() => expect(stopImpersonating).toHaveBeenCalled())
    expect(bodies).toEqual([{ verdict: 'failed' }])
  })

  it('sends the template as failReason on a bare fail with no comments', async () => {
    const bodies: Array<Record<string, unknown>> = []
    api.mock('PUT /v1/meetings/:date/briefing/review-verdict', (req) => {
      bodies.push(req.body)
      return { status: 200, data: { ...verdictResponse, verdict: 'failed' } }
    })
    render(<ReviewVerdictControls meetingDate="2026-06-10" reviewsCount={0} />)

    await userEvent.click(screen.getByRole('button', { name: /fail/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm fail/i }))

    await waitFor(() => expect(stopImpersonating).toHaveBeenCalled())
    expect(bodies).toEqual([
      { verdict: 'failed', failReason: FAIL_REASON_TEMPLATE.trim() },
    ])
  })

  it('resets the fail reason to the template when cancelled', async () => {
    render(<ReviewVerdictControls meetingDate="2026-06-10" reviewsCount={0} />)

    await userEvent.click(screen.getByRole('button', { name: /fail/i }))
    await userEvent.type(
      screen.getByPlaceholderText(/why is this briefing failing/i),
      ' extra notes',
    )
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

    await userEvent.click(screen.getByRole('button', { name: /fail/i }))

    expect(
      screen.getByPlaceholderText(/why is this briefing failing/i),
    ).toHaveValue(FAIL_REASON_TEMPLATE)
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
