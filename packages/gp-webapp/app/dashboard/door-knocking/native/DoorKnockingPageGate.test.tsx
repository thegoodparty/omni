import { render, screen } from '@testing-library/react'
import DoorKnockingPageGate from './DoorKnockingPageGate'

const flagState = { ready: true, enabled: false }

vi.mock('app/shared/experiments/nativeDoorKnockingFlag', () => ({
  useNativeDoorKnockingFlag: () => flagState,
}))
vi.mock('./NativeDoorKnockingPage', () => ({
  __esModule: true,
  default: () => <div data-testid="native-door-knocking" />,
}))
vi.mock('../components/DoorKnockingPage', () => ({
  __esModule: true,
  default: () => <div data-testid="ecanvasser-dashboard" />,
}))

const props = {
  pathname: '/dashboard/door-knocking',
  campaign: null,
}

describe('DoorKnockingPageGate', () => {
  it('renders the eCanvasser dashboard when the flag is off', () => {
    flagState.ready = true
    flagState.enabled = false
    render(<DoorKnockingPageGate {...props} />)
    expect(screen.getByTestId('ecanvasser-dashboard')).toBeInTheDocument()
    expect(screen.queryByTestId('native-door-knocking')).toBeNull()
  })

  it('renders the eCanvasser dashboard while the flag is unsettled', () => {
    flagState.ready = false
    flagState.enabled = true
    render(<DoorKnockingPageGate {...props} />)
    expect(screen.getByTestId('ecanvasser-dashboard')).toBeInTheDocument()
  })

  it('renders the native experience when the flag is on', () => {
    flagState.ready = true
    flagState.enabled = true
    render(<DoorKnockingPageGate {...props} />)
    expect(screen.getByTestId('native-door-knocking')).toBeInTheDocument()
    expect(screen.queryByTestId('ecanvasser-dashboard')).toBeNull()
  })
})
