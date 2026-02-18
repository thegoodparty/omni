import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TabNavigation } from './TabNavigation'
import { UserProvider } from '../context/UserContext'
import type { User } from '@goodparty_org/sdk'

const mockUsePathname = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

function makeUser(id: number): User {
  return {
    id,
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.com',
    hasPassword: true,
  }
}

function renderWithUser(userId: number, props: { isEditMode?: boolean } = {}) {
  return render(
    <UserProvider user={makeUser(userId)}>
      <TabNavigation {...props} />
    </UserProvider>
  )
}

describe('TabNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('view mode', () => {
    it('renders all tab links', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123')

      renderWithUser(123)

      expect(screen.getByRole('link', { name: 'User' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Campaign' })).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Path to Victory' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Elected Office' })
      ).toBeInTheDocument()
    })

    it('generates correct hrefs for view mode', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/456')

      renderWithUser(456)

      expect(screen.getByRole('link', { name: 'User' })).toHaveAttribute(
        'href',
        '/dashboard/users/456'
      )
      expect(screen.getByRole('link', { name: 'Campaign' })).toHaveAttribute(
        'href',
        '/dashboard/users/456/campaign'
      )
      expect(
        screen.getByRole('link', { name: 'Path to Victory' })
      ).toHaveAttribute('href', '/dashboard/users/456/p2v')
      expect(
        screen.getByRole('link', { name: 'Elected Office' })
      ).toHaveAttribute('href', '/dashboard/users/456/elected-office')
    })

    it('marks User tab as current page on base route', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123')

      renderWithUser(123)

      expect(
        screen.getByRole('link', { name: 'User', current: 'page' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Campaign' })
      ).not.toHaveAttribute('aria-current')
    })

    it('marks Campaign tab as current page on campaign route', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123/campaign')

      renderWithUser(123)

      expect(
        screen.getByRole('link', { name: 'Campaign', current: 'page' })
      ).toBeInTheDocument()
    })

    it('marks P2V tab as current page on p2v route', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123/p2v')

      renderWithUser(123)

      expect(
        screen.getByRole('link', { name: 'Path to Victory', current: 'page' })
      ).toBeInTheDocument()
    })

    it('marks Elected Office tab as current page on elected-office route', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123/elected-office')

      renderWithUser(123)

      expect(
        screen.getByRole('link', { name: 'Elected Office', current: 'page' })
      ).toBeInTheDocument()
    })
  })

  describe('edit mode', () => {
    it('generates correct hrefs for edit mode', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/789/edit')

      renderWithUser(789, { isEditMode: true })

      expect(screen.getByRole('link', { name: 'User' })).toHaveAttribute(
        'href',
        '/dashboard/users/789/edit'
      )
      expect(screen.getByRole('link', { name: 'Campaign' })).toHaveAttribute(
        'href',
        '/dashboard/users/789/edit/campaign'
      )
      expect(
        screen.getByRole('link', { name: 'Path to Victory' })
      ).toHaveAttribute('href', '/dashboard/users/789/edit/p2v')
      expect(
        screen.getByRole('link', { name: 'Elected Office' })
      ).toHaveAttribute('href', '/dashboard/users/789/edit/elected-office')
    })

    it('marks User tab as current page on edit base route', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123/edit')

      renderWithUser(123, { isEditMode: true })

      expect(
        screen.getByRole('link', { name: 'User', current: 'page' })
      ).toBeInTheDocument()
    })

    it('marks Campaign tab as current page on edit campaign route', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123/edit/campaign')

      renderWithUser(123, { isEditMode: true })

      expect(
        screen.getByRole('link', { name: 'Campaign', current: 'page' })
      ).toBeInTheDocument()
    })
  })
})
