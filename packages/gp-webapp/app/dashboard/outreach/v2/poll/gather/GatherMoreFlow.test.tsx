import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { GatherMoreFlow } from './GatherMoreFlow'

vi.mock('app/dashboard/polls/shared/audience-selection', () => ({
  useTotalConstituentsWithCellPhone: () => ({
    data: { totalConstituents: 20_000 },
    isPending: false,
    isUnavailable: false,
  }),
}))

const createCheckoutSession = vi.fn(
  async (_type: string, _meta: Record<string, unknown>) => ({
    ok: true,
    data: { id: 'cs_1', clientSecret: 'secret', amount: 30.1 },
  }),
)
vi.mock('app/dashboard/purchase/utils/purchaseFetch.utils', () => ({
  createCheckoutSession: (type: string, meta: Record<string, unknown>) =>
    createCheckoutSession(type, meta),
  completeCheckoutSession: vi.fn(async () => ({ ok: true })),
}))

// The real form mounts Stripe elements, which jsdom cannot render.
vi.mock('app/dashboard/purchase/components/CheckoutPayment', () => ({
  default: ({
    onPaymentSuccess,
  }: {
    onPaymentSuccess: (id: string) => void
  }) => (
    <button type="button" onClick={() => onPaymentSuccess('cs_1')}>
      Pay now
    </button>
  ),
}))

const OUTREACH_ID = 41
const createBodies: Record<string, unknown>[] = []

const openFlow = () => {
  const onPaid = vi.fn().mockResolvedValue(undefined)
  render(
    <GatherMoreFlow
      open
      onClose={vi.fn()}
      outreachId={OUTREACH_ID}
      sent={2_000}
      responses={10}
      onPaid={onPaid}
    />,
  )
  return { onPaid }
}

const next = () =>
  userEvent.click(screen.getByRole('button', { name: 'Continue' }))

describe('GatherMoreFlow', () => {
  beforeEach(() => {
    api.reset()
    createBodies.length = 0
    createCheckoutSession.mockClear()
  })

  it('asks for the minimum reliable sample by default', async () => {
    api.mock('POST /v1/outreach/serve/poll/:id/expansions', ({ body }) => {
      createBodies.push(body as Record<string, unknown>)
      return {
        status: 200,
        data: { expansionId: 'ex-1', recipientCount: 2434, amountCents: 8519 },
      }
    })
    openFlow()

    expect(
      await screen.findByRole('heading', {
        level: 3,
        name: 'How many more messages would you like to send?',
      }),
    ).toBeVisible()
    expect(
      screen.getByText(
        "We won't send text messages to constituents you've already messaged.",
      ),
    ).toBeVisible()
    await next()
    await next()

    await waitFor(() => expect(createBodies).toEqual([{ size: 2434 }]))
  })

  it('asks for everyone not yet messaged', async () => {
    api.mock('POST /v1/outreach/serve/poll/:id/expansions', ({ body }) => {
      createBodies.push(body as Record<string, unknown>)
      return {
        status: 200,
        data: {
          expansionId: 'ex-1',
          recipientCount: 10000,
          amountCents: 35000,
        },
      }
    })
    openFlow()

    await userEvent.click(
      await screen.findByText("Everyone you haven't messaged yet"),
    )
    await next()
    await next()

    await waitFor(() => expect(createBodies).toEqual([{ size: 10000 }]))
  })

  it('turns a budget into a count at the per-text price', async () => {
    api.mock('POST /v1/outreach/serve/poll/:id/expansions', ({ body }) => {
      createBodies.push(body as Record<string, unknown>)
      return {
        status: 200,
        data: { expansionId: 'ex-1', recipientCount: 1000, amountCents: 3500 },
      }
    })
    openFlow()

    await userEvent.click(await screen.findByText('Set a budget'))
    await userEvent.type(screen.getByLabelText('Budget in dollars'), '35')
    expect(screen.getByText('1,000 constituents')).toBeVisible()
    await next()
    await next()

    await waitFor(() => expect(createBodies).toEqual([{ size: 1000 }]))
  })

  it('does not offer the custom segments option', async () => {
    openFlow()
    await screen.findByText('Set a budget')
    expect(screen.queryByText(/segment/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Custom')).not.toBeInTheDocument()
  })

  it('reviews and pays for the count the server settled on', async () => {
    api.mock('POST /v1/outreach/serve/poll/:id/expansions', {
      status: 200,
      data: { expansionId: 'ex-9', recipientCount: 1234, amountCents: 4319 },
    })
    const { onPaid } = openFlow()

    await next()
    await next()

    expect(await screen.findByText('1,234')).toBeVisible()
    await waitFor(() =>
      expect(createCheckoutSession).toHaveBeenCalledWith(
        'SERVE_TEXT',
        expect.objectContaining({
          outreachId: OUTREACH_ID,
          contactCount: 1234,
          expansionId: 'ex-9',
        }),
      ),
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'Pay now' }),
    )

    expect(await screen.findByText('Your request is in review')).toBeVisible()
    expect(onPaid).toHaveBeenCalled()
  })

  it('shows the server reason when another request is still open', async () => {
    api.mock('POST /v1/outreach/serve/poll/:id/expansions', {
      status: 409,
      data: {
        statusCode: 409,
        message:
          'Another request to gather more feedback on this poll is still waiting. Finish or wait for it first.',
      },
    })
    openFlow()

    await next()
    await next()

    expect(
      await screen.findByText(/Another request to gather more feedback/),
    ).toBeVisible()
    expect(screen.queryByText('Review & pay')).not.toBeInTheDocument()
  })
})
