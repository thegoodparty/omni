import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { useVoterOutreachV2Flag } from '@shared/experiments/voterOutreachV2Flag'
import { OutreachPageGate } from './OutreachPageGate'
import type { Campaign } from 'helpers/types'

vi.mock('@shared/experiments/voterOutreachV2Flag', () => ({
  useVoterOutreachV2Flag: vi.fn(),
}))
vi.mock('app/dashboard/outreach/components/OutreachPage', () => ({
  OutreachPage: () => <div data-testid="legacy-outreach-page" />,
}))
vi.mock('./OutreachHubPage', () => ({
  OutreachHubPage: () => <div data-testid="v2-outreach-hub" />,
}))

const mockedUseFlag = vi.mocked(useVoterOutreachV2Flag)

const props = {
  pathname: '/dashboard/outreach',
  campaign: { id: 1 } as Campaign,
}

describe('OutreachPageGate — whole-page outreach v2 gate', () => {
  it('renders the legacy page when the flag is off', () => {
    mockedUseFlag.mockReturnValue({ ready: true, enabled: false })

    render(<OutreachPageGate {...props} />)

    expect(screen.getByTestId('legacy-outreach-page')).toBeInTheDocument()
    expect(screen.queryByTestId('v2-outreach-hub')).not.toBeInTheDocument()
  })

  it('renders the legacy page while the flag has not settled', () => {
    mockedUseFlag.mockReturnValue({ ready: false, enabled: true })

    render(<OutreachPageGate {...props} />)

    expect(screen.getByTestId('legacy-outreach-page')).toBeInTheDocument()
    expect(screen.queryByTestId('v2-outreach-hub')).not.toBeInTheDocument()
  })

  it('renders only the v2 hub when the flag is on and settled', () => {
    mockedUseFlag.mockReturnValue({ ready: true, enabled: true })

    render(<OutreachPageGate {...props} />)

    expect(screen.getByTestId('v2-outreach-hub')).toBeInTheDocument()
    expect(screen.queryByTestId('legacy-outreach-page')).not.toBeInTheDocument()
  })
})
