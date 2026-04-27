import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CampaignListTable } from './CampaignListTable'
import type { CampaignWithPositionName } from '@goodparty_org/sdk'
import {
  CampaignLaunchStatus,
  OnboardingStep,
  BallotReadyPositionLevel,
  ElectionLevel,
} from '@goodparty_org/sdk'

const baseCampaign: CampaignWithPositionName = {
  id: 1,
  createdAt: new Date('2023-04-02T05:51:59.450Z'),
  updatedAt: new Date('2026-01-29T03:50:12.433Z'),
  slug: 'test-campaign',
  userId: 595,
  isActive: true,
  isVerified: false,
  isPro: false,
  isDemo: false,
  didWin: false,
  dateVerified: null,
  tier: null,
  canDownloadFederal: false,
  completedTaskIds: [],
  hasFreeTextsOffer: false,
  aiContent: {},
  data: {
    name: 'Test Campaign',
    launchStatus: CampaignLaunchStatus.launched,
    currentStep: OnboardingStep.complete,
  },
  details: {
    state: 'CA',
    ballotLevel: BallotReadyPositionLevel.CITY,
    level: ElectionLevel.city,
  },
  positionName: 'Mayor',
}

const mockCampaigns: CampaignWithPositionName[] = [
  baseCampaign,
  {
    ...baseCampaign,
    id: 2,
    slug: 'second-campaign',
    isActive: false,
    data: { name: 'Second Campaign' },
    details: {},
    positionName: 'Governor',
    tier: 'WIN' as CampaignWithPositionName['tier'],
  },
]

describe('CampaignListTable', () => {
  it('renders empty state when no campaigns', () => {
    render(
      <CampaignListTable
        campaigns={[]}
        basePath="/dashboard/users/1/campaign"
      />
    )

    expect(
      screen.getByText('No campaigns found for this user.')
    ).toBeInTheDocument()
  })

  it('does not render a table when campaigns are empty', () => {
    render(
      <CampaignListTable
        campaigns={[]}
        basePath="/dashboard/users/1/campaign"
      />
    )

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('renders table headers', () => {
    render(
      <CampaignListTable
        campaigns={mockCampaigns}
        basePath="/dashboard/users/1/campaign"
      />
    )

    expect(screen.getByText('ID')).toBeInTheDocument()
    expect(screen.getByText('Campaign')).toBeInTheDocument()
    expect(screen.getByText('Position')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Tier')).toBeInTheDocument()
  })

  it('renders campaign rows with correct data', () => {
    render(
      <CampaignListTable
        campaigns={mockCampaigns}
        basePath="/dashboard/users/1/campaign"
      />
    )

    expect(screen.getByText('Test Campaign')).toBeInTheDocument()
    expect(screen.getByText('Mayor')).toBeInTheDocument()
    expect(screen.getByText('Second Campaign')).toBeInTheDocument()
    expect(screen.getByText('Governor')).toBeInTheDocument()
  })

  it('renders campaign name as link to detail page', () => {
    render(
      <CampaignListTable
        campaigns={[baseCampaign]}
        basePath="/dashboard/users/595/campaign"
      />
    )

    const link = screen.getByRole('link', { name: 'Test Campaign' })
    expect(link).toHaveAttribute('href', '/dashboard/users/595/campaign/1')
  })

  it('falls back to Campaign #ID when name is missing', () => {
    const noNameCampaign: CampaignWithPositionName = {
      ...baseCampaign,
      id: 99,
      data: {},
    }

    render(
      <CampaignListTable
        campaigns={[noNameCampaign]}
        basePath="/dashboard/users/1/campaign"
      />
    )

    expect(screen.getByText('Campaign #99')).toBeInTheDocument()
  })

  it('shows Active badge for active campaigns', () => {
    render(
      <CampaignListTable
        campaigns={[baseCampaign]}
        basePath="/dashboard/users/1/campaign"
      />
    )

    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('shows Inactive badge for inactive campaigns', () => {
    const inactiveCampaign: CampaignWithPositionName = {
      ...baseCampaign,
      isActive: false,
    }

    render(
      <CampaignListTable
        campaigns={[inactiveCampaign]}
        basePath="/dashboard/users/1/campaign"
      />
    )

    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('shows dash when positionName is null', () => {
    const noPositionCampaign: CampaignWithPositionName = {
      ...baseCampaign,
      positionName: null,
    }

    render(
      <CampaignListTable
        campaigns={[noPositionCampaign]}
        basePath="/dashboard/users/1/campaign"
      />
    )

    // The \u2014 is the em dash character
    expect(screen.getAllByText('\u2014').length).toBeGreaterThanOrEqual(1)
  })

  it('uses basePath for link generation', () => {
    render(
      <CampaignListTable
        campaigns={[baseCampaign]}
        basePath="/dashboard/users/595/edit/campaign"
      />
    )

    const link = screen.getByRole('link', { name: 'Test Campaign' })
    expect(link).toHaveAttribute('href', '/dashboard/users/595/edit/campaign/1')
  })
})
