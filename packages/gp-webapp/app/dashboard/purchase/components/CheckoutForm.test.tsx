import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, act } from '@testing-library/react'
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
  paymentElementOptions,
  expressProps,
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
    paymentElementOptions: { current: undefined as unknown },
    expressProps: {
      current: undefined as
        | undefined
        | {
            options: unknown
            onReady: (e: unknown) => void
            onConfirm: (e: unknown) => void
          },
    },
  }
})

vi.mock('@stripe/react-stripe-js/checkout', () => ({
  useCheckout: () => ({ type: 'success', checkout: checkoutValue }),
  PaymentElement: ({ options }: { options: unknown }) => {
    paymentElementOptions.current = options
    return <div data-testid="payment-element" />
  },
  ExpressCheckoutElement: (props: NonNullable<typeof expressProps.current>) => {
    expressProps.current = props
    return <div data-testid="express-element" />
  },
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

  describe('wallets and accordion layout', () => {
    it('keeps the tabbed Payment Element and no wallet buttons by default', () => {
      render(<CheckoutForm onSuccess={vi.fn()} sessionId="cs_one_time" />)

      expect(paymentElementOptions.current).toEqual({ layout: 'tabs' })
      expect(screen.queryByTestId('express-element')).toBeNull()
      expect(screen.getByText('Promo Code')).toBeInTheDocument()
    })

    it('shows wallets above an accordion Payment Element that skips wallets', () => {
      render(
        <CheckoutForm
          onSuccess={vi.fn()}
          sessionId="cs_one_time"
          walletsAndAccordion
        />,
      )

      expect(screen.getByTestId('express-element')).toBeInTheDocument()
      expect(expressProps.current?.options).toMatchObject({
        paymentMethods: {
          applePay: 'auto',
          googlePay: 'auto',
          link: 'never',
          amazonPay: 'never',
          paypal: 'never',
        },
      })
      expect(paymentElementOptions.current).toMatchObject({
        layout: { type: 'accordion', radios: true, spacedAccordionItems: true },
        wallets: { applePay: 'never', googlePay: 'never' },
      })
    })

    it('hides the divider until a wallet is available on the device', () => {
      render(
        <CheckoutForm
          onSuccess={vi.fn()}
          sessionId="cs_one_time"
          walletsAndAccordion
        />,
      )
      expect(screen.queryByText('Or pay another way')).toBeNull()

      act(() =>
        expressProps.current?.onReady({
          availablePaymentMethods: { applePay: true, googlePay: false },
        }),
      )
      expect(screen.getByText('Or pay another way')).toBeInTheDocument()
    })

    it('shows no divider when Stripe reports no wallet', () => {
      render(
        <CheckoutForm
          onSuccess={vi.fn()}
          sessionId="cs_one_time"
          walletsAndAccordion
        />,
      )

      act(() =>
        expressProps.current?.onReady({ availablePaymentMethods: undefined }),
      )
      expect(screen.queryByText('Or pay another way')).toBeNull()
    })

    it('completes the purchase from a wallet confirm through the same path as Pay', async () => {
      const onSuccess = vi.fn()
      const event = { paymentFailed: vi.fn(), expressPaymentType: 'apple_pay' }
      render(
        <CheckoutForm
          onSuccess={onSuccess}
          sessionId="cs_one_time"
          walletsAndAccordion
        />,
      )

      act(() => expressProps.current?.onConfirm(event))

      await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('cs_one_time'))
      expect(confirmMock).toHaveBeenCalledWith({
        redirect: 'if_required',
        expressCheckoutConfirmEvent: event,
      })
      expect(event.paymentFailed).not.toHaveBeenCalled()
    })

    it('fails the wallet sheet and shows the error when the wallet confirm is declined', async () => {
      confirmMock.mockResolvedValueOnce({
        type: 'error',
        error: { message: 'Wallet declined.' },
      })
      const onSuccess = vi.fn()
      const event = { paymentFailed: vi.fn(), expressPaymentType: 'google_pay' }
      render(
        <CheckoutForm
          onSuccess={onSuccess}
          sessionId="cs_one_time"
          walletsAndAccordion
        />,
      )

      act(() => expressProps.current?.onConfirm(event))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Wallet declined.',
      )
      expect(event.paymentFailed).toHaveBeenCalledWith({ reason: 'fail' })
      expect(onSuccess).not.toHaveBeenCalled()
    })

    it('ignores a wallet tap while a payment is already in flight', async () => {
      let release: (v: unknown) => void = vi.fn()
      confirmMock.mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve
        }),
      )
      const onSuccess = vi.fn()
      const event = { paymentFailed: vi.fn(), expressPaymentType: 'apple_pay' }
      render(
        <CheckoutForm
          onSuccess={onSuccess}
          sessionId="cs_one_time"
          walletsAndAccordion
        />,
      )

      clickSubmit()
      await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1))
      act(() => expressProps.current?.onConfirm(event))

      expect(event.paymentFailed).toHaveBeenCalledWith({ reason: 'fail' })
      expect(confirmMock).toHaveBeenCalledTimes(1)
      release({ type: 'success' })
      await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    })

    it('drops the promo box when the host draws the promo link', () => {
      render(
        <CheckoutForm
          onSuccess={vi.fn()}
          sessionId="cs_one_time"
          walletsAndAccordion
          hidePromoSection
        />,
      )

      expect(screen.queryByText('Promo Code')).toBeNull()
    })
  })

  describe('with the pay button outside the form', () => {
    it('puts the id on the form and drops its own submit button', () => {
      const { container } = render(
        <CheckoutForm
          onSuccess={vi.fn()}
          sessionId="cs_one_time"
          formId="pay-form"
          hideSubmit
        />,
      )

      expect(container.querySelector('form#pay-form')).not.toBeNull()
      expect(
        screen.queryByRole('button', { name: 'Complete Purchase' }),
      ).toBeNull()
    })

    it('confirms when the form is submitted from outside and reports the pending state', async () => {
      let release: (value: { type: 'success' }) => void = (value) => {
        void value
      }
      confirmMock.mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve
        }),
      )
      const onSuccess = vi.fn()
      const onSubmittingChange = vi.fn()
      const { container } = render(
        <CheckoutForm
          onSuccess={onSuccess}
          sessionId="cs_one_time"
          formId="pay-form"
          hideSubmit
          onSubmittingChange={onSubmittingChange}
        />,
      )
      expect(onSubmittingChange).toHaveBeenLastCalledWith(false)

      const form = container.querySelector('form#pay-form')
      expect(form).toBeInstanceOf(HTMLFormElement)
      ;(form as HTMLFormElement).requestSubmit()

      await waitFor(() =>
        expect(onSubmittingChange).toHaveBeenLastCalledWith(true),
      )
      release({ type: 'success' })
      await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('cs_one_time'))
      await waitFor(() =>
        expect(onSubmittingChange).toHaveBeenLastCalledWith(false),
      )
    })
  })
})
