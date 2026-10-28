import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import { EmailPayStep } from './EmailPayStep'
import { WIN_EMAIL_SURFACE } from './emailSurface'

const { confirmSetupMock } = vi.hoisted(() => ({ confirmSetupMock: vi.fn() }))

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmSetup: confirmSetupMock }),
  useElements: () => ({}),
}))

const send = {
  id: 11,
  status: 'draft',
  goal: 'Hello',
  layout: 'newsletter',
  theme: 'classic_blue',
  subject: 'Hello',
  headline: null,
  body: 'Hi',
  imageUrl: null,
  buttonLabel: null,
  buttonUrl: null,
  paidForBy: null,
  date: null,
  consentConfirmedAt: null,
  recipientCount: 4800,
  recipientCap: null,
  sentCount: 0,
  pauseReason: null,
  stopping: false,
  estimate: { warmingCap: 1000, recipientCap: 1000, priceCents: 1000 },
}

beforeEach(() => {
  confirmSetupMock
    .mockReset()
    .mockResolvedValue({ setupIntent: { payment_method: 'pm_new' } })
  api.mock('GET /v1/outreach/email/:id', { status: 200, data: send })
  api.mock('POST /v1/outreach/holds/card-intent', {
    status: 200,
    data: { clientSecret: 'seti_secret_1' },
  })
})

describe('EmailPayStep', () => {
  it('confirms the send with the saved card and reports it paid', async () => {
    const bodies: unknown[] = []
    api.mock('POST /v1/outreach/email/:id/confirm', ({ body }) => {
      bodies.push(body)
      return {
        status: 200,
        data: {
          outcome: 'held',
          declineCode: null,
          email: { ...send, status: 'pending', estimate: null },
        },
      }
    })
    const onPaid = vi.fn()
    render(
      <EmailPayStep surface={WIN_EMAIL_SURFACE} draftId={11} onPaid={onPaid} />,
    )

    expect(await screen.findByTestId('email-pay-price')).toHaveTextContent(
      'Up to $10.00',
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Pay and send' }),
    )

    await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1))
    expect(bodies).toEqual([{ paymentMethodId: 'pm_new' }])
  })

  it('keeps the card form up after a decline', async () => {
    api.mock('POST /v1/outreach/email/:id/confirm', {
      status: 200,
      data: {
        outcome: 'declined',
        declineCode: 'expired_card',
        email: { ...send, status: 'pending_payment', estimate: null },
      },
    })
    const onPaid = vi.fn()
    render(
      <EmailPayStep surface={WIN_EMAIL_SURFACE} draftId={11} onPaid={onPaid} />,
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'Pay and send' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That card has expired. Try another.',
    )
    expect(onPaid).not.toHaveBeenCalled()
  })
})
