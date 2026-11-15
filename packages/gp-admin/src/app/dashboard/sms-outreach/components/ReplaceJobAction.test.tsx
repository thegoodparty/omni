import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import { ReplaceJobAction } from './ReplaceJobAction'

const { refresh, replaceSmsJob, linkSmsJob, showToast } = vi.hoisted(() => ({
  refresh: vi.fn(),
  replaceSmsJob: vi.fn(),
  linkSmsJob: vi.fn(),
  showToast: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/components/Toast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../actions', () => ({ replaceSmsJob, linkSmsJob }))

// A day well ahead, so the future-date check never trips on the runner clock.
const NEW_DAY = '2099-11-03'
const CURRENT_JOB = 'hlBP0duZEHzbFLsPwO0m'

const renderAction = (
  overrides: Partial<{ alreadySent: boolean; canvassersBooked: boolean }> = {}
) =>
  render(
    <Theme>
      <ReplaceJobAction
        id={87883}
        jobId={CURRENT_JOB}
        sendAt="2026-10-30T15:00:00.000Z"
        scheduledLocalTime="10:00"
        alreadySent={false}
        canvassersBooked
        {...overrides}
      />
    </Theme>
  )

const dialog = () => within(screen.getByRole('alertdialog'))
const button = (name: string) =>
  dialog().getByRole('button', { name }) as HTMLButtonElement

const openDialog = () =>
  userEvent.click(screen.getByRole('button', { name: 'Replace Peerly job' }))

const pickDay = async () => {
  const dateInput = screen
    .getByRole('alertdialog')
    .querySelector('input[type="date"]')
  if (!dateInput) throw new Error('no date input')
  await userEvent.type(dateInput, NEW_DAY)
}

const pickReason = (label: string) =>
  userEvent.click(dialog().getByRole('radio', { name: label }))

const switchToLink = () =>
  userEvent.click(
    dialog().getByRole('radio', { name: 'Link a job from Peerly' })
  )

describe('ReplaceJobAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('needs a day and a reason before it can be reviewed', async () => {
    renderAction()
    await openDialog()
    expect(button('Review').disabled).toBe(true)

    await pickDay()
    expect(button('Review').disabled).toBe(true)

    await pickReason('Peerly flagged the sending number')
    expect(button('Review').disabled).toBe(false)
  })

  it('needs words when the reason is Other', async () => {
    renderAction()
    await openDialog()
    await pickDay()
    await pickReason('Other')
    expect(button('Review').disabled).toBe(true)

    await userEvent.type(
      dialog().getByLabelText('Other reason'),
      'Candidate moved the day'
    )
    expect(button('Review').disabled).toBe(false)
  })

  it('restates what will happen before replacing, then replaces', async () => {
    replaceSmsJob.mockResolvedValue({ error: null })
    renderAction()
    await openDialog()
    await pickDay()
    await pickReason('Peerly flagged the sending number')
    await userEvent.click(button('Review'))

    expect(
      dialog().getByText(
        `Cancels Peerly job ${CURRENT_JOB} and its canvasser booking.`
      )
    ).toBeTruthy()
    expect(dialog().getByText(/same message, image and list/)).toBeTruthy()
    expect(dialog().getByText(/goes back to awaiting review/)).toBeTruthy()
    expect(
      dialog().getByText('The candidate is not charged again.')
    ).toBeTruthy()
    expect(replaceSmsJob).not.toHaveBeenCalled()

    await userEvent.click(button('Replace job'))

    await waitFor(() => expect(replaceSmsJob).toHaveBeenCalled())
    // 15:00Z on 2026-10-30 is 11:00 ET (EDT); 11:00 ET on 2099-11-03 is EST.
    expect(replaceSmsJob).toHaveBeenCalledWith(87883, {
      currentJobId: CURRENT_JOB,
      reason: 'bad_sending_number',
      sendAt: '2099-11-03T16:00:00.000Z',
      scheduledLocalDate: NEW_DAY,
    })
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Job replaced. Approve it to book canvassers on the new job.'
      )
    )
    expect(refresh).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('goes back to change the choice without sending anything', async () => {
    renderAction()
    await openDialog()
    await pickDay()
    await pickReason('Peerly delivery failure')
    await userEvent.click(button('Review'))
    await userEvent.click(button('Back'))

    expect(button('Review')).toBeTruthy()
    expect(replaceSmsJob).not.toHaveBeenCalled()
  })

  it('offers only Link once the send has gone out', async () => {
    renderAction({ alreadySent: true })
    await openDialog()

    expect(dialog().getByText(/already went out/)).toBeTruthy()
    expect(dialog().queryByRole('radio', { name: 'Replace job' })).toBeNull()
    expect(dialog().getByText('Peerly job id')).toBeTruthy()
  })

  it('links a job made in Peerly, keeping the current one as it is', async () => {
    linkSmsJob.mockResolvedValue({ error: null })
    renderAction({ alreadySent: true })
    await openDialog()
    await userEvent.type(dialog().getByLabelText('Peerly job id'), ' abc123 ')
    await pickReason('Other')
    await userEvent.type(dialog().getByLabelText('Other reason'), 'Bad number')
    await userEvent.click(button('Review'))

    expect(
      dialog().getByText(
        new RegExp(`Leaves Peerly job ${CURRENT_JOB} as it is`)
      )
    ).toBeTruthy()
    expect(dialog().getByText(/Follows Peerly job abc123 instead/)).toBeTruthy()

    await userEvent.click(button('Link job'))

    await waitFor(() =>
      expect(linkSmsJob).toHaveBeenCalledWith(87883, {
        currentJobId: CURRENT_JOB,
        jobId: 'abc123',
        reason: 'other',
        otherReason: 'Bad number',
      })
    )
    expect(replaceSmsJob).not.toHaveBeenCalled()
  })

  it("shows gp-api's refusal on the confirm step", async () => {
    replaceSmsJob.mockResolvedValue({
      error: 'This campaign is already sending, so its job cannot be canceled',
    })
    renderAction()
    await openDialog()
    await pickDay()
    await pickReason('Message or schedule change')
    await userEvent.click(button('Review'))
    await userEvent.click(button('Replace job'))

    await waitFor(() =>
      expect(dialog().getByRole('alert').textContent).toContain(
        'already sending'
      )
    )
    expect(showToast).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('switches to linking from the picker', async () => {
    renderAction()
    await openDialog()
    await switchToLink()

    expect(dialog().getByText('Peerly job id')).toBeTruthy()
  })
})
