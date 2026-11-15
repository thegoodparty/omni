import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import { BackfillRepliesAction } from './BackfillRepliesAction'

const { startWinReplyBackfill, showToast } = vi.hoisted(() => ({
  startWinReplyBackfill: vi.fn(),
  showToast: vi.fn(),
}))
vi.mock('@/components/Toast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../actions', () => ({ startWinReplyBackfill }))

beforeEach(() => {
  startWinReplyBackfill.mockReset().mockResolvedValue({ error: null })
  showToast.mockReset()
  render(
    <Theme>
      <BackfillRepliesAction />
    </Theme>
  )
})

describe('BackfillRepliesAction', () => {
  it('starts a dry run at once and says where the results are', async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Dry run' }))

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Dry run started. Results are in the gp-api logs.'
      )
    )
    expect(startWinReplyBackfill).toHaveBeenCalledWith(true)
  })

  it('asks before running, and runs only on confirm', async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Run backfill' }))
    expect(startWinReplyBackfill).not.toHaveBeenCalled()

    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Run backfill',
      })
    )

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Backfill started. Results are in the gp-api logs.'
      )
    )
    expect(startWinReplyBackfill).toHaveBeenCalledWith(false)
  })

  it('keeps the dialog open and shows the refusal', async () => {
    startWinReplyBackfill.mockResolvedValue({ error: 'Only admins can decide' })
    await userEvent.click(screen.getByRole('button', { name: 'Run backfill' }))
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Run backfill',
      })
    )

    await waitFor(() =>
      expect(
        within(screen.getByRole('alertdialog')).getByRole('alert').textContent
      ).toContain('Only admins')
    )
    expect(showToast).not.toHaveBeenCalled()
  })
})
