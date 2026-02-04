import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CampaignSection } from './CampaignSection'
import type { Campaign } from '../types'

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
  data: {
    name: 'Tomer Almog',
    launchStatus: 'launched',
    currentStep: 'onboarding-complete',
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
    ballotLevel: 'CITY',
    level: 'city',
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

  it('renders top issues when present', () => {
    render(<CampaignSection campaign={mockCampaign} />)

    expect(screen.getByText('Top Issues')).toBeInTheDocument()
    expect(screen.getByText('Covid')).toBeInTheDocument()
    expect(screen.getByText('Mandate Freedom')).toBeInTheDocument()
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

  it('renders campaign plan status when present', () => {
    render(<CampaignSection campaign={mockCampaign} />)

    expect(screen.getByText('Campaign Plan Status')).toBeInTheDocument()
    expect(screen.getByText('why')).toBeInTheDocument()
    expect(screen.getByText('slogan')).toBeInTheDocument()
  })

  it('renders custom voter files when present', () => {
    render(<CampaignSection campaign={mockCampaign} />)

    expect(screen.getByText('Custom Voter Files')).toBeInTheDocument()
    expect(screen.getByText('Door Knocking - GOTV')).toBeInTheDocument()
    expect(screen.getByText('Door Knocking')).toBeInTheDocument()
    expect(screen.getByText('GOTV')).toBeInTheDocument()
  })
})
