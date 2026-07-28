import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { mswServer } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import { PURCHASE_TYPES } from 'helpers/purchaseTypes'
import { CheckoutSessionProvider } from 'app/dashboard/purchase/components/CheckoutSessionProvider'
import { PurchaseStep } from 'app/dashboard/components/tasks/flows/PurchaseStep'

const CREATE_SESSION_URL = '/api/v1/payments/purchase/create-checkout-session'
const COMPLETE_FREE_PURCHASE_URL =
  '/api/v1/payments/purchase/complete-free-purchase'

describe('PurchaseStep', () => {
  // Regression for the drift-rejection tradeoff documented in
  // outreachPurchase.service.ts: the server can reject a free-purchase
  // confirmation that was $0 at checkout-session creation time. Without a
  // wired onError, that rejection was silent — the button just re-enabled.
  it('shows a visible error when the free-purchase confirmation is rejected', async () => {
    mswServer.use(
      http.post(CREATE_SESSION_URL, () =>
        HttpResponse.json(
          { id: 'cs_1', clientSecret: 'secret', amount: 0 },
          { status: 200 },
        ),
      ),
      http.post(COMPLETE_FREE_PURCHASE_URL, () =>
        HttpResponse.json(
          { statusCode: 400, message: 'contactCount is required' },
          { status: 400 },
        ),
      ),
    )

    render(
      <CheckoutSessionProvider type={PURCHASE_TYPES.TEXT}>
        <PurchaseStep
          type="p2p"
          phoneListId={42}
          phoneListToken="token-abc"
          contactCount={500}
          outreachId={1}
        />
      </CheckoutSessionProvider>,
    )

    const scheduleButton = await screen.findByRole('button', {
      name: /schedule text/i,
    })
    fireEvent.click(scheduleButton)

    await waitFor(() => {
      expect(
        screen.getByText(/failed to complete purchase/i),
      ).toBeInTheDocument()
    })
  })
})
