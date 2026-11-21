import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import { RedriveDeadLetterButton } from './RedriveDeadLetterButton'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}))
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))
vi.mock('../actions', () => ({
  redriveJobDeadLetter: vi.fn().mockResolvedValue({ error: null }),
}))

describe('RedriveDeadLetterButton', () => {
  it('returns to the dead letter list after a redrive', async () => {
    render(
      <Theme>
        <RedriveDeadLetterButton
          deadLetter={{ id: 'abc', sourceQueue: 'contactUploadProcess' }}
        />
      </Theme>
    )

    await userEvent.click(screen.getByRole('button', { name: /re-drive/i }))
    const buttons = await screen.findAllByRole('button', { name: /re-drive/i })
    await userEvent.click(buttons[buttons.length - 1])

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/dashboard/job-dead-letters')
    )
  })
})
