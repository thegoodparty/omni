import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import { ApproveDenyActions } from './ApproveDenyActions'

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))
vi.mock('../actions', () => ({ approveSms: vi.fn(), denySms: vi.fn() }))

const renderActions = (
  scheduledLocalDate: string | null,
  sendAt: string | null
) =>
  render(
    <Theme>
      <ApproveDenyActions
        id={90487}
        scheduledLocalDate={scheduledLocalDate}
        sendAt={sendAt}
      />
    </Theme>
  )

const approveButton = () =>
  screen.getByRole('button', { name: 'Approve & book send' })

afterEach(() => {
  vi.useRealTimers()
})

describe('ApproveDenyActions', () => {
  it('disables Approve once the stored send day has passed', () => {
    renderActions('2024-03-05', null)

    expect(approveButton()).toBeDisabled()
    expect(
      screen.getByText('Send date passed — set a new date first')
    ).toBeInTheDocument()
  })

  it('keeps Deny live on a passed day so the row is still decidable', () => {
    renderActions('2024-03-05', null)

    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled()
  })

  it('still opens the confirmation from a live Approve', async () => {
    renderActions('2099-01-01', null)

    await userEvent.click(approveButton())

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Approve this campaign?'
    )
  })

  it('leaves Approve live while the send day is still ahead', () => {
    renderActions('2099-01-01', null)

    expect(approveButton()).toBeEnabled()
    expect(screen.queryByText(/send date/i)).not.toBeInTheDocument()
  })

  it('falls back to the stored instant when the row has no send day', () => {
    renderActions(null, '2024-03-05T16:00:00.000Z')

    expect(approveButton()).toBeDisabled()
  })

  it('keeps Approve live when only the instant is stored and it is ahead', () => {
    renderActions(null, '2099-01-01T16:00:00.000Z')

    expect(approveButton()).toBeEnabled()
  })

  it('refuses a row with no send date on record', () => {
    renderActions(null, null)

    expect(approveButton()).toBeDisabled()
    expect(
      screen.getByText('No send date on record — set a date first')
    ).toBeInTheDocument()
  })

  // 01:00 UTC is still the previous evening in Eastern, and gp-api's guard
  // compares the Eastern day, so a send dated that evening is not stale yet.
  it('reads the send day in Eastern, keeping a same-ET-day send approvable', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-11T01:00:00.000Z'))

    renderActions('2026-03-10', null)

    expect(approveButton()).toBeEnabled()
  })

  it('disables Approve for a day before today in Eastern', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-11T01:00:00.000Z'))

    renderActions('2026-03-09', null)

    expect(approveButton()).toBeDisabled()
  })
})
