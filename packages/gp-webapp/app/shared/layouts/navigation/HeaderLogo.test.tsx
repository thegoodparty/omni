import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { HeaderLogo } from './HeaderLogo'

const { mockPlan } = vi.hoisted(() => ({ mockPlan: { current: 'free' } }))
vi.mock('app/dashboard/shared/plan/useBadgePlan', () => ({
  useBadgePlan: () => mockPlan.current,
}))

describe('HeaderLogo', () => {
  it('shows PRO on a Pro campaign', () => {
    mockPlan.current = 'pro'
    render(<HeaderLogo />)
    expect(screen.getByText('PRO')).toBeInTheDocument()
  })

  it('shows TEAM on a Team campaign', () => {
    mockPlan.current = 'team'
    render(<HeaderLogo />)
    expect(screen.getByText('TEAM')).toBeInTheDocument()
    expect(screen.queryByText('PRO')).toBeNull()
  })

  it('shows no badge on a Free campaign', () => {
    mockPlan.current = 'free'
    render(<HeaderLogo />)
    expect(screen.queryByText('PRO')).toBeNull()
    expect(screen.queryByText('TEAM')).toBeNull()
  })
})
