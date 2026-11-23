// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import PaymentStep from './PaymentStep'

vi.mock('app/shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => ({ ready: true, enabled: true }),
}))
vi.mock('./ProUpgradeWizard', () => ({
  useProUpgradeWizard: () => ({ goToStep: vi.fn(), goToPreviousStep: vi.fn() }),
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ id: 42 }],
}))
vi.mock('app/dashboard/shared/membership/deriveMembershipState', () => ({
  usePlan: () => ({ plan: 'free' }),
}))
vi.mock('app/dashboard/shared/smsCutoff/useSmsCompliance', () => ({
  useSmsCompliance: () => ({ smsCompliance: 'open' }),
}))
vi.mock('app/dashboard/purchase/components/CheckoutSessionProvider', () => ({
  CheckoutSessionProvider: () => null,
  useCheckoutSession: vi.fn(),
}))

describe('PaymentStep server render', () => {
  it('renders the plan checkout without touching window', () => {
    expect(typeof window).toBe('undefined')
    expect(() => renderToString(<PaymentStep />)).not.toThrow()
  })
})
