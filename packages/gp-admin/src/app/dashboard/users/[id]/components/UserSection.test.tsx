import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UserSection } from './UserSection'
import { UserProvider } from '../context/UserContext'
import { UserRole, type User } from '@goodparty_org/sdk'

const mockUser: User = {
  id: 123,
  firstName: 'John',
  lastName: 'Doe',
  name: 'John Doe',
  avatar: 'https://example.com/avatar.jpg',
  email: 'john@example.com',
  phone: '5551234567',
  zip: '12345',
  hasPassword: true,
  roles: [UserRole.admin, UserRole.candidate],
  metaData: {
    hubspotId: 'hs_12345',
    textNotifications: true,
  },
}

function renderWithUser(user: User) {
  return render(
    <UserProvider user={user}>
      <UserSection />
    </UserProvider>
  )
}

describe('UserSection', () => {
  it('renders personal information card', () => {
    renderWithUser(mockUser)

    expect(screen.getByText('Personal Information')).toBeInTheDocument()
    expect(screen.getByText('123')).toBeInTheDocument()
    expect(screen.getByText('John')).toBeInTheDocument()
    expect(screen.getByText('Doe')).toBeInTheDocument()
    expect(screen.getByText('john@example.com')).toBeInTheDocument()
    expect(screen.getByText('12345')).toBeInTheDocument()
  })

  it('formats phone number', () => {
    renderWithUser(mockUser)

    expect(screen.getByText('(555) 123-4567')).toBeInTheDocument()
  })

  it('renders metadata card', () => {
    renderWithUser(mockUser)

    expect(screen.getByText('Metadata')).toBeInTheDocument()
    expect(screen.getByText('hs_12345')).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
  })

  it('shows Disabled for text notifications when false', () => {
    renderWithUser({
      ...mockUser,
      metaData: { textNotifications: false },
    })

    expect(screen.getByText('Disabled')).toBeInTheDocument()
  })

  it('renders roles', () => {
    renderWithUser(mockUser)

    expect(screen.getByText('Roles')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('candidate')).toBeInTheDocument()
  })

  it('shows no roles message when user has no roles', () => {
    renderWithUser({ ...mockUser, roles: [] })

    expect(screen.getByText('No roles assigned')).toBeInTheDocument()
  })

  it('handles undefined metadata', () => {
    renderWithUser({ ...mockUser, metaData: undefined })

    expect(screen.getByText('Metadata')).toBeInTheDocument()
    expect(screen.getByText('Disabled')).toBeInTheDocument()
  })
})
