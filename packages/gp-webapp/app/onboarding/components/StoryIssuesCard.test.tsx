import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { WebsiteIssue } from 'helpers/types'
import StoryIssuesCard from './StoryIssuesCard'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

beforeEach(() => {
  vi.clearAllMocks()
})

const Harness = ({
  initial = [],
}: {
  initial?: WebsiteIssue[]
}): React.JSX.Element => {
  const [issues, setIssues] = useState<WebsiteIssue[]>(initial)
  return <StoryIssuesCard issues={issues} onChange={setIssues} />
}

describe('StoryIssuesCard', () => {
  it('adds an inline row (title + description + record + Improve) instead of a modal', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    // Empty state: just the Add issue button, no fields yet.
    expect(
      screen.queryByPlaceholderText(/policy title/i),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add issue/i }))

    expect(screen.getByPlaceholderText(/policy title/i)).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText(/describe this policy/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Improve with AI/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /record voice/i }),
    ).toBeInTheDocument()
  })

  it('improves a policy description in place, sending the issue field + title', async () => {
    const user = userEvent.setup()
    let body: { field?: string; title?: string; text?: string } | null = null
    api.mock('POST /v1/campaigns/mine/story/rewrite', async ({ body: b }) => {
      body = b
      return { status: 200, data: { rewrite: 'A sharper policy.' } }
    })

    render(
      <Harness initial={[{ title: 'Schools', description: 'fund them' }]} />,
    )

    await user.click(screen.getByRole('button', { name: /Improve with AI/ }))

    const description =
      screen.getByPlaceholderText<HTMLTextAreaElement>(/describe this policy/i)
    await waitFor(() => expect(description.value).toBe('A sharper policy.'))
    expect(body).toEqual({
      field: 'issue',
      title: 'Schools',
      text: 'fund them',
    })
  })

  it('removes a policy row', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        initial={[
          { title: 'Schools', description: 'fund them' },
          { title: 'Roads', description: 'fix them' },
        ]}
      />,
    )

    expect(screen.getAllByPlaceholderText(/policy title/i)).toHaveLength(2)

    const [firstRemove] = screen.getAllByRole('button', {
      name: /remove policy/i,
    })
    await user.click(firstRemove!)

    await waitFor(() =>
      expect(screen.getAllByPlaceholderText(/policy title/i)).toHaveLength(1),
    )
  })
})
