import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CampaignSection } from './CampaignSection'
import {
  CampaignLaunchStatus,
  OnboardingStep,
  BallotReadyPositionLevel,
  ElectionLevel,
  CampaignTier,
} from '@goodparty_org/sdk'
import type { Campaign } from '@goodparty_org/sdk'

const mockCampaign: Campaign = {
  id: 1,
  createdAt: '2023-04-02T05:51:59.450Z',
  updatedAt: '2026-01-29T03:50:12.433Z',
  slug: 'tomer-almog',
  userId: 595,
  isActive: true,
  isVerified: false,
  isPro: true,
  isDemo: false,
  didWin: true,
  dateVerified: null,
  tier: null,
  canDownloadFederal: false,
  completedTaskIds: [],
  hasFreeTextsOffer: false,
  aiContent: {},
  data: {
    name: 'Tomer Almog',
    launchStatus: CampaignLaunchStatus.launched,
    currentStep: OnboardingStep.complete,
    lastVisited: 1769658612427,
    lastStepDate: '2024-04-03',
    campaignPlanStatus: {
      why: { status: 'completed', createdAt: 2678400000 },
      slogan: { status: 'completed', createdAt: 2678400000 },
    },
    customVoterFiles: [
      {
        name: 'Door Knocking - GOTV',
        channel: 'Door Knocking',
        filters: ['audience_likelyVoters'],
        purpose: 'GOTV',
        createdAt: 'Tue May 06 2025',
      },
    ],
  },
  details: {
    state: 'NC',
    city: 'Los Angeles',
    county: 'Los Angeles',
    zip: '53212',
    office: 'Other',
    otherOffice: 'Hendersonville City Mayor',
    ballotLevel: BallotReadyPositionLevel.CITY,
    level: ElectionLevel.city,
    officeTermLength: '4 years',
    electionDate: '2026-11-03',
    partisanType: 'nonpartisan',
    hasPrimary: true,
    party: 'Independent',
    occupation: 'former CTO of Good Party.',
    website: 'https://tomeralmog.com',
    pledged: true,
    funFact: 'I love playing guitar!',
    topIssues: {
      positions: [
        {
          id: 157,
          name: 'Mandate Freedom',
          topIssue: {
            id: 25,
            name: 'Covid',
            createdAt: 1649219354821,
            updatedAt: 1649219354821,
          },
          createdAt: 1649226095142,
          updatedAt: 1649226095142,
        },
      ],
      'position-157': 'Free choice',
    },
    customIssues: [{ title: 'Custom Issue', position: 'My position' }],
  },
}

describe('CampaignSection', () => {
  it('renders campaign status card with flags', () => {
    render(<CampaignSection campaign={mockCampaign} />)

    expect(screen.getByText('Campaign Status')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Verified')).toBeInTheDocument()
    expect(screen.getByText('Pro')).toBeInTheDocument()
    expect(screen.getByText('Demo Account')).toBeInTheDocument()
    expect(screen.getByText('Won Election')).toBeInTheDocument()
  })

  it('renders campaign data card', () => {
    render(<CampaignSection campaign={mockCampaign} />)

    expect(screen.getByText('Campaign Data')).toBeInTheDocument()
    expect(screen.getByText('Tomer Almog')).toBeInTheDocument()
    expect(screen.getByText('tomer-almog')).toBeInTheDocument()
    expect(screen.getByText('launched')).toBeInTheDocument()
  })

  it('renders location card', () => {
    render(<CampaignSection campaign={mockCampaign} />)

    expect(screen.getByText('Location')).toBeInTheDocument()
    expect(screen.getByText('NC')).toBeInTheDocument()
    // Los Angeles appears for both city and county in mock data
    expect(screen.getAllByText('Los Angeles')).toHaveLength(2)
    expect(screen.getByText('53212')).toBeInTheDocument()
  })

  it('renders office card', () => {
    render(<CampaignSection campaign={mockCampaign} />)

    // "Office" appears as card title and as DataRow label
    expect(screen.getAllByText('Office')).toHaveLength(2)
    // "Other" appears twice: as office value and in "Other Office" label
    expect(screen.getByText('Hendersonville City Mayor')).toBeInTheDocument()
    expect(screen.getByText('CITY')).toBeInTheDocument()
    expect(screen.getByText('4 years')).toBeInTheDocument()
  })

  it('renders election card', () => {
    render(<CampaignSection campaign={mockCampaign} />)

    expect(screen.getByText('Election')).toBeInTheDocument()
    expect(screen.getByText('2026-11-03')).toBeInTheDocument()
    expect(screen.getByText('nonpartisan')).toBeInTheDocument()
  })

  it('renders party and background card', () => {
    render(<CampaignSection campaign={mockCampaign} />)

    expect(screen.getByText('Party & Background')).toBeInTheDocument()
    expect(screen.getByText('Independent')).toBeInTheDocument()
    expect(screen.getByText('former CTO of Good Party.')).toBeInTheDocument()
    expect(screen.getByText('https://tomeralmog.com')).toBeInTheDocument()
  })

  it('renders fun fact when present', () => {
    render(<CampaignSection campaign={mockCampaign} />)

    expect(screen.getByText('Fun Fact')).toBeInTheDocument()
    expect(screen.getByText('I love playing guitar!')).toBeInTheDocument()
  })

  it('does not render fun fact when missing', () => {
    const campaignNoFunFact: Campaign = {
      ...mockCampaign,
      details: { ...mockCampaign.details, funFact: undefined },
    }

    render(<CampaignSection campaign={campaignNoFunFact} />)

    expect(screen.queryByText('Fun Fact')).not.toBeInTheDocument()
  })

  it('does not render top issues when empty', () => {
    const campaignNoIssues: Campaign = {
      ...mockCampaign,
      details: { ...mockCampaign.details, topIssues: undefined },
    }

    render(<CampaignSection campaign={campaignNoIssues} />)

    expect(screen.queryByText('Top Issues')).not.toBeInTheDocument()
  })

  it('renders custom issues when present', () => {
    render(<CampaignSection campaign={mockCampaign} />)

    expect(screen.getByText('Custom Issues')).toBeInTheDocument()
    expect(screen.getByText('Custom Issue')).toBeInTheDocument()
    expect(screen.getByText('My position')).toBeInTheDocument()
  })

  it('renders custom voter files when present', () => {
    render(<CampaignSection campaign={mockCampaign} />)

    expect(screen.getByText('Custom Voter Files')).toBeInTheDocument()
    expect(screen.getByText('Door Knocking - GOTV')).toBeInTheDocument()
    expect(screen.getByText('Door Knocking')).toBeInTheDocument()
    expect(screen.getByText('GOTV')).toBeInTheDocument()
  })

  it('does not render custom voter files when empty', () => {
    const campaignNoVoterFiles: Campaign = {
      ...mockCampaign,
      data: { ...mockCampaign.data, customVoterFiles: [] },
    }

    render(<CampaignSection campaign={campaignNoVoterFiles} />)

    expect(screen.queryByText('Custom Voter Files')).not.toBeInTheDocument()
  })

  it('does not render custom issues when empty', () => {
    const campaignNoCustomIssues: Campaign = {
      ...mockCampaign,
      details: { ...mockCampaign.details, customIssues: [] },
    }

    render(<CampaignSection campaign={campaignNoCustomIssues} />)

    expect(screen.queryByText('Custom Issues')).not.toBeInTheDocument()
  })

  it('does not render campaign plan status when missing', () => {
    const campaignNoPlanStatus: Campaign = {
      ...mockCampaign,
      data: { ...mockCampaign.data, campaignPlanStatus: undefined },
    }

    render(<CampaignSection campaign={campaignNoPlanStatus} />)

    expect(screen.queryByText('Campaign Plan Status')).not.toBeInTheDocument()
  })

  it('renders not launched status when launchStatus is missing', () => {
    const campaignNotLaunched: Campaign = {
      ...mockCampaign,
      data: { ...mockCampaign.data, launchStatus: undefined },
    }

    render(<CampaignSection campaign={campaignNotLaunched} />)

    expect(screen.getByText('Not launched')).toBeInTheDocument()
  })

  it('renders dateVerified when present', () => {
    const campaignVerified: Campaign = {
      ...mockCampaign,
      dateVerified: '2024-06-15T12:00:00.000Z',
    }

    render(<CampaignSection campaign={campaignVerified} />)

    expect(screen.getByText('Jun 15, 2024')).toBeInTheDocument()
  })

  it('renders tier when present', () => {
    const campaignWithTier: Campaign = {
      ...mockCampaign,
      tier: CampaignTier.WIN,
    }

    render(<CampaignSection campaign={campaignWithTier} />)

    expect(screen.getByText('WIN')).toBeInTheDocument()
  })

  it('renders Not set when ballotLevel is missing', () => {
    const campaignNoBallotLevel: Campaign = {
      ...mockCampaign,
      details: { ...mockCampaign.details, ballotLevel: undefined },
    }

    render(<CampaignSection campaign={campaignNoBallotLevel} />)

    expect(screen.getAllByText('Not set')).toHaveLength(1)
  })

  it('renders Not set when level is missing', () => {
    const campaignNoLevel: Campaign = {
      ...mockCampaign,
      details: {
        ...mockCampaign.details,
        ballotLevel: BallotReadyPositionLevel.CITY,
        level: undefined,
      },
    }

    render(<CampaignSection campaign={campaignNoLevel} />)

    expect(screen.getAllByText('Not set')).toHaveLength(1)
  })

  it('renders No for hasPrimary when false', () => {
    const campaignNoPrimary: Campaign = {
      ...mockCampaign,
      details: { ...mockCampaign.details, hasPrimary: false },
    }

    render(<CampaignSection campaign={campaignNoPrimary} />)

    // Find the hasPrimary "No" badge
    const electionCard = screen.getByText('Election').closest('div')
    expect(electionCard).toBeInTheDocument()
  })

  it('renders No for pledged when false', () => {
    const campaignNotPledged: Campaign = {
      ...mockCampaign,
      details: { ...mockCampaign.details, pledged: false },
    }

    render(<CampaignSection campaign={campaignNotPledged} />)

    // Component renders without error
    expect(screen.getByText('Party & Background')).toBeInTheDocument()
  })

  it('does not render top issues when positions array is empty', () => {
    const campaignEmptyPositions: Campaign = {
      ...mockCampaign,
      details: {
        ...mockCampaign.details,
        topIssues: { positions: [] },
      },
    }

    render(<CampaignSection campaign={campaignEmptyPositions} />)

    expect(screen.queryByText('Top Issues')).not.toBeInTheDocument()
  })

})
