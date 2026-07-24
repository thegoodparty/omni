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
  it('adds an inline "Priority" row (title + description + record + Improve) instead of a modal', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    // Empty state: just the dashed Add button, no priority card yet.
    expect(screen.queryByText('Priority 1')).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /add a policy priority/i }),
    )

    expect(screen.getByText('Priority 1')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/reliable transit/i)).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText(/northside bus route/i),
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
      screen.getByPlaceholderText<HTMLTextAreaElement>(/northside bus route/i)
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

    expect(screen.getAllByPlaceholderText(/reliable transit/i)).toHaveLength(2)

    const [firstRemove] = screen.getAllByRole('button', {
      name: /remove policy priority/i,
    })
    await user.click(firstRemove!)

    await waitFor(() =>
      expect(screen.getAllByPlaceholderText(/reliable transit/i)).toHaveLength(
        1,
      ),
    )
  })

  it('does not bleed rewrite/undo state onto the row that shifts up after a remove', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/campaigns/mine/story/rewrite', async () => ({
      status: 200,
      data: { rewrite: 'Sharper priority one.' },
    }))
    render(
      <Harness
        initial={[
          { title: 'First', description: 'first desc' },
          { title: 'Second', description: 'second desc' },
        ]}
      />,
    )

    // Improve the first priority — it gains an Undo.
    await user.click(
      screen.getAllByRole('button', { name: /Improve with AI/ })[0]!,
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Undo/ })).toBeInTheDocument(),
    )

    // Remove the first priority. The second shifts into its slot.
    await user.click(
      screen.getAllByRole('button', { name: /remove policy priority/i })[0]!,
    )

    // The surviving row keeps its own (undo-free) state + description — the
    // removed row's hook state must not carry over via a reused key.
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(2)) // one title + one description
    expect(
      screen.queryByRole('button', { name: /Undo/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByPlaceholderText<HTMLTextAreaElement>(/northside bus route/i)
        .value,
    ).toBe('second desc')
  })
})
