import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { CampaignDetailsDisplaySection } from './CampaignDetailsDisplaySection'
import { renderWithUser, mockUser } from './test-utils'

describe('CampaignDetailsDisplaySection', () => {
  describe('location card', () => {
    it('renders location card', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Location')).toBeInTheDocument()
    })

    it('displays state', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('State')).toBeInTheDocument()
      expect(screen.getByText('CA')).toBeInTheDocument()
    })

    it('displays city', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('City')).toBeInTheDocument()
      expect(screen.getByText('Test City')).toBeInTheDocument()
    })

    it('displays county', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('County')).toBeInTheDocument()
      expect(screen.getByText('Test County')).toBeInTheDocument()
    })

    it('displays geo location coordinates', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Geo Location')).toBeInTheDocument()
      expect(screen.getByText('34.0522, -118.2437')).toBeInTheDocument()
    })

    it('displays dash when geo location is missing', () => {
      const userNoGeo = {
        ...mockUser,
        details: { ...mockUser.details, geoLocation: {} },
      }
      renderWithUser(<CampaignDetailsDisplaySection />, userNoGeo)

      const geoRow = screen.getByText('Geo Location').closest('div')
      expect(geoRow).toHaveTextContent('—')
    })
  })

  describe('office card', () => {
    it('renders office card with office name', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      // Office appears as both card title and field label
      expect(screen.getByText('Mayor')).toBeInTheDocument()
    })

    it('displays other office field', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Other Office')).toBeInTheDocument()
    })

    it('displays ballot level badge', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Ballot Level')).toBeInTheDocument()
      expect(screen.getByText('CITY')).toBeInTheDocument()
    })

    it('displays election level badge', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Election Level')).toBeInTheDocument()
      expect(screen.getByText('city')).toBeInTheDocument()
    })

    it('displays term length', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Term Length')).toBeInTheDocument()
      expect(screen.getByText('4 years')).toBeInTheDocument()
    })
  })

  describe('election card', () => {
    it('renders election card', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Election')).toBeInTheDocument()
    })

    it('displays election date', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Election Date')).toBeInTheDocument()
    })

    it('displays partisan type', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Partisan Type')).toBeInTheDocument()
      expect(screen.getByText('nonpartisan')).toBeInTheDocument()
    })

    it('displays has primary status', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Has Primary')).toBeInTheDocument()
    })
  })

  describe('filing period card', () => {
    it('renders filing period card', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Filing Period')).toBeInTheDocument()
    })

    it('displays filing start date', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Filing Start')).toBeInTheDocument()
    })

    it('displays filing end date', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Filing End')).toBeInTheDocument()
    })
  })

  describe('party card', () => {
    it('renders party card with party badge', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      // Party appears as both card title and field label, check for Independent badge
      expect(screen.getByText('Independent')).toBeInTheDocument()
    })

    it('displays other party field', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Other Party')).toBeInTheDocument()
    })
  })

  describe('background card', () => {
    it('renders background card', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Background')).toBeInTheDocument()
    })

    it('displays occupation', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Occupation')).toBeInTheDocument()
      expect(screen.getByText('Engineer')).toBeInTheDocument()
    })

    it('displays website link', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Website')).toBeInTheDocument()
      const websiteLink = screen.getByRole('link', {
        name: 'https://example.com',
      })
      expect(websiteLink).toHaveAttribute('href', 'https://example.com')
    })

    it('displays pledged status', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Pledged')).toBeInTheDocument()
    })
  })

  describe('fun fact card', () => {
    it('renders fun fact when present', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Fun Fact')).toBeInTheDocument()
      expect(screen.getByText('Test fun fact')).toBeInTheDocument()
    })

    it('does not render fun fact when empty', () => {
      const userNoFunFact = {
        ...mockUser,
        details: { ...mockUser.details, funFact: '' },
      }
      renderWithUser(<CampaignDetailsDisplaySection />, userNoFunFact)

      expect(screen.queryByText('Fun Fact')).not.toBeInTheDocument()
    })
  })

  describe('past experience card', () => {
    it('renders past experience when present', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Past Experience')).toBeInTheDocument()
      expect(
        screen.getByText('Previous experience details')
      ).toBeInTheDocument()
    })

    it('does not render past experience when empty', () => {
      const userNoPastExp = {
        ...mockUser,
        details: { ...mockUser.details, pastExperience: '' },
      }
      renderWithUser(<CampaignDetailsDisplaySection />, userNoPastExp)

      expect(screen.queryByText('Past Experience')).not.toBeInTheDocument()
    })
  })

  describe('opponents card', () => {
    it('renders opponents when present', () => {
      renderWithUser(<CampaignDetailsDisplaySection />)

      expect(screen.getByText('Opponents')).toBeInTheDocument()
      expect(screen.getByText('Jane Smith')).toBeInTheDocument()
      expect(screen.getByText('Democrat')).toBeInTheDocument()
      expect(screen.getByText('Incumbent candidate')).toBeInTheDocument()
    })

    it('does not render opponents when empty', () => {
      const userNoOpponents = {
        ...mockUser,
        details: { ...mockUser.details, runningAgainst: [] },
      }
      renderWithUser(<CampaignDetailsDisplaySection />, userNoOpponents)

      expect(screen.queryByText('Opponents')).not.toBeInTheDocument()
    })
  })
})
