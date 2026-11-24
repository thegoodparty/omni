import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { RobocallReviewStep } from './RobocallReviewStep'

const credit = vi.hoisted(() => ({ enabled: false, cents: 0 }))

vi.mock('@shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => ({
    ready: true,
    enabled: credit.enabled,
  }),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ hasFreeTextsOffer: false }],
}))

vi.mock('app/dashboard/shared/membership/deriveMembershipState', () => ({
  usePlan: () => ({ creditCents: credit.cents }),
}))

beforeEach(() => {
  credit.enabled = false
  credit.cents = 0
})

const baseProps = {
  campaignName: 'Election eve',
  audienceName: 'Landline voters',
  reachCount: 3581,
  pricePerContact: 0.045,
  scheduledAt: new Date('2026-11-02T15:00:00.000Z'),
  timeZone: 'America/New_York',
  callbackNumber: '16175073539',
  recording: null,
  script: '',
  onFreeOfferList: false,
}

const withScript = { ...baseProps, script: 'AI drafted script text' }

describe('RobocallReviewStep', () => {
  it('says the free offer is applied on the next step', () => {
    render(<RobocallReviewStep {...baseProps} onFreeOfferList />)

    expect(
      screen.getByText(
        "Your free offer covers this. You'll see it on the next step.",
      ),
    ).toBeInTheDocument()
  })

  it('points anyone else to the promo code on the next step', () => {
    render(<RobocallReviewStep {...baseProps} />)

    expect(
      screen.getByText('Have a promo code? Add it on the next step.'),
    ).toBeInTheDocument()
  })

  it('shows the transcript of the recording over the AI script', () => {
    render(
      <RobocallReviewStep {...withScript} transcript="What I really said" />,
    )
    expect(screen.getByText('What I really said')).toBeInTheDocument()
    expect(screen.queryByText('AI drafted script text')).toBeNull()
    expect(screen.getByText('What we heard')).toBeInTheDocument()
    expect(screen.getByText(/can miss names/)).toBeInTheDocument()
  })

  it('falls back to the script when the transcript is blank', () => {
    render(<RobocallReviewStep {...withScript} transcript="   " />)
    expect(screen.getByText('AI drafted script text')).toBeInTheDocument()
    expect(screen.getByText('Your recording')).toBeInTheDocument()
    expect(screen.queryByText('What we heard')).toBeNull()
  })

  it('falls back to the script when there is no transcript', () => {
    render(<RobocallReviewStep {...withScript} transcript={null} />)
    expect(screen.getByText('AI drafted script text')).toBeInTheDocument()
  })
})

// 2,000 calls at $0.045 is $90.00.
describe('RobocallReviewStep outreach credit', () => {
  const props = { ...baseProps, reachCount: 2000 }

  it('takes the credit off the cost and says what is left', () => {
    credit.enabled = true
    credit.cents = 17500
    render(<RobocallReviewStep {...props} />)

    expect(screen.getByText('$90.00')).toBeInTheDocument()
    expect(
      screen.getByText('Outreach credit ($85.00 left after)'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Review and pay' }),
    ).toBeInTheDocument()
    expect(screen.getByText('\u2212$90.00')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getByText('$0.00')).toBeInTheDocument()
    expect(screen.queryByText(/credit left after it sends/)).toBeNull()
  })

  it('totals what the credit leaves when it covers part', () => {
    credit.enabled = true
    credit.cents = 4000
    render(<RobocallReviewStep {...props} />)

    expect(screen.getByText('\u2212$40.00')).toBeInTheDocument()
    expect(screen.getByText('$50.00')).toBeInTheDocument()
    expect(screen.queryByText(/credit left after/)).not.toBeInTheDocument()
  })

  it('keeps the estimate row with no credit', () => {
    credit.enabled = true
    render(<RobocallReviewStep {...props} />)

    expect(screen.queryByText(/Outreach credit \(/)).not.toBeInTheDocument()
  })

  it('keeps the old rows with the flag off', () => {
    credit.cents = 17500
    render(<RobocallReviewStep {...props} />)

    expect(screen.getByText('Estimated cost')).toBeInTheDocument()
    expect(screen.queryByText(/Outreach credit \(/)).not.toBeInTheDocument()
  })
})
