import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { trackEvent } from 'helpers/analyticsHelper'
import { SmsTestSendForm } from './SmsTestSendForm'

const userRef = vi.hoisted(() => ({ phone: '5551234567' as string | null }))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ phone: userRef.phone }, vi.fn(), false],
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

beforeEach(() => {
  userRef.phone = '5551234567'
  vi.mocked(trackEvent).mockClear()
})

describe('SmsTestSendForm', () => {
  it("prefills the first number from the candidate's phone", () => {
    render(<SmsTestSendForm outreachId={7} surface="drawer" />)
    expect(screen.getByLabelText('Phone number 1')).toHaveValue('5551234567')
  })

  it('starts empty when the candidate has no phone', () => {
    userRef.phone = null
    render(<SmsTestSendForm outreachId={7} surface="drawer" />)
    expect(screen.getByLabelText('Phone number 1')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Send a test' })).toBeDisabled()
  })

  it('disables Add a number at five numbers', async () => {
    const user = userEvent.setup()
    render(<SmsTestSendForm outreachId={7} surface="drawer" />)
    const add = screen.getByRole('button', { name: 'Add a number' })
    for (let i = 0; i < 4; i++) await user.click(add)
    expect(screen.getAllByLabelText(/Phone number/)).toHaveLength(5)
    expect(add).toBeDisabled()
  })

  it('shows the not-a-cell message on the failing row only and tracks the result', async () => {
    const user = userEvent.setup()
    let sentBody: unknown
    api.mock('POST /v1/outreach/:id/sms/test', ({ body }) => {
      sentBody = body
      return {
        status: 200,
        data: {
          results: [
            { phone: '+15551234567', result: 'sent', message: null },
            {
              phone: '+15559876543',
              result: 'not_cell',
              message: 'Not a cell number',
            },
          ],
        },
      }
    })
    render(<SmsTestSendForm outreachId={7} surface="confirmation" />)
    await user.click(screen.getByRole('button', { name: 'Add a number' }))
    await user.type(screen.getByLabelText('Phone number 2'), '5559876543')
    await user.click(screen.getByRole('button', { name: 'Send a test' }))

    const statuses = await screen.findAllByRole('status')
    expect(statuses).toHaveLength(2)
    expect(statuses[0]).toHaveTextContent('Sent')
    expect(statuses[1]).toHaveTextContent('Not a cell number')
    expect(sentBody).toEqual({ phones: ['+15551234567', '+15559876543'] })
    expect(trackEvent).toHaveBeenCalledWith(
      'Voter Outreach - SMS Test Completed',
      {
        surface: 'confirmation',
        numberCount: 2,
        result: 'mixed',
      },
    )
  })

  it('tells the candidate the text is still getting ready on a 409', async () => {
    const user = userEvent.setup()
    api.mock('POST /v1/outreach/:id/sms/test', {
      status: 409,
      data: { message: 'still getting ready' },
    })
    render(<SmsTestSendForm outreachId={7} surface="drawer" />)
    await user.click(screen.getByRole('button', { name: 'Send a test' }))
    expect(await screen.findByText(/still getting ready/)).toBeInTheDocument()
    expect(screen.getByLabelText('Phone number 1')).toBeDisabled()
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('keeps the field disabled until the job exists', () => {
    render(
      <SmsTestSendForm outreachId={7} surface="confirmation" ready={false} />,
    )
    expect(screen.getByLabelText('Phone number 1')).toBeDisabled()
  })
})
