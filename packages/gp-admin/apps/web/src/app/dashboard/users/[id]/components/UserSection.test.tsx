import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UserSection } from './UserSection'
import type { User } from '../types'

const mockUser: User = {
  id: 123,
  createdAt: '2024-01-15T10:30:00.000Z',
  updatedAt: '2024-06-20T14:45:00.000Z',
  firstName: 'John',
  lastName: 'Doe',
  name: 'John Doe',
  avatar: 'https://example.com/avatar.jpg',
  email: 'john@example.com',
  phone: '5551234567',
  zip: '12345',
  roles: ['admin', 'candidate'],
  metaData: {
    hubspotId: 'hs_12345',
    textNotifications: true,
  },
}

describe('UserSection', () => {
  it('renders personal information card', () => {
    render(<UserSection user={mockUser} />)

    expect(screen.getByText('Personal Information')).toBeInTheDocument()
    expect(screen.getByText('123')).toBeInTheDocument()
    expect(screen.getByText('John')).toBeInTheDocument()
    expect(screen.getByText('Doe')).toBeInTheDocument()
    expect(screen.getByText('John Doe')).toBeInTheDocument()
    expect(screen.getByText('john@example.com')).toBeInTheDocument()
    expect(screen.getByText('12345')).toBeInTheDocument()
  })

  it('formats phone number', () => {
    render(<UserSection user={mockUser} />)

    expect(screen.getByText('(555) 123-4567')).toBeInTheDocument()
  })

  it('renders metadata card', () => {
    render(<UserSection user={mockUser} />)

    expect(screen.getByText('Metadata')).toBeInTheDocument()
    expect(screen.getByText('hs_12345')).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
  })

  it('shows Disabled for text notifications when false', () => {
    const userWithDisabledNotifications: User = {
      ...mockUser,
      metaData: { textNotifications: false },
    }

    render(<UserSection user={userWithDisabledNotifications} />)

    expect(screen.getByText('Disabled')).toBeInTheDocument()
  })

  it('renders roles', () => {
    render(<UserSection user={mockUser} />)

    expect(screen.getByText('Roles')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('candidate')).toBeInTheDocument()
  })

  it('shows no roles message when user has no roles', () => {
    const userNoRoles: User = {
      ...mockUser,
      roles: [],
    }

    render(<UserSection user={userNoRoles} />)

    expect(screen.getByText('No roles assigned')).toBeInTheDocument()
  })

  it('renders timestamps card', () => {
    render(<UserSection user={mockUser} />)

    expect(screen.getByText('Timestamps')).toBeInTheDocument()
    expect(screen.getByText('Jan 15, 2024')).toBeInTheDocument()
    expect(screen.getByText('Jun 20, 2024')).toBeInTheDocument()
  })

  it('handles null metadata', () => {
    const userNoMetadata: User = {
      ...mockUser,
      metaData: null,
    }

    render(<UserSection user={userNoMetadata} />)

    expect(screen.getByText('Metadata')).toBeInTheDocument()
    expect(screen.getByText('Disabled')).toBeInTheDocument()
  })
})
