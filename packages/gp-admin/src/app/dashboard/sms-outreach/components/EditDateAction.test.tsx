import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import { EditDateAction } from './EditDateAction'

const { refresh, editSmsDate, showToast } = vi.hoisted(() => ({
  refresh: vi.fn(),
  editSmsDate: vi.fn(),
  showToast: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/components/Toast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../actions', () => ({ editSmsDate }))

// A day well ahead, so the future-date check never trips on the runner clock.
const NEW_DAY = '2099-11-03'

const renderAction = () =>
  render(
    <Theme>
      <EditDateAction
        id={90487}
        sendAt="2026-11-20T15:00:00.000Z"
        scheduledLocalDate="2026-11-20"
        scheduledLocalTime="10:00"
      />
    </Theme>
  )

const dialog = () => within(screen.getByRole('dialog'))
const button = (name: string) =>
  dialog().getByRole('button', { name }) as HTMLButtonElement

const openAndSave = async () => {
  renderAction()
  await userEvent.click(screen.getByRole('button', { name: 'Edit date' }))
  const dateInput = screen
    .getByRole('dialog')
    .querySelector('input[type="date"]')
  if (!dateInput) throw new Error('no date input')
  await userEvent.clear(dateInput)
  await userEvent.type(dateInput, NEW_DAY)
  await userEvent.click(button('Save date'))
}

describe('EditDateAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows gp-api's refusal inside the open dialog", async () => {
    editSmsDate.mockResolvedValue({
      error: 'This campaign is already sending and cannot be rescheduled',
    })

    await openAndSave()

    await waitFor(() =>
      expect(dialog().getByRole('alert').textContent).toContain(
        'already sending and cannot be rescheduled'
      )
    )
    expect(editSmsDate).toHaveBeenCalledWith(90487, expect.any(String), NEW_DAY)
    expect(showToast).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('confirms with a toast and refreshes on success', async () => {
    editSmsDate.mockResolvedValue({ error: null })

    await openAndSave()

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Send date updated — the vendor window moved with it'
      )
    )
    expect(refresh).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
