import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import type { PendingFeedback } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useServeIssueCaptureFlag } from 'app/shared/experiments/serveIssueCaptureFlag'
import { useWinIssueCaptureFlag } from 'app/shared/experiments/winIssueCaptureFlag'
import { NotesToReviewLink } from './NotesToReviewLink'

vi.mock('app/shared/experiments/serveIssueCaptureFlag', () => ({
  useServeIssueCaptureFlag: vi.fn(),
}))

vi.mock('app/shared/experiments/winIssueCaptureFlag', () => ({
  useWinIssueCaptureFlag: vi.fn(),
}))

const OUTREACH_ID = 30

const memo = (id: string): PendingFeedback => ({
  id,
  personId: 'person-1',
  occurredAt: new Date('2026-10-01T00:00:00Z'),
  channel: 'door_knock',
  transcript: null,
  issueLabel: null,
  stance: null,
  desiredOutcome: null,
  extractionStatus: 'pending',
  confirmedAt: null,
  outreachId: OUTREACH_ID,
  actorName: null,
  tags: [],
  clientKey: id,
  reference: null,
})

let reads = 0

const mockPending = (feedback: PendingFeedback[]) =>
  api.mock('GET /v1/constituent-feedback/pending', () => {
    reads += 1
    return { status: 200, data: { feedback } }
  })

const setFlags = ({ serve, win }: { serve: boolean; win: boolean }) => {
  vi.mocked(useServeIssueCaptureFlag).mockReturnValue({
    ready: true,
    enabled: serve,
  })
  vi.mocked(useWinIssueCaptureFlag).mockReturnValue({
    ready: true,
    enabled: win,
  })
}

beforeEach(() => {
  testQueryClient.clear()
  reads = 0
  setFlags({ serve: false, win: true })
})

describe('NotesToReviewLink', () => {
  it('counts the notes waiting and links to them', async () => {
    mockPending([memo('a'), memo('b')])
    render(<NotesToReviewLink outreachId={OUTREACH_ID} isServe={false} />)

    const link = await screen.findByRole('link', { name: /Notes to review: 2/ })
    expect(link).toHaveAttribute(
      'href',
      `/dashboard/issue-capture/${OUTREACH_ID}/review`,
    )
  })

  it('shows nothing when nothing is waiting', async () => {
    mockPending([])
    const { container } = render(
      <NotesToReviewLink outreachId={OUTREACH_ID} isServe={false} />,
    )

    await waitFor(() => expect(reads).toBe(1))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing, and asks for nothing, without the product’s flag', async () => {
    mockPending([memo('a')])
    const { container } = render(
      <NotesToReviewLink outreachId={OUTREACH_ID} isServe />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(reads).toBe(0)
  })
})
