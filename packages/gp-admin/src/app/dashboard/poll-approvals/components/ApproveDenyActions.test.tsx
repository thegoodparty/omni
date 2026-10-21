import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import { ApproveDenyActions } from './ApproveDenyActions'

const { refresh, approvePoll } = vi.hoisted(() => ({
  refresh: vi.fn(),
  approvePoll: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))
vi.mock('../actions', () => ({ approvePoll, denyPoll: vi.fn() }))

const renderActions = (expansionId?: string) =>
  render(
    <Theme>
      <ApproveDenyActions id={7} expansionId={expansionId} />
    </Theme>
  )

describe('ApproveDenyActions', () => {
  it('shows the conflict message inline and refreshes without retrying', async () => {
    approvePoll.mockResolvedValue({
      error: 'This poll is not awaiting review any more',
    })
    renderActions()

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Approve',
      })
    )

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'not awaiting review any more'
      )
    )
    expect(approvePoll).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalled()
  })

  it('offers no deny on an expansion, which has no deny of its own', () => {
    renderActions('exp-1')
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull()
  })
})
