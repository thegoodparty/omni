import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { CampaignStatusSection } from './CampaignStatusSection'
import { renderWithUser, mockUser } from './test-utils'

describe('CampaignStatusSection', () => {
  describe('campaign status card', () => {
    it('renders campaign status card', () => {
      renderWithUser(<CampaignStatusSection />)

      expect(screen.getByText('Campaign Status')).toBeInTheDocument()
    })

    it('displays active status as Yes when true', () => {
      renderWithUser(<CampaignStatusSection />)

      expect(screen.getByText('Active')).toBeInTheDocument()
      // Find the Yes badge in the Active row
      const activeRow = screen.getByText('Active').closest('div')
      expect(activeRow).toHaveTextContent('Yes')
    })

    it('displays verified status', () => {
      renderWithUser(<CampaignStatusSection />)

      expect(screen.getByText('Verified')).toBeInTheDocument()
    })

    it('displays pro status', () => {
      renderWithUser(<CampaignStatusSection />)

      expect(screen.getByText('Pro')).toBeInTheDocument()
    })

    it('displays demo account status', () => {
      renderWithUser(<CampaignStatusSection />)

      expect(screen.getByText('Demo Account')).toBeInTheDocument()
    })

    it('displays won election status', () => {
      renderWithUser(<CampaignStatusSection />)

      expect(screen.getByText('Won Election')).toBeInTheDocument()
    })

    it('displays can download federal status', () => {
      renderWithUser(<CampaignStatusSection />)

      expect(screen.getByText('Can Download Federal')).toBeInTheDocument()
    })
  })

  describe('campaign tier card', () => {
    it('renders campaign tier card', () => {
      renderWithUser(<CampaignStatusSection />)

      expect(screen.getByText('Campaign Tier')).toBeInTheDocument()
    })

    it('displays tier value', () => {
      renderWithUser(<CampaignStatusSection />)

      expect(screen.getByText('Tier')).toBeInTheDocument()
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('displays None when tier is null', () => {
      const userWithoutTier = { ...mockUser, tier: null }
      renderWithUser(<CampaignStatusSection />, userWithoutTier)

      expect(screen.getByText('None')).toBeInTheDocument()
    })
  })

  describe('campaign data card', () => {
    it('renders campaign data card', () => {
      renderWithUser(<CampaignStatusSection />)

      expect(screen.getByText('Campaign Data')).toBeInTheDocument()
    })

    it('displays campaign name', () => {
      renderWithUser(<CampaignStatusSection />)

      expect(screen.getByText('Campaign Name')).toBeInTheDocument()
      expect(screen.getByText('Test User')).toBeInTheDocument()
    })

    it('displays launch status as launched', () => {
      renderWithUser(<CampaignStatusSection />)

      expect(screen.getByText('Launch Status')).toBeInTheDocument()
      expect(screen.getByText('launched')).toBeInTheDocument()
    })

    it('displays Not launched when launch status is empty', () => {
      const userNotLaunched = {
        ...mockUser,
        data: { ...mockUser.data, launchStatus: '' },
      }
      renderWithUser(<CampaignStatusSection />, userNotLaunched)

      expect(screen.getByText('Not launched')).toBeInTheDocument()
    })
  })

  describe('timeline card', () => {
    it('renders timeline card', () => {
      renderWithUser(<CampaignStatusSection />)

      expect(screen.getByText('Timeline')).toBeInTheDocument()
    })

    it('displays created date', () => {
      renderWithUser(<CampaignStatusSection />)

      expect(screen.getByText('Created')).toBeInTheDocument()
    })

    it('displays updated date', () => {
      renderWithUser(<CampaignStatusSection />)

      expect(screen.getByText('Updated')).toBeInTheDocument()
    })

    it('displays date verified', () => {
      renderWithUser(<CampaignStatusSection />)

      expect(screen.getByText('Date Verified')).toBeInTheDocument()
    })

    it('displays Not verified when dateVerified is null', () => {
      const userNotVerified = { ...mockUser, dateVerified: null }
      renderWithUser(<CampaignStatusSection />, userNotVerified)

      expect(screen.getByText('Not verified')).toBeInTheDocument()
    })

    it('displays last visited', () => {
      renderWithUser(<CampaignStatusSection />)

      expect(screen.getByText('Last Visited')).toBeInTheDocument()
    })

    it('displays current step', () => {
      renderWithUser(<CampaignStatusSection />)

      expect(screen.getByText('Current Step')).toBeInTheDocument()
      expect(screen.getByText('onboarding-complete')).toBeInTheDocument()
    })
  })

  describe('status flag variations', () => {
    it('displays No for inactive user', () => {
      const inactiveUser = { ...mockUser, isActive: false }
      renderWithUser(<CampaignStatusSection />, inactiveUser)

      const activeRow = screen.getByText('Active').closest('div')
      expect(activeRow).toHaveTextContent('No')
    })

    it('displays No for non-pro user', () => {
      const nonProUser = { ...mockUser, isPro: false }
      renderWithUser(<CampaignStatusSection />, nonProUser)

      const proRow = screen.getByText('Pro').closest('div')
      expect(proRow).toHaveTextContent('No')
    })
  })
})
