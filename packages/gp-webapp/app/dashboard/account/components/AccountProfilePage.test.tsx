import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { Campaign, User } from 'helpers/types'
import AccountProfilePage from './AccountProfilePage'

const { mockFlag } = vi.hoisted(() => ({ mockFlag: vi.fn() }))

vi.mock('@shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => mockFlag(),
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ electedOfficeId: null }),
}))
vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('app/dashboard/shared/DashboardPageHeader', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}))
vi.mock('app/dashboard/profile/components/NotificationSection', () => ({
  default: () => null,
}))
vi.mock(
  'app/dashboard/profile/texting-compliance-agentic/components/ProUpgrade3Compliance',
  () => ({ default: () => null }),
)
vi.mock('./PersonalInformationCard', () => ({
  PersonalInformationCard: ({ title }: { title: string }) => <h2>{title}</h2>,
}))
vi.mock('./AccountInformationCard', () => ({
  AccountInformationCard: () => null,
}))
vi.mock('./DeleteAccountPage', () => ({ default: () => null }))

const user = { id: 1 } as unknown as User
const campaign = { id: 1 } as unknown as Campaign

describe('AccountProfilePage headings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses sentence case with the pricing flag on', () => {
    mockFlag.mockReturnValue({ enabled: true })
    render(<AccountProfilePage user={user} campaign={campaign} />)
    expect(screen.getByText('Account settings')).toBeInTheDocument()
    expect(screen.getByText('Candidate information')).toBeInTheDocument()
  })

  it('keeps title case with the flag off', () => {
    mockFlag.mockReturnValue({ enabled: false })
    render(<AccountProfilePage user={user} campaign={campaign} />)
    expect(screen.getByText('Account Settings')).toBeInTheDocument()
    expect(screen.getByText('Candidate Information')).toBeInTheDocument()
  })
})
