import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, testQueryClient } from 'helpers/test-utils/render'
import type { Campaign } from 'helpers/types'
import type { ElectedOffice } from 'gpApi/api-endpoints'

let mockOrg: {
  slug?: string
  electedOfficeId?: string | null
  position?: { state?: string } | null
}
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => mockOrg,
  ORGANIZATIONS_QUERY_KEY: ['organizations'],
}))

let mockPositionName: string
vi.mock('@shared/hooks/usePositionName', () => ({
  usePositionName: () => mockPositionName,
}))

let mockUser: { zip?: string | null } | null
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [mockUser],
}))

let mockElectedOffice: ElectedOffice | null
vi.mock('@shared/hooks/useElectedOffice', () => ({
  useElectedOffice: () => ({ data: mockElectedOffice }),
}))

vi.mock('app/onboarding/shared/ajaxActions', () => ({
  getCampaign: vi.fn().mockResolvedValue(false),
}))

// Stub both office-change modals so the test asserts *which* flow opens
// without pulling in the heavy ballot/office pickers.
vi.mock('app/dashboard/shared/CampaignOfficeSelectionModal', () => ({
  CampaignOfficeSelectionModal: ({ show }: { show?: boolean }) =>
    show ? <div>campaign-office-modal</div> : null,
}))
vi.mock('app/dashboard/shared/ElectedOfficeSelectionModal', () => ({
  ElectedOfficeSelectionModal: ({ show }: { show?: boolean }) =>
    show ? <div>elected-office-modal</div> : null,
}))

vi.mock('helpers/analyticsHelper', async (importActual) => {
  const actual =
    await importActual<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

import OfficeDetailsCard from './OfficeDetailsCard'

const campaign = (details: Record<string, unknown>): Campaign =>
  ({ id: 1, slug: 'campaign-1', details }) as unknown as Campaign

const electedOffice = (overrides: Partial<ElectedOffice>): ElectedOffice =>
  ({
    id: 'eo-1',
    swornInDate: null,
    electedDate: null,
    termStartDate: null,
    termEndDate: null,
    termLengthDays: null,
    isActive: true,
    party: null,
    pledgedAt: null,
    ...overrides,
  }) as ElectedOffice

beforeEach(() => {
  vi.clearAllMocks()
  testQueryClient.clear()
})

describe('OfficeDetailsCard — candidate (campaign) mode', () => {
  beforeEach(() => {
    mockOrg = {
      slug: 'campaign-1',
      electedOfficeId: null,
      position: { state: 'ME' },
    }
    mockPositionName = 'Mayor'
    mockUser = { zip: '04841' }
    mockElectedOffice = null
  })

  it('shows the election date and campaign location, not term length', () => {
    render(
      <OfficeDetailsCard
        campaign={campaign({
          city: 'Rockland',
          state: 'ME',
          zip: '04841',
          electionDate: '2026-11-03',
        })}
      />,
    )

    expect(screen.getByText('Mayor')).toBeInTheDocument()
    expect(screen.getByText('Rockland, ME, 04841')).toBeInTheDocument()
    expect(screen.getByText('Election date')).toBeInTheDocument()
    expect(screen.queryByText('Term length')).not.toBeInTheDocument()
  })

  it('opens the campaign office-selection flow on "Change office"', async () => {
    const user = userEvent.setup()
    render(<OfficeDetailsCard campaign={campaign({ state: 'ME' })} />)

    await user.click(screen.getByRole('button', { name: /change office/i }))

    expect(screen.getByText('campaign-office-modal')).toBeInTheDocument()
    expect(screen.queryByText('elected-office-modal')).not.toBeInTheDocument()
  })
})

describe('OfficeDetailsCard — elected official mode', () => {
  beforeEach(() => {
    mockOrg = {
      slug: 'eo-1',
      electedOfficeId: 'eo-1',
      position: { state: 'ME' },
    }
    mockPositionName = 'City Council'
    mockUser = { zip: '04841' }
    mockElectedOffice = electedOffice({
      termStartDate: '2023-01-01',
      termEndDate: '2027-01-01',
    })
  })

  it('derives term length from the elected office and uses org state + user zip', () => {
    render(<OfficeDetailsCard campaign={undefined} />)

    expect(screen.getByText('City Council')).toBeInTheDocument()
    // Location falls back to org state + the official's saved ZIP (no campaign).
    expect(screen.getByText('ME, 04841')).toBeInTheDocument()
    // 2023-01-01 → 2027-01-01 is a 4-year term.
    expect(screen.getByText('Term length')).toBeInTheDocument()
    expect(screen.getByText('4 years')).toBeInTheDocument()
    expect(screen.queryByText('Election date')).not.toBeInTheDocument()
  })

  it('opens the elected-office change flow on "Change office"', async () => {
    const user = userEvent.setup()
    render(<OfficeDetailsCard campaign={undefined} />)

    await user.click(screen.getByRole('button', { name: /change office/i }))

    expect(screen.getByText('elected-office-modal')).toBeInTheDocument()
    expect(screen.queryByText('campaign-office-modal')).not.toBeInTheDocument()
  })
})
