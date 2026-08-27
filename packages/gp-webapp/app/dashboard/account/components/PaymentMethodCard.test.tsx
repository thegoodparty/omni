import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { User } from 'helpers/types'
import { PaymentMethodCard } from './PaymentMethodCard'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn() }),
}))

let robocallFlag = { ready: true, enabled: true }
vi.mock('@shared/experiments/voterOutreachV2RobocallFlag', () => ({
  useVoterOutreachV2RobocallFlag: () => robocallFlag,
}))

const buildUser = (customerId?: string): User =>
  ({
    id: 1,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    email: 'candidate@example.com',
    hasPassword: true,
    roles: [],
    metaData: customerId ? { customerId } : {},
  }) as User

describe('PaymentMethodCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    robocallFlag = { ready: true, enabled: true }
  })

  it('shows the manage-payment-method control when the flag is on and a customer exists', () => {
    render(<PaymentMethodCard user={buildUser('cus_123')} />)

    expect(
      screen.getByRole('button', { name: /manage payment method/i }),
    ).toBeInTheDocument()
  })

  it('renders nothing when the robocall flag is off', () => {
    robocallFlag = { ready: true, enabled: false }
    const { container } = render(
      <PaymentMethodCard user={buildUser('cus_123')} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the user has no saved Stripe customer', () => {
    const { container } = render(<PaymentMethodCard user={buildUser()} />)

    expect(container).toBeEmptyDOMElement()
  })
})
