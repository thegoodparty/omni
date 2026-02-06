import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TabNavigation } from './TabNavigation'

// Mock next/navigation
const mockUsePathname = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

describe('TabNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('view mode', () => {
    it('renders all tab links', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123')

      render(<TabNavigation userId="123" />)

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

      render(<TabNavigation userId="456" />)

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

      render(<TabNavigation userId="123" />)

      expect(
        screen.getByRole('link', { name: 'User', current: 'page' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Campaign' })
      ).not.toHaveAttribute('aria-current')
    })

    it('marks Campaign tab as current page on campaign route', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123/campaign')

      render(<TabNavigation userId="123" />)

      expect(
        screen.getByRole('link', { name: 'Campaign', current: 'page' })
      ).toBeInTheDocument()
    })

    it('marks P2V tab as current page on p2v route', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123/p2v')

      render(<TabNavigation userId="123" />)

      expect(
        screen.getByRole('link', { name: 'Path to Victory', current: 'page' })
      ).toBeInTheDocument()
    })

    it('marks Elected Office tab as current page on elected-office route', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123/elected-office')

      render(<TabNavigation userId="123" />)

      expect(
        screen.getByRole('link', { name: 'Elected Office', current: 'page' })
      ).toBeInTheDocument()
    })
  })

  describe('edit mode', () => {
    it('generates correct hrefs for edit mode', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/789/edit')

      render(<TabNavigation userId="789" isEditMode />)

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

      render(<TabNavigation userId="123" isEditMode />)

      expect(
        screen.getByRole('link', { name: 'User', current: 'page' })
      ).toBeInTheDocument()
    })

    it('marks Campaign tab as current page on edit campaign route', () => {
      mockUsePathname.mockReturnValue('/dashboard/users/123/edit/campaign')

      render(<TabNavigation userId="123" isEditMode />)

      expect(
        screen.getByRole('link', { name: 'Campaign', current: 'page' })
      ).toBeInTheDocument()
    })
  })
})
