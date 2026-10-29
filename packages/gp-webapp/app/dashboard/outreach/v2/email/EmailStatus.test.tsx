import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { EmailSend } from '@goodparty_org/contracts'
import { api } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import { EmailStatus, emailStatusCopy } from './EmailStatus'
import { SERVE_EMAIL_SURFACE, WIN_EMAIL_SURFACE } from './emailSurface'

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({
    confirmSetup: vi.fn().mockResolvedValue({
      setupIntent: { payment_method: 'pm_new' },
    }),
  }),
  useElements: () => ({}),
}))

const send = (over: Partial<EmailSend> = {}): EmailSend => ({
  id: 11,
  status: 'pending',
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
  date: '2026-11-03T18:00:00.000Z',
  consentConfirmedAt: null,
  recipientCount: 4800,
  recipientCap: 1000,
  sentCount: 0,
  pauseReason: null,
  stopping: false,
  estimate: null,
  ...over,
})

describe('emailStatusCopy', () => {
  it('shows progress against the frozen cap while sending', () => {
    expect(
      emailStatusCopy(
        send({ status: 'in_progress', sentCount: 400 }),
        WIN_EMAIL_SURFACE,
      )?.title,
    ).toBe('Sending 400 of 1,000.')
  })

  it('says a paused send is paused, and which kinds clear themselves', () => {
    const manual = emailStatusCopy(
      send({ status: 'in_progress', pauseReason: 'bounce_rate' }),
      WIN_EMAIL_SURFACE,
    )
    const account = emailStatusCopy(
      send({ status: 'in_progress', pauseReason: 'daily_quota' }),
      WIN_EMAIL_SURFACE,
    )
    expect(manual?.title).toBe('Paused.')
    expect(manual?.caption).toMatch(/until we clear it/)
    expect(account?.caption).toMatch(/on its own/)
  })

  it('reports a finished send and a failed one', () => {
    expect(
      emailStatusCopy(
        send({ status: 'completed', sentCount: 987, recipientCount: 987 }),
        WIN_EMAIL_SURFACE,
      )?.caption,
    ).toBe('987 emails went out.')
    expect(
      emailStatusCopy(send({ status: 'failed' }), WIN_EMAIL_SURFACE)?.caption,
    ).toBe('Your card was not charged.')
  })

  it('shows a send stopped at the payment deadline as sent, with the count', () => {
    const stopped = send({
      status: 'completed',
      sentCount: 3200,
      recipientCount: 5000,
      recipientCap: 5000,
    })
    expect(emailStatusCopy(stopped, WIN_EMAIL_SURFACE)).toEqual({
      title: 'Sent.',
      caption: 'Sent to 3,200 of 5,000 people.',
    })
    expect(emailStatusCopy(stopped, SERVE_EMAIL_SURFACE)?.caption).toBe(
      'Sent to 3,200 of 5,000 constituents.',
    )
  })

  it('does not say a failed send that sent some was not charged', () => {
    expect(
      emailStatusCopy(
        send({ status: 'failed', sentCount: 12 }),
        WIN_EMAIL_SURFACE,
      )?.caption,
    ).toBe('12 went out before it stopped.')
  })

  it('says a draft is a draft, and has no copy for an unknown status', () => {
    expect(
      emailStatusCopy(send({ status: 'draft' }), WIN_EMAIL_SURFACE)?.title,
    ).toBe('This email is still a draft.')
    expect(
      emailStatusCopy(send({ status: 'mystery' }), WIN_EMAIL_SURFACE),
    ).toBeNull()
  })
})

describe('EmailStatus', () => {
  it('shows a scheduled send and cancels it after confirming', async () => {
    api.mock('GET /v1/outreach/email/:id', { status: 200, data: send() })
    let canceled = false
    api.mock('POST /v1/outreach/email/:id/cancel', () => {
      canceled = true
      return { status: 200, data: send({ status: 'canceled' }) }
    })
    const user = userEvent.setup()
    render(<EmailStatus surface={WIN_EMAIL_SURFACE} id={11} />)

    expect(await screen.findByText('Scheduled.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel this email' }))
    await user.click(screen.getByRole('button', { name: 'Cancel email' }))

    expect(await screen.findByText('Canceled.')).toBeInTheDocument()
    expect(canceled).toBe(true)
  })

  it('offers a new card when the send is waiting on one', async () => {
    api.mock('GET /v1/outreach/email/:id', {
      status: 200,
      data: send({ status: 'pending_payment' }),
    })
    api.mock('POST /v1/outreach/holds/card-intent', {
      status: 200,
      data: { clientSecret: 'seti_secret_1' },
    })
    render(<EmailStatus surface={WIN_EMAIL_SURFACE} id={11} />)

    expect(await screen.findByText('Update your card')).toBeInTheDocument()
    expect(await screen.findByTestId('payment-element')).toBeInTheDocument()
  })

  it('sends a new card to the hold, then confirms the send', async () => {
    api.mock('GET /v1/outreach/email/:id', {
      status: 200,
      data: send({ status: 'pending_payment' }),
    })
    api.mock('POST /v1/outreach/holds/card-intent', {
      status: 200,
      data: { clientSecret: 'seti_secret_1' },
    })
    const cards: unknown[] = []
    api.mock('POST /v1/outreach/holds/:outreachId/card', ({ body }) => {
      cards.push(body)
      return { status: 200, data: { outcome: 'scheduled' } }
    })
    api.mock('POST /v1/outreach/email/:id/confirm', {
      status: 200,
      data: {
        outcome: 'scheduled',
        declineCode: null,
        email: send({ status: 'pending' }),
      },
    })
    render(<EmailStatus surface={WIN_EMAIL_SURFACE} id={11} />)

    await userEvent.click(
      await screen.findByRole('button', { name: 'Pay and send' }),
    )
    expect(await screen.findByText('Scheduled.')).toBeInTheDocument()
    expect(cards).toEqual([{ paymentMethodId: 'pm_new' }])
  })

  it('reads a Serve send through the office-scoped route', async () => {
    api.mock('GET /v1/outreach/serve/email/:id', {
      status: 200,
      data: send({ status: 'completed', sentCount: 40 }),
    })
    render(<EmailStatus surface={SERVE_EMAIL_SURFACE} id={11} />)
    expect(await screen.findByText('Sent.')).toBeInTheDocument()
  })
})
