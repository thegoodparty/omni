import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import { deleteJobDeadLetters, redriveJobDeadLetters } from '../actions'
import { JobDeadLetterSelectionBar } from './JobDeadLetterSelectionBar'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}))
const showToast = vi.fn()
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast }),
}))
vi.mock('../actions', () => ({
  redriveJobDeadLetters: vi.fn(),
  deleteJobDeadLetters: vi.fn(),
}))

const board = [
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000000',
    sourceQueue: 'contactUploadProcess',
    createdAt: new Date('2026-06-01T12:00:00.000Z'),
    retriesUsed: 2,
    data: {},
    error: null,
  },
  {
    id: 'bbbbbbbb-0000-4000-8000-000000000000',
    sourceQueue: null,
    createdAt: new Date('2026-06-01T12:00:00.000Z'),
    retriesUsed: 2,
    data: {},
    error: null,
  },
]

const renderBar = (onDone = vi.fn()) =>
  render(
    <Theme>
      <JobDeadLetterSelectionBar selected={board} onDone={onDone} />
    </Theme>
  )

describe('JobDeadLetterSelectionBar', () => {
  it('warns that a dead letter with no source queue stays put', async () => {
    renderBar()

    await userEvent.click(screen.getByRole('button', { name: /re-drive 2/i }))

    expect(
      await screen.findByText(/one selected dead letter records no source/i)
    ).toBeInTheDocument()
  })

  it('re-drives the selection and reports how many moved', async () => {
    vi.mocked(redriveJobDeadLetters).mockResolvedValue({
      redriven: [board[0]!.id],
      failed: [{ id: board[1]!.id, message: 'records no source queue' }],
    })
    const onDone = vi.fn()
    renderBar(onDone)

    await userEvent.click(screen.getByRole('button', { name: /re-drive 2/i }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Re-drive' })
    )

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(vi.mocked(redriveJobDeadLetters)).toHaveBeenCalledWith([
      board[0]!.id,
      board[1]!.id,
    ])
    expect(showToast).toHaveBeenCalledWith(
      'Re-drove 1 of 2. 1 left in place.',
      'error'
    )
  })

  it('deletes the selection without a redrive warning', async () => {
    vi.mocked(deleteJobDeadLetters).mockResolvedValue({
      deleted: board.map((entry) => entry.id),
      failed: [],
    })
    const onDone = vi.fn()
    renderBar(onDone)

    await userEvent.click(screen.getByRole('button', { name: /delete 2/i }))
    expect(
      screen.queryByText(/records no source queue/i)
    ).not.toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(showToast).toHaveBeenCalledWith('Deleted 2 of 2')
  })

  it('shows a whole-request failure in the dialog rather than closing', async () => {
    vi.mocked(deleteJobDeadLetters).mockResolvedValue({
      error: 'gp-api is unreachable',
    })
    const onDone = vi.fn()
    renderBar(onDone)

    await userEvent.click(screen.getByRole('button', { name: /delete 2/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('gp-api is unreachable')).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })
})
