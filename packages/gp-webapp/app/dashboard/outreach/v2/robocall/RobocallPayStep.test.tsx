import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { api } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import { RobocallPayStep } from './RobocallPayStep'

const credit = vi.hoisted(() => ({ cents: 0 }))

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('@shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => ({ ready: true, enabled: true }),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ hasFreeTextsOffer: false }],
}))

vi.mock('app/dashboard/shared/membership/deriveMembershipState', () => ({
  usePlan: () => ({ creditCents: credit.cents }),
}))

const authorized = {
  status: 'authorized' as const,
  settleState: 'authorized',
  authorizedAmountInCents: 2500,
  promoDiscountInCents: null,
}

const props = {
  voterFileFilterId: 1,
  audioKey: 'audio.mp3',
  callbackNumber: '16175073539',
  scheduledAt: new Date('2026-11-02T15:00:00.000Z'),
  timeZone: 'America/New_York',
  script: 'Hello',
  campaignName: 'Election eve',
  audienceName: 'Landline voters',
  reachCount: 3581,
  outcome: authorized,
  settledOutreachId: 41,
  onOutcome: vi.fn(),
}

const mockReserved = (creditReservedCents: number) =>
  api.mock('GET /v1/outreach/:id', {
    status: 200,
    data: { id: 41, creditReservedCents } as never,
  })

beforeEach(() => {
  credit.cents = 0
})

describe('RobocallPayStep success summary', () => {
  it('shows credit used, credit left and a $0.00 charge', async () => {
    credit.cents = 4000
    mockReserved(10000)
    render(<RobocallPayStep {...props} />)

    expect(await screen.findByText('Outreach credit used')).toBeInTheDocument()
    expect(screen.getByText('-$100.00')).toBeInTheDocument()
    expect(screen.getByText('Outreach credit left after')).toBeInTheDocument()
    expect(screen.getByText('$40.00')).toBeInTheDocument()
    expect(screen.getByText('Charged today')).toBeInTheDocument()
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })

  it('keeps the credit rows when the step mounts again', async () => {
    mockReserved(2500)
    const first = render(<RobocallPayStep {...props} />)
    expect(await screen.findByText('Outreach credit used')).toBeInTheDocument()
    first.unmount()

    render(<RobocallPayStep {...props} />)
    expect(await screen.findByText('Outreach credit used')).toBeInTheDocument()
    expect(screen.getByText('-$25.00')).toBeInTheDocument()
  })

  it('shows no credit rows when the send used none', async () => {
    mockReserved(0)
    render(<RobocallPayStep {...props} />)

    expect(await screen.findByText('Authorized')).toBeInTheDocument()
    expect(screen.queryByText('Outreach credit used')).not.toBeInTheDocument()
    expect(screen.queryByText('Charged today')).not.toBeInTheDocument()
  })
})
