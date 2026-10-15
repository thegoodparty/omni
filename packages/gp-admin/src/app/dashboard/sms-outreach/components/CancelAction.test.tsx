import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import { CancelAction } from './CancelAction'

const { refresh, cancelSms, showToast } = vi.hoisted(() => ({
  refresh: vi.fn(),
  cancelSms: vi.fn(),
  showToast: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/components/Toast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../actions', () => ({ cancelSms }))

const renderAndConfirm = async () => {
  render(
    <Theme>
      <CancelAction id={85286} paid />
    </Theme>
  )
  await userEvent.click(screen.getByRole('button', { name: 'Cancel campaign' }))
  await userEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Cancel campaign',
    })
  )
}

describe('CancelAction', () => {
  it("shows gp-api's refusal inside the open dialog", async () => {
    cancelSms.mockResolvedValue({
      error:
        'This campaign has reached its send time and can no longer be canceled',
    })

    await renderAndConfirm()

    await waitFor(() =>
      expect(
        within(screen.getByRole('alertdialog')).getByRole('alert').textContent
      ).toContain('can no longer be canceled')
    )
    expect(cancelSms).toHaveBeenCalledWith(85286)
    expect(showToast).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('confirms with a toast and refreshes on success', async () => {
    cancelSms.mockResolvedValue({ error: null })

    await renderAndConfirm()

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Canceled — the vendor job is deleted and the payment refunded'
      )
    )
    expect(refresh).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })
})
