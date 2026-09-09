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

const organizationMock = vi.fn()
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => organizationMock(),
}))

const routerReplaceMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}))

const props = {
  pathname: '/dashboard',
  tcrCompliance: null,
  sunsetEligible: false,
}

beforeEach(() => {
  layoutPropsMock.mockClear()
  routerReplaceMock.mockClear()
  flagMock.mockReturnValue({ ready: true, enabled: false })
  organizationMock.mockReturnValue({ slug: 'renee-for-council' })
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

  // The server redirects a Serve org away from /dashboard at page load, but the
  // org picker switches client-side without navigating, which would leave the
  // Win home mounted and answering as the Campaign Manager under an
  // elected-office org.
  it('redirects a Serve org away instead of rendering the Win home', () => {
    flagMock.mockReturnValue({ ready: true, enabled: true })
    organizationMock.mockReturnValue({
      slug: 'mayor-office',
      electedOfficeId: 42,
    })
    render(<DashboardContent {...props} />)

    expect(routerReplaceMock).toHaveBeenCalledWith('/dashboard/chief-of-staff')
    expect(
      screen.queryByTestId('campaign-manager-chat-home'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('campaign-manager-home'),
    ).not.toBeInTheDocument()
  })
})
