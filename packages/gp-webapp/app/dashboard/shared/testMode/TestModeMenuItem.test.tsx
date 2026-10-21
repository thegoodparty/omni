import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { TestModeMenuItem } from './TestModeMenuItem'

const { mockUseFlagOn, mockUseUser } = vi.hoisted(() => ({
  mockUseFlagOn: vi.fn(),
  mockUseUser: vi.fn(),
}))

vi.mock('app/shared/experiments/FeatureFlagsProvider', () => ({
  useFlagOn: (...args: unknown[]) => mockUseFlagOn(...args),
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => mockUseUser(),
}))
vi.mock('./TestModeSheet', () => ({
  TestModeSheet: () => <div data-testid="test-mode-sheet" />,
}))

const flagOn = () => mockUseFlagOn.mockReturnValue({ on: true, ready: true })
const flagOff = () => mockUseFlagOn.mockReturnValue({ on: false, ready: true })
const withEmail = (email: string) => mockUseUser.mockReturnValue([{ email }])

describe('TestModeMenuItem', () => {
  it('returns null when the staff-test-mode flag is off', () => {
    flagOff()
    withEmail('staff@goodparty.org')

    const { container } = render(<TestModeMenuItem />)

    expect(container.firstChild).toBeNull()
  })

  it('returns null for a non-staff email even when the flag is on', () => {
    flagOn()
    withEmail('candidate@gmail.com')

    const { container } = render(<TestModeMenuItem />)

    expect(container.firstChild).toBeNull()
  })

  it('returns null when the user has no email', () => {
    flagOn()
    withEmail('')

    const { container } = render(<TestModeMenuItem />)

    expect(container.firstChild).toBeNull()
  })

  it('renders the menu item for a @goodparty.org user when the flag is on', () => {
    flagOn()
    withEmail('staff@goodparty.org')

    render(<TestModeMenuItem />)

    expect(screen.getByText('Test mode')).toBeInTheDocument()
  })

  it('passes the flag key with trackExposure: false to useFlagOn', () => {
    flagOff()
    withEmail('staff@goodparty.org')

    render(<TestModeMenuItem />)

    expect(mockUseFlagOn).toHaveBeenCalledWith('staff-test-mode', {
      trackExposure: false,
    })
  })
})
