import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { PaymentHoldCard } from './PaymentHoldCard'

const { confirmSetupMock } = vi.hoisted(() => ({ confirmSetupMock: vi.fn() }))

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({
    children,
    options,
  }: {
    children: React.ReactNode
    options?: { clientSecret?: string }
  }) => (
    <div
      data-testid="stripe-elements"
      data-client-secret={options?.clientSecret}
    >
      {children}
    </div>
  ),
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmSetup: confirmSetupMock }),
  useElements: () => ({}),
}))

const onOutcome = vi.fn()

beforeEach(() => {
  onOutcome.mockReset()
  confirmSetupMock.mockReset().mockResolvedValue({
    setupIntent: { payment_method: 'pm_new' },
  })
})

const mockIntent = (mode: 'win' | 'serve') => {
  let calls = 0
  const handler = () => {
    calls += 1
    return {
      status: 200 as const,
      data: { clientSecret: `seti_secret_${calls}` },
    }
  }
  if (mode === 'serve') {
    api.mock('POST /v1/outreach/serve/holds/card-intent', handler)
  } else {
    api.mock('POST /v1/outreach/holds/card-intent', handler)
  }
}

const mockCard = (
  mode: 'win' | 'serve',
  response: { status: number; data: unknown },
  onBody?: (body: { paymentMethodId: string }) => void,
) => {
  const handler = ({ body }: { body: { paymentMethodId: string } }) => {
    onBody?.(body)
    return response as never
  }
  if (mode === 'serve') {
    api.mock('POST /v1/outreach/serve/holds/:outreachId/card', handler)
  } else {
    api.mock('POST /v1/outreach/holds/:outreachId/card', handler)
  }
}

const submit = async () => {
  await userEvent.click(
    await screen.findByRole('button', { name: 'Save card' }),
  )
}
describe('PaymentHoldCard', () => {
  it.each(['win', 'serve'] as const)(
    'saves the card on the %s route',
    async (mode) => {
      mockIntent(mode)
      let body: unknown
      mockCard(
        mode,
        {
          status: 200,
          data: { outcome: 'held', captureBefore: '2026-11-05T00:00:00.000Z' },
        },
        (b) => {
          body = b
        },
      )

      render(
        <PaymentHoldCard
          mode={mode}
          outreachId={7}
          submitLabel="Save card"
          onOutcome={onOutcome}
        />,
      )
      await submit()

      await waitFor(() =>
        expect(onOutcome).toHaveBeenCalledWith({
          outcome: 'held',
          captureBefore: '2026-11-05T00:00:00.000Z',
        }),
      )
      expect(body).toEqual({ paymentMethodId: 'pm_new' })
    },
  )

  it('hands the card to a custom save for a send with no hold yet', async () => {
    mockIntent('win')
    const savePaymentMethod = vi
      .fn()
      .mockResolvedValue({ outcome: 'scheduled' })

    render(
      <PaymentHoldCard
        mode="win"
        outreachId={7}
        submitLabel="Save card"
        savePaymentMethod={savePaymentMethod}
        onOutcome={onOutcome}
      />,
    )
    await submit()

    await waitFor(() =>
      expect(onOutcome).toHaveBeenCalledWith({ outcome: 'scheduled' }),
    )
    expect(savePaymentMethod).toHaveBeenCalledWith('pm_new')
  })

  it('shows the decline and mounts a fresh card form on retry', async () => {
    mockIntent('win')
    mockCard('win', {
      status: 200,
      data: { outcome: 'declined', declineCode: 'insufficient_funds' },
    })

    render(
      <PaymentHoldCard
        mode="win"
        outreachId={7}
        submitLabel="Save card"
        onOutcome={onOutcome}
      />,
    )
    await submit()

    expect(
      await screen.findByText(/doesn't have enough available/),
    ).toBeInTheDocument()
    expect(onOutcome).not.toHaveBeenCalled()

    await userEvent.click(
      screen.getByRole('button', { name: 'Use a different card' }),
    )

    const elements = await screen.findByTestId('stripe-elements')
    expect(elements).toHaveAttribute('data-client-secret', 'seti_secret_2')
  })

  it('asks the user to wait when the last try is still processing', async () => {
    mockIntent('win')
    mockCard('win', {
      status: 409,
      data: { message: 'The payment hold is still being placed' },
    })

    render(
      <PaymentHoldCard
        mode="win"
        outreachId={7}
        submitLabel="Save card"
        onOutcome={onOutcome}
      />,
    )
    await submit()

    expect(
      await screen.findByText(/still finishing your last try/),
    ).toBeInTheDocument()
    expect(onOutcome).not.toHaveBeenCalled()
  })

  it('sends the retry after a first-card decline to the hold route', async () => {
    mockIntent('win')
    mockCard('win', {
      status: 200,
      data: { outcome: 'held', captureBefore: '2026-11-05T00:00:00.000Z' },
    })
    const savePaymentMethod = vi
      .fn()
      .mockResolvedValue({ outcome: 'declined', declineCode: null })

    render(
      <PaymentHoldCard
        mode="win"
        outreachId={7}
        submitLabel="Save card"
        savePaymentMethod={savePaymentMethod}
        onOutcome={onOutcome}
      />,
    )
    await submit()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Use a different card' }),
    )
    await submit()

    await waitFor(() => expect(onOutcome).toHaveBeenCalled())
    expect(savePaymentMethod).toHaveBeenCalledTimes(1)
  })

  it('does not ask to wait on a final 409 and offers another card', async () => {
    mockIntent('win')
    mockCard('win', {
      status: 409,
      data: { message: "This send's payment is released" },
    })

    render(
      <PaymentHoldCard
        mode="win"
        outreachId={7}
        submitLabel="Save card"
        onOutcome={onOutcome}
      />,
    )
    await submit()

    expect(
      await screen.findByText(/can't take a new card anymore/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Use a different card' }),
    ).toBeInTheDocument()
  })
})
