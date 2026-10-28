import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RobocallReviewStep } from './RobocallReviewStep'

const base = {
  campaignName: 'Fall push',
  audienceName: 'Renters',
  reachCount: 10,
  pricePerContact: 0.045,
  scheduledAt: null,
  timeZone: 'America/New_York',
  callbackNumber: '+12025550147',
  recording: null,
  script: 'AI drafted script text',
}

describe('RobocallReviewStep', () => {
  it('shows the transcript of the recording over the AI script', () => {
    render(<RobocallReviewStep {...base} transcript="What I really said" />)
    expect(screen.getByText('What I really said')).toBeInTheDocument()
    expect(screen.queryByText('AI drafted script text')).toBeNull()
  })

  it('falls back to the script when there is no transcript', () => {
    render(<RobocallReviewStep {...base} transcript={null} />)
    expect(screen.getByText('AI drafted script text')).toBeInTheDocument()
  })
})
