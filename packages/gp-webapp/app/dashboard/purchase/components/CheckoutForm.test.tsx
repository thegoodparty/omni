import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import CheckoutForm from './CheckoutForm'

const {
  confirmMock,
  checkoutValue,
  errorSnackbar,
  successSnackbar,
  setError,
  reportClientError,
  reportClientInterruption,
} = vi.hoisted(() => {
  const confirmMock = vi.fn()
  return {
    confirmMock,
    checkoutValue: {
      confirm: confirmMock,
      canConfirm: true,
      total: {
        total: { minorUnitsAmount: 1000 },
        subtotal: { minorUnitsAmount: 1000 },
      },
      discountAmounts: undefined,
      applyPromotionCode: vi.fn(),
      removePromotionCode: vi.fn(),
    },
    errorSnackbar: vi.fn(),
    successSnackbar: vi.fn(),
    setError: vi.fn(),
    reportClientError: vi.fn(),
    reportClientInterruption: vi.fn(),
  }
})

vi.mock('@stripe/react-stripe-js/checkout', () => ({
  useCheckout: () => ({ type: 'success', checkout: checkoutValue }),
  PaymentElement: () => <div data-testid="payment-element" />,
}))

vi.mock('@shared/utils/Snackbar', () => ({
  useSnackbar: () => ({ errorSnackbar, successSnackbar }),
}))

vi.mock('@shared/observability/reportClientError', () => ({
  reportClientError,
  reportClientInterruption,
}))

vi.mock('./CheckoutSessionProvider', () => ({
  useCheckoutSession: () => ({ setError }),
}))

const clickSubmit = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Complete Purchase' }))

describe('CheckoutForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirmMock.mockResolvedValue({ type: 'success' })
  })

  it('completes a one-time purchase via onSuccess with the session id', async () => {
    const onSuccess = vi.fn()

    render(<CheckoutForm onSuccess={onSuccess} sessionId="cs_one_time" />)
    clickSubmit()

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('cs_one_time'))
    expect(confirmMock).toHaveBeenCalledWith({ redirect: 'if_required' })
  })

  it('signals confirmation via onConfirmed (not onSuccess) when there is no session id', async () => {
    const onSuccess = vi.fn()
    const onConfirmed = vi.fn()

    render(
      <CheckoutForm
        onSuccess={onSuccess}
        onConfirmed={onConfirmed}
        submitLabel="Complete Purchase"
      />,
    )
    clickSubmit()

    await waitFor(() => expect(onConfirmed).toHaveBeenCalled())
    expect(confirmMock).toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('reports the total Stripe is charging, not the pre-discount one, to the parent', async () => {
    // After a promo code applies, Stripe's total is the only live figure; the
    // parent's own session amount is the pre-discount price.
    const onTotalChange = vi.fn()
    checkoutValue.total.total.minorUnitsAmount = 84742

    render(
      <CheckoutForm
        onSuccess={vi.fn()}
        sessionId="cs_one_time"
        onTotalChange={onTotalChange}
      />,
    )

    await waitFor(() => expect(onTotalChange).toHaveBeenCalledWith(847.42))
    checkoutValue.total.total.minorUnitsAmount = 1000
  })

  it('fails before charging when a one-time session has no id and no onConfirmed fallback', async () => {
    // Guards the regression the type change opened up: confirming first would
    // charge the card and then silently skip fulfillment.
    const onSuccess = vi.fn()
    const onError = vi.fn()

    render(<CheckoutForm onSuccess={onSuccess} onError={onError} />)
    clickSubmit()

    await waitFor(() => expect(onError).toHaveBeenCalled())
    expect(confirmMock).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('keeps a declined confirm on the form instead of only in a toast', async () => {
    confirmMock.mockResolvedValueOnce({
      type: 'error',
      error: { message: 'Afterpay needs a billing address.' },
    })

    render(<CheckoutForm onSuccess={vi.fn()} sessionId="cs_one_time" />)
    clickSubmit()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Afterpay needs a billing address.',
    )

    confirmMock.mockResolvedValueOnce({ type: 'success' })
    clickSubmit()
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('keeps a declined card out of the exception stream the alert pages on', async () => {
    // A bank decline is an expected outcome of taking payment, not a defect:
    // reported as a client exception it filed a "new front-end error" alert for
    // every decline, indistinguishable from a bug we shipped (ENG-11776).
    confirmMock.mockResolvedValueOnce({
      type: 'error',
      error: {
        message: 'The payment attempt failed.',
        code: 'paymentFailed',
        paymentFailed: { declineCode: 'generic_decline' },
      },
    })

    render(<CheckoutForm onSuccess={vi.fn()} sessionId="cs_one_time" />)
    clickSubmit()

    await waitFor(() => expect(reportClientInterruption).toHaveBeenCalled())
    expect(reportClientError).not.toHaveBeenCalled()
    // The customer still gets the same message, snackbar and inline error.
    expect(errorSnackbar).toHaveBeenCalledWith('The payment attempt failed.')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The payment attempt failed.',
    )
  })

  it('reports a genuine Stripe failure with its code so the alert can tell it apart', async () => {
    confirmMock.mockResolvedValueOnce({
      type: 'error',
      error: { message: 'An unknown error occurred.', code: 'api_error' },
    })

    render(<CheckoutForm onSuccess={vi.fn()} sessionId="cs_one_time" />)
    clickSubmit()

    await waitFor(() =>
      expect(reportClientError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'checkout form stripe error: api_error',
        }),
        { stripeError: expect.objectContaining({ code: 'api_error' }) },
      ),
    )
    expect(reportClientInterruption).not.toHaveBeenCalled()
  })

  it('submits on the first click even while Stripe has not yet set canConfirm', async () => {
    // canConfirm lags the last keystroke until the field blurs, so a click
    // right after typing used to land on a disabled button and do nothing.
    checkoutValue.canConfirm = false
    const onSuccess = vi.fn()

    render(<CheckoutForm onSuccess={onSuccess} sessionId="cs_one_time" />)
    clickSubmit()

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('cs_one_time'))
    checkoutValue.canConfirm = true
  })
})
