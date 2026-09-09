import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import DashboardContent from './DashboardContent'

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ firstName: 'Renee' }],
}))

// Echoes hideChatDock so the flag tests can assert the footer dock is dropped
// on the conversational home (two chats on screen otherwise).
const layoutPropsMock = vi.fn()
vi.mock('../shared/DashboardLayout', () => ({
  default: ({
    children,
    ...rest
  }: {
    children: ReactNode
    hideChatDock?: boolean
  }) => {
    layoutPropsMock(rest)
    return <div>{children}</div>
  },
}))
vi.mock('../shared/WebsiteSunsetModalController', () => ({
  WebsiteSunsetModalController: () => null,
}))
vi.mock('../campaign-manager/CampaignManagerHome', () => ({
  default: () => <div data-testid="campaign-manager-home" />,
}))
vi.mock('../campaign-manager/CampaignManagerChatHome', () => ({
  default: () => <div data-testid="campaign-manager-chat-home" />,
}))

const flagMock = vi.fn()
vi.mock('@shared/experiments/campaignManagerChatHomeFlag', () => ({
  useCampaignManagerChatHomeFlag: () => flagMock(),
}))

const props = {
  pathname: '/dashboard',
  tcrCompliance: null,
  sunsetEligible: false,
}

beforeEach(() => {
  layoutPropsMock.mockClear()
  flagMock.mockReturnValue({ ready: true, enabled: false })
})

describe('DashboardContent', () => {
  it('renders the campaign manager home', () => {
    render(<DashboardContent {...props} />)

    expect(screen.getByTestId('campaign-manager-home')).toBeInTheDocument()
    expect(layoutPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({ hideChatDock: false }),
    )
  })

  it('renders the conversational home when the flag is on, without the dock', () => {
    flagMock.mockReturnValue({ ready: true, enabled: true })
    render(<DashboardContent {...props} />)

    expect(screen.getByTestId('campaign-manager-chat-home')).toBeInTheDocument()
    expect(
      screen.queryByTestId('campaign-manager-home'),
    ).not.toBeInTheDocument()
    expect(layoutPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({ hideChatDock: true }),
    )
  })

  // `ready` never flips true when the flag provider can't resolve (no seed and
  // a failed refresh), so an unresolved read must fall back to a working home
  // rather than blank the dashboard.
  it('falls back to the card home while the flag is unresolved', () => {
    flagMock.mockReturnValue({ ready: false, enabled: false })
    render(<DashboardContent {...props} />)

    expect(screen.getByTestId('campaign-manager-home')).toBeInTheDocument()
  })
})
