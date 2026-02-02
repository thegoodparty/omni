import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { UserInfoSection } from './UserInfoSection'
import { renderWithUser, mockUser } from './test-utils'

describe('UserInfoSection', () => {
  describe('rendering', () => {
    it('renders personal information card', () => {
      renderWithUser(<UserInfoSection />)

      expect(screen.getByText('Personal Information')).toBeInTheDocument()
    })

    it('displays user IDs', () => {
      renderWithUser(<UserInfoSection />)

      expect(screen.getByText('User ID')).toBeInTheDocument()
      expect(screen.getByText('123')).toBeInTheDocument()
      expect(screen.getByText('Campaign ID')).toBeInTheDocument()
      expect(screen.getByText('1')).toBeInTheDocument()
    })

    it('displays user slug', () => {
      renderWithUser(<UserInfoSection />)

      expect(screen.getByText('Slug')).toBeInTheDocument()
      expect(screen.getByText('test-user')).toBeInTheDocument()
    })

    it('displays user name fields', () => {
      renderWithUser(<UserInfoSection />)

      expect(screen.getByText('First Name')).toBeInTheDocument()
      expect(screen.getByText('Test')).toBeInTheDocument()
      expect(screen.getByText('Last Name')).toBeInTheDocument()
      expect(screen.getByText('User')).toBeInTheDocument()
      expect(screen.getByText('Display Name')).toBeInTheDocument()
      expect(screen.getByText('Test User')).toBeInTheDocument()
    })

    it('displays formatted phone number', () => {
      renderWithUser(<UserInfoSection />)

      expect(screen.getByText('Phone')).toBeInTheDocument()
      // Phone is formatted by formatPhone utility
      expect(screen.getByText('(555) 123-4567')).toBeInTheDocument()
    })

    it('displays ZIP code', () => {
      renderWithUser(<UserInfoSection />)

      expect(screen.getByText('ZIP')).toBeInTheDocument()
      expect(screen.getByText('12345')).toBeInTheDocument()
    })
  })

  describe('metadata card', () => {
    it('renders metadata card', () => {
      renderWithUser(<UserInfoSection />)

      expect(screen.getByText('Metadata')).toBeInTheDocument()
    })

    it('displays HubSpot ID', () => {
      renderWithUser(<UserInfoSection />)

      expect(screen.getByText('HubSpot ID')).toBeInTheDocument()
      expect(screen.getByText('HS-98765')).toBeInTheDocument()
    })

    it('displays text notifications status', () => {
      renderWithUser(<UserInfoSection />)

      expect(screen.getByText('Text Notifications')).toBeInTheDocument()
      expect(screen.getByText('Unknown')).toBeInTheDocument()
    })
  })

  describe('roles card', () => {
    it('renders roles card', () => {
      renderWithUser(<UserInfoSection />)

      expect(screen.getByText('Roles')).toBeInTheDocument()
    })

    it('displays candidate role badge', () => {
      renderWithUser(<UserInfoSection />)

      expect(screen.getByText('candidate')).toBeInTheDocument()
    })
  })

  describe('with different user data', () => {
    it('handles missing phone gracefully', () => {
      const userWithoutPhone = {
        ...mockUser,
        details: { ...mockUser.details, phone: '' },
      }
      renderWithUser(<UserInfoSection />, userWithoutPhone)

      expect(screen.getByText('Phone')).toBeInTheDocument()
    })
  })
})
