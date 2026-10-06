import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import HomeGreeting from './HomeGreeting'

const mockCampaign = vi.hoisted(() => ({
  value: { details: { electionDate: '2099-11-03' } } as Record<string, object>,
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [mockCampaign.value],
}))
vi.mock('./useSessionHeadline', () => ({
  useSessionHeadline: () => 'Earn every vote',
}))

describe('HomeGreeting', () => {
  it('names the card landmark with the session headline', () => {
    render(<HomeGreeting />)

    const heading = screen.getByRole('heading', {
      level: 2,
      name: 'Earn every vote',
    })
    expect(heading).toHaveAttribute('id', 'next-thing-heading')
  })

  it('shows the days left to the election', () => {
    render(<HomeGreeting />)

    expect(screen.getByText(/days to Election Day$/)).toBeInTheDocument()
  })

  it('shows no countdown without an election ahead', () => {
    mockCampaign.value = { details: {} }
    render(<HomeGreeting />)

    expect(screen.queryByText(/Election Day/)).not.toBeInTheDocument()
  })
})
