import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { RobocallReviewStep } from './RobocallReviewStep'

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
